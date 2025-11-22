# Tube Joint Designer

Interactive Electron + Three.js desktop tool for sketching, positioning, and previewing joints between rectangular or square tubes at configurable angles. Built for a technical assessment with a focus on readability, modularity, and pragmatism—no bundler or frontend framework required.

## Features

### Core Functionality
- **Tube Types**: Rectangular and Square tube profiles
- **Tube Parameters**: Configurable width, height, thickness, and length (in millimeters)
- **Joint Parameters**: Automatic joint detection when tubes are within 30mm proximity
- **Interactive Controls**: 
  - Drag, rotate, and position tubes directly on the canvas
  - Click-to-place tube creation mode
  - Transform gizmo (colored arrows) for precise movement
- **Angle Snapping**: Snap to standard angles (30°, 45°, 90°, 135°) or custom angles
- **Joint Grouping**: Jointed tubes move together as a single unit
- **Workspace Navigation**: Zoom, pan, and rotate the workspace (OrbitControls)

### Visualization
- **Wireframe/Solid Toggle**: Switch between wireframe and solid rendering modes
- **Joint Preview**: Tubes turn yellow when close enough to form a joint
- **Joint Highlighting**: Visual feedback for joint candidates
- **Joint Count Display**: Overlay shows number of joints ready
- **Selection Highlighting**: Selected tubes highlighted in purple

### Additional Features
- **Undo/Redo**: Full undo/redo support for all operations (add, delete, transform)
- **Multiple Tubes**: Create assemblies with multiple tubes
- **Ground Plane**: Visual grid plane with solid base
- **Camera Constraints**: Prevents camera from going below ground plane

## Project Structure

```
.
├─ assets/
├─ docs/
│  └─ CHANGELOG.md
├─ src/
│  ├─ main/
│  │  └─ main.js
│  └─ renderer/
│     ├─ app.js
│     ├─ index.html
│     ├─ styles.css
│     ├─ threeScene.js
│     ├─ tubeManager.js
│     ├─ uiControls.js
│     └─ undoRedo.js
├─ electron-builder.yml
└─ package.json
```

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the app in development:
   ```bash
   npm run dev
   ```
   Electron launches with live reload via Chromium dev tools (toggle in `src/main/main.js`).

## Usage Guide

### Creating Tubes

1. **Configure Tube Parameters**:
   - Select tube type: Rectangular or Square
   - Set width, height, thickness, and length (in millimeters)
   - For square tubes, height automatically matches width

2. **Add a Tube**:
   - Click "Add Tube" button
   - Click anywhere on the canvas to place the tube
   - Placement mode stays active for multiple placements
   - Right-click or press Shift to cancel placement mode

### Manipulating Tubes

1. **Select a Tube**: Click on a tube in the viewport
   - Selected tube turns purple with a glow
   - Transform gizmo (colored arrows) appears

2. **Move a Tube**:
   - Select a tube (gizmo appears)
   - Click and drag the colored arrows:
     - **Blue arrows**: Move along X-axis (left/right)
     - **Green arrow**: Move along Y-axis (up/down)
     - **Red arrow**: Move along Z-axis (forward/back)

3. **Rotate a Tube**:
   - Click "Rotate Gizmo" button to switch to rotation mode
   - Or use the manual rotation controls:
     - Select rotation axis (X, Y, or Z)
     - Enter angle in degrees
     - Click "Rotate" button

4. **Angle Snapping**:
   - Select snap angle from dropdown (30°, 45°, 90°, 135°, or Custom)
   - Custom angle allows you to set any angle value
   - Snapping applies to both gizmo rotations and manual rotations

### Creating Joints

1. **Automatic Joint Detection**:
   - Move tubes close together (within 30mm)
   - Tubes automatically turn yellow when close enough
   - Joint count appears in the overlay: "Joints ready: X"

2. **Jointed Tubes Move Together**:
   - When tubes are jointed (yellow), they move as a single unit
   - Drag one jointed tube and all connected tubes move together
   - Joints are automatically removed when tubes move apart

3. **Joint Preview**:
   - Yellow color indicates joint candidates
   - Overlay shows number of joints ready
   - Joints are created automatically when tubes are close

### View Controls

- **Zoom**: Scroll mouse wheel or pinch gesture
- **Pan**: Right-click and drag (or middle mouse button)
- **Rotate View**: Left-click and drag on empty space
- **Reset View**: Click "Reset View" button to restore default camera position
- **Wireframe Toggle**: Click "Wireframe" to switch between solid and wireframe rendering

### Other Features

