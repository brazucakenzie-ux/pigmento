# Changelog

All notable changes to Pigmento. Versions follow [Semantic Versioning](https://semver.org).

## [1.2.0] — 2026-11-20

Pieces in 3D: sheets you tilt and turn, hinge into boxes and film with a moving camera.

### Pieces anywhere
- **Piece from layer** turns a whole layer into a piece, **Place image…** brings in a picture file as one (bigger than the canvas if you like), and **Paste as piece** pastes the clipboard as one.
- Pieces can sit outside the canvas and move in over time. View → **Pieces outside the canvas** shows them faded around it, where you can grab them, and Fit to window takes them in.
- **Repeat** tiles copies of a piece across, down or both ways, and **Scroll** slides them along. The loop button makes a background that scrolls round seamlessly.
- **Paint on piece:** the painting tools and Fill paint the selected piece's own pixels, under the pointer, however it's scaled or turned.

### Pieces in 3D
- The **Perspective plane** tool (M) treats a piece as a sheet of paper in 3D: push it back, tilt it, turn it like a door and spin it, all keyed on the timeline.
- A camera with a **vanishing point** you drag and a **Perspective** strength, with a perspective grid to draw to.
- **Shading** by a light you place, and a choice of what shows on a piece's back.
- Drawn on the GPU, with the same picture in exports, flattening and the colour picker.

### Hinges, groups and boxes
- Drag a piece's edge onto another's and they **hinge** there. Fold the hinge with its handle, the **Fold** field or the arrow keys, and **Unhinge** to let go.
- A piece can **follow** another, and hinged pieces form a **group** that moves, tilts and turns as one, about its middle with **Centre pivot**. Alt changes just one piece.
- **Box…** makes six blank faces folded into a box, ready to paint.
- Hinges show no line at any angle, on screen or in exports.

### Camera moves
- A **Camera** row on the timeline keys pans and pushes. Near pieces slide past faster than far ones, while the layers stay put.
- The timeline shows a group's pieces indented under it.

### Files
- Projects keep all of this in `.pigm` version 3. A picture that uses none of it is still saved as version 2 (or 1), so Pigmento 1.1 opens it.

## [1.1.1] — 2026-11-17

A calligraphy nib you can turn, and installers built on GitHub.

### Brushes
- The Calligraphy brush shows its flat nib as a line under the pointer instead of a circle, and a new **Nib angle** option turns the nib. It now leans like "/" by default, the way a broad-edge pen is held, so strokes going up to the right are hairlines.

### Installing
- The installer is now called `Pigmento-Setup-<version>.exe`. Without spaces in the name, the file on the Releases page matches its line in the checksum file (GitHub turned the spaces into dots).
- Releases are built on GitHub from the tagged source (`.github/workflows/release.yml`), ready to be code-signed through SignPath Foundation's free programme for open-source projects.

## [1.1.0] — 2026-11-16

Animation, and Pigmento is now open source.

### Keyframe animation
- Animate selection lifts part of a layer off as a piece (or animates a copy). The Animate tool moves, scales, stretches, skews and turns it, and every change sets a keyframe at the frame shown.
- Keyframes interpolate position, size, rotation (more than one turn if you like), skew and opacity, with five easings.
- Curved motion paths you bend on the canvas, and a pivot you can move without moving the piece.
- Pieces follow resizes, crops, flips and turns, and are kept by layer duplicates and merges.

### Frame-by-frame drawing
- New drawing, Copy drawing, Clear drawing and Delete drawing on any pixel layer. Every tool paints on the frame shown, and undo goes back to the frame it changed.
- Onion skin shows the drawings before and after, on screen only.

### Timeline and playback
- A timeline with a frame ruler, a row per layer and piece, keyframes to drag in time (with a frame label, and the timeline growing past its end), drawings to hold longer or shorter, and menus for easing, copying and deleting.
- Playback at the picture's frame rate, looping, once, or back and forth, with keys for frames and keyframes.

### Export and files
- Export animation as an animated GIF or an MP4 video (H.264), with a frame range, size, progress and Stop.
- Projects (`.pigm` version 2) keep the animation. Pictures without animation are still saved as version 1.

### Open source and installing
- Pigmento is free and open-source software under the MIT licence.
- The full text of every third-party licence ships with the app and shows in Help → About.
- When Pigmento is already installed, the installer asks first whether to update it, reinstall the same version or replace a newer version with an older one, instead of quietly installing over it. No changes nothing, settings are kept either way, and silent installs (`/S`) don't ask.
- The packaged app is hardened: it can't be run as plain Node.js, and it only loads its own code, checked against a hash in the exe.
- `npm run dist` also writes SHA-256 checksums for the files to publish.

### Also
- The interface size goes up to 200 %, and a single shape can be exported as a shape pack.
- F6 carries on from the last region if the focus falls back to the page.

## [1.0.0] — 2026-11-15

The first release.

### Painting and Paint parity
- The classic Paint layout: a ribbon (Home, Image, View), an options bar, a status bar, rulers, gridlines, pixel grid, side panels (Navigator, History) and canvas resize handles.
- Pencil, brush with pen pressure, eraser, flood fill with tolerance, colour picker, magnifier and text.
- Line, curve, rectangle, rounded rectangle, ellipse and polygon.
- Two colours, a palette, an Edit colours dialog (HSV, RGB, hex, alpha), recent and custom colours.
- Open and save PNG, JPEG, WebP, BMP and GIF; print; set as desktop background; recent files and the taskbar jump list; drag and drop; the clipboard; autosave and crash recovery.
- Themes: Pigmento, GitHub, VS Code, Claude, Pierre and High contrast, each light and dark or following Windows, with the Windows accent colour.

### Layers, selections and shapes
- Layers with groups, 15 blend modes, opacity, locking, merging and flattening.
- `.pigm` projects keep layers, shape layers, saved selections and guides.
- Selections: rectangle, ellipse, free-form, polygon, magic wand and colour range. They can be combined, modified, saved and loaded, made transparent, and free-transformed (including skew and perspective).
- Guides, snapping and smart alignment guides.
- Shape layers keep shapes editable: move, resize, rotate, recolour, align, distribute, group and arrange them.
- More than 150 built-in shapes with sliders, plus fills (solid, gradient, pattern, image) and outlines (dashes, caps, joins, arrowheads).
- A pen for paths, My shapes, shape packs, SVG import and SVG export.
- Gradient tool and pattern fills; palette files (`.json`, `.gpl`, `.ase`).

### Brushes and effects
- A brush engine with dynamics (pressure, tilt, speed, random) and response curves, a stabiliser, symmetry and Shift for straight lines.
- 50 built-in brushes, a brush library with favourites, and the eraser using any brush.
- Retouch tools: smudge, blur, sharpen, clone stamp, dodge and burn.
- The Brush Designer and My brushes; brush packs (`.pigmbrush`).
- Stroke the selection outline, or a path, with any brush.
- 11 adjustments and 11 filters, run in background workers with a live preview, progress and cancel.
- Turning the view, and a reference image.
- A performance overlay (Ctrl+Alt+Shift+P) and measured performance budgets.

### Polish, accessibility and packaging
- Settings: interface size, Simple or Full mode, and customisable keyboard shortcuts (including the mouse's side buttons).
- Simple mode keeps the Paint essentials; Full shows everything.
- A first-run welcome tour; Help with the user guide, keyboard shortcuts and About with every licence.
- Keyboard navigation everywhere: F6 moves between regions, there are focus rings, and the arrow keys move around the picture.
- An automated WCAG 2.1 AA check in light, dark and high-contrast themes.
- Friendly error handling: an error screen with save and reload, recovery after a crash, an error log, and a memory check before huge pictures.
- 100-megapixel pictures open in about two seconds.
- An NSIS installer (per user) and a portable `.exe`, with the `.pigm` file association and "Open with" for images.
