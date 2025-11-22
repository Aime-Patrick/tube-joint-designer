export function createUndoRedoManager() {
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();

  function notify() {
    const payload = {
      undoAvailable: undoStack.length > 0,
      redoAvailable: redoStack.length > 0
    };
    listeners.forEach((listener) => listener(payload));
  }

  function record(action) {
    if (!action || typeof action.undo !== 'function' || typeof action.redo !== 'function') {
      console.warn('Invalid undo/redo action supplied');
      return;
    }
    undoStack.push(action);
    redoStack.length = 0;
    notify();
  }

  function undo() {
    const action = undoStack.pop();
    if (!action) return;
    action.undo();
    redoStack.push(action);
    notify();
  }

  function redo() {
    const action = redoStack.pop();
    if (!action) return;
    action.redo();
    undoStack.push(action);
    notify();
  }

  function onChange(callback) {
    listeners.add(callback);
    callback({
      undoAvailable: undoStack.length > 0,
      redoAvailable: redoStack.length > 0
    });
    return () => listeners.delete(callback);
  }

  return {
    record,
    undo,
    redo,
    onChange
  };
}

