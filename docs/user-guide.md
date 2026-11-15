# Pigmento user guide

Pigmento is a painting app for Windows 11 with the classic Paint layout, plus layers, shapes, brushes and effects when you want them. This guide follows the window from top to bottom. Press F1 at any time for the full list of keyboard shortcuts.

## Getting started

The window has five parts:

- **The ribbon** at the top holds the tools and commands, grouped into tabs: Home, Shapes, Brushes, Effects, Image and View. The File menu is at its left, Help at its right.
- **The options bar** under the ribbon shows the settings of the tool you're using, such as its size, opacity or brush.
- **The canvas** in the middle is your picture.
- **The side panel** on the right has the Navigator, Layers and History. View → Side panel shows or hides it.
- **The status bar** at the bottom shows the pointer position, the selection size, the picture size and the zoom.

The first time Pigmento starts, a short tour points these out. Help → Welcome tour shows it again.

### Simple and Full mode

The button beside the ribbon tabs switches between two modes:

- **Simple** keeps the Paint essentials: the Home, Image and View tabs, no Layers panel and fewer tool options.
- **Full** shows everything.

Switching never changes your picture or your settings, so you can move between them at any time.

## Files

- **New** (Ctrl+N) starts a picture at the size you choose. **New window** (Ctrl+Shift+N) opens another Pigmento window.
- **Open** (Ctrl+O) reads PNG, JPEG, WebP, BMP and GIF images and Pigmento projects (`.pigm`). You can also drag a file onto the window, or choose Pigmento in Windows' "Open with".
- **Save** (Ctrl+S) and **Save as** (Ctrl+Shift+S) write the picture in the format you pick. Only a `.pigm` project keeps layers, shape layers, saved selections and guides. The image formats save the picture merged into one; Pigmento tells you when that happens, and the picture you have open keeps its layers.
- **Export** saves a copy (for example one layer, or at 2×) without changing which file you're working on.
- **Recent** lists the files you opened lately. The Windows taskbar's jump list shows them too.
- **Print** (Ctrl+P), **Set as desktop background** (fill, fit, stretch, tile or centre) and **Image properties** (Ctrl+E) are in the File menu as well.

### Autosave and recovery

Pigmento saves a recovery copy of your work in the background. If it closes without saving, it offers to bring your work back the next time it starts.

## Painting

These tools are in Home → Tools. Hover over a tool to see what it does and its key.

| Tool | Key | What it does |
|---|---|---|
| Pencil | P | Hard one-pixel lines (pixel art) |
| Brush | B | Soft or textured strokes with any brush; see Brushes below |
| Eraser | E | Rubs pixels out to transparency (the paper shows through) |
| Fill | F | Fills an area of similar colour, with a tolerance; can also fill with a pattern |
| Gradient | G | Linear, radial, angular or diamond blends between colours |
| Colour picker | I | Takes a colour from the picture |
| Magnifier | Z | Click to zoom in, right-click to zoom out, drag to zoom to an area |
| Text | T | Type in any installed font, with bold, italic, underline, strikethrough and alignment |

The left mouse button paints with colour 1 and the right button with colour 2. Hold Shift while painting to draw a straight line. **[** and **]** change the tool's size, and so do the mouse's back and forward side buttons.

## Colours

The Colours group shows colour 1 and colour 2 and a palette of swatches.

- Click a swatch to set colour 1, right-click to set colour 2.
- **X** swaps the two colours, and **D** puts them back to black and white.
- **Edit colours** opens a colour picker with HSV, RGB, hex and alpha, and remembers your recent and custom colours.
- Palettes can be imported from `.json`, GIMP `.gpl` and Adobe `.ase` files, and exported as `.json`.

## Selections

The Select button in Home holds the selection tools and commands: Select (rectangle), Ellipse select, Free-form select, Polygon select, Magic wand and Colour range.

- **Ctrl+A** selects everything, **Ctrl+D** deselects and **Ctrl+Shift+A** inverts the selection.
- Hold Shift to add to a selection, Alt to take away from it, or both to keep only the overlap.
- Drag inside a selection to move its pixels; the arrow keys nudge it (Shift for 10 px).
- **Free transform** (Ctrl+T) scales, rotates, skews and distorts the selection, or the whole layer when nothing is selected. Enter applies the change and Esc cancels it.
- **Modify selection** feathers, grows, shrinks or turns it into a border.
- **Save selection** and **Load selection** keep selections inside the project.
- **Transparent selection** leaves colour 2 behind when you move pixels.
- **Make pattern from selection** turns the selected pixels into a fill pattern.
- **Crop** (Ctrl+Shift+X) crops the picture to the selection.

## Shapes

Home → Shapes has Line, Curve, Rectangle, Rounded rectangle, Ellipse and Polygon. The **Shapes** tab adds more than 150 shapes with search and favourites; most have sliders, for example a star's points.

- The options bar chooses outline, fill or both, and the line width, dashes, caps, joins and arrowheads. Fills can be solid, a gradient, a pattern or an image.
- **Draw as: Shape layer** keeps shapes editable: use the Move tool (V) to select, move, resize, rotate or recolour them later. **Pixels** paints them straight into the layer.
- The **Pen** (N) draws your own paths: click for corners, drag for curves.
- **Save as my shape** keeps a shape in My shapes, which you can rename, duplicate or delete.
- **Shape packs** (`.pigmshapes`) share My shapes between PCs, and **Import SVG** brings in a drawing's shapes as editable paths.

## Layers

Full mode's Layers panel stacks your picture in layers.

