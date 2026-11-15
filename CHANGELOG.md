# Changelog

All notable changes to Pigmento. Versions follow [Semantic Versioning](https://semver.org).

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
