# Pigmento for AI assistants: tool reference

<!-- Made from the tools themselves (src/main/mcp): run `npm run mcp-docs` after changing one. -->

Pigmento offers 41 tools and 3 resources to AI assistants over the Model Context Protocol. The [user guide](user-guide.md#ai-assistants) says how to connect one and how to choose what assistants may do.

- Positions and sizes are in picture pixels, from the top-left corner. Animation frames are numbered from 1, as in the timeline.
- Colours are `#rrggbb` or `#rrggbbaa`. Layers, pieces and shapes are named by the ids `get_picture_info` gives.
- Each tool acts on the window the user is working in. Every tool except `list_windows` also takes an optional `window` (an id from `list_windows`) to act on another.
- Each call that changes the picture is one undo step, named "Assistant: …" in the History panel.
- Each tool is checked against a permission (Settings → AI assistants), which the user can set to Allowed, Ask each time or Not allowed.

## Looking

### `list_windows` (List windows)

The Pigmento windows that are open, each with its id and title (the picture in it), and which one the user is working in.

Permission: Look at pictures. Only reads.

### `get_picture_info` (Picture info)

The picture in a window: its size in pixels, its resolution (DPI), its paper colour, its layers (top first: id, name, kind, visible, opacity, blend mode, which is active), whether it has unsaved changes and its file, the selection, the tool and colours in use, and the animation (frame shown, length, frames a second, frame-by-frame drawings and pieces). Frames are numbered from 1, as in the timeline.

Permission: Look at pictures. Only reads.

### `get_picture_image` (Picture image)

The picture as a PNG, to see it and check your work: all of it, one layer, a region, or another animation frame. Big pictures are scaled down to fit maxSize (the answer says the scale); the paper is behind the picture, and a single layer is see-through.

Permission: Look at pictures. Only reads.

| Argument | Type | Description |
|---|---|---|
| `layer` (optional) | string | Just this layer or group (an id from get_picture_info), shown even if it is hidden. Leave it out for the whole picture. |
| `region` (optional) | { x, y, width, height } | Just this part of the picture, in picture pixels from the top-left corner. Leave it out for all of it. Its fields: `x` (whole number); `y` (whole number); `width` (whole number); `height` (whole number). |
| `frame` (optional) | whole number | The animation frame (numbered from 1, as in the timeline). Leave it out for the frame shown. |
| `maxSize` (optional) | whole number 16 to 2048 | The longest side of the image in pixels, up to 2048 (1024 if left out). Pictures are never scaled up. |

### `list_available` (List available)

What Pigmento has, by id and name: its tools (with their shortcut letters), brushes, shapes, effects and adjustments (with their settings), or actions (the commands in its menus, with their shortcuts and whether they can be used now).

Permission: Look at pictures. Only reads.

| Argument | Type | Description |
|---|---|---|
| `what` | `tools`, `brushes`, `shapes`, `effects`, `actions` | Which list. |

### `get_settings` (Settings)

Pigmento’s settings, by section (the theme, the view, panels, export, animation and the rest), as change_settings takes them. The AI assistants settings aren’t included.

Permission: Look at pictures. Only reads.

## Pictures and files

### `new_picture` (New picture)

Make a new, empty picture, in this window or a new one (see where). The picture you work on after this is the new one.

Permission: New, close and switch pictures.

| Argument | Type | Description |
|---|---|---|
| `width` | whole number 1 to 30000 | Width in pixels. |
| `height` | whole number 1 to 30000 | Height in pixels. |
| `paper` (optional) | string | The paper colour as #rrggbb (or #rrggbbaa), or none for see-through. White if left out. |
| `dpi` (optional) | whole number 1 to 10000 | Dots per inch, for printing (96 if left out). |
| `where` (optional) | `this`, `new` | This window or a new one. Left out: this window if its picture has no unsaved changes, otherwise a new window. |
| `unsaved` (optional) | `save`, `discard` | What to do with unsaved changes in the picture this replaces or closes: save them first, or throw them away (that can’t be undone). Needed only when there are some. |

### `open_file` (Open file)

Open a picture file (.pigm (keeps layers, animation and everything else), .png, .jpg, .webp, .bmp or .gif, and other images Pigmento reads), in this window or a new one (see where).

Permission: Open, save and export files.

| Argument | Type | Description |
|---|---|---|
| `path` | string | The file’s full path, like C:\Users\you\Pictures\picture.png. |
| `where` (optional) | `this`, `new` | This window or a new one. Left out: this window if its picture has no unsaved changes, otherwise a new window. |
| `unsaved` (optional) | `save`, `discard` | What to do with unsaved changes in the picture this replaces or closes: save them first, or throw them away (that can’t be undone). Needed only when there are some. |

### `save_file` (Save)

Save the picture to its file, or to a new path (Save as). The kind of file comes from the name: .pigm (keeps layers, animation and everything else), .png, .jpg, .webp, .bmp or .gif. Only .pigm keeps layers and animation; the others keep the picture as it looks (the frame shown, for an animation).

Permission: Open, save and export files.

| Argument | Type | Description |
|---|---|---|
| `path` (optional) | string | Where to save it (Save as), ending in .pigm (keeps layers, animation and everything else), .png, .jpg, .webp, .bmp or .gif. Leave it out to save to the picture’s own file. |
| `overwrite` (optional) | boolean | Replace the file if it’s already there (otherwise you’re told it is). |
| `quality` (optional) | whole number 1 to 100 | JPEG and WebP quality, 1 to 100 (Pigmento’s export setting if left out). |

### `export_image` (Export image)

Export a copy of the picture (or one layer) as .png, .jpg, .webp, .bmp or .gif, at a scale. The picture, its file and whether it is saved don’t change.

Permission: Open, save and export files.

| Argument | Type | Description |
|---|---|---|
| `path` | string | The image’s full path, like C:\Users\you\Pictures\picture.png. |
| `scale` (optional) | number 0.01 to 16 | Size compared with the picture: 2 is twice as big (1 if left out). |
| `layer` (optional) | string | Export just this layer or group (an id from get_picture_info). |
| `transparent` (optional) | boolean | Leave the paper out (for .png, .webp and .gif). False if left out. |
| `quality` (optional) | whole number 1 to 100 | JPEG and WebP quality, 1 to 100 (Pigmento’s export setting if left out). |
| `overwrite` (optional) | boolean | Replace the file if it’s already there (otherwise you’re told it is). |

### `close_window` (Close window)

Close a Pigmento window and its picture. If the picture has unsaved changes, say what to do with them (unsaved). The last window can’t be closed (that would close Pigmento).

Permission: New, close and switch pictures.

| Argument | Type | Description |
|---|---|---|
| `unsaved` (optional) | `save`, `discard` | What to do with unsaved changes in the picture this replaces or closes: save them first, or throw them away (that can’t be undone). Needed only when there are some. |

### `focus_window` (Switch window)

Bring a Pigmento window to the front, so it is the one being worked in (tools that don’t name a window act on it).

Permission: New, close and switch pictures.

| Argument | Type | Description |
|---|---|---|
| `window` | whole number | The window (an id from list_windows). |

## Layers and selections

### `add_layer` (Add layer)

Add a layer above the active one (or above the layer named), and make it active. A pixels layer holds painting; a shapes layer holds shapes you can still edit.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `kind` (optional) | `pixels`, `shapes` | pixels (if left out) or shapes. |
| `name` (optional) | string | Its name (Pigmento numbers it if left out). |
| `above` (optional) | string | Put it above this layer (an id) instead of the active one. |

### `delete_layer` (Delete layer)

Delete a layer or a group (with what’s in it). The last layer can’t be deleted.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `layer` | string | The layer (an id from get_picture_info). |

### `move_layer` (Move layer)

Move a layer up or down among its neighbours, to the top or bottom of them, or into a group.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `layer` | string | The layer (an id from get_picture_info). |
| `to` (optional) | `up`, `down`, `top`, `bottom` | One step up or down, or to the top or bottom (top if into is given). |
| `into` (optional) | string | Move it into this group (an id), or "picture" for the picture’s own list of layers. |

### `group_layers` (Group layers)

Put layers in a new group (where the topmost of them was), and make the group active.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `layers` | list of string | The layers (ids). |
| `name` (optional) | string | The group’s name. |

### `set_layer` (Set layer)

Change a layer’s name, whether it shows, whether it’s locked, its opacity or blend mode, or make it the active layer.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `layer` | string | The layer (an id from get_picture_info). |
| `name` (optional) | string | Its new name. |
| `visible` (optional) | boolean | Show it (true) or hide it (false). |
| `locked` (optional) | boolean | Lock it against changes (true) or unlock it. |
| `opacity` (optional) | number 0 to 1 | 0 (see-through) to 1. |
| `blend` (optional) | `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `difference`, `soft-light`, `hard-light`, `hue`, `saturation`, `color`, `luminosity` | How it mixes with the layers below. |
| `active` (optional) | boolean | true to make it the active layer. |

### `select` (Select)

Change the selection, which painting, effects and moving stay inside: a rectangle, ellipse or polygon; the magic wand (similar colours around a point); a colour range (a colour everywhere); all, none or the opposite; or feather, grow, shrink or make a border of it.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `shape` | `rectangle`, `ellipse`, `polygon`, `wand`, `color`, `all`, `none`, `invert`, `feather`, `grow`, `shrink`, `border` | What to select, or how to change the selection. |
| `mode` (optional) | `replace`, `add`, `subtract`, `intersect` | How it combines with the selection there is (replace if left out). |
| `x` (optional) | number | rectangle and ellipse: left edge; wand: the point. |
| `y` (optional) | number | rectangle and ellipse: top edge; wand: the point. |
| `width` (optional) | number | rectangle and ellipse. |
| `height` (optional) | number | rectangle and ellipse. |
| `points` (optional) | list of { x, y } | polygon: its corners, in order. |
| `color` (optional) | string | color: the colour to select, #rrggbb. |
| `tolerance` (optional) | number 0 to 100 | wand and color: how different a colour may be, 0 to 100 (25 for the wand and 20 for colour range if left out). |
| `contiguous` (optional) | boolean | wand: only the connected area (true if left out). |
| `allLayers` (optional) | boolean | wand and color: look at everything visible, not just the active layer. |
| `layer` (optional) | string | The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out. |
| `amount` (optional) | number up to 500 | feather, grow, shrink and border: how many pixels. |

### `transform_pixels` (Move pixels)

Move, scale, rotate or flip what’s selected on a pixel layer, or the whole layer if nothing is. Moved pixels leave see-through behind them.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `dx` (optional) | number | Pixels to the right (negative: left). |
| `dy` (optional) | number | Pixels down (negative: up). |
| `scaleX` (optional) | number up to 100 | Width times this (1 keeps it). |
| `scaleY` (optional) | number up to 100 | Height times this (1 keeps it). |
| `rotate` (optional) | number -360 to 360 | Degrees, clockwise, around its centre. |
| `flip` (optional) | `horizontal`, `vertical` | Flip it horizontally (left to right) or vertically. |
| `layer` (optional) | string | The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out. |

## Painting

### `set_colors` (Set colours)

Set Pigmento’s primary and secondary colours (what the user paints with next, and the default for your painting).

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `primary` (optional) | string | #rrggbb or #rrggbbaa. |
| `secondary` (optional) | string | #rrggbb or #rrggbbaa. |

### `fill` (Fill)

Fill with a colour on a pixels layer: the area of similar colour around a point (like the paint bucket), or, with no point, the selection (or the whole layer if nothing is selected).

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `x` (optional) | number | Where to fill from, in picture pixels (leave x and y out to fill the selection or the whole layer). |
| `y` (optional) | number | Where to fill from. |
| `color` (optional) | string | The colour, #rrggbb or #rrggbbaa (the primary colour if left out). |
| `tolerance` (optional) | number 0 to 100 | How different a colour may be and still fill, 0 to 100 (15 if left out). |
| `contiguous` (optional) | boolean | Only the connected area (true if left out); false fills that colour everywhere. |
| `layer` (optional) | string | The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out. |

### `brush_stroke` (Brush stroke)

Paint a stroke through points on a pixels layer, with any brush (ids from list_available with what: brushes), as a person would drag it: pressure changes the width and opacity where the brush uses it. Stays inside the selection. With erase, or an eraser brush, it takes paint away.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `points` | list of { x, y, pressure } | The stroke’s path; one point makes a dot. Points far apart are joined by straight lines. |
| `brush` (optional) | string | The brush (round if left out). |
| `size` (optional) | number 1 to 400 | Brush size in pixels (8 if left out). |
| `opacity` (optional) | number 0 to 1 | 0 to 1 (1 if left out). |
| `color` (optional) | string | The colour, #rrggbb or #rrggbbaa (the primary colour if left out). |
| `erase` (optional) | boolean | Take paint away instead. |
| `layer` (optional) | string | The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out. |

### `draw_line` (Line)

Draw a straight line, with arrow heads and dashes if wanted. On a pixels layer it becomes pixels; on a shapes layer it stays an object you can edit.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `from` | { x, y } |  Its fields: `x` (number); `y` (number). |
| `to` | { x, y } |  Its fields: `x` (number); `y` (number). |
| `width` (optional) | number 0.5 to 500 | Width in pixels (3 if left out). |
| `color` (optional) | string | The colour, #rrggbb or #rrggbbaa (the primary colour if left out). |
| `arrowStart` (optional) | `none`, `triangle`, `open`, `circle`, `diamond` | An arrow head at its start (none if left out). |
| `arrowEnd` (optional) | `none`, `triangle`, `open`, `circle`, `diamond` | An arrow head at its end (none if left out). |
| `dash` (optional) | `solid`, `dash`, `dot`, `dashDot` | Solid (if left out), dashed or dotted. |
| `layer` (optional) | string | The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out. |

### `draw_shape` (Shape)

Draw a shape from Pigmento’s library (ids from list_available with what: shapes: rectangle, circle, star-5, heart, arrows, speech bubbles and many more) in a box, turned if wanted, with its own settings. On a pixels layer it becomes pixels; on a shapes layer it stays an object you can edit.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `shape` | string | The shape’s id. |
| `x` | number | The box’s left edge. |
| `y` | number | The box’s top edge. |
| `width` | number | The box’s width, in pixels. |
| `height` | number | The box’s height, in pixels. |
| `rotate` (optional) | number -360 to 360 | Degrees, clockwise, around the box’s centre. |
| `settings` (optional) | object | The shape’s own settings by key (list_available with what: shapes gives them); the defaults are used for any left out. |
| `fill` (optional) | string | Fill colour, #rrggbb or #rrggbbaa, or none. Left out with outline also left out: an outline in the primary colour. |
| `outline` (optional) | string | Outline colour, #rrggbb or #rrggbbaa, or none. |
| `outlineWidth` (optional) | number 0.5 to 500 | Outline width in pixels (3 if left out). |
| `layer` (optional) | string | The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out. |

### `draw_path` (Path)

Draw a path through points (like the Pen): straight between points, or curved by each point’s in and out handles (Bézier control points). Closed paths can be filled. On a pixels layer it becomes pixels; on a shapes layer it stays an object you can edit.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `points` | list of { x, y, in, out } | The path’s points, in order, each with optional in and out handles. |
| `closed` (optional) | boolean | Join the last point back to the first (false if left out). |
| `fill` (optional) | string | Fill colour, #rrggbb or #rrggbbaa, or none. Left out with outline also left out: an outline in the primary colour. |
| `outline` (optional) | string | Outline colour, #rrggbb or #rrggbbaa, or none. |
| `outlineWidth` (optional) | number 0.5 to 500 | Outline width in pixels (3 if left out). |
| `layer` (optional) | string | The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out. |

### `add_text` (Text)

Write text on a pixels layer, its top-left corner at x, y. New lines (\n) start new lines; with a width, long lines wrap.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `text` | string | What to write. |
| `x` | number | Its left edge, in picture pixels. |
| `y` | number | Its top edge. |
| `width` (optional) | number | Wrap lines at this width in pixels. |
| `font` (optional) | string | A font on this PC, like Segoe UI (if left out), Arial, Georgia, Times New Roman, Consolas or Comic Sans MS. |
| `size` (optional) | number 1 to 1000 | Font size in the chosen unit (24 if left out). |
| `unit` (optional) | `px`, `pt` | Unit for size: px (picture pixels, if left out) or pt (points, scaled by the picture’s DPI). |
| `bold` (optional) | boolean | Bold. |
| `italic` (optional) | boolean | Italic. |
| `underline` (optional) | boolean | Underlined. |
| `align` (optional) | `left`, `center`, `right` | How lines line up (left if left out). |
| `color` (optional) | string | The colour, #rrggbb or #rrggbbaa (the primary colour if left out). |
| `background` (optional) | string | A colour behind the text, #rrggbb (none if left out). |
| `layer` (optional) | string | The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out. |

## The image, effects, actions and settings

### `resize_image` (Resize)

Resize the whole picture (every layer). Give a width, a height (the other follows, keeping its shape), both, or a scale. The selection is let go first.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `width` (optional) | whole number 1 to 30000 | The new width, in pixels. |
| `height` (optional) | whole number 1 to 30000 | The new height, in pixels. |
| `scale` (optional) | number 0.01 to 16 | Times the size it is (0.5 is half). |
| `method` (optional) | `bicubic`, `bilinear`, `nearest` | bicubic (smooth, if left out), bilinear, or nearest (keeps hard pixels, for pixel art). |

### `crop` (Crop)

Crop the picture to a rectangle, or to the selection if no rectangle is given.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `x` (optional) | whole number | The rectangle’s left edge, in picture pixels. |
| `y` (optional) | whole number | Its top edge. |
| `width` (optional) | whole number | Its width. |
| `height` (optional) | whole number | Its height. |

### `canvas_size` (Canvas size)

Make the canvas bigger or smaller without scaling what’s on it: new space is see-through (the paper shows), and what falls outside is cut off.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `width` | whole number 1 to 30000 | The canvas’s new width, in pixels. |
| `height` | whole number 1 to 30000 | The canvas’s new height, in pixels. |
| `anchor` (optional) | `nw`, `n`, `ne`, `w`, `c`, `e`, `sw`, `s`, `se` | Where the picture stays: nw is top-left (if left out), c the centre, se bottom-right… |

### `set_picture_properties` (Image properties)

Change the picture’s resolution (DPI) and/or paper colour. Changing DPI doesn’t resize any pixels.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `dpi` (optional) | whole number 1 to 10000 | Resolution in dots per inch (96 for screen, 300 for print). |
| `paper` (optional) | string | The paper colour as #rrggbb (or #rrggbbaa), or none for see-through. |

### `rotate_flip` (Rotate or flip)

Rotate the whole picture (90, 180 or 270 degrees keep every pixel; other angles grow the canvas to fit), and/or flip it. The selection is let go first.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `rotate` (optional) | number -360 to 360 | Degrees, clockwise. |
| `flip` (optional) | `horizontal`, `vertical` | Flip it horizontally (left to right) or vertically. |

### `apply_effect` (Effect)

Apply an adjustment or filter (ids from list_available with what: effects, which gives each one’s settings) to a pixels layer, inside the selection if there is one.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `effect` | string | The effect’s id. |
| `settings` (optional) | object | Its settings by key: numbers for sliders, true or false for toggles, a choice’s value, #rrggbb for colours, [[x, y], …] (0 to 1) for curves. The defaults are used for any left out. |
| `layer` (optional) | string | The layer to work on (an id from get_picture_info); it becomes the active layer. The active layer if left out. |

### `run_action` (Action)

Do one of Pigmento’s actions by its id (list_available with what: actions lists them and whether each can be used now), like layerMergeDown, layerFlatten, layerDuplicate, invertColors or gridlines (show the grid). File actions have their own tools; actions that would open a dialog are refused.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `action` | string | The action’s id. |

### `change_settings` (Change settings)

Change Pigmento’s settings: sections as get_settings gives them, each with just the values to change, like { "view": { "gridlines": true }, "theme": "forest" }. The AI assistants settings can only be changed by the user.

Permission: Change Pigmento’s settings.

| Argument | Type | Description |
|---|---|---|
| `changes` | object | The sections to change, and in each the values to change. |

## Animation

### `make_piece` (Make piece)

Make a piece to animate: from the selection on a pixels layer (Animate selection), from a whole pixels layer (Piece from layer), from an image file (Place image), or a 3D box of coloured faces. A piece moves, turns and fades by its keyframes; it starts where it is, at the frame shown.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `from` | `selection`, `layer`, `image`, `box` | What to make it from. |
| `layer` (optional) | string | selection and layer: the pixels layer (an id); it becomes the active layer. The active layer if left out. |
| `keepOriginal` (optional) | boolean | selection and layer: leave the pixels on the layer too (false: they move into the piece). |
| `path` (optional) | string | image: the image file’s full path. |
| `width` (optional) | whole number 1 to 4000 | box: across, in pixels. |
| `height` (optional) | whole number 1 to 4000 | box: down, in pixels. |
| `depth` (optional) | whole number 1 to 4000 | box: back, in pixels. |
| `name` (optional) | string | Its name. |

### `set_keyframe` (Keyframe)

Set a piece’s values at a frame, making a keyframe there (or remove one). Between keyframes the piece moves smoothly, eased as the earlier keyframe says. Values left out stay as they are at that frame. The timeline goes to that frame.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `piece` | string | The piece (an id from get_picture_info). |
| `frame` | whole number from 1 | The frame (numbered from 1, as in the timeline). |
| `x` (optional) | number | Where its pivot is, in picture pixels. |
| `y` (optional) | number | Where its pivot is, down. |
| `scale` (optional) | number | Size, times as drawn (1); sets both scaleX and scaleY. Negative flips it. |
| `scaleX` (optional) | number | Width, times as drawn (negative flips it). |
| `scaleY` (optional) | number | Height, times as drawn (negative flips it). |
| `rotate` (optional) | number | Degrees, clockwise (720 is two whole turns). |
| `skew` (optional) | number -85 to 85 | Degrees. |
| `opacity` (optional) | number 0 to 1 | 0 (gone) to 1. |
| `scrollX` (optional) | number | A repeating piece: how far its tiles have slid, in its own pixels. |
| `scrollY` (optional) | number | How far its tiles have slid down. |
| `depth` (optional) | number | 3D: pixels behind the canvas (negative: in front). |
| `tilt` (optional) | number | 3D: degrees tipped back. |
| `turn` (optional) | number | 3D: degrees turned round. |
| `fold` (optional) | number | A hinged piece: degrees folded round its edge. |
| `progress` (optional) | number | A piece following a path: how far along it, 0 (start) to 1 (end); past 1 goes round a closed path again. |
| `easing` (optional) | `linear`, `easeIn`, `easeOut`, `easeInOut`, `hold` | How it moves from this keyframe to the next: linear, easeIn, easeOut, easeInOut, or hold (jumps at the next). |
| `curveIn` (optional) | { x, y } or null | Bends its path arriving here: a handle relative to this keyframe’s position (null: straight). |
| `curveOut` (optional) | { x, y } or null | Bends its path leaving here towards the next keyframe (null: straight). |
| `remove` (optional) | boolean | Remove the keyframe at this frame instead. |

### `set_piece` (Piece)

Change a piece: its name; how its moves repeat after the last keyframe (loop); follow another piece (moving with it) or hang off one of its edges (hinge), or let go; move along a path (a shape on a shapes layer), facing its way; spin forever; what shows of its back when turned round in 3D; its shading by the light; tiling copies of it; its pivot; or delete it.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `piece` | string | The piece (an id from get_picture_info). |
| `name` (optional) | string | Its new name. |
| `loop` (optional) | `off`, `loop`, `pingpong` | After its last keyframe: stop (off), go round again (loop), or back and forth (pingpong). |
| `follow` (optional) | string | Another piece (an id) it moves with from now on, staying where it is; "none" lets go. |
| `hinge` (optional) | { to, edge, childEdge, fold } |  Its fields: `to` (string: The piece it hangs from.); `edge` (`n`, `e`, `s`, `w`: Which edge of that piece: n (top), e (right), s (bottom) or w (left).); `childEdge` (`n`, `e`, `s`, `w`: Which of its own edges meets it (the opposite one if left out).); `fold` (number: Degrees folded round the edge (0 if left out).). |
| `path` (optional) | { object, outline } or `"none"` | Move along a shape: from its start at its first keyframe to its end at its last (progress in set_keyframe changes that). none stops, keeping the motion as keyframes. |
| `facesItsWay` (optional) | boolean | Turn to face the way it moves. |
| `artAngle` (optional) | number | Which way its art points as drawn, in degrees (0 right, 90 down), for facing its way. |
| `spin` (optional) | { frame, spin, tilt, turn, easing } or `"stop"` | Spin forever at speeds (keyed from a frame), or stop. |
| `back` (optional) | `mirror`, `hide` | 3D: its back shows mirrored, or not at all. |
| `shade` (optional) | number 0 to 1 | 3D: how much the light shades it, 0 (off) to 1. |
| `repeat` (optional) | `none`, `x`, `y`, `both` | Tile copies of it across (x), down (y) or both. |
| `pivot` (optional) | { x, y } or `"centre"` | The point it turns and scales about, in picture pixels, or centre (a group’s: the middle of its pieces). |
| `delete` (optional) | boolean | Delete the piece (and the pieces that follow it). |

### `set_trail` (Trail)

A trail a piece leaves as it moves: add one made as a preset (rocketSmoke, cometTail, sparkles, speedLines or echo), make one over as a preset, change its settings, or remove it. Trails show when the animation plays or is exported.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `piece` | string | The piece (an id from get_picture_info). |
| `add` (optional) | `rocketSmoke`, `cometTail`, `sparkles`, `speedLines`, `echo` | Add a trail made as this preset. |
| `trail` (optional) | string | The trail to change or remove (an id from get_picture_info; the piece’s first if left out). |
| `preset` (optional) | `rocketSmoke`, `cometTail`, `sparkles`, `speedLines`, `echo` | Make that trail over as this preset. |
| `settings` (optional) | { rate, spacing, lifetime, size, growth, drift, driftAngle, spread, opacity, fade, colors, front, copies, gap, emitter } |  Its fields: `rate` (number from 0: Puffs born each second.); `spacing` (number from 0: One puff each time it travels this many pixels (0: none).); `lifetime` (number from 0: Seconds each puff lives.); `size` (number from 0: Puff width at birth, in pixels.); `growth` (number from 0: Size at the end of its life, times the size at birth.); `drift` (number: Pixels a second the puffs drift.); `driftAngle` (number: Which way they drift, in degrees (-90 is up).); `spread` (number from 0: Random scatter, pixels a second.); `opacity` (number 0 to 1); `fade` (number 0 to 1: How much they fade by the end of their life.); `colors` (list of string: Colours over their life, #rrggbb, 2 to 4.); `front` (boolean: In front of the piece instead of behind it.); `copies` (whole number from 1: Echo: how many copies.); `gap` (whole number from 1: Echo: frames between copies.); `emitter` ({ x, y }: Where it comes from, in the piece’s own pixels.). |
| `remove` (optional) | boolean | Remove the trail. |

### `set_trim` (Trim)

Animate shapes on a shapes layer being drawn: Draw on (the outline drawn from nothing to all of it) or Erase behind (from all of it to nothing, from its start), between two frames; and tie a trim’s end to a piece following the shape, so the line is drawn up to it or erased behind it.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `layer` | string | The shapes layer (an id). |
| `objects` | list of string | The shapes (object ids from get_picture_info). |
| `effect` (optional) | `drawOn`, `eraseBehind` | Draw on (drawn from nothing) or Erase behind (erased from its start). |
| `from` (optional) | whole number from 1 | The frame it starts (1 if left out). |
| `to` (optional) | whole number from 1 | The frame it ends (the last if left out). |
| `easing` (optional) | `linear`, `easeIn`, `easeOut`, `easeInOut`, `hold` | How it speeds up and slows down (linear if left out). |
| `tie` (optional) | { piece, end, gap } or `"none"` | Tie an end of the line to a piece that follows it, or none to untie. |

### `set_animation` (Animation)

The animation as a whole: its length in frames, frames a second and how it plays (round and round, once, or back and forth); the frame shown; playing or stopping it in Pigmento (for the user to watch; use get_picture_image with a frame to see frames yourself); and the 3D camera (vanishing point and perspective strength, and keyframed camera moves) and light.

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `length` (optional) | whole number 1 to 2000 | Frames. |
| `fps` (optional) | whole number 1 to 60 | Frames a second. |
| `loop` (optional) | `loop`, `once`, `pingpong` | How it plays: round and round (loop), once, or back and forth (pingpong). |
| `frame` (optional) | whole number from 1 | Show this frame. |
| `play` (optional) | boolean | true plays it in Pigmento, false stops. |
| `camera` (optional) | { x, y, strength } | The vanishing point (picture pixels) and how strong the perspective is (1 almost flat, 50 a normal lens, 100 strong). Its fields: `x` (number); `y` (number); `strength` (number 1 to 100). |
| `cameraMove` (optional) | { frame, panX, panY, push, easing } | A camera keyframe: slid across (panX) and down (panY) and moved in (push; negative: back), in picture pixels. Its fields: `frame` (whole number from 1: The frame (numbered from 1, as in the timeline).); `panX` (number); `panY` (number); `push` (number); `easing` (`linear`, `easeIn`, `easeOut`, `easeInOut`, `hold`). |
| `light` (optional) | { angle, height } |  Its fields: `angle` (number: Degrees round the view, from above.); `height` (number 0 to 90: 0 (low) to 90 (overhead).). |

### `edit_drawing` (Drawing)

Frame-by-frame drawings, on a pixels layer or a piece: a new drawing (blank, or a copy of the one shown) starting at a frame, clearing or deleting the drawing shown at a frame, moving where a drawing starts, or looping the drawings for the whole animation. Painting tools paint on a layer’s drawing shown at the frame shown (set_animation frame, or the frame a tool works at).

Permission: Draw and edit.

| Argument | Type | Description |
|---|---|---|
| `on` (optional) | string | The pixels layer or piece (an id). The active layer if left out. |
| `action` | `new`, `copy`, `clear`, `delete`, `retime`, `loop` | new (blank) or copy (of the one shown), starting at frame; clear or delete the drawing shown at frame; retime: drawing starts at start; loop the drawings. |
| `frame` (optional) | whole number from 1 | new, copy, clear and delete: the frame (the frame shown if left out); the timeline goes there. |
| `drawing` (optional) | whole number from 2 | retime: which drawing (numbered from 1; the first always starts at frame 1). |
| `start` (optional) | whole number from 1 | retime: the frame it starts at. |
| `loop` (optional) | `cycle`, `pingpong`, `off` | loop: round and round (cycle), back and forth (pingpong), or not (off: the last drawing holds). |
| `loopEnd` (optional) | whole number from 1 | loop: the last frame of the cycle (the last drawing shows until then). |

### `export_animation` (Export animation)

Export the animation (or some of its frames) as a GIF or an MP4 video, at a scale. The picture and its file don’t change.

Permission: Open, save and export files.

| Argument | Type | Description |
|---|---|---|
| `path` | string | Where to save it: a full path ending in .gif or .mp4. |
| `from` (optional) | whole number from 1 | The first frame (1 if left out). |
| `to` (optional) | whole number from 1 | The last frame (the animation’s last if left out). |
| `scale` (optional) | number 0.05 to 4 | Size compared with the picture (1 if left out). |
| `playback` (optional) | `loop`, `once`, `pingpong` | Round and round, once, or back and forth (as the animation plays if left out). |
| `transparent` (optional) | boolean | GIF: leave the paper out. |
| `quality` (optional) | `low`, `medium`, `high` | MP4: smaller, or sharper (high if left out). |
| `overwrite` (optional) | boolean | Replace the file if it’s already there. |

## Resources

The same views as resources, of the window the user is working in:

| URI | What it is |
|---|---|
| `pigmento://windows` | The Pigmento windows that are open. (application/json) |
| `pigmento://picture/info` | The picture in the window being worked in: size, layers, selection, animation. (application/json) |
| `pigmento://picture/image` | The picture in the window being worked in, as a PNG up to 1024 pixels. (image/png) |
