import * as THREE from 'three';

// Convert millimeters to scene units (1 unit ~= 1 cm for readability)
const MM_TO_UNITS = 0.01;
const DEFAULT_COLOR = new THREE.Color('#6bc4ff');
const SELECTED_COLOR = new THREE.Color('#c3b8ff');
const JOINT_COLOR = new THREE.Color('#ffd166');
const JOINT_THRESHOLD = 0.03; // ~30 mm

let contextRefs = null;
let undoRedo = null;
let overlayElement = null;
let selectionElement = null;

const tubes = new Map();
let selectedTubeId = null;
let wireframeEnabled = false;
let snapIncrementRad = THREE.MathUtils.degToRad(45);
let interactionSnapshot = null;
let pendingClearSelection = false;
let transformDragging = false;
let transformInteracting = false;
let placementMode = false;
let pendingTubeParams = null;
let currentJointCount = 0; // Track current joint count to prevent overlay reset

// Joint system: Track which tubes are jointed together
// Format: Map<tubeId, Set<tubeId>> - each tube knows which other tubes it's jointed with
const joints = new Map(); // Bidirectional: if A is jointed to B, both A and B have each other in their sets
let jointedTubesSnapshots = new Map(); // Store initial transforms of jointed tubes when dragging starts

const raycaster = new THREE.Raycaster();
// Enable all layers for raycaster to work with TransformControls
raycaster.layers.enableAll();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y=0 plane
const intersectionPoint = new THREE.Vector3();

let nextId = 1;
let getTubeParamsCallback = null; // Will be set by UI controls
let placementModeChangeCallback = null; // Callback when placement mode changes

export function createTubeManager(sceneContext, undoRedoManager, overlayInfoEl, selectionSummaryEl) {
  contextRefs = sceneContext;
  undoRedo = undoRedoManager;
  overlayElement = overlayInfoEl;
  selectionElement = selectionSummaryEl;

  setupPointerControls();
  hookTransformControls();
  updateOverlay();

  return {
    addTube: (params) => addTube(params),
    deleteSelectedTube: () => deleteSelectedTube(),
    toggleWireframe: () => setWireframe(!wireframeEnabled),
    setWireframe: (state) => setWireframe(state),
    setTransformMode: (mode) => {
      const controls = contextRefs.transformControls;
      if (controls) {
        controls.setMode(mode);
        // If there's a selected object, refresh the attachment to ensure gizmo updates
        if (controls.object && selectedTubeId) {
          const currentObject = controls.object;
          // Re-attach to refresh the gizmo
          controls.detach();
          controls.attach(currentObject);
          controls.visible = true;
          if (controls.updateMatrixWorld) {
            controls.updateMatrixWorld();
          }
        }
        console.log(`TransformControls mode set to: ${mode}`, {
          hasObject: !!controls.object,
          visible: controls.visible
        });
      }
    },
    rotateSelectedTube: (degrees, axis = 'y') => rotateSelectedTube(degrees, axis),
    setSnapIncrement: (degrees) => {
      snapIncrementRad = THREE.MathUtils.degToRad(Math.max(1, degrees));
      contextRefs.transformControls.setRotationSnap(snapIncrementRad);
      updateOverlay();
    },
    getSelectedTube: () => (selectedTubeId ? tubes.get(selectedTubeId) : null),
    getTubeCount: () => tubes.size,
    recoverLostTubes: () => recoverLostTubes(),
    setTubeParamsCallback: (callback) => {
      getTubeParamsCallback = callback;
    },
    enterPlacementMode: (params) => {
      placementMode = true;
      pendingTubeParams = params;
      // Clear any selection when entering placement mode
      if (selectedTubeId) {
        clearSelection();
      }
      if (placementModeChangeCallback) {
        placementModeChangeCallback(true);
      }
    },
    cancelPlacementMode: () => {
      placementMode = false;
      pendingTubeParams = null;
      if (placementModeChangeCallback) {
        placementModeChangeCallback(false);
      }
    },
    isPlacementMode: () => placementMode,
    setPlacementModeChangeCallback: (callback) => {
      placementModeChangeCallback = callback;
    }
  };
}

function addTube(params, options = {}) {
  const validated = sanitizeTubeParams(params);
  const geometry = buildTubeGeometry(validated);
  const material = new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR.clone(),
    metalness: 0.15,
    roughness: 0.55,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.visible = true; // Ensure it's visible
  // CRITICAL: Set renderOrder so TransformControls gizmo renders on top
  // Objects with transparent materials need lower renderOrder
  mesh.renderOrder = -1;

  const tubeId = options.existingId ?? `tube-${nextId++}`;

  mesh.userData = {
    id: tubeId,
    params: validated,
    state: {
      selected: false,
      jointCandidate: false
    }
  };

  // Position new tubes - use provided transform or default to origin
  // Always ensure Y is 0 so tubes sit on the ground plane
  if (options.transform && options.transform.position) {
    mesh.position.copy(options.transform.position);
    mesh.position.y = 0; // Ensure tube sits on ground plane
  } else if (!options.transform) {
    // Default position at origin (y=0) if no transform provided
    mesh.position.set(0, 0, 0);
  }

  const addedToScene = safeAddToScene(mesh);
  
  // Debug: Verify tube is in scene and visible
  const isInScene = mesh.parent === contextRefs.scene || 
                   contextRefs.scene?.children?.includes(mesh);
  console.log(`Tube ${tubeId} added:`, {
    addedToScene,
    isInScene,
    hasParent: !!mesh.parent,
    parentIsScene: mesh.parent === contextRefs.scene,
    visible: mesh.visible,
    position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    hasGeometry: !!mesh.geometry,
    hasMaterial: !!mesh.material,
    geometryVertices: mesh.geometry?.attributes?.position?.count || 0
  });
  
  if (!isInScene) {
    console.error(`CRITICAL: Tube ${tubeId} is NOT in the scene!`);
  }
  if (!mesh.visible) {
    console.warn(`Tube ${tubeId} is not visible!`);
    mesh.visible = true;
  }

  const tube = {
    id: tubeId,
    mesh,
    params: validated
  };
  tubes.set(tubeId, tube);

  updateOverlay();

  if (options.transform) {
    applyTransform(mesh, options.transform);
  }

  const recordedTransform = captureTransform(mesh);

  if (!options.skipHistory) {
    undoRedo.record({
      description: 'add tube',
      undo: () => removeTubeById(tubeId, { skipHistory: true }),
      redo: () => {
        addTube(validated, {
          skipHistory: true,
          existingId: tubeId,
          transform: recordedTransform
        });
      }
    });
  }

  // Only auto-select if not in placement mode (allows continuous placement)
  if (!placementMode) {
    selectTube(tubeId);
  }
  return tube;
}

