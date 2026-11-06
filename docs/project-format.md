# Pigmento project format (`.pigm`)

A `.pigm` file is a ZIP archive. It holds everything needed to reopen an image with its layers. The reader is `src/renderer/src/engine/io/project.ts`, which validates every file with Zod and never runs anything from the archive.

| Entry | Contents |
|---|---|
| `document.json` | Document description (below), UTF-8 JSON |
| `layers/0001.png` … | One PNG per raster layer, cropped to the layer's non-transparent pixels |
| `selections/0001.png` … | One greyscale PNG per saved selection (white = selected, grey = partly selected) |
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
  "selections": [ /* optional, saved selections in the order they were saved */ ]
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

**Saved selection** (Select → Save selection)
```json
{ "id": "selection-4-lx1", "name": "Window", "mask": { "file": "selections/0001.png", "x": 90, "y": 90, "w": 220, "h": 220 } }
```
The PNG's red channel is the coverage (0–255) and is placed at (`x`, `y`). The active selection itself isn't saved.

`blend` is one of `normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, difference, soft-light, hard-light, hue, saturation, color, luminosity`. Groups composite their children in isolation, then blend the result as one layer.

## Limits and safety
- Width and height are at most 30,000 px each and 250 megapixels in total. Files may hold at most 2,000 layers, nested at most 64 deep, and 200 saved selections.
- Each archive entry is capped at 1 GB uncompressed and the whole archive at 2 GB. PNG sizes must match `image.w`/`image.h`.
- Duplicate layer ids are replaced with fresh ones. A file with a newer `version` is refused with a clear message instead of being half-read.

## Autosave
While a window has unsaved changes, Pigmento writes the same format to `%APPDATA%\Pigmento\autosave\<session>.pigm` every minute. It also writes a `.json` file with the name, original path and time, plus a `.png` preview. A clean close deletes these files. Files left behind at the next start are offered under "Recover unsaved work".
