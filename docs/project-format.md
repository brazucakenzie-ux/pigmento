# Pigmento project format (`.pigm`)

A `.pigm` file is a ZIP archive. It holds everything needed to reopen an image with its layers. The reader is `src/renderer/src/engine/io/project.ts`, which validates every file with Zod and never runs anything from the archive.

| Entry | Contents |
|---|---|
| `document.json` | Document description (below), UTF-8 JSON |
| `layers/0001.png` … | One PNG per raster layer, cropped to the layer's non-transparent pixels |
| `selections/0001.png` … | One greyscale PNG per saved selection (white = selected, grey = partly selected) |
| `assets/0001.png` … | Pictures used by image-filled shapes, one per picture |
| `pieces/0001.png` … | Version 2: the pixels of each animated piece, at their own size (which may be bigger than the canvas) |
| `cels/0001.png` … | Version 2: frame-by-frame drawings, each cropped like a layer |
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

A picture with animated pieces or frame-by-frame drawings is written as version 2, with an `animation` object in `document.json`. A picture without any is still written as version 1, so Pigmento 1.0 opens it. Version 1 files open with a default timeline (12 fps, 24 frames, looping) and no pieces.

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
- **Frame-by-frame drawings:** a pixel layer drawn frame by frame lists its drawings in `cels` (its `image` is then `null`). Each drawing has the frame it starts at and its picture (or `null` when it's blank). A drawing shows until the next one starts, the first starts at frame 0, and a layer has at least two:

  ```json
  { "kind": "raster", "id": "layer-3-lx1", "name": "Ink", "opacity": 1, "blend": "normal", "visible": true, "locked": false,
    "image": null,
    "cels": [
      { "start": 0, "image": { "file": "cels/0001.png", "x": 40, "y": 30, "w": 200, "h": 120 } },
      { "start": 4, "image": null },
      { "start": 9, "image": { "file": "cels/0002.png", "x": 60, "y": 30, "w": 180, "h": 140 } }
    ] }
  ```

  On opening, drawings that start on the same frame keep the last one listed, and the first one is moved to frame 0 if it isn't there already.
- **Between keyframes:** a piece is scaled about its pivot, then skewed, turned, and moved to its position. Before its first keyframe it holds the first one's values; after its last, the last one's.

## Pieces in 1.2 (version 3)

Pigmento 1.2 writes the oldest version that holds everything in the picture: version 1 without animation, version 2 when the animation only uses what 1.1 had (and then exactly as 1.1 wrote it), and version 3 when a piece uses something new. Pigmento 1.1 refuses a version 3 file with its "made with a newer Pigmento" message rather than showing it wrongly. Versions 1 and 2 open as before.

Pieces in 1.2 can be bigger than the canvas and sit anywhere, partly or wholly outside it. They're also made from a whole layer, a placed picture file or the clipboard. None of that needs new fields: `image` and `home` already hold any size and place. Version 3 adds:

```json
{
  "id": "piece-2-lx9", "name": "Hills", "layerId": "layer-1-lx1",
  "image": { "file": "pieces/0002.png", "w": 3200, "h": 400 },
  "home": { "x": -1200, "y": 200, "w": 3200, "h": 400 },
  "pivot": { "x": 1600, "y": 200 },
  "repeat": "x",
  "keyframes": [
    { "frame": 0, "x": 400, "y": 400, "sx": 1, "sy": 1, "angle": 0, "skew": 0, "opacity": 1, "scrollX": 0, "scrollY": 0, "easing": "linear", "in": null, "out": null },
    { "frame": 23, "x": 400, "y": 400, "sx": 1, "sy": 1, "angle": 0, "skew": 0, "opacity": 1, "scrollX": -3066.6667, "scrollY": 0, "easing": "linear", "in": null, "out": null }
  ]
}
```

- **`repeat`:** `none`, `x` (copies tile on across, along the piece's own horizontal axis), `y` (down) or `both` (an endless plane). Left out, it's `none`.
- **`scrollX`, `scrollY`** (on each keyframe): how far the tiles have slid along the piece's own axes, in its own pixels, from −1,000,000 to 1,000,000. Only the axes it repeats along count. They aren't wrapped, so a long scroll keeps its speed between keyframes. Left out, they're 0.
- A repeating piece draws its copies wherever its plane reaches. The pixel at piece point (u, v) shows the piece's own pixel ((u − scrollX) mod width, (v − scrollY) mod height) on the axes it repeats along. Smoothing blends across the seams between copies.
- **`depth`, `tilt`, `turn`** (on each keyframe): the piece in 3D. Left out, they're 0.
  - `depth` is how far behind the canvas its pivot is, in pixels (negative is in front), from −1,000,000 to 1,000,000.
  - `tilt` turns it round its own horizontal axis, top edge back, then `turn` turns it round the upright, like a door. Both are in radians and not wrapped.
  - `x` and `y` stay where the pivot shows on the canvas. A piece with no tilt or turn stays flat, and depth just shrinks it towards that spot.
- **`back`** (on the piece): `mirror` (its pixels show mirrored when it's turned round, like paper) or `hide`. Left out, it's `mirror`.
- **The camera:** it looks at the canvas straight on from its vanishing point, at a distance of (50 % ÷ strength) × the picture's diagonal. The pivot's point in 3D is the one at its depth that shows where the pivot is.
- **`shade`** (on the piece): how much the picture's light darkens it as it turns away from it, from 0 (off, the default) to 1. A face that faces the camera keeps its colours.
- **`light`** (in `document.json`): `{ "angle": -30, "height": 45 }`. `angle` is where the light comes from round the picture, in degrees clockwise from straight above, and `height` runs from 0 (grazing) to 90 (from the front). It's left out while it's the default shown here.
- **`camera`** (in `document.json`, beside `animation`): `{ "x": 640, "y": 400, "strength": 50 }`, the vanishing point in document pixels (−1,000,000 to 1,000,000) and the strength from 1 to 100 %. It's left out while the camera is the default one, in the middle of the canvas at 50 %.

### Linked pieces, hinges and groups

```json
{
  "id": "piece-7", "kind": "piece", "layerId": "layer-2",
  "link": { "parent": "piece-3", "hinge": { "edge": "e", "childEdge": "w", "offset": 0, "along": 1, "across": 1 } },
  "keyframes": [{ "frame": 0, "fold": 1.5708, "…": "…" }]
}
```

- **`kind`** (on the piece): `piece` (the default) or `group`. A group is never drawn: it carries the pieces linked under it, so a box turns about its group's pivot. Its `image` is one clear pixel.
- **`link`** (on the piece): the piece it follows, by id, on the same layer, or `null` (the default). Groups follow nothing.
  - Without a hinge (`"hinge": null`), the piece's keyframes are relative to its parent: `x`, `y` and `depth` are a point in the parent's own pixels (depth along the parent's normal, scaled with its area), and the rest turn it in that space as they turn a free piece on the canvas.
  - With a hinge, it hangs off the parent's `edge` (`n`, `e`, `s` or `w`: top, right, bottom, left), and only its keyframes' `fold`, `opacity` and scroll count. Edges run clockwise round a box (the top from left to right, the right edge downwards, and so on). Its own `childEdge` lies along the parent's edge, running the other way, starting `offset` parent pixels from that edge's start. `along` and `across` are parent pixels per piece pixel, along the edge and away from it (0.0001 to 10,000).
  - Unfolded, a hinged piece lies flat outside the parent's edge. **`fold`** (on each keyframe, radians, not wrapped, 0 when left out) turns it round the edge, away from the viewer when positive, so a front face with its sides folded by π/2 makes a box going back from it with the fronts outward.
  - A group's opacity multiplies the opacity of every piece under it; a piece's own opacity reaches only itself.
### Camera moves

- **`cameraMoves`** (in `animation`, version 3): the camera's moves over the timeline, `[{ "frame": 0, "panX": 0, "panY": 0, "push": 0, "easing": "linear" }, …]`. Left out (or empty), the camera stays put.
  - `panX` and `panY` slide the camera across and down from where it rests, and `push` moves it in towards the canvas (negative: back from it), all in document pixels from −1,000,000 to 1,000,000. Between keys the camera eases as pieces do; before the first key and after the last it holds.
  - Pieces are placed in 3D by the camera at rest and seen by the moved one, so near pieces slide past faster than far ones. The camera never gets closer to the canvas than 5 % of its distance. Layers' own pixels don't move.
  - One key per frame (the last given wins); frames past the end of the timeline move to its last frame.
- Links that don't hold are dropped when a file is opened (the piece then follows nothing): one to a missing piece or one on another layer, a link from a group, a hinge onto a group, a loop, and pieces past the 64th in one tree.

## Paths and trims in 1.3 (version 4)

Pigmento 1.3 writes version 4 only when a piece follows a path or faces the way it goes (or has a keyed progress or an art angle left over), or a shape's outline is trimmed; otherwise it writes the oldest version that holds the picture, as 1.2 did. Pigmento 1.2 refuses a version 4 file with its "made with a newer Pigmento" message. Version 4 adds:

```json
{
  "id": "piece-1",
  "follow": { "layerId": "layer-4", "objectId": "v12-m3k9", "sub": 0 },
  "face": { "on": true, "angle": -1.5708 },
  "keyframes": [{ "frame": 0, "progress": 0, "…": "…" }, { "frame": 23, "progress": 1, "…": "…" }]
}
```

- **`follow`** (on the piece): the path it moves along, or `null` (the default). `layerId` is a shape layer, `objectId` one of its shapes (in a group or not), and `sub` which of that shape's outlines (0 = the first; 0 to 100,000). Any shape can be followed: a pen path by its own subpaths, and a line, curve, rectangle, ellipse or library shape by the outline Convert to path would give it.
  - Only a piece that follows no other piece (`link` is `null`) is placed by its path. One that also has a `link` keeps to the link, and its `follow` is ignored.
  - A path that isn't there (a missing layer or shape, or an outline with fewer than two points) leaves the piece on its own `x` and `y`. Pigmento never writes one: deleting a path turns the motion along it into ordinary keyframes in the same undo step.
- **`progress`** (on each keyframe, 0 when left out): how far along the path the piece's pivot is, by distance along it, so an even progress moves it at an even speed. 0 is the path's start and 1 its end; an open path holds at its ends, and a closed one goes round again past 1 or below 0 (2.5 is half way round the third time). From −1,000,000 to 1,000,000. It eases between keyframes like any other value, and replaces the keyframe's `x` and `y` while the piece follows a path (they're kept, but don't place it).
- **`face`** (on the piece, default `{ "on": false, "angle": 0 }`): facing the way it goes. While `on`, a piece that follows no other piece is turned so its art points the way its pivot is moving on the canvas (along its path, or by its own `x` and `y`). `angle` (radians, −10,000 to 10,000; Pigmento writes −π to π) is which way the art points in the piece's own pixels before it's scaled or turned: 0 right, π/2 down. The turn is the heading minus that direction once scaled by the keyframe's `sx` and `sy` (atan2(sy·sin angle, sx·cos angle)), added to the keyframe's `angle`.
  - The heading at a frame is the direction from where the pivot is 0.2 seconds earlier to where it is 0.2 seconds later (at the animation's `fps`; at least half a frame each way). Where that's no movement at all, it's the last heading before (where the piece stopped), else the first one after (where it starts). A piece that never moves isn't turned.

### Trimmed outlines

On a shape (in a shape layer's `objects`, in a group or not):

```json
{
  "type": "shape",
  "id": "v12-m3k9",
  "trim": { "start": 0, "end": 0.5, "offset": 0 },
  "trimKeys": [{ "frame": 0, "start": 0, "end": 0, "offset": 0, "easing": "easeInOut" }, { "frame": 23, "start": 0, "end": 1, "offset": 0, "easing": "linear" }],
  "trimTie": { "piece": "piece-1", "end": "start", "gap": 12 },
  "…": "…"
}
```

- **`trim`** (left out: all of the outline shows): only the outline from `start` to `end` shows (shares of its whole length, 0 to 1, either way round), both slid along by `offset` (−1,000,000 to 1,000,000). Lengths are measured along the outline as it's drawn (box shapes inset for their outline, as Convert to path gives them). A shape with several outlines is trimmed across all of them in turn, as one long line. When all its outlines are closed, `offset` wraps round (only its fraction counts); otherwise the part that shows stops at the ends. Only the outline is trimmed: a fill is drawn whole.
  - Dashes are laid out from the start of each outline as if it weren't trimmed, so they don't move as the ends do. Lines and curves with arrowheads get them at the ends that show, pointing along the outline there.
- **`trimKeys`** (1 to 2,000; left out: not keyed): the trim keyed on the timeline, which wins over `trim`. Each key has a `frame` (0 to 1,999; ones past the end of the timeline move to its last frame, and the last key given for a frame wins) and an `easing` on to the next key (as for piece keyframes). Before the first key and after the last the trim holds. A picture with keyed trims writes its `animation` (for its timeline) even without pieces.
- **`trimTie`** (left out: none): one end of the trim follows a piece that follows this shape (`piece` is its id). With `end` `"start"` the outline is erased behind the piece; with `"end"` it's drawn up to the piece. That end goes `gap` document pixels (−100,000 to 100,000; negative: ahead) behind where the piece's pivot is along the shape's outlines (taken as one long line, on the piece's current turn round a closed one), clamped to the outline, instead of where `trim` or `trimKeys` say; the other end and `offset` come from them. A tie to a piece that isn't there, or doesn't follow this shape, does nothing.

## Limits and safety
- Width and height are at most 30,000 px each and 250 megapixels in total. Files may hold at most 2,000 layers, nested at most 64 deep, 200 saved selections and 256 pictures (each at most 4096 × 4096 px; bigger pictures are scaled down when chosen).
- Each archive entry is capped at 1 GB uncompressed and the whole archive at 2 GB. PNG sizes must match the sizes recorded for them.
- Duplicate layer ids are replaced with fresh ones. A file with a newer `version` is refused with a clear message instead of being half-read.
- A file may hold at most 500 pieces with at most 2,000 keyframes each, and at most 20,000 frame-by-frame drawings (2,000 per layer). Pieces on a layer that's missing or isn't a pixel layer are left out, duplicate piece ids get fresh ones, repeated frames keep the last keyframe given, and frames past the end of the timeline move to its last frame.

## Autosave
While a window has unsaved changes, Pigmento writes the same format to `%APPDATA%\Pigmento\autosave\<session>.pigm` every minute. It also writes a `.json` file with the name, original path and time, plus a `.png` preview. A clean close deletes these files. Files left behind at the next start are offered under "Recover unsaved work".