function sanitizeTubeParams(params) {
  const base = {
    type: params.type || 'rectangular',
    width: Number(params.width) || 80,
    height: Number(params.height) || 60,
    thickness: Number(params.thickness) || 4,
    length: Number(params.length) || 300
  };

  if (base.type === 'square') {
    base.height = base.width;
  }

  base.width = Math.max(10, base.width);
  base.height = Math.max(10, base.height);
  base.thickness = THREE.MathUtils.clamp(base.thickness, 2, Math.min(base.width, base.height) / 2 - 1);
  base.length = Math.max(50, base.length);
  return base;
}

function buildTubeGeometry(params) {
  const halfWidth = (params.width * MM_TO_UNITS) / 2;
  const halfHeight = (params.height * MM_TO_UNITS) / 2;
  const thickness = params.thickness * MM_TO_UNITS;

  const outerShape = new THREE.Shape();
  outerShape.moveTo(-halfWidth, -halfHeight);
  outerShape.lineTo(-halfWidth, halfHeight);
  outerShape.lineTo(halfWidth, halfHeight);
  outerShape.lineTo(halfWidth, -halfHeight);
  outerShape.closePath();

  const innerWidth = halfWidth - thickness;
  const innerHeight = halfHeight - thickness;
  const holePath = new THREE.Path();
  holePath.moveTo(-innerWidth, -innerHeight);
  holePath.lineTo(-innerWidth, innerHeight);
  holePath.lineTo(innerWidth, innerHeight);
  holePath.lineTo(innerWidth, -innerHeight);
  holePath.closePath();
  outerShape.holes.push(holePath);

  const extrudeSettings = {
    depth: params.length * MM_TO_UNITS,
    bevelEnabled: false,
    steps: 1
  };

  const geometry = new THREE.ExtrudeGeometry(outerShape, extrudeSettings);
  
  // Don't center - we want the bottom of the tube to sit on the ground plane (y=0)
  // Instead, translate so the bottom is at y=0
  geometry.computeBoundingBox();
  const boundingBox = geometry.boundingBox;
  if (boundingBox) {
    // Move geometry up so the bottom (minY) is at 0
    const offsetY = -boundingBox.min.y;
    geometry.translate(0, offsetY, 0);
  } else {
    // Fallback: center if bounding box computation fails
    geometry.center();
  }
  
  geometry.computeBoundingBox(); // Recompute after translation
  geometry.computeVertexNormals();
  
  // Verify geometry is valid
  const vertexCount = geometry.attributes?.position?.count || 0;
  if (vertexCount === 0) {
    console.error('CRITICAL: Geometry has no vertices!', {
      width: params.width,
      height: params.height,
      thickness: params.thickness,
      length: params.length
    });
  } else {
    console.log(`Geometry created with ${vertexCount} vertices`);
  }
  
  return geometry;
}

function setupPointerControls() {
  const domElement = contextRefs.renderer.domElement;
  domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // Only block selection if actively dragging the transform controls
    if (transformDragging || transformInteracting) return;
    
    // Right-click or Shift+click to deselect or cancel placement
    if (event.button === 2 || event.shiftKey) {
      if (placementMode) {
        // Cancel placement mode
        placementMode = false;
        pendingTubeParams = null;
        if (placementModeChangeCallback) {
          placementModeChangeCallback(false);
        }
      } else {
        clearSelection();
      }
      return;
    }
    
    setPointerFromEvent(event);
    const intersects = raycaster.intersectObjects([...tubes.values()].map((tube) => tube.mesh), false);
    
    if (intersects.length > 0) {
      // Clicked on a tube
      if (placementMode) {
        // In placement mode, clicking on a tube cancels placement
        placementMode = false;
        pendingTubeParams = null;
        if (placementModeChangeCallback) {
          placementModeChangeCallback(false);
        }
      }
      // Select the tube
      pendingClearSelection = false;
      const tubeId = intersects[0].object.userData.id;
      selectTube(tubeId);
    } else {
      // Clicked on empty space
      if (placementMode && pendingTubeParams) {
        // In placement mode - place tube at clicked position
        raycaster.setFromCamera(pointer, contextRefs.camera);
        raycaster.ray.intersectPlane(groundPlane, intersectionPoint);
        
        if (intersectionPoint) {
          // Place tube at clicked position, ensuring it sits on the ground plane (y=0)
          const placementPosition = intersectionPoint.clone();
          placementPosition.y = 0; // Force Y to 0 so tube sits on plane
          addTube(pendingTubeParams, {
            transform: {
              position: placementPosition,
              rotation: new THREE.Euler(0, 0, 0)
            }
          });
          // Stay in placement mode so user can place more tubes
          // Placement mode will only exit when explicitly cancelled
        }
      } else {
        // Not in placement mode - just mark for deselection
        pendingClearSelection = true;
      }
    }
  });

  domElement.addEventListener('pointerup', () => {
    // Only clear selection if we didn't place a tube
    if (pendingClearSelection && !transformDragging && !transformInteracting) {
      clearSelection();
    }
    pendingClearSelection = false;
  });
  
  // Prevent context menu on right-click
  domElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });
  
  // Add keyboard listener for Escape to cancel placement mode
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && placementMode) {
      placementMode = false;
      pendingTubeParams = null;
      if (placementModeChangeCallback) {
        placementModeChangeCallback(false);
      }
    }
  });
}