- Add a layer (Ctrl+Shift+L), duplicate it (Ctrl+J), merge it down (Ctrl+Shift+E), group layers (Ctrl+Alt+G) and drag layers to reorder them.
- Each layer has its own visibility, lock, opacity and blend mode (15 modes), and so does each group.
- Shape layers hold editable shapes; **Rasterise** turns one into pixels.
- **Flatten** merges everything into one layer.

## Brushes

The Brush tool works with any of 50 brushes: pencils, paints, airbrushes, chalk, charcoal, crayon, textured, artistic, pixel and erasers. Choose one from the options bar, the Home tab's Brush menu or the **Brushes** tab, and star the ones you use most.

- **Smoothing** steadies a shaky hand: the brush follows the pointer on a string.
- **Symmetry** mirrors strokes left–right, top–bottom, both ways, or radially. Drag its centre to move it.
- **Pen pressure** can change the size, opacity and more, depending on the brush. A mouse always paints at full pressure.
- **Retouch** (in Home → Tools) holds Smudge, Blur, Sharpen, Clone stamp and Dodge and burn. For the clone stamp, Alt+click where to copy from.
- **Stroke selection outline** and **Stroke path with brush** (Brushes tab) paint along an outline with the current brush. "Taper the ends" makes the stroke thin out like a pen.

### Making your own brushes

**New brush** in the Brushes tab opens the Brush Designer:

- **Tip:** a built-in tip, the selection, an imported PNG, or a tip you draw yourself.
- **Stroke:** spacing, scatter and random variation.
- **Grain:** a paper texture with its scale, depth and blend.
- **Dynamics:** a pen input and a response curve for any setting.
- **Paint:** opacity, flow, wet mix and airbrush.

The sample stroke at the top shows every change. Your brushes are kept in My brushes, and brush packs (`.pigmbrush`) share them between PCs.

## Effects

The **Effects** tab has the adjustments and filters:

- **Tone:** Brightness and contrast, Levels, Curves, Posterise and Threshold.
- **Colour:** Hue and saturation (with Colourise), Colour balance, Greyscale, Sepia and Invert.
- **Blur and detail:** Gaussian blur, Motion blur, Sharpen and Add noise.
- **Stylise:** Pixelate, Emboss and Find edges.
- **Light and edges:** Vignette, Drop shadow, Outer glow and Outline.

Each opens a panel beside the picture. The picture shows a live preview while you change the settings, and Apply makes the change as one undo step. If something is selected, only the selection changes. Big pictures are processed in the background with a progress bar, and Stop cancels.

## Image

The Image tab resizes the picture or the canvas, crops, rotates and flips, and inverts colours. **Resize** (Ctrl+W) keeps the proportions while "Keep aspect ratio" is ticked, and lets you choose how pixels are resampled.

## View

- **Zoom** with Ctrl+mouse wheel, Ctrl+Plus/Minus, the status bar's slider, or **Fit to window** (Ctrl+0). Hold Space and drag to move around.
- **Rulers** (Ctrl+R), **Gridlines** (Ctrl+G) and the **Pixel grid** help with lining things up. Drag guides out of the rulers, and turn on **Snapping** to snap to the grid, guides, the canvas and other layers.
- **Turn view** turns the view, never the picture: drag with the Turn view tool (hold Shift for 15° steps) or use Ctrl+Alt+Left/Right. Ctrl+Alt+0 sets it upright again.
- **Reference image** shows a picture to draw from over the canvas. Move it, resize it from its corner and change its opacity. It is never saved or exported.
- **Themes:** Pigmento, GitHub, VS Code, Claude, Pierre and High contrast, each in Light, Dark or Match Windows, optionally using the Windows accent colour.
- **Full screen** hides the window frame.

## Settings

File → Settings (Ctrl+Alt+S) has two pages:

- **General** sets the interface size (80–150 %) and Simple or Full mode.
- **Keyboard shortcuts** lists every command. Press **+** on a row, then press the keys you want, or a mouse side button. If the keys are already taken, Pigmento asks whether to move them over; tools can also share a letter, and pressing it again switches between them. Remove a shortcut with its ×, or reset one command or all of them.

## Keyboard shortcuts

These are the defaults; F1 always shows the current ones.

| Command | Keys |
|---|---|
| New, Open, Save, Save as | Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S |
| Undo, Redo | Ctrl+Z, Ctrl+Y |
| Cut, Copy, Paste | Ctrl+X, Ctrl+C, Ctrl+V |
| Paste as new image | Ctrl+Alt+V |
| Select all, Deselect, Invert selection | Ctrl+A, Ctrl+D, Ctrl+Shift+A |
| Free transform | Ctrl+T |
| Resize, Canvas size | Ctrl+W, Ctrl+Shift+R |
| Rotate right / left 90° | Ctrl+Period, Ctrl+Comma |
| Zoom in, Zoom out, Fit | Ctrl+Plus, Ctrl+Minus, Ctrl+0 |
| Brush size | [ and ] (or the mouse side buttons) |
| Swap colours, Reset colours | X, D |
| Settings | Ctrl+Alt+S |
| Keyboard shortcuts | F1 |

## Where Pigmento keeps things

Everything Pigmento remembers lives in `%APPDATA%\Pigmento`:

- `settings.json`: your settings.
- `recent.json`: the recent files list.
- `shapes`, `brushes` and `patterns`: My shapes, My brushes and your patterns.
- `autosave`: recovery copies.

Deleting the folder resets Pigmento to how it was when first installed.

## Tips

- Very large pictures (100 megapixels and more) work, but leave other apps room: each layer of a 10000 × 10000 picture needs about 400 MB.
- Ctrl+Alt+Shift+P shows a performance overlay with the frame time, pointer latency and memory.
- If something goes wrong, Pigmento says what happened in plain words. Your work is still in the recovery copy if the app closes.
