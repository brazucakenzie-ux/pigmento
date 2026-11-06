# Pigmento project format (`.pigm`)

A `.pigm` file is a ZIP archive. It holds everything needed to reopen an image with its layers. The reader is `src/renderer/src/engine/io/project.ts`, which validates every file with Zod and never runs anything from the archive.

| Entry | Contents |
|---|---|
| `document.json` | Document description (below), UTF-8 JSON |
| `layers/0001.png` … | One PNG per raster layer, cropped to the layer's non-transparent pixels |
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
  "layers": [ /* bottom layer first */ ]
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

`blend` is one of `normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, difference, soft-light, hard-light, hue, saturation, color, luminosity`. Groups composite their children in isolation, then blend the result as one layer.

## Limits and safety
- Width and height are at most 30,000 px each and 250 megapixels in total. Files may hold at most 2,000 layers, nested at most 64 deep.
- Each archive entry is capped at 1 GB uncompressed and the whole archive at 2 GB. PNG sizes must match `image.w`/`image.h`.
- Duplicate layer ids are replaced with fresh ones. A file with a newer `version` is refused with a clear message instead of being half-read.

## Autosave
While a window has unsaved changes, Pigmento writes the same format to `%APPDATA%\Pigmento\autosave\<session>.pigm` every minute. It also writes a `.json` file with the name, original path and time, plus a `.png` preview. A clean close deletes these files. Files left behind at the next start are offered under "Recover unsaved work".