function hookTransformControls() {
  const controls = contextRefs.transformControls;

  const handleTransformPointerDown = (event) => {
    transformInteracting = true;
    pendingClearSelection = false;
    // Disable OrbitControls immediately when clicking on gizmo (like Blender)
    if (contextRefs.orbitControls) {
      contextRefs.orbitControls.enabled = false;
      console.log('OrbitControls disabled - gizmo interaction started');
    }
  };

  const handleTransformPointerUp = (event) => {
    transformInteracting = false;
    pendingClearSelection = false;
    // Re-enable OrbitControls when releasing gizmo (if not dragging)
    if (contextRefs.orbitControls && !transformDragging) {
      contextRefs.orbitControls.enabled = true;
      console.log('OrbitControls re-enabled - gizmo interaction ended');
    }
  };

  // According to Three.js docs, TransformControls fires these events
  // Make sure we're listening to the right events
  if (controls.addEventListener) {
    controls.addEventListener('mouseDown', handleTransformPointerDown);
    controls.addEventListener('mouseUp', handleTransformPointerUp);
    controls.addEventListener('touchStart', handleTransformPointerDown);
    controls.addEventListener('touchEnd', handleTransformPointerUp);
    console.log('TransformControls event listeners attached');
  }

  contextRefs.transformControls.addEventListener('dragging-changed', (event) => {
    transformDragging = event.value;
    pendingClearSelection = false;
    
    // Disable OrbitControls when dragging gizmo (like Blender)
    if (contextRefs.orbitControls) {
      contextRefs.orbitControls.enabled = !event.value;
    }
    
    if (event.value) {
      const mesh = contextRefs.transformControls.object;
      if (mesh && mesh.isMesh) {
        // Validate position before starting drag
        if (!isValidPosition(mesh.position)) {
          console.warn('Invalid position before drag, resetting to origin');
          mesh.position.set(0, 0, 0);
        }
        // Ensure mesh is in scene before starting drag
        if (!mesh.parent) {
          safeAddToScene(mesh);
        }
        interactionSnapshot = captureTransform(mesh);
        
        // Capture snapshots of all jointed tubes so they move together
        const tubeId = mesh.userData?.id;
        if (tubeId) {
          const jointedIds = getJointedTubes(tubeId);
          jointedTubesSnapshots.clear();
          jointedIds.forEach(id => {
            if (id !== tubeId) { // Don't snapshot the active tube, we already have interactionSnapshot
              const jointedTube = tubes.get(id);
              if (jointedTube) {
                jointedTubesSnapshots.set(id, captureTransform(jointedTube.mesh));
              }
            }
          });
          if (jointedIds.length > 1) {
            console.log(`📎 Moving ${jointedIds.length} jointed tubes together`);
          }
        }
      }
    } else if (interactionSnapshot && contextRefs.transformControls.object) {
      const mesh = contextRefs.transformControls.object;
      if (!mesh || !mesh.isMesh) {
        interactionSnapshot = null;
        return;
      }
      
      // Clamp position to reasonable values to prevent NaN/Infinity
      const MAX_POS = 1000; // Reasonable max position
      mesh.position.x = Math.max(-MAX_POS, Math.min(MAX_POS, mesh.position.x));
      mesh.position.y = Math.max(-MAX_POS, Math.min(MAX_POS, mesh.position.y));
      mesh.position.z = Math.max(-MAX_POS, Math.min(MAX_POS, mesh.position.z));
      
      // Validate position after drag
      if (!isValidPosition(mesh.position)) {
        console.warn('Invalid position after drag, resetting to snapshot');
        applyTransform(mesh, interactionSnapshot);
        interactionSnapshot = null;
        updateOverlay();
        return;
      }
      
      // CRITICAL: Ensure mesh is still in scene and visible
      if (!mesh.parent) {
        console.warn('Mesh lost parent during drag, re-adding to scene');
        safeAddToScene(mesh);
      }
      if (!mesh.visible) {
        console.warn('Mesh became invisible during drag, making visible');
        mesh.visible = true;
      }
      
      // Verify mesh is still valid
      if (!mesh.geometry || !mesh.material) {
        console.error('CRITICAL: Mesh lost geometry or material during drag!');
        // Try to restore from snapshot
        if (interactionSnapshot) {
          applyTransform(mesh, interactionSnapshot);
        }
        interactionSnapshot = null;
        return;
      }
      
      const after = captureTransform(mesh);
      const tubeId = mesh.userData?.id;
      if (!tubeId) {
        console.error('CRITICAL: Mesh lost userData.id during drag!');
        interactionSnapshot = null;
        return;
      }
      
      // Verify the tube still exists in our map
      if (!tubes.has(tubeId)) {
        console.error('CRITICAL: Tube not found in tubes map after drag!');
        interactionSnapshot = null;
        return;
      }
      
      // Record undo/redo for the active tube and all jointed tubes
      const jointedSnapshots = new Map();
      const jointedAfter = new Map();
      
      if (tubeId && jointedTubesSnapshots.size > 0) {
        jointedTubesSnapshots.forEach((snapshot, jointedId) => {
          const jointedTube = tubes.get(jointedId);
          if (jointedTube) {
            jointedSnapshots.set(jointedId, snapshot);
            jointedAfter.set(jointedId, captureTransform(jointedTube.mesh));
          }
        });
      }
      
      undoRedo.record({
        description: jointedSnapshots.size > 0 ? `transform ${1 + jointedSnapshots.size} jointed tubes` : 'transform tube',
        undo: () => {
          applyTransform(mesh, interactionSnapshot);
          jointedSnapshots.forEach((snapshot, jointedId) => {
            const jointedTube = tubes.get(jointedId);
            if (jointedTube) {
              applyTransform(jointedTube.mesh, snapshot);
            }
          });
          updateJointPreview(mesh);
        },
        redo: () => {
          applyTransform(mesh, after);
          jointedAfter.forEach((afterTransform, jointedId) => {
            const jointedTube = tubes.get(jointedId);
            if (jointedTube) {
              applyTransform(jointedTube.mesh, afterTransform);
            }
          });
          updateJointPreview(mesh);
        }
      });
      interactionSnapshot = null;
      jointedTubesSnapshots.clear();
      updateOverlay();
    }
  });

  contextRefs.transformControls.addEventListener('objectChange', () => {
    const mesh = contextRefs.transformControls.object;
    if (!mesh || !mesh.isMesh) return;
    
    // CRITICAL: Ensure mesh stays in scene and visible during transform
    if (!mesh.parent && contextRefs.scene) {
      console.warn('Mesh lost parent during objectChange, re-adding');
      safeAddToScene(mesh);
    }
    if (!mesh.visible) {
      mesh.visible = true;
    }
    
    // Clamp position values to prevent NaN/Infinity
    const MAX_POS = 1000;
    if (!isFinite(mesh.position.x) || isNaN(mesh.position.x)) {
      mesh.position.x = Math.max(-MAX_POS, Math.min(MAX_POS, mesh.position.x || 0));
    } else {
      mesh.position.x = Math.max(-MAX_POS, Math.min(MAX_POS, mesh.position.x));
    }
    if (!isFinite(mesh.position.y) || isNaN(mesh.position.y)) {
      mesh.position.y = Math.max(-MAX_POS, Math.min(MAX_POS, mesh.position.y || 0));
    } else {
      mesh.position.y = Math.max(-MAX_POS, Math.min(MAX_POS, mesh.position.y));
    }
    if (!isFinite(mesh.position.z) || isNaN(mesh.position.z)) {
      mesh.position.z = Math.max(-MAX_POS, Math.min(MAX_POS, mesh.position.z || 0));
    } else {
      mesh.position.z = Math.max(-MAX_POS, Math.min(MAX_POS, mesh.position.z));
    }
    
    // During active dragging, move all jointed tubes together
    if (transformDragging && interactionSnapshot) {
      const tubeId = mesh.userData?.id;
      if (tubeId && jointedTubesSnapshots.size > 0) {
        // Calculate the delta (change) in the active tube's position
        const deltaPosition = new THREE.Vector3().subVectors(mesh.position, interactionSnapshot.position);
        
        // Apply the same position delta to all jointed tubes
        jointedTubesSnapshots.forEach((snapshot, jointedId) => {
          const jointedTube = tubes.get(jointedId);
          if (jointedTube && jointedTube.mesh) {
            const jointedMesh = jointedTube.mesh;
            // Calculate new position: initial position + delta
            const newPos = new THREE.Vector3().addVectors(snapshot.position, deltaPosition);
            
            // Clamp position
            const MAX_POS = 1000;
            jointedMesh.position.x = Math.max(-MAX_POS, Math.min(MAX_POS, newPos.x));
            jointedMesh.position.y = Math.max(-MAX_POS, Math.min(MAX_POS, newPos.y));
            jointedMesh.position.z = Math.max(-MAX_POS, Math.min(MAX_POS, newPos.z));
          }
        });
      }
      updateJointPreview(mesh);
      return;
    }
    
    // Ensure mesh is still in the scene (but don't do this during drag)
    if (!mesh.parent) {
      console.warn('Mesh lost parent, re-adding to scene');
      safeAddToScene(mesh);
    }
    
    if (contextRefs.transformControls.getMode() === 'rotate') {
      applyRotationSnap(mesh);
    }
    updateJointPreview(mesh);
  });
}

