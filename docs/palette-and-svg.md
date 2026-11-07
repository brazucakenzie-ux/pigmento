# Palettes and SVG export

## Palettes

Edit colours → Import palette replaces the 24 colours in the Colours group with a palette file's colours. When a palette has more than 24, the last cell shows all of them. Use Pigmento's palette brings the original colours back. Up to 256 colours are kept; repeats are dropped and transparency is ignored.

| File | Read | Written |
|---|---|---|
| Pigmento palette `.json` | yes | yes (Export palette: the palette, then your custom colours) |
| a plain JSON list of `"#rrggbb"` strings | yes | no |
| GIMP palette `.gpl` | yes: `R G B name` rows; `Name:` and `Columns:` lines and `#` comments are allowed | no |
| Adobe Swatch Exchange `.ase` | yes: RGB, CMYK, Lab and grey swatches, in or outside groups | no |

A Pigmento palette:

```json
{ "format": "pigmento-palette", "version": 1, "name": "Pigmento palette", "colors": ["#000000", "#d7263d", "#1e88e5"] }
```

CMYK swatches are converted without a colour profile, and Lab swatches from D50 to sRGB. Palette files may be at most 4 MB.

## SVG export

File → Export as SVG saves the whole image as one SVG file:

- **Shape layers** become real paths: rectangles, ellipses, library shapes, lines, curves, polygons and paths. Each path keeps its fill and outline colours, outline width, ends, corners and dashes, and arrowheads become paths of their own.
- **Gradients** become `linearGradient` or `radialGradient` laid over the shape's box. SVG has no angular gradient, so those are written as linear ones.
- **Patterns** become an SVG `pattern` holding the tile as a PNG.
- **Picture fills** become an `image` clipped to the shape.
- **Pixel layers** become an embedded PNG covering just their content.
- **Layers** keep their visibility, opacity and blend mode (as `mix-blend-mode`); groups become `g` elements with `isolation: isolate`, and the canvas colour becomes a background rectangle.
- **Shapes without smooth edges** get `shape-rendering="crispEdges"`.

SVG files can be imported again (see [shape-format.md](shape-format.md#svg-import)); that brings back the shapes, not the pixel layers.
