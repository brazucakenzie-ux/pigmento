# Pigmento project format (`.pigm`)

A `.pigm` file is a ZIP archive. It holds everything needed to reopen an image with its layers. The reader is `src/renderer/src/engine/io/project.ts`, which validates every file with Zod and never runs anything from the archive.

| Entry | Contents |
|---|---|
| `document.json` | Document description (below), UTF-8 JSON |
| `layers/0001.png` … | One PNG per raster layer, cropped to the layer's non-transparent pixels |
| `selections/0001.png` … | One greyscale PNG per saved selection (white = selected, grey = partly selected) |
| `assets/0001.png` … | Pictures used by image-filled shapes, one per picture |
| `pieces/0001.png` … | Version 2: the pixels of each animated piece, at their own size |
| `thumbnail.png` | Optional preview of the flattened image (up to 256 px) |

Any other entries are ignored.

## `document.json` (version 1)

```json
{
  "format": "pigmento-project",
  "version": 1,
  "width": 1280,
  "height": 800,
  "dpi": 96,
  "paper": { "r": 255, "g": 255, "b": 255, "a": 255 },
  "activeId": "layer-3-lx1",
  "layers": [ /* bottom layer first */ ],
  "selections": [ /* optional, saved selections in the order they were saved */ ],
  "assets": [ /* optional: { "id": "img-1a2b3c4d-640x480", "file": "assets/0001.png", "w": 640, "h": 480 } */ ]
}
```

- `paper` is the canvas colour under all layers, or `null` for transparent.
- `layers` is listed bottom to top, and every entry is one of these:

**Raster layer**
```json
{
  "kind": "raster",
  "id": "layer-1-lx1",
  "name": "Sky",
  "opacity": 1,
  "blend": "normal",
  "visible": true,
  "locked": false,
  "image": { "file": "layers/0001.png", "x": 0, "y": 0, "w": 1280, "h": 400 }
}
```
`image` places the PNG at (`x`, `y`) on the canvas. It is `null` for an empty layer.

**Group**
```json
{
  "kind": "group",
  "id": "group-2-lx1",
  "name": "Clouds",
  "opacity": 0.8,
  "blend": "screen",
  "visible": true,
  "locked": false,
  "collapsed": false,
  "children": [ /* bottom first */ ]
}
```

**Shape layer** (shapes that stay editable; no PNG, the objects are stored)
```json
{
  "kind": "vector",
  "id": "shapes-5-lx1",
  "name": "Shapes 1",
  "opacity": 1,
  "blend": "normal",
  "visible": true,
  "locked": false,
  "objects": [
    {
      "type": "shape",
      "id": "v3-lx2",
      "shape": "roundRect",
      "box": { "cx": 200, "cy": 150, "w": 200, "h": 100, "angle": 0 },
      "points": [],
      "style": { "mode": "both", "width": 3, "outline": "#d7263dff", "fill": "#1e88e5ff", "radius": 12, "antialias": true }
    },
    { "type": "group", "id": "v9-lx2", "children": [ /* shapes or groups */ ] }
  ]
}
```
`shape` is `rect`, `roundRect` or `ellipse` (with an oriented `box`: centre, size, angle in radians; a negative size is a flip) or `line`, `curve` (four points: start, two controls, end) or `polygon` (with `points`). Objects are listed bottom to top. All shape layers together may hold at most 50,000 objects.