function isTransformControlActive() {
  const controls = contextRefs?.transformControls;
  if (!controls) return false;
  return controls.dragging || controls.axis !== null;
}

function rotateSelectedTube(degrees, axis) {
  if (!selectedTubeId) return;
  const tube = tubes.get(selectedTubeId);
  if (!tube) return;
  const mesh = tube.mesh;
  const before = captureTransform(mesh);
  const radians = THREE.MathUtils.degToRad(degrees);
  mesh.rotation[axis] += radians;
  applyRotationSnap(mesh);
  updateJointPreview(mesh);
  undoRedo.record({
    description: 'rotate tube',
    undo: () => {
      applyTransform(mesh, before);
      updateJointPreview(mesh);
    },
    redo: () => {
      mesh.rotation[axis] += radians;
      applyRotationSnap(mesh);
      updateJointPreview(mesh);
    }
  });
  updateOverlay();
}

function deleteSelectedTube() {
  if (!selectedTubeId) return;
  const id = selectedTubeId;
  const tube = tubes.get(id);
  if (!tube) return;
  const snapshot = captureTubeState(tube);
  removeTubeById(id, { skipHistory: true });
  undoRedo.record({
    description: 'delete tube',
    undo: () => {
      addTube(snapshot.params, {
        skipHistory: true,
        existingId: snapshot.id,
        transform: snapshot.transform
      });
    },
    redo: () => removeTubeById(snapshot.id, { skipHistory: true })
  });
  updateOverlay();
}

function removeTubeById(id, options = {}) {
  const tube = tubes.get(id);
  if (!tube) return;
  
  // Clean up all joints for this tube
  removeAllJointsForTube(id);
  
  contextRefs.scene.remove(tube.mesh);
  if (contextRefs.transformControls.object === tube.mesh) {
    contextRefs.transformControls.detach();
  }
  tubes.delete(id);
  if (selectedTubeId === id) {
    selectedTubeId = null;
    updateSelectionPanel(null);
  }
  if (!options.skipHistory) {
    undoRedo.record({
      description: 'remove tube',
      undo: () => addTube(tube.params, { skipHistory: true, existingId: id }),
      redo: () => removeTubeById(id, { skipHistory: true })
    });
  }
  updateOverlay();
}

