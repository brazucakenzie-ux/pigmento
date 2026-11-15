# Pigmento shape files

Pigmento keeps your own shapes (My shapes in the Shapes tab) as small JSON files, and can bundle them into a **shape pack** to share or move to another PC. Both are checked against Zod schemas in `src/shared/shapeFormat.ts` when they are read, saved or imported. Files that don't match are refused (or skipped when listing), and nothing in them is ever run.

## Outlines

An outline is a list of **subpaths**. Each subpath has:

| Field | Meaning |
|---|---|
| `closed` | `true` if the last point joins back to the first |
| `anchors` | the points, in order |

Each anchor is `{ "x", "y", "in", "out", "smooth" }`:

- `x`, `y`: the point.
- `in`, `out`: its Bézier handles towards the previous and the next point, or `null` for a corner on that side.
- `smooth`: whether editing keeps the two handles in line.

Outlines are stored in a **unit box**: 0–1 on both axes, with handles allowed a little outside it (−10 to 11). The outline is stretched to whatever box the shape is drawn into. A shape may have up to 500 subpaths and 20,000 points in total.

## A personal shape (`%APPDATA%\Pigmento\shapes\<id>.json`)

```json
{
  "format": "pigmento-shape",
  "version": 1,
  "id": "my-0b8f2c1e-6c2a-4e5b-9a7d-3f1e2d4c5b6a",
  "name": "Badge",
  "category": "symbols",
  "aspect": 1.5,
  "fillRule": "evenodd",
  "outline": [
    { "closed": true, "anchors": [
      { "x": 0, "y": 0, "in": null, "out": null, "smooth": false },
      { "x": 1, "y": 0, "in": null, "out": null, "smooth": false },
      { "x": 0.5, "y": 1, "in": null, "out": null, "smooth": false }
    ] }
  ],
  "createdAt": 1767225600000
}
```

| Field | Meaning |
|---|---|
| `id` | `my-` followed by a UUID; also the file name |
| `name` | 1–80 characters |
| `category` | one of `basic`, `polygons`, `stars`, `arrows`, `callouts`, `flowchart`, `symbols`, `banners`, `brackets`, `math`, `nature` or `custom` (My shapes only). Every personal shape is also listed under My shapes |
| `aspect` | width ÷ height of the shape it was saved from (0.01–100), used for its thumbnail |
| `fillRule` | `evenodd` (inner subpaths are holes) or `nonzero` |
| `createdAt` | milliseconds since 1970; orders the gallery |

A shape whose subpaths are all open is drawn as lines only. There are at most 500 personal shapes, and each file is at most 4 MB. Drawings that use a personal shape keep their own copy of its outline (see `unitPath` in [project-format.md](project-format.md)), so renaming or deleting it never changes a drawing.

## A shape pack (`.pigmshapes`)

Shapes tab → Shape files → Export my shapes saves all of them; a shape's own menu (My shape → Export as shape pack) saves just that one. Import shape pack adds a pack's shapes to My shapes with new ids, up to the 500-shape limit.

```json
{
  "format": "pigmento-shape-pack",
  "version": 1,
  "name": "My shapes",
  "shapes": [
    { "name": "Badge", "category": "symbols", "aspect": 1.5, "fillRule": "evenodd", "outline": [ /* as above */ ] }
  ]
}
```

A pack holds 1–500 shapes with the same fields as a personal shape, but without `id` or `createdAt`. It may be at most 20 MB.

## SVG import

File → Import SVG (or Shapes tab → Shape files) puts a drawing's shapes on a new shape layer as editable paths. If the drawing is bigger than the image, it is scaled down to fit. The file is read with a small XML reader of Pigmento's own, not a browser DOM, so nothing in it is displayed or run.

| Supported | Left out |
|---|---|
| `path` (all commands, including arcs), `rect` (rounded corners too), `circle`, `ellipse`, `line`, `polyline`, `polygon` | `text`, `image`, `use`, `foreignObject`, `script`, `style` sheets, filters, masks and clip paths |
| `g`, `a` and nested `svg` groups, with `transform` (`matrix`, `translate`, `scale`, `rotate`, `skewX`, `skewY`) | external references, DOCTYPE entities (never expanded) |
| `viewBox`, `width`, `height` and the default `preserveAspectRatio` (or `none`) | gradients and patterns (`url(#…)` paints become grey) |
| `fill`, `stroke`, `stroke-width`, `fill-rule`, `opacity`, `fill-opacity`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `display`, `visibility`, as attributes or in `style` | CSS selectors and inheritance from style sheets |
| colours as `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`, common names, `none`, `currentColor` (black) | |

Limits: 20 MB per file, 20,000 elements, nesting at most 64 deep and 1,000,000 path commands. Anything bigger is refused with a message.

## Selection to shape

Selection → Selection to shape (or the Shapes tab) traces the selection's edge along its pixels and simplifies it: stair-steps within 0.8 px become straight lines. The result is a path on the active shape layer (or a new one), with holes as extra subpaths.