A shape from the shape library is `"shape": "parametric"` with a `box`, the library id in `shapeId` and its slider values in `params` (at most 32 numbers; missing values use the shape's defaults and out-of-range values are clamped when drawn):
```json
{ "type": "shape", "id": "v4-lx2", "shape": "parametric", "shapeId": "star-5", "params": { "inner": 45 },
  "box": { "cx": 300, "cy": 200, "w": 160, "h": 160, "angle": 0 }, "points": [], "style": { /* as above */ } }
```
An unknown `shapeId` (for example from a newer version) is kept as is and drawn as its box until that shape is available.

A personal shape (from My shapes) also carries its outline in `unitPath`, in the same form as a path's `subpaths` but in a 0–1 box, plus its `fillRule`. It is drawn from that copy, so the drawing doesn't depend on the shape still being in My shapes.

A path (drawn with the Pen, or a shape converted to a path) is `"shape": "path"` with `box: null` and its outline in `subpaths`. Each subpath has `closed` and a list of `anchors`, each `{ "x", "y", "in", "out", "smooth" }`: `in` and `out` are the Bézier handles towards the previous and next point (`null` for a corner on that side), and `smooth` keeps the two handles in line while editing. `fillRule` is `evenodd` (the default: inner subpaths are holes) or `nonzero`. All shape layers together may hold at most 2,000,000 path points.

A `style` may also say how the shape is filled and outlined. Every field is optional; without them a shape has a solid fill and outline and the usual ends and corners for its kind:

| Field | Values |
|---|---|
| `fillKind` | `solid`, `gradient`, `pattern` or `image` |
| `fillGradient`, `outlineGradient` | `{ "type", "angle", "stops" }`: `type` is `linear`, `radial` or `angular`, `angle` is in degrees, `stops` is a list of `{ "pos": 0–1, "color": "#rrggbbaa" }` or `null` to run from the outline colour to the fill colour. The gradient is laid over the shape's box and turns with it |
| `fillPattern` | `{ "id": built-in or saved pattern, "scale": 1–8 }`; built-in patterns are drawn in the outline colour on the fill colour |
| `fillImage` | the `id` of an entry in `assets`; the picture covers the box, cropped to its proportions |
| `outlineKind` | `solid` or `gradient` |
| `dash` | `solid`, `dash`, `dot` or `dashDot` (lengths scale with the width) |
| `cap` | `butt`, `round` or `square` |
| `join` | `miter`, `round` or `bevel` |
| `arrowStart`, `arrowEnd` | lines and curves: `none`, `triangle`, `open`, `circle` or `diamond` |

A fill whose pattern or picture is missing (for example a saved pattern from another PC) is drawn in the fill colour.

**Saved selection** (Select → Save selection)
```json
{ "id": "selection-4-lx1", "name": "Window", "mask": { "file": "selections/0001.png", "x": 90, "y": 90, "w": 220, "h": 220 } }
```
The PNG's red channel is the coverage (0–255) and is placed at (`x`, `y`). The active selection itself isn't saved.

`blend` is one of `normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, difference, soft-light, hard-light, hue, saturation, color, luminosity`. Groups composite their children in isolation, then blend the result as one layer.

## Animation (version 2)

A picture with animated pieces is written as version 2, with an `animation` object in `document.json`. A picture without any is still written as version 1, so Pigmento 1.0 opens it. Version 1 files open with a default timeline (12 fps, 24 frames, looping) and no pieces.

```json
"animation": {
  "fps": 12,
  "length": 24,
  "loop": "loop",
  "frame": 0,
  "pieces": [
    {
      "id": "piece-1-lx9",
      "name": "Ball",
      "layerId": "layer-3-lx1",
      "image": { "file": "pieces/0001.png", "w": 40, "h": 40 },
      "home": { "x": 100, "y": 120, "w": 40, "h": 40 },
      "pivot": { "x": 20, "y": 20 },
      "keyframes": [
        { "frame": 0, "x": 120, "y": 140, "sx": 1, "sy": 1, "angle": 0, "skew": 0, "opacity": 1, "easing": "easeOut", "in": null, "out": { "x": 60, "y": -80 } },
        { "frame": 12, "x": 400, "y": 140, "sx": 1.5, "sy": 1.5, "angle": 6.2832, "skew": 0, "opacity": 1, "easing": "linear", "in": { "x": -60, "y": -80 }, "out": null }
      ]
    }
  ]
}
```

- **Timeline:** `fps` is 1–60 and `length` 1–2000 frames. `loop` is `loop`, `once` or `pingpong`, and `frame` is the frame shown (frames count from 0).
- **Pieces:** a piece is pixels lifted from a selection. `layerId` names the pixel layer it belongs to: it's drawn just above that layer's pixels, inside the layer, so the layer's opacity and blend mode apply to it. `image` holds its pixels and `home` is where they were lifted from. `pivot` is the point it turns and scales around, in the piece's own pixels.
- **Keyframes:** they're listed by frame, one per frame.
  - `x`, `y`: where the pivot is, in document pixels.
  - `sx`, `sy`: the scale along the piece's own axes (negative flips it).
  - `angle`, `skew`: the turn and horizontal skew, in radians. The angle isn't wrapped, so 4π is two whole turns.
  - `opacity`: from 0 to 1.
  - `easing`: how the piece gets to the next keyframe: `linear`, `easeIn`, `easeOut`, `easeInOut` or `hold`.
  - `out` and `in`: optional handles (relative to the keyframe's position) that bend the motion path towards the next keyframe, and arriving from the previous one.
- **Between keyframes:** a piece is scaled about its pivot, then skewed, turned, and moved to its position. Before its first keyframe it holds the first one's values; after its last, the last one's.

## Limits and safety
- Width and height are at most 30,000 px each and 250 megapixels in total. Files may hold at most 2,000 layers, nested at most 64 deep, 200 saved selections and 256 pictures (each at most 4096 × 4096 px; bigger pictures are scaled down when chosen).
- Each archive entry is capped at 1 GB uncompressed and the whole archive at 2 GB. PNG sizes must match the sizes recorded for them.
- Duplicate layer ids are replaced with fresh ones. A file with a newer `version` is refused with a clear message instead of being half-read.
- A file may hold at most 500 pieces with at most 2,000 keyframes each. Pieces on a layer that's missing or isn't a pixel layer are left out, duplicate piece ids get fresh ones, repeated frames keep the last keyframe given, and frames past the end of the timeline move to its last frame.

## Autosave
While a window has unsaved changes, Pigmento writes the same format to `%APPDATA%\Pigmento\autosave\<session>.pigm` every minute. It also writes a `.json` file with the name, original path and time, plus a `.png` preview. A clean close deletes these files. Files left behind at the next start are offered under "Recover unsaved work".