function selectTube(id) {
  if (selectedTubeId === id) return;
  if (selectedTubeId) {
    const prev = tubes.get(selectedTubeId);
    if (prev) {
      prev.mesh.userData.state.selected = false;
      refreshTubeMaterial(prev.mesh);
    }
  }
  selectedTubeId = id;
  const tube = tubes.get(id);
  if (!tube) {
    clearSelection();
    return;
  }
  
  // Ensure mesh is in the scene and has valid position
  const mesh = tube.mesh;
  if (!mesh.parent && contextRefs.scene) {
    console.warn(`Tube ${id} lost parent, re-adding to scene`);
    safeAddToScene(mesh);
  }
  
  if (!isValidPosition(mesh.position)) {
    console.warn(`Tube ${id} has invalid position, resetting to origin`);
    mesh.position.set(0, 0, 0);
  }
  
  mesh.userData.state.selected = true;
  refreshTubeMaterial(mesh);
  
  // Ensure TransformControls is properly attached and visible
  const controls = contextRefs.transformControls;
  if (controls && mesh instanceof THREE.Object3D && mesh.isMesh) {
    try {
      // Don't attach during active drag
      if (transformDragging) {
        return;
      }
      
      // Detach any existing object first to avoid conflicts
      if (controls.object && controls.object !== mesh) {
        try {
          controls.detach();
        } catch (e) {
          console.warn('Error detaching previous object:', e);
        }
      }
      
      // TransformControls should already be in the scene from initialization
      // Don't try to add it again - it's added once in threeScene.js
      
      // Verify mesh is valid before attaching
      if (mesh.geometry && mesh.material && isValidPosition(mesh.position)) {
        // Set mode BEFORE attaching (important for TransformControls)
        // Default to translate mode if not set
        const currentMode = controls.getMode();
        if (!currentMode || currentMode === 'scale') {
          controls.setMode('translate');
        }
        
        // CRITICAL FIX: TransformControls in this version uses internal _gizmo and _root
        // These are created when we attach, so we need to add them after attaching
        // First attach, then add the gizmo objects
        
        // Also try to add TransformControls itself (might work in some cases)
        const isInScene = controls.parent === contextRefs.scene || 
                         contextRefs.scene?.children?.includes(controls);
        if (!isInScene) {
          try {
            // Try adding it - might work even if not Object3D
            contextRefs.scene.add(controls);
            console.log('TransformControls added to scene');
          } catch (addError) {
            // If that fails, it's okay - we have _gizmo and _plane
            console.log('TransformControls itself not added (using _gizmo/_plane instead)');
          }
        }
        
        // Set renderOrder so gizmo renders on top
        if (controls.renderOrder !== undefined) {
          controls.renderOrder = 999;
        }
        if (controls._gizmo && controls._gizmo.renderOrder !== undefined) {
          controls._gizmo.renderOrder = 999;
        }
        
        // According to Three.js docs, TransformControls must be in scene before attaching
        // Ensure it's in the scene
        const controlsInScene = controls.parent === contextRefs.scene || 
                               contextRefs.scene?.children?.includes(controls);
        if (!controlsInScene) {
          console.warn('⚠️ TransformControls not in scene before attach - attempting to add');
          try {
            contextRefs.scene.add(controls);
            console.log('TransformControls added to scene before attach');
          } catch (e) {
            console.error('Failed to add TransformControls to scene:', e);
          }
        }
        
        // Attach the mesh with error handling
        try {
          // Ensure controls are visible before attaching
          controls.visible = true;
          
          controls.attach(mesh);
          console.log('✅ TransformControls.attach() called successfully');
          
          // After attach, the gizmo should be created automatically
          // Ensure TransformControls is visible (gizmo visibility follows this)
          controls.visible = true;
          
          // CRITICAL: In this Three.js version, TransformControls uses internal _gizmo and _root
          // These must be manually added to the scene for the gizmo to render
          // _gizmo contains the visual arrows (the gizmo you see)
          if (controls._gizmo) {
            try {
              const gizmoInScene = controls._gizmo.parent === contextRefs.scene || 
                                  contextRefs.scene?.children?.includes(controls._gizmo);
              if (!gizmoInScene) {
                contextRefs.scene.add(controls._gizmo);
                controls._gizmo.visible = true;
                controls._gizmo.renderOrder = 999; // Render on top
                console.log('✅ TransformControls._gizmo added to scene (arrows should appear!)');
              } else {
                controls._gizmo.visible = true;
                controls._gizmo.renderOrder = 999;
                console.log('TransformControls._gizmo already in scene, made visible');
              }
            } catch (e) {
              console.error('❌ Failed to add _gizmo to scene:', e);
            }
          } else {
            console.warn('⚠️ TransformControls._gizmo not found after attach - gizmo will not render!');
          }
          
          // _root is the root container for the gizmo
          if (controls._root) {
            try {
              const rootInScene = controls._root.parent === contextRefs.scene || 
                                 contextRefs.scene?.children?.includes(controls._root);
              if (!rootInScene) {
                contextRefs.scene.add(controls._root);
                controls._root.visible = true;
                controls._root.renderOrder = 999;
                console.log('✅ TransformControls._root added to scene');
              } else {
                controls._root.visible = true;
              }
            } catch (e) {
              console.warn('Could not add _root to scene:', e);
            }
          }
          
          // _plane is used for dragging interaction, not the visual gizmo
          if (controls._plane) {
            try {
              const planeInScene = controls._plane.parent === contextRefs.scene || 
                                  contextRefs.scene?.children?.includes(controls._plane);
              if (!planeInScene) {
                contextRefs.scene.add(controls._plane);
                console.log('TransformControls._plane added to scene');
              }
            } catch (e) {
              // _plane is optional, not critical for visual gizmo
            }
          }
        } catch (error) {
          console.error('❌ Error attaching TransformControls:', error);
          console.error('This will prevent the gizmo from appearing!');
        }
        
        // Verify attachment worked
        if (controls.object !== mesh) {
          console.error('TransformControls attachment failed - object mismatch', {
            expected: mesh.userData?.id,
            actual: controls.object?.userData?.id
          });
          // Try attaching again
          try {
            controls.attach(mesh);
            if (controls.object === mesh) {
              console.log('Second attach attempt succeeded');
            } else {
              console.error('Second attach attempt also failed');
              return; // Don't continue if attachment failed
            }
          } catch (retryError) {
            console.error('Retry attach also failed:', retryError);
            return; // Don't continue if attachment failed
          }
        }
        
        // Re-apply mode after attaching to ensure it's properly set
        const modeToSet = controls.getMode() || 'translate';
        controls.setMode(modeToSet);
        console.log(`Mode re-applied after attach: ${modeToSet}`);
        
        // Ensure visibility is explicitly set
        controls.visible = true;
        
        // Verify the controls are actually visible
        if (!controls.visible) {
          console.warn('TransformControls.visible is false after setting to true!');
          controls.visible = true; // Force it again
        }
        
        // According to Three.js documentation, TransformControls extends Object3D
        // and MUST be in the scene for the gizmo to render
        // Verify it's in the scene (recheck after attach)
        const controlsInSceneAfterAttach = controls.parent === contextRefs.scene || 
                               contextRefs.scene?.children?.includes(controls);
        if (!controlsInSceneAfterAttach) {
          console.warn('⚠️ TransformControls not in scene - gizmo will not render!');
          try {
            contextRefs.scene.add(controls);
            console.log('✅ TransformControls added to scene (required for gizmo)');
          } catch (e) {
            console.error('❌ Failed to add TransformControls to scene:', e);
            // Last resort: direct manipulation
            try {
              if (!contextRefs.scene.children.includes(controls)) {
                contextRefs.scene.children.push(controls);
                controls.parent = contextRefs.scene;
                console.log('TransformControls added via workaround');
              }
            } catch (e2) {
              console.error('All methods to add TransformControls failed:', e2);
            }
          }
        }
        
        // Force update to ensure gizmo appears
        if (typeof controls.update === 'function') {
          controls.update();
        }
        if (typeof controls.updateMatrixWorld === 'function') {
          controls.updateMatrixWorld();
        }
        
        // Update the camera to ensure it's looking at the right place
        if (contextRefs.camera) {
          contextRefs.camera.updateMatrixWorld();
        }
        
        // Check if TransformControls has gizmo helpers (the arrows)
        const gizmoHelpers = [];
        let totalChildren = 0;
        if (controls.children && controls.children.length > 0) {
          totalChildren = controls.children.length;
          controls.traverse((child) => {
            gizmoHelpers.push({
              type: child.type,
              name: child.name || 'unnamed',
              visible: child.visible !== false,
              isHelper: child.type === 'ArrowHelper' || child.type === 'Line' || child.name?.includes('helper')
            });
          });
        } else {
          console.warn('TransformControls has NO children - gizmo helpers not created!');
        }
        
        // Log detailed info for debugging
        const debugInfo = {
          mode: controls.getMode(),
          visible: controls.visible,
          object: controls.object?.userData?.id,
          objectType: controls.object?.constructor?.name,
          // TransformControls doesn't need to be in scene in this version
          attached: !!controls.object && controls.object === mesh,
          objectPosition: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
          controlsPosition: controls.position ? { x: controls.position.x, y: controls.position.y, z: controls.position.z } : null,
          hasObject: !!controls.object,
          objectIsMesh: controls.object?.isMesh,
          gizmoHelpersCount: gizmoHelpers.length,
          gizmoHelpers: gizmoHelpers,
          controlsChildrenCount: totalChildren,
          allChildren: gizmoHelpers, // Show all children for debugging
          isInScene: controls.parent === contextRefs.scene || contextRefs.scene?.children?.includes(controls),
          hasTraverse: typeof controls.traverse === 'function',
          cameraPosition: contextRefs.camera?.position ? {
            x: contextRefs.camera.position.x,
            y: contextRefs.camera.position.y,
            z: contextRefs.camera.position.z
          } : null
        };
        console.log(`TransformControls attached to ${id}`, debugInfo);
        
        // Comprehensive diagnostic
        console.log('=== TransformControls Diagnostic ===');
        console.log('Controls object:', controls);
        console.log('Controls type:', controls.constructor?.name);
        console.log('Is Object3D:', controls instanceof THREE.Object3D);
        console.log('Has children:', !!controls.children, 'Count:', controls.children?.length || 0);
        console.log('Visible:', controls.visible);
        console.log('Mode:', controls.getMode());
        console.log('Attached object:', controls.object?.userData?.id);
        console.log('In scene:', controls.parent === contextRefs.scene || contextRefs.scene?.children?.includes(controls));
        console.log('Scene children count:', contextRefs.scene?.children?.length);
        
        // CRITICAL FIX: In this Three.js version, TransformControls uses internal _gizmo and _root
        // These are NOT children, they're internal properties that need to be added to scene
        if (gizmoHelpers.length === 0 && totalChildren === 0) {
          console.warn('⚠️ TransformControls has no children - using internal _gizmo/_root instead');
          
          // Add _gizmo to scene (this contains the visual arrows)
          if (controls._gizmo) {
            try {
              // Check if _gizmo is already in scene
              const gizmoInScene = controls._gizmo.parent === contextRefs.scene || 
                                  contextRefs.scene?.children?.includes(controls._gizmo);
              if (!gizmoInScene) {
                contextRefs.scene.add(controls._gizmo);
                controls._gizmo.visible = true;
                controls._gizmo.renderOrder = 999;
                console.log('✅ TransformControls._gizmo added to scene - arrows should appear!');
              } else {
                controls._gizmo.visible = true;
                console.log('TransformControls._gizmo already in scene, made visible');
              }
            } catch (e) {
              console.error('❌ Failed to add _gizmo to scene:', e);
            }
          } else {
            console.error('❌ TransformControls._gizmo does not exist!');
          }
          
          // Add _root to scene (this is the root container for gizmo)
          if (controls._root) {
            try {
              const rootInScene = controls._root.parent === contextRefs.scene || 
                                 contextRefs.scene?.children?.includes(controls._root);
              if (!rootInScene) {
                contextRefs.scene.add(controls._root);
                controls._root.visible = true;
                controls._root.renderOrder = 999;
                console.log('✅ TransformControls._root added to scene');
              } else {
                controls._root.visible = true;
              }
            } catch (e) {
              console.error('Failed to add _root to scene:', e);
            }
          }
          
          // Add _plane to scene (used for dragging plane)
          if (controls._plane) {
            try {
              const planeInScene = controls._plane.parent === contextRefs.scene || 
                                  contextRefs.scene?.children?.includes(controls._plane);
              if (!planeInScene) {
                contextRefs.scene.add(controls._plane);
                console.log('TransformControls._plane added to scene');
              }
            } catch (e) {
              // _plane is optional
            }
          }
        } else if (gizmoHelpers.length > 0) {
          console.log(`✅ Found ${gizmoHelpers.length} gizmo helpers - gizmo SHOULD be visible`);
          console.log('Helper details:', gizmoHelpers);
          // Ensure all helpers are visible
          gizmoHelpers.forEach((helper, idx) => {
            if (!helper.visible) {
              console.warn(`⚠️ Gizmo helper ${idx} (${helper.type}) is not visible!`);
            }
          });
        } else {
          console.warn('⚠️ TransformControls has children but no recognized helpers');
          console.log('All children:', gizmoHelpers);
        }
        console.log('=== End Diagnostic ===');
        
        // FINAL FIX: Force add _gizmo to scene if it exists (this is the visual arrows)
        // This must happen after attach, as _gizmo might be created during attach
        if (controls._gizmo) {
          try {
            // Check what _gizmo actually is
            console.log('_gizmo type:', controls._gizmo.constructor?.name);
            console.log('_gizmo is Object3D:', controls._gizmo instanceof THREE.Object3D);
            console.log('_gizmo has parent:', !!controls._gizmo.parent);
            console.log('_gizmo visible:', controls._gizmo.visible);
            
            // Force add to scene if not already there
            if (!controls._gizmo.parent) {
              contextRefs.scene.add(controls._gizmo);
              console.log('✅ FORCED: _gizmo added to scene');
            } else if (controls._gizmo.parent !== contextRefs.scene) {
              // Remove from wrong parent and add to scene
              controls._gizmo.parent.remove(controls._gizmo);
              contextRefs.scene.add(controls._gizmo);
              console.log('✅ FORCED: _gizmo moved to scene');
            }
            
            // Ensure visibility and render order
            controls._gizmo.visible = true;
            if (controls._gizmo.renderOrder !== undefined) {
              controls._gizmo.renderOrder = 999;
            }
            
            // If _gizmo has children (the actual arrows), make sure they're visible
            if (controls._gizmo.children && controls._gizmo.children.length > 0) {
              console.log(`_gizmo has ${controls._gizmo.children.length} children (the arrows)`);
              controls._gizmo.traverse((child) => {
                if (child.visible !== undefined) {
                  child.visible = true;
                }
                if (child.renderOrder !== undefined) {
                  child.renderOrder = 999;
                }
              });
            }
          } catch (e) {
            console.error('❌ CRITICAL: Failed to add _gizmo to scene:', e);
            console.error('This is why you cannot see the arrows!');
          }
        } else {
          console.error('❌ CRITICAL: controls._gizmo does not exist!');
          console.error('TransformControls may not be properly initialized.');
        }
        
        // Also ensure _root is in scene
        if (controls._root && !controls._root.parent) {
          try {
            contextRefs.scene.add(controls._root);
            controls._root.visible = true;
            controls._root.renderOrder = 999;
            console.log('✅ FORCED: _root added to scene');
          } catch (e) {
            console.warn('Could not add _root:', e);
          }
        }
        
        // Final verification - check if everything is correct
        if (!controls.object || controls.object !== mesh) {
          console.error('CRITICAL: TransformControls object mismatch!', {
            expected: mesh.userData?.id,
            actual: controls.object?.userData?.id
          });
        }
        if (!controls.visible) {
          console.error('CRITICAL: TransformControls is not visible!');
        }
        // TransformControls doesn't need to be in the scene in this version
        // It renders automatically when attached to an object
        // Just verify it's properly attached
        if (!controls.object || controls.object !== mesh) {
          console.error('CRITICAL: TransformControls object not properly attached!');
        } else {
          console.log('TransformControls properly attached and ready to render');
        }
        
        // Ensure TransformControls is properly configured for rendering
        // Force all children to be visible (if it has children)
        if (controls.children && typeof controls.traverse === 'function') {
          controls.traverse((child) => {
            if (child.visible !== undefined) {
              child.visible = true;
            }
          });
        }
        
        // Force a render update
        if (contextRefs.renderer && contextRefs.scene && contextRefs.camera) {
          // Update mesh and camera
          if (mesh.updateMatrixWorld) {
            mesh.updateMatrixWorld(true);
          }
          if (contextRefs.camera.updateMatrixWorld) {
            contextRefs.camera.updateMatrixWorld(true);
          }
          // Update controls if method exists
          if (typeof controls.updateMatrixWorld === 'function') {
            controls.updateMatrixWorld(true);
          } else if (controls.update) {
            controls.update();
          }
          contextRefs.renderer.render(contextRefs.scene, contextRefs.camera);
          console.log('Forced render update after TransformControls attachment');
        }
      } else {
        console.error(`Invalid mesh for tube ${id}, cannot attach TransformControls`, {
          hasGeometry: !!mesh.geometry,
          hasMaterial: !!mesh.material,
          validPosition: isValidPosition(mesh.position),
          position: mesh.position
        });
      }
    } catch (error) {
      console.error('Error attaching TransformControls:', error);
      // Don't crash, just log the error
    }
  } else {
    console.warn('TransformControls or mesh not available for selection', {
      hasControls: !!controls,
      isObject3D: mesh instanceof THREE.Object3D,
      isMesh: mesh?.isMesh,
      tubeId: id
    });
  }
  
  updateSelectionPanel(tube);
  updateOverlay();
}