- **Undo/Redo**: Click "Undo" or "Redo" buttons to revert or reapply actions
- **Delete Tube**: Select a tube and click "Delete" button
- **Recover Lost Tubes**: If tubes disappear, click "Recover Lost Tubes" to restore them

## Packaging Steps

This section explains how to package the application into a standalone executable that runs without requiring a separate local server.

### Prerequisites

- Node.js (v16 or higher recommended)
- npm (comes with Node.js)

### Step 1: Install Dependencies

First, install all required dependencies:

```bash
npm install
```

This will install:
- `electron` - The Electron framework
- `three` - Three.js 3D library
- `electron-builder` - Packaging tool (dev dependency)

### Step 2: Build the Application

Run the build script to create the executable:

```bash
npm run build:electron
```

This command uses `electron-builder` to package the application according to the configuration in `electron-builder.yml`.

### Step 3: Locate the Final Executable

After the build completes, the packaged application will be in the `dist/` directory:

- **Windows**: `dist/Tube Joint Designer Setup X.X.X.exe` (NSIS installer)
- **macOS**: `dist/Tube Joint Designer-X.X.X.dmg` (DMG disk image)
- **Linux**: `dist/Tube Joint Designer-X.X.X.AppImage` (AppImage)

### Build Output Details

- The executable includes all necessary dependencies and static assets
- No separate server or runtime installation required
- The application is self-contained and portable
- File size: Approximately 150-200 MB (includes Electron runtime and Three.js)

### Troubleshooting

If you encounter issues during packaging:

1. **Clean build**: Delete `dist/` and `node_modules/` folders, then run `npm install` again
2. **Platform-specific**: Ensure you're building on the target platform (Windows builds on Windows, etc.)
3. **Permissions**: On Linux/macOS, you may need to make the AppImage executable: `chmod +x *.AppImage`

## Development Notes

- The renderer uses ECMAScript modules directly in the browser context. Three.js, OrbitControls, and TransformControls are imported via relative paths to `node_modules`, so no bundler is required.
- Undo/redo is implemented as a light command stack (`src/renderer/undoRedo.js`).
- Tube geometry uses `THREE.Shape` + `ExtrudeGeometry` to approximate a hollow rectangular/square tube; parameters are in millimeters and scaled for scene units.

## Project Completion Summary

This project implements all required features for the Rectangular/Square Tube Joint Visualization technical challenge:

### ✅ Part 1: Rectangular/Square Tube Joint Visualization Feature

**Geometry & Input Controls:**
- ✅ Choose tube type: Rectangular or Square
- ✅ Define tube parameters: Width, height, thickness, length (in millimeters)
- ✅ Define joint parameters: Automatic joint detection based on proximity (30mm threshold)
- ✅ Joint position: Automatically determined by tube placement
- ✅ Rotation/orientation: Manual rotation controls with axis selection

**Interaction Controls:**
- ✅ Drag, rotate, and position tubes directly on canvas
- ✅ Joint preview appears when tubes are moved close together (yellow highlight)
- ✅ Snap to standard angles: 30°, 45°, 90°, 135°, and custom angles
- ✅ Ability to add multiple tubes to form assemblies
- ✅ Zoom, pan, and rotate workspace (OrbitControls)

**Visualization Options:**
- ✅ Wireframe and Solid View toggle
- ✅ Highlight joint region (yellow color for joint candidates)
- ✅ Display basic joint dimensions (joint count in overlay)
- ✅ Support undo/redo for positioning and joint creation

### ✅ Part 2: Code Quality, GitHub Usage, and Collaboration

- ✅ GitHub repository with clear folder structure
- ✅ Meaningful commit messages following conventional commits
- ✅ README.md with setup, usage, and build instructions
- ✅ Clear folder structure (src/, assets/, docs/)
- ✅ Changelog documenting progress and features

### ✅ Part 3: Application Packaging

- ✅ Electron framework for desktop application
- ✅ All dependencies and static assets included
- ✅ Build script: `npm run build:electron`
- ✅ Packaging steps documented in README
- ✅ Standalone executable (no separate server required)

### Additional Features Implemented

- **Joint Grouping**: Jointed tubes move together as a single unit
- **Click-to-Place**: Precise tube placement by clicking on canvas
- **Ground Plane**: Visual grid with solid base
- **Camera Constraints**: Prevents viewing below ground plane
- **Tube Recovery**: System to recover lost or invisible tubes

## Next Steps / Future Enhancements

- Persist/load assemblies from disk (JSON or custom format).
- Advanced joint boolean previews (CSG) or cut planes.
- Materials library and metadata inspector per tube.
- Keyboard shortcuts for gizmo modes and deletions.
- Snapshot/annotation export (PNG capture).
- Joint angle calculations and measurements.

