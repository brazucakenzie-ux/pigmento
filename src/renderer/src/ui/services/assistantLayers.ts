import { BLEND_MODES, type BlendMode, type LayerProps } from '@engine/doc/Document';
import { Selection, type SelectionModify } from '@engine/doc/Selection';
import type { SelectionMode } from '@engine/doc/selectionMath';
import type { Point } from '@engine/core/geometry';
import { engine } from '../state/engine';
import { bool, colorArg, layerArg, num, pixelLayer, str, chooseLayer, type Handler } from './assistantArgs';

/**
 * The window's side of layers, selections and moving pixels (8.8). Each handler checks what it
 * was given first, then returns the change, made as one "Assistant: …" undo step.
 */

const named = (id: string) => `“${engine.doc.layerById(id)?.name ?? id}”`;

/** Where the selection is now, for the assistant. */
function selectionNow() {
  const b = engine.doc.selection?.bounds;
  return b ? { x: b.x, y: b.y, width: b.w, height: b.h } : null;
}

const SELECT_LABEL: Record<string, string> = { rectangle: 'Selected a rectangle', ellipse: 'Selected an ellipse', polygon: 'Selected a polygon', wand: 'Selected with the magic wand', color: 'Selected a colour range' };

/** A rectangle the assistant gave (for rectangle and ellipse). */
function boxArg(args: Record<string, unknown>) {
  const [x, y, w, h] = [num(args.x), num(args.y), num(args.width), num(args.height)];
  if (x === undefined || y === undefined || w === undefined || h === undefined) throw new Error('A rectangle or ellipse needs x, y, width and height.');
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export const LAYER_HANDLERS: Record<string, Handler> = {
  add_layer: (args) => {
    const above = layerArg(args.above);
    const name = str(args.name);
    return {
      label: 'assistant.step.add_layer',
      apply: () => {
        if (above) engine.layers.setActive(above.id);
        const id = args.kind === 'shapes' ? engine.layers.addVector() : engine.layers.add();
        if (name) engine.layers.setProps(id, { name });
        return { text: `Added the layer ${named(id)}, now the active layer.`, data: { layer: id } };
      },
    };
  },

  delete_layer: (args) => {
    const layer = layerArg(args.layer)!;
    if (!engine.layers.canRemove(layer.id)) throw new Error(`${named(layer.id)} is the last layer: a picture always has one.`);
    return {
      label: 'assistant.step.delete_layer',
      apply: () => {
        const name = named(layer.id);
        engine.layers.remove(layer.id);
        return { text: `Deleted the layer ${name}.` };
      },
    };
  },

  move_layer: (args) => {
    const layer = layerArg(args.layer)!;
    const to = str(args.to);
    const into = str(args.into);
    let parentId: string | null | undefined;
    if (into !== undefined) {
      if (into === 'picture') parentId = null;
      else {
        const g = layerArg(into)!;
        if (g.kind !== 'group') throw new Error(`${named(g.id)} isn’t a group.`);
        if (g.id === layer.id) throw new Error('A group can’t go inside itself.');
        parentId = g.id;
      }
    }
    if (parentId === undefined && to === undefined) throw new Error('Say where to: to (up, down, top or bottom) or into (a group, or "picture").');
    return {
      label: 'assistant.step.move_layer',
      apply: () => {
        const slot = engine.doc.slotOf(layer.id)!;
        let moved: boolean;
        if (parentId === undefined && (to === 'up' || to === 'down')) moved = engine.layers.step(layer.id, to === 'up' ? 1 : -1);
        else {
          const parent = parentId === undefined ? (slot.parent?.id ?? null) : parentId;
          const list = parent === null ? engine.doc.layers : (engine.doc.layerById(parent) as { children: unknown[] }).children;
          moved = engine.layers.move(layer.id, parent, to === 'bottom' ? 0 : list.length);
        }
        if (!moved) return { text: `${named(layer.id)} is already there.` };
        return { text: `Moved the layer ${named(layer.id)}.` };
      },
    };
  },

  group_layers: (args) => {
    const ids = (Array.isArray(args.layers) ? args.layers : []).map((v) => layerArg(v)!.id);
    const parents = new Set(ids.map((id) => engine.doc.slotOf(id)?.list));
    if (parents.size > 1) throw new Error('The layers to group have to be side by side in the same list (all at the top level, or all in the same group).');
    const name = str(args.name);
    return {
      label: 'assistant.step.group_layers',
      apply: () => {
        const id = engine.layers.group(ids);
        if (!id) throw new Error('Those layers couldn’t be grouped.');
        if (name) engine.layers.setProps(id, { name });
        return { text: `Grouped ${ids.length} layer${ids.length === 1 ? '' : 's'} in ${named(id)}.`, data: { layer: id } };
      },
    };
  },

  set_layer: (args) => {
    const layer = layerArg(args.layer)!;
    const props: Partial<LayerProps> = {};
    const name = str(args.name);
    if (name !== undefined) props.name = name;
    const visible = bool(args.visible);
    if (visible !== undefined) props.visible = visible;
    const locked = bool(args.locked);
    if (locked !== undefined) props.locked = locked;
    const opacity = num(args.opacity);
    if (opacity !== undefined) props.opacity = Math.min(1, Math.max(0, opacity));
    const blend = str(args.blend);
    if (blend !== undefined) {
      if (!BLEND_MODES.includes(blend as BlendMode)) throw new Error(`The blend mode can be ${BLEND_MODES.join(', ')}.`);
      props.blend = blend as BlendMode;
    }
    const active = bool(args.active) === true;
    return {
      label: 'assistant.step.set_layer',
      apply: () => {
        // One property at a time, so each change keeps its own label inside the step.
        for (const [k, v] of Object.entries(props)) engine.layers.setProps(layer.id, { [k]: v });
        if (active) engine.layers.setActive(layer.id);
        return { text: `Set the layer ${named(layer.id)}.` };
      },
    };
  },

  select: (args) => {
    const shape = str(args.shape) ?? '';
    const mode = (str(args.mode) ?? 'replace') as SelectionMode;
    const { width: W, height: H } = engine.doc;
    const sel = engine.doc.selection;
    let make: () => void | Promise<void>;
    if (shape === 'rectangle' || shape === 'ellipse') {
      const box = boxArg(args);
      const next = shape === 'rectangle' ? Selection.fromRect(box, W, H) : Selection.fromEllipse(box, W, H);
      if (!next) throw new Error(`That ${shape} is outside the picture, which is ${W} × ${H} pixels.`);
      make = () => engine.applySelection(next, mode, shape === 'rectangle' ? 'history.selectRect' : 'history.selectEllipse');
    } else if (shape === 'polygon') {
      const pts = (Array.isArray(args.points) ? args.points : []) as Point[];
      const next = Selection.fromPolygon(pts, W, H);
      if (!next) throw new Error('That polygon has no area inside the picture.');
      make = () => engine.applySelection(next, mode, 'history.selectPolygon');
    } else if (shape === 'wand') {
      const [x, y] = [num(args.x), num(args.y)];
      if (x === undefined || y === undefined) throw new Error('The magic wand needs the point to start from: x and y.');
      if (x < 0 || y < 0 || x >= W || y >= H) throw new Error(`That point is outside the picture, which is ${W} × ${H} pixels.`);
      const allLayers = bool(args.allLayers) === true;
      if (!allLayers) chooseLayer(args.layer);
      const o = { tolerance: num(args.tolerance) ?? 25, contiguous: bool(args.contiguous) ?? true, sampleAll: allLayers };
      make = () => engine.magicWand(x, y, o, mode);
    } else if (shape === 'color') {
      const color = colorArg(args.color);
      if (!color) throw new Error('A colour range needs the colour: color as #rrggbb.');
      const allLayers = bool(args.allLayers) === true;
      if (!allLayers) chooseLayer(args.layer);
      const tolerance = num(args.tolerance) ?? 20;
      make = () => engine.applySelection(engine.colorRange(allLayers)(color, tolerance), mode, 'history.colorRange');
    } else if (shape === 'all') make = () => engine.changeSelection(Selection.all(W, H), 'history.selectAll');
    else if (shape === 'none') make = () => engine.changeSelection(null, 'history.deselect');
    else if (shape === 'invert') make = () => engine.changeSelection(sel ? sel.inverted(W, H) : Selection.all(W, H), 'history.invertSelection');
    else {
      if (!sel) throw new Error(`There’s no selection to ${shape === 'border' ? 'make a border of' : shape}.`);
      const amount = num(args.amount);
      if (amount === undefined) throw new Error(`Say how many pixels to ${shape} by: amount.`);
      make = () => {
        if (!engine.modifySelection(shape as SelectionModify, amount)) throw new Error('Nothing would stay selected.');
      };
    }
    return {
      label: 'assistant.step.select',
      apply: async () => {
        await make();
        const now = selectionNow();
        return { text: now ? `${SELECT_LABEL[shape] ?? 'Changed the selection'}: ${now.width} × ${now.height} pixels at ${now.x}, ${now.y}.` : 'Nothing is selected.', data: { selection: now } };
      },
    };
  },

  transform_pixels: (args) => {
    chooseLayer(args.layer);
    const layer = pixelLayer();
    const [dx, dy, sx, sy, rot] = [num(args.dx) ?? 0, num(args.dy) ?? 0, num(args.scaleX) ?? 1, num(args.scaleY) ?? 1, num(args.rotate) ?? 0];
    const flip = str(args.flip);
    const what = engine.doc.selection ? 'the selected pixels' : `the layer ${named(layer.id)}`;
    return {
      label: 'assistant.step.transform_pixels',
      apply: () => {
        // Free transform, as you'd do it, set by numbers; then back to the tool you had.
        const tool = engine.activeToolIdValue;
        if (!engine.freeTransform()) throw new Error(`There’s nothing on ${named(layer.id)} to move.`);
        try {
          const t = engine.transformInfo()!;
          engine.setTransformValues({ x: t.x + dx, y: t.y + dy, w: t.w * sx, h: t.h * sy, angle: t.angle + rot });
          if (flip) engine.flip(flip === 'horizontal' ? 'h' : 'v');
          engine.commitLive(true);
        } finally {
          if (engine.activeToolIdValue !== tool) engine.setTool(tool);
        }
        return { text: `Moved ${what}.`, data: { selection: selectionNow() } };
      },
    };
  },
};
