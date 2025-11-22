import { initScene, renderLoop, resizeRendererOnWindowResize } from './threeScene.js';
import { createTubeManager } from './tubeManager.js';
import { initUIControls } from './uiControls.js';
import { createUndoRedoManager } from './undoRedo.js';

const sceneContainer = document.getElementById('scene-container');
const overlayInfo = document.getElementById('overlay-info');
const selectionSummary = document.getElementById('selection-summary');

const sceneContext = initScene(sceneContainer);
renderLoop();
resizeRendererOnWindowResize(sceneContext);

const undoRedoManager = createUndoRedoManager();
const tubeManager = createTubeManager(sceneContext, undoRedoManager, overlayInfo, selectionSummary);

initUIControls({
  tubeManager,
  undoRedoManager,
  sceneContext
});