function clearSelection() {
  if (!selectedTubeId) return;
  const prev = tubes.get(selectedTubeId);
  if (prev) {
    prev.mesh.userData.state.selected = false;
    refreshTubeMaterial(prev.mesh);
  }
  selectedTubeId = null;
  contextRefs.transformControls.detach();
  contextRefs.transformControls.visible = false;
  
  // Re-enable OrbitControls when gizmo is hidden (like Blender)
  if (contextRefs.orbitControls && !transformDragging && !transformInteracting) {
    contextRefs.orbitControls.enabled = true;
  }
  
  updateSelectionPanel(null);
  updateOverlay();
}

function setWireframe(state) {
  wireframeEnabled = state;
  tubes.forEach((tube) => {
    tube.mesh.material.wireframe = wireframeEnabled;
    tube.mesh.material.opacity = wireframeEnabled ? 0.65 : 0.95;
    tube.mesh.material.needsUpdate = true;
  });
}

function setPointerFromEvent(event) {
  const rect = contextRefs.renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, contextRefs.camera);
}

function applyRotationSnap(mesh) {
  if (!snapIncrementRad || snapIncrementRad <= 0) return;
  ['x', 'y', 'z'].forEach((axis) => {
    const value = mesh.rotation[axis];
    mesh.rotation[axis] = Math.round(value / snapIncrementRad) * snapIncrementRad;
  });
}

