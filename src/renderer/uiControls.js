export function initUIControls({ tubeManager, undoRedoManager, sceneContext }) {
  const tubeType = document.getElementById('tube-type');
  const widthInput = document.getElementById('tube-width');
  const heightInput = document.getElementById('tube-height');
  const thicknessInput = document.getElementById('tube-thickness');
  const lengthInput = document.getElementById('tube-length');

  const addTubeBtn = document.getElementById('add-tube-btn');
  const deleteTubeBtn = document.getElementById('delete-tube-btn');

  const snapSelect = document.getElementById('snap-angle');
  const customAngleGroup = document.getElementById('custom-angle-group');
  const customAngleInput = document.getElementById('custom-angle');
  const rotationAxisSelect = document.getElementById('rotation-axis');
  const manualAngleInput = document.getElementById('manual-angle');
  const applyRotationBtn = document.getElementById('apply-rotation-btn');

  const transformButtons = document.querySelectorAll('[data-transform]');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const wireframeBtn = document.getElementById('wireframe-btn');
  const resetViewBtn = document.getElementById('reset-view-btn');
  const recoverTubesBtn = document.getElementById('recover-tubes-btn');

  let wireframeState = false;

  addTubeBtn.addEventListener('click', () => {
    // Enter placement mode - tube will appear when user clicks in viewport
    tubeManager.enterPlacementMode(readTubeParams());
  });

  deleteTubeBtn.addEventListener('click', () => {
    tubeManager.deleteSelectedTube();
  });

  tubeType.addEventListener('change', () => {
    if (tubeType.value === 'square') {
      heightInput.value = widthInput.value;
      heightInput.disabled = true;
    } else {
      heightInput.disabled = false;
    }
  });

  widthInput.addEventListener('input', () => {
    if (tubeType.value === 'square') {
      heightInput.value = widthInput.value;
    }
  });

  snapSelect.addEventListener('change', () => {
    if (snapSelect.value === 'custom') {
      customAngleGroup.classList.remove('hidden');
    } else {
      customAngleGroup.classList.add('hidden');
      const angle = Number(snapSelect.value);
      tubeManager.setSnapIncrement(angle);
    }
  });

  customAngleInput.addEventListener('input', () => {
    if (snapSelect.value === 'custom') {
      const customAngle = Number(customAngleInput.value) || 15;
      tubeManager.setSnapIncrement(customAngle);
    }
  });

  applyRotationBtn.addEventListener('click', () => {
    const angle = Number(manualAngleInput.value) || 0;
    const axis = rotationAxisSelect.value;
    tubeManager.rotateSelectedTube(angle, axis);
  });

  transformButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.transform;
      tubeManager.setTransformMode(mode);
      transformButtons.forEach((btn) => btn.classList.remove('primary'));
      button.classList.add('primary');
    });
  });

  undoBtn.addEventListener('click', () => undoRedoManager.undo());
  redoBtn.addEventListener('click', () => undoRedoManager.redo());

  undoRedoManager.onChange(({ undoAvailable, redoAvailable }) => {
    undoBtn.disabled = !undoAvailable;
    redoBtn.disabled = !redoAvailable;
    undoBtn.style.opacity = undoAvailable ? '1' : '0.5';
    redoBtn.style.opacity = redoAvailable ? '1' : '0.5';
  });

  wireframeBtn.addEventListener('click', () => {
    wireframeState = !wireframeState;
    tubeManager.setWireframe(wireframeState);
    wireframeBtn.textContent = wireframeState ? 'Solid' : 'Wireframe';
  });

  resetViewBtn.addEventListener('click', () => {
    sceneContext.resetView();
  });

  recoverTubesBtn.addEventListener('click', () => {
    const recovered = tubeManager.recoverLostTubes();
    if (recovered > 0) {
      alert(`✅ Fixed ${recovered} issue(s)!\n\nCheck the browser console (F12) for details about what was recovered.`);
    } else {
      alert('✅ All tubes are in good condition!\n\nAll tubes are visible, properly positioned, and sitting on the ground plane.');
    }
  });

  // Initial UI state
  tubeManager.setTransformMode('translate');
  transformButtons[0]?.classList.add('primary');
  tubeManager.setSnapIncrement(
    snapSelect.value === 'custom' ? Number(customAngleInput.value) || 15 : Number(snapSelect.value)
  );
  if (tubeType.value === 'square') {
    heightInput.disabled = true;
  }

  // Set callback for getting tube params when placing tubes by clicking
  tubeManager.setTubeParamsCallback(() => readTubeParams());
  
  // Set callback for placement mode changes to update button state
  tubeManager.setPlacementModeChangeCallback((isActive) => {
    if (isActive) {
      addTubeBtn.textContent = 'Click in viewport to place tube...';
      addTubeBtn.disabled = true;
    } else {
      addTubeBtn.textContent = 'Add Tube';
      addTubeBtn.disabled = false;
    }
  });

  function readTubeParams() {
    return {
      type: tubeType.value,
      width: Number(widthInput.value),
      height: Number(heightInput.value),
      thickness: Number(thicknessInput.value),
      length: Number(lengthInput.value)
    };
  }
}

