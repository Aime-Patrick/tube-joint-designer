# Changelog / Progress Notes

This document tracks the development progress and features implemented for the Tube Joint Designer application.

## feat: initialize electron + three.js app
- Scaffolded npm package, Electron main process, renderer entry point.
- Added base Three.js scene with camera, lighting, grid, axes helpers.
- Configured Content Security Policy for Electron renderer.

## feat: add tube creation and parameter controls
- Implemented renderer UI (`index.html`, `styles.css`, `uiControls.js`).
- Wired DOM inputs to create rectangular/square tubes with hollow extrusion meshes.
- Added tube parameter validation and sanitization.
- Support for rectangular and square tube types.

## feat: implement tube selection and drag
- Added raycasting selection, TransformControls gizmos, and overlay/status panels.
- Highlighting for selected tubes plus camera reset.
- TransformControls integration with proper gizmo visibility.
- Click-to-place tube creation mode for precise positioning.

## feat: add angle snapping and joint preview
- Snap settings (30°, 45°, 90°, 135°, custom) applied to gizmo rotations and manual rotate actions.
- Joint proximity detection between tubes with yellow highlight preview.
- Joint count display in overlay.
- Automatic joint creation when tubes are within 30mm proximity.

## feat: add undo/redo
- Simple command stack for add/delete/transform actions with buttons + disabled states.
- Undo/redo support for jointed tube movements.

## feat: implement joint grouping system
- Automatic joint creation when tubes are close together.
- Jointed tubes move together as a single unit.
- Bidirectional joint relationships (if A is jointed to B, B is jointed to A).
- Automatic joint removal when tubes move apart.
- Joint cleanup when tubes are deleted.

## feat: improve camera and ground plane
- Added solid ground plane to prevent seeing underneath.
- Camera constraints to prevent looking below ground plane.
- Tubes positioned correctly on ground plane (not submerged).
- Camera position clamping to maintain proper viewing angle.

## feat: fix TransformControls gizmo visibility
- Fixed gizmo (colored arrows) visibility issues.
- Proper scene integration for TransformControls internal objects.
- Render order management for gizmo to appear on top.
- Event handling for gizmo interactions.

## feat: add wireframe toggle
- Global wireframe/solid view toggle.
- Material opacity adjustment for wireframe mode.

## fix: improve joint detection accuracy
- Fixed bounding box calculations with proper world matrix updates.
- Improved joint count tracking and display.
- Better color priority (joint color shows even on selected tubes).

## fix: tube position validation
- Added position clamping to prevent NaN/Infinity values.
- Tube recovery system for lost or invisible tubes.
- Position validation during drag operations.

## chore: add packaging with electron-builder
- Configured `electron-builder.yml`, `npm run build:electron`, and metadata for multi-platform builds.
- Windows (NSIS), macOS (DMG), and Linux (AppImage) support.

## docs: update README with packaging steps
- Added comprehensive setup instructions.
- Detailed usage guide with all features explained.
- Step-by-step packaging instructions as per requirements.
- Troubleshooting section for common issues.

## style: update UI to light theme
- Changed UI from dark to light theme (white background).
- Improved contrast and readability.
- Updated color scheme for better visibility.