function captureTransform(mesh) {
  if (!mesh) return null;
  return {
    position: mesh.position.clone(),
    rotation: mesh.rotation.clone()
  };
}

function isValidPosition(position) {
  return (
    position &&
    isFinite(position.x) &&
    isFinite(position.y) &&
    isFinite(position.z) &&
    !isNaN(position.x) &&
    !isNaN(position.y) &&
    !isNaN(position.z)
  );
}

function safeAddToScene(object) {
  if (!object || !contextRefs?.scene) return false;
  
  // Verify it's a valid THREE.Object3D
  if (!(object instanceof THREE.Object3D)) {
    console.error('Attempted to add non-Object3D to scene:', object);
    return false;
  }
  
  // Don't add if already in scene
  if (object.parent === contextRefs.scene) {
    return true;
  }
  
  // Don't add if it's already a child of something else (might cause issues)
  if (object.parent && object.parent !== contextRefs.scene) {
    console.warn('Object already has a different parent, removing from parent first');
    object.parent.remove(object);
  }
  
  try {
    contextRefs.scene.add(object);
    return true;
  } catch (error) {
    console.error('Error adding object to scene:', error, object);
    return false;
  }
}

function applyTransform(mesh, transform) {
  if (!mesh || !transform) return;
  
  // Validate position before applying
  if (isValidPosition(transform.position)) {
    mesh.position.copy(transform.position);
  } else {
    console.warn('Invalid transform position, using origin');
    mesh.position.set(0, 0, 0);
  }
  
  // Validate rotation
  if (
    isFinite(transform.rotation.x) &&
    isFinite(transform.rotation.y) &&
    isFinite(transform.rotation.z)
  ) {
    mesh.rotation.copy(transform.rotation);
  }
  
  // Ensure mesh stays in scene
  if (!mesh.parent && contextRefs.scene) {
    safeAddToScene(mesh);
  }
}

function captureTubeState(tube) {
  return {
    id: tube.id,
    params: { ...tube.params },
    transform: captureTransform(tube.mesh)
  };
}

function updateJointPreview(activeMesh) {
  // Reset all joint candidates
  tubes.forEach((tube) => {
    tube.mesh.userData.state.jointCandidate = false;
  });
  
  if (!activeMesh) {
    refreshAllMaterials();
    currentJointCount = 0; // Reset joint count when no active mesh
    updateOverlay(0);
    return;
  }

  const activeId = activeMesh.userData?.id;
  
  // CRITICAL: Update world matrix before calculating bounding box
  // This ensures the bounding box reflects the current position/rotation
  activeMesh.updateMatrixWorld(true);
  
  const activeBox = new THREE.Box3().setFromObject(activeMesh);
  let joinCount = 0;
  
  tubes.forEach((tube) => {
    if (tube.id === activeId) return;
    
    // CRITICAL: Update world matrix for other tubes too
    tube.mesh.updateMatrixWorld(true);
    
    const otherBox = new THREE.Box3().setFromObject(tube.mesh);
    const isClose = boxesAreClose(activeBox, otherBox);
    
    if (isClose) {
      tube.mesh.userData.state.jointCandidate = true;
      if (activeMesh.userData.state) {
        activeMesh.userData.state.jointCandidate = true;
      }
      
      // Automatically create joint if tubes are close enough
      if (!hasJoint(activeId, tube.id)) {
        createJoint(activeId, tube.id);
      }
      
      refreshTubeMaterial(tube.mesh);
      joinCount += 1;
      console.log(`Joint detected between ${activeId} and ${tube.id} (count: ${joinCount})`);
    } else {
      // Remove joint if tubes are no longer close
      if (hasJoint(activeId, tube.id)) {
        removeJoint(activeId, tube.id);
      }
      refreshTubeMaterial(tube.mesh);
    }
  });
  
  refreshTubeMaterial(activeMesh);
  
  // Store the joint count so updateOverlay() can use it even when called without parameter
  currentJointCount = joinCount;
  
  // Debug: Log joint detection results
  if (joinCount > 0) {
    console.log(`✅ Joint detected: ${joinCount} joint(s) ready for tube ${activeId}`);
  }
  
  updateOverlay(joinCount);
}

