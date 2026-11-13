# Pigmento brush files

Pigmento keeps your own brushes (My brushes, made with the Brush Designer) as small JSON files, and can bundle them into a **brush pack** to share or move to another PC. Both are checked against Zod schemas in `src/shared/brushFormat.ts` when they are read, saved or imported. Files that don't match are refused (or skipped when listing), and nothing in them is ever run.

## Brush settings

A brush is data. The same settings drive the Brush, the Eraser and the retouching tools (Smudge, Blur, Sharpen, Clone stamp, Dodge and burn).

| Field | Range | Meaning |
|---|---|---|
| `tip` | see below | the shape of each dab |
| `size` | 1–1000 | diameter in px when the brush is picked (the tool's Size slider can change it) |
| `opacity` | 0–1 | the most one stroke covers; overlapping dabs never go past it |
| `flow` | 0–1 | how much each dab adds (dabs build up towards the opacity) |
| `hardness` | 0–1 | edge softness of round and square tips: 1 is crisp, 0 soft to the centre |
| `spacing` | 0.01–5 | distance between dabs, as a fraction of the diameter |
| `angle` | −360–360 | tip angle in degrees |
| `roundness` | 0.05–1 | height ÷ width of the tip |
| `scatter` | 0–10 | how far dabs wander from the stroke, as a fraction of the diameter |
| `count` | 1–16 (whole) | dabs at each step along the stroke |
| `sizeJitter`, `opacityJitter`, `angleJitter`, `hueJitter`, `lightJitter` | 0–1 | random variation per dab (`angleJitter` 1 = any angle) |
| `followStroke` | true/false | the tip turns with the stroke's direction |
| `pixel` | true/false | hard pixels with no anti-aliasing, placed pixel by pixel |
| `airbrush` | true/false | keeps adding paint while the pointer is held still |
| `mix` | 0–1 | picks up colour from the picture under each dab (wet paint) |
| `texture` | object or `null` | paper grain fixed to the picture (below) |
| `dynamics` | object | how pen input changes the brush (below) |

### Tips

| Value | Meaning |
|---|---|
| `{ "kind": "round" }` | an anti-aliased ellipse with the hardness falloff |
| `{ "kind": "square" }` | a square with the hardness falloff |
| `{ "kind": "image", "id": "chalk" }` | a built-in tip: `chalk`, `charcoal`, `crayon`, `graphite`, `bristle`, `watercolor`, `splatter`, `spray`, `sponge`, `star`, `sparkle`, `grass`, `fur` or `leaf` |
| `{ "kind": "image", "id": "own" }` | the brush's own tip, stored with it |

An id Pigmento doesn't know (one from a newer version) falls back to a round tip.

### Texture

```json
{ "id": "paper", "scale": 1, "depth": 0.6, "mode": "multiply" }
```

| Field | Meaning |
|---|---|
| `id` | a built-in grain (`paper`, `canvas`, `noise`, `grain`, `bayer`, `checker`) or `own` |
| `scale` | 0.25–8: the size of the grain (1 = one texture pixel per image pixel) |
| `depth` | 0–1: how much the grain shows |
| `mode` | `multiply` or `subtract`: how the grain takes paint away where it is low |

### Dynamics

`dynamics` maps a setting to an input. Any of `size`, `opacity`, `flow`, `angle`, `roundness`, `scatter` and `hardness` can be listed. A setting that isn't listed doesn't respond to input.

```json
"dynamics": {
  "size": { "source": "pressure", "curve": [[0, 0], [0.5, 0.8], [1, 1]], "min": 0.2 }
}
```

| Field | Meaning |
|---|---|
| `source` | `off`, `pressure`, `tilt`, `speed` or `random`. With a mouse or touch, pressure is always 1 and tilt 0 |
| `curve` | 2–16 points `[input, output]`, both 0–1, with inputs in increasing order. The output is linear between points |
| `min` | 0–1: the setting's share at curve output 0. It scales between `min` and full (output 1) |

For `angle`, the output turns the tip by up to a full circle instead.

## Masks

A brush's own tip and texture are greyscale masks: 0 is nothing and 255 is full paint (for a texture, 255 is where paint lands).

```json
{ "w": 48, "h": 48, "data": "AAAA…" }
```

`w` and `h` are 1–512. `data` is the `w × h` bytes, row by row, as base64, and must decode to exactly that many bytes.

## A personal brush (`%APPDATA%\Pigmento\brushes\<id>.json`)

```json
{
  "format": "pigmento-brush",
  "version": 1,
  "id": "my-0b8f2c1e-6c2a-4e5b-9a7d-3f1e2d4c5b6a",
  "name": "Dotty",
  "category": "artistic",
  "settings": { "tip": { "kind": "image", "id": "own" }, "size": 24, "…": "all the fields above" },
  "tip": { "w": 48, "h": 48, "data": "…" },
  "texture": null,
  "createdAt": 1767225600000
}
```

| Field | Meaning |
|---|---|
| `id` | `my-` followed by a UUID; also the file name |
| `name` | 1–80 characters |
| `category` | one of `basic`, `pencil`, `paint`, `spray`, `dry`, `textured`, `artistic`, `pixel`, `eraser` or `custom` (My brushes only). Every personal brush is also listed under My brushes. A brush in `eraser` switches the Brush to the Eraser when picked |
| `tip`, `texture` | the brush's own masks, or `null`. A brush whose settings say `own` must carry the matching mask |
| `createdAt` | milliseconds since 1970; orders the library |

There are at most 500 personal brushes, and each file is at most 2 MB. A picture painted with a brush never depends on it, so editing or deleting a brush changes nothing already painted.

## A brush pack (`.pigmbrush`)

Brushes tab → Brush packs → Export my brushes saves all of them. Import brush pack adds a pack's brushes to My brushes with new ids, up to the 500-brush limit.

A pack is a zip file:

| Entry | Contents |
|---|---|
| `pack.json` | the pack (below) |
| `tips/<n>.png` | a brush's own tip: the mask is the PNG's alpha channel. A PNG with no transparency is read by its dark parts instead |
| `textures/<n>.png` | a brush's own texture, as grey |

```json
{
  "format": "pigmento-brush-pack",
  "version": 1,
  "name": "My brushes",
  "brushes": [
    {
      "name": "Dotty",
      "category": "artistic",
      "settings": { "tip": { "kind": "image", "id": "own" }, "…": "all the fields above" },
      "tip": "tips/1.png",
      "texture": null
    }
  ]
}
```

A pack holds 1–500 brushes, with the same fields as a personal brush except `id` and `createdAt`. `tip` and `texture` name PNGs in the zip (`tips/<n>.png`, `textures/<n>.png`) instead of holding masks. Larger images are scaled down to 512 px.

These limits are checked before anything is unpacked:
- The pack file may be at most 50 MB.
- Each entry may be at most 8 MB, and all entries together at most 200 MB.
- A pack may have at most 1,008 entries.
- Entries other than `pack.json`, `tips/<n>.png` and `textures/<n>.png` are ignored.
