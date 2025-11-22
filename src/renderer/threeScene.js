import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

let scene;
let camera;
let renderer;
let orbitControls;
let transformControls;
let animationFrame;

const cameraDefaults = {
  position: new THREE.Vector3(6, 4, 8),
  target: new THREE.Vector3(0, 0, 0)
};

export function initScene(containerElement) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#05070d');

  camera = new THREE.PerspectiveCamera(
    60,
    containerElement.clientWidth / containerElement.clientHeight,
    0.1,
    1000
  );
  camera.position.copy(cameraDefaults.position);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(containerElement.clientWidth, containerElement.clientHeight);
  containerElement.appendChild(renderer.domElement);

  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.05;
  orbitControls.target.copy(cameraDefaults.target);

  transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setTranslationSnap(0.01);
  transformControls.setRotationSnap(THREE.MathUtils.degToRad(5));
  transformControls.visible = false;
  
  // According to Three.js docs, TransformControls extends Object3D and MUST be added to scene
  // Set high renderOrder so gizmo renders on top of objects
  transformControls.renderOrder = 999;
  
  // Add TransformControls to scene (required for gizmo to render)
  // Even if instanceof check fails, try adding it - Three.js handles it internally
  try {
    scene.add(transformControls);
    console.log('✅ TransformControls added to scene (required for gizmo rendering)');
  } catch (error) {
    console.error('❌ CRITICAL: Failed to add TransformControls to scene:', error);
    console.error('The gizmo will NOT be visible without TransformControls in the scene!');
    // Last resort: try direct manipulation
    try {
      scene.children.push(transformControls);
      transformControls.parent = scene;
      console.log('TransformControls added via direct manipulation (workaround)');
    } catch (workaroundError) {
      console.error('All methods failed to add TransformControls:', workaroundError);
    }
  }

  const ambient = new THREE.AmbientLight('#ffffff', 0.35);
  const dir = new THREE.DirectionalLight('#ffffff', 0.85);
  dir.position.set(5, 10, 7);
  dir.castShadow = true;
  scene.add(ambient, dir);

  // Add a solid ground plane to prevent seeing through/under
  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: '#1a1d2e',
    metalness: 0.1,
    roughness: 0.8,
    side: THREE.DoubleSide
  });
  const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
  groundPlane.rotation.x = -Math.PI / 2; // Rotate to be horizontal
  groundPlane.position.y = 0;
  groundPlane.receiveShadow = true;
  scene.add(groundPlane);

  const grid = new THREE.GridHelper(20, 20, '#1f4ed8', '#1f1f2e');
  grid.position.y = 0.01; // Slightly above ground plane
  const axes = new THREE.AxesHelper(2.5);
  scene.add(grid, axes);
  
  // Limit camera movement to prevent going below ground
  orbitControls.minDistance = 2;
  orbitControls.maxDistance = 50;
  orbitControls.minPolarAngle = 0.1; // Prevent camera from going too high (looking straight down)
  orbitControls.maxPolarAngle = Math.PI / 2 - 0.1; // Prevent camera from going below horizontal (can't look up from under plane)
  
  // Add listener to prevent camera from going below ground plane (y < 0)
  const originalUpdate = orbitControls.update.bind(orbitControls);
  orbitControls.update = function() {
    originalUpdate();
    // Keep camera above ground plane
    if (camera.position.y < 0.5) {
      camera.position.y = 0.5; // Minimum height above ground
    }
    // Keep target above or at ground level
    if (orbitControls.target.y < 0) {
      orbitControls.target.y = 0;
    }
  };

  transformControls.addEventListener('dragging-changed', (event) => {
    orbitControls.enabled = !event.value;
  });

  return {
    scene,
    camera,
    renderer,
    orbitControls,
    transformControls,
    resetView: () => {
      camera.position.copy(cameraDefaults.position);
      orbitControls.target.copy(cameraDefaults.target);
      orbitControls.update();
    }
  };
}

export function renderLoop() {
  if (!scene || !renderer) return;
  animationFrame = requestAnimationFrame(renderLoop);
  orbitControls?.update();
  // TransformControls updates automatically - no need to check/add every frame
  renderer.render(scene, camera);
}

export function stopRenderLoop() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
}

export function resizeRendererOnWindowResize({ renderer: ctxRenderer, camera: ctxCamera }) {
  window.addEventListener('resize', () => {
    if (!ctxRenderer || !ctxCamera) return;
    const container = ctxRenderer.domElement.parentElement;
    ctxCamera.aspect = container.clientWidth / container.clientHeight;
    ctxCamera.updateProjectionMatrix();
    ctxRenderer.setSize(container.clientWidth, container.clientHeight);
  });
}