function boxesAreClose(boxA, boxB) {
  // If boxes intersect, they're definitely close enough for a joint
  if (boxA.intersectsBox(boxB)) {
    return true;
  }
  
  // Calculate the minimum distance between the two boxes
  // This is the distance between the closest points on each box
  const dx = Math.max(0, Math.max(boxA.min.x - boxB.max.x, boxB.min.x - boxA.max.x));
  const dy = Math.max(0, Math.max(boxA.min.y - boxB.max.y, boxB.min.y - boxA.max.y));
  const dz = Math.max(0, Math.max(boxA.min.z - boxB.max.z, boxB.min.z - boxA.max.z));
  
  // Calculate 3D distance
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
  // Check if within threshold
  const isClose = distance < JOINT_THRESHOLD;
  
  return isClose;
}

// Joint Management Functions
function createJoint(tubeId1, tubeId2) {
  if (tubeId1 === tubeId2) return false;
  if (!tubes.has(tubeId1) || !tubes.has(tubeId2)) return false;
  
  // Initialize joint sets if they don't exist
  if (!joints.has(tubeId1)) {
    joints.set(tubeId1, new Set());
  }
  if (!joints.has(tubeId2)) {
    joints.set(tubeId2, new Set());
  }
  
  // Add bidirectional joint relationship
  joints.get(tubeId1).add(tubeId2);
  joints.get(tubeId2).add(tubeId1);
  
  console.log(`✅ Joint created between ${tubeId1} and ${tubeId2}`);
  return true;
}

function removeJoint(tubeId1, tubeId2) {
  if (joints.has(tubeId1)) {
    joints.get(tubeId1).delete(tubeId2);
    if (joints.get(tubeId1).size === 0) {
      joints.delete(tubeId1);
    }
  }
  if (joints.has(tubeId2)) {
    joints.get(tubeId2).delete(tubeId1);
    if (joints.get(tubeId2).size === 0) {
      joints.delete(tubeId2);
    }
  }
  console.log(`Joint removed between ${tubeId1} and ${tubeId2}`);
}

function removeAllJointsForTube(tubeId) {
  if (!joints.has(tubeId)) return;
  
  const jointedTubes = Array.from(joints.get(tubeId));
  jointedTubes.forEach(otherId => {
    removeJoint(tubeId, otherId);
  });
}

function getJointedTubes(tubeId, visited = new Set()) {
  // Recursively get all tubes in the joint group
  if (visited.has(tubeId)) return [];
  visited.add(tubeId);
  
  const result = [tubeId];
  if (!joints.has(tubeId)) return result;
  
  joints.get(tubeId).forEach(otherId => {
    result.push(...getJointedTubes(otherId, visited));
  });
  
  return result;
}

function hasJoint(tubeId1, tubeId2) {
  return joints.has(tubeId1) && joints.get(tubeId1).has(tubeId2);
}

function refreshTubeMaterial(mesh) {
  if (!mesh || !mesh.material) return;
  const state = mesh.userData.state;
  const material = mesh.material;
  material.color.copy(DEFAULT_COLOR);
  material.emissive.setHex(0x000000);

  // Priority: Joint candidate color takes precedence over selected color
  // This way you can see when a selected tube is also a joint candidate
  if (state?.jointCandidate) {
    material.color.copy(JOINT_COLOR);
    // If also selected, add a slight glow to indicate both states
    if (state?.selected) {
      material.emissive.setHex(0xffaa00); // Orange glow for selected + joint
    }
  } else if (state?.selected) {
    material.color.copy(SELECTED_COLOR);
    material.emissive.setHex(0x3727ff);
  }
  material.needsUpdate = true;
}

function refreshAllMaterials() {
  tubes.forEach((tube) => refreshTubeMaterial(tube.mesh));
}

function updateSelectionPanel(tube) {
  if (!selectionElement) return;
  if (!tube) {
    selectionElement.textContent = 'No tube selected.';
    return;
  }
  const { params } = tube;
  selectionElement.innerHTML = `
    <strong>${tube.id}</strong><br/>
    Type: ${params.type}<br/>
    ${params.width} x ${params.height} mm<br/>
    Thickness: ${params.thickness} mm<br/>
    Length: ${params.length} mm
  `;
}

function recoverLostTubes() {
  let recovered = 0;
  const fixes = [];
  
  tubes.forEach((tube) => {
    const mesh = tube.mesh;
    let tubeFixed = false;
    
    // Re-add to scene if missing
    if (!mesh.parent && contextRefs.scene) {
      safeAddToScene(mesh);
      recovered++;
      tubeFixed = true;
      fixes.push(`${tube.id}: re-added to scene`);
    }
    
    // Fix invalid positions
    if (!isValidPosition(mesh.position)) {
      mesh.position.set(0, 0, 0);
      recovered++;
      tubeFixed = true;
      fixes.push(`${tube.id}: fixed invalid position`);
    }
    
    // CRITICAL: Fix tubes that are partially underground
    // Calculate where the bottom of the tube should be
    if (mesh.geometry && mesh.geometry.boundingBox) {
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const bottomY = box.min.y;
      
      // If bottom is below ground (y < 0), move tube up
      if (bottomY < 0) {
        const offsetY = -bottomY; // How much to move up
        mesh.position.y += offsetY;
        recovered++;
        tubeFixed = true;
        fixes.push(`${tube.id}: moved up ${offsetY.toFixed(2)} units to sit on plane`);
      }
    }
    
    // Ensure mesh is visible
    if (mesh.visible === false) {
      mesh.visible = true;
      recovered++;
      tubeFixed = true;
      fixes.push(`${tube.id}: made visible`);
    }
    
    // Ensure mesh has valid geometry and material
    if (!mesh.geometry) {
      console.warn(`${tube.id}: missing geometry - cannot recover`);
    }
    if (!mesh.material) {
      console.warn(`${tube.id}: missing material - cannot recover`);
    }
  });
  
  if (recovered > 0) {
    console.log(`✅ Recovered ${recovered} issue(s) in ${tubes.size} tube(s):`, fixes);
    updateOverlay();
    // If a tube was selected, re-select it to refresh the gizmo
    if (selectedTubeId) {
      const tube = tubes.get(selectedTubeId);
      if (tube) {
        selectTube(selectedTubeId);
      }
    }
  } else {
    console.log('✅ All tubes are in good condition - nothing to recover');
  }
  
  return recovered;
}

function updateOverlay(joinCount = null) {
  if (!overlayElement) return;
  const snapDeg = Math.round(THREE.MathUtils.radToDeg(snapIncrementRad));
  // Use provided count, or fall back to stored currentJointCount
  const displayCount = joinCount !== null ? joinCount : currentJointCount;
  overlayElement.textContent = `Tubes: ${tubes.size} | Snap: ${snapDeg}° | Joints ready: ${displayCount}`;
}

