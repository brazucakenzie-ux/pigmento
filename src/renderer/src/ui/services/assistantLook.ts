import type { AssistantResult } from '@shared/ipc';
import { brushRegistry } from '@engine/brush/BrushRegistry';
import { toHex8 } from '@engine/core/color';
import { rectIntersect, type Rect } from '@engine/core/geometry';
import type { LayerNode } from '@engine/doc/LayerController';
import { filterRegistry } from '@engine/filters/FilterRegistry';
import { shapeRegistry } from '@engine/shapes/ShapeRegistry';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { t } from '../../i18n';
import { actions } from '../actions/actions';
import { shortcutFor } from '../actions/keymap';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { int, type Handler } from './assistantArgs';

/** The window's side of looking (8.5): picture info, the picture as a PNG, and what Pigmento has. */

/** A layer as an assistant sees it (top first, like the Layers panel). */
interface LayerView {
  id: string;
  name: string;
  kind: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: string;
  active: boolean;
  children?: LayerView[];
  objects?: { id: string; kind: string }[];
}

/** The objects on a shapes layer, top first: shapes (by kind) and groups. */
function objectsOf(id: string): { id: string; kind: string }[] {
  const l = engine.doc.layerById(id);
  return l?.kind === 'vector' ? [...l.objects].reverse().map((o) => ({ id: o.id, kind: o.type === 'group' ? 'group' : o.shape })) : [];
}

function layerView(n: LayerNode, activeId: string): LayerView {
  return {
    id: n.id,
    name: n.name,
    kind: n.kind === 'raster' ? 'pixels' : n.kind === 'vector' ? 'shapes' : 'group',
    visible: n.visible,
    locked: n.locked,
    opacity: Math.round(n.opacity * 100) / 100,
    blend: n.blend,
    active: n.id === activeId,
    ...(n.kind === 'group' ? { children: [...n.children].reverse().map((c) => layerView(c, activeId)) } : {}),
    ...(n.kind === 'vector' ? { objects: objectsOf(n.id) } : {}),
  };
}

/** The picture in this window, in brief. Frames are numbered from 1, as in the timeline. */
function pictureInfo(): AssistantResult {
  const s = useUi.getState();
  const layers = engine.layers.info();
  const anim = engine.anim.info();
  const sel = s.selection.bounds;
  const tool = toolRegistry.get(s.tool);
  const frames = (list: readonly number[] | null | undefined) => (list ? list.map((f) => f + 1) : null);
  const data = {
    width: engine.doc.width,
    height: engine.doc.height,
    file: s.file.path,
    name: s.file.name ?? 'Untitled',
    unsavedChanges: s.history.dirty,
    paper: engine.doc.paper ? toHex8(engine.doc.paper) : null,
    layers: [...layers.tree].reverse().map((n) => layerView(n, layers.activeId)),
    selection: sel ? { x: sel.x, y: sel.y, width: sel.w, height: sel.h } : null,
    tool: tool ? { id: tool.id, name: t(tool.labelKey) } : null,
    colors: { primary: toHex8(s.colors.primary), secondary: toHex8(s.colors.secondary) },
    animation: {
      frame: anim.frame + 1,
      length: anim.length,
      fps: anim.fps,
      drawings: Object.fromEntries(Object.entries(anim.cels).map(([id, starts]) => [id, frames(starts)])),
      loop: anim.loop,
      pieces: anim.pieces.map((p) => {
        const full = engine.anim.piece(p.id);
        return {
          id: p.id,
          name: p.name,
          kind: p.kind,
          layer: p.layerId,
          keyframes: frames(p.keys.map((k) => k.frame)),
          drawings: frames(p.drawings),
          loop: p.loop,
          follows: p.parent,
          hinged: p.hinged,
          path: full?.follow ? { layer: full.follow.layerId, object: full.follow.objectId } : null,
          facesItsWay: full?.face.on ?? false,
          spins: p.spinKeys.length > 0,
          trails: full?.trails.map((t) => t.id) ?? [],
        };
      }),
      camera: { ...engine.doc.camera },
      cameraMoves: frames(engine.doc.cameraKeys.map((k) => k.frame)),
      light: { ...engine.doc.light },
    },
  };
  return { text: `${data.name}: ${data.width} × ${data.height} pixels, ${layers.count} layer${layers.count === 1 ? '' : 's'}${data.unsavedChanges ? ', with unsaved changes' : ''}.`, data };
}

/** The longest side of a picture image when the assistant doesn't say. */
const DEFAULT_IMAGE_SIZE = 1024;

/** The part of the picture an assistant asked for (all of it if it didn't say), inside the picture. */
function regionOf(v: unknown): Rect {
  const all = engine.doc.bounds;
  if (typeof v !== 'object' || v === null) return all;
  const o = v as Record<string, unknown>;
  const [x, y, w, h] = [int(o.x), int(o.y), int(o.width), int(o.height)];
  if (x === undefined || y === undefined || w === undefined || h === undefined) throw new Error('A region needs whole numbers x, y, width and height.');
  const r = rectIntersect({ x, y, w, h }, all);
  if (!r || r.w <= 0 || r.h <= 0) throw new Error(`That region is outside the picture, which is ${all.w} × ${all.h} pixels.`);
  return r;
}

/** The PNG of a canvas, in base 64. */
async function pngBase64(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image couldn’t be made.'));
    reader.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

/** The picture (or a layer, a region or a frame of it) as a PNG, scaled down to fit maxSize. */
async function pictureImage(args: Record<string, unknown>): Promise<AssistantResult> {
  const doc = engine.doc;
  const length = doc.timeline.length;
  const layerId = typeof args.layer === 'string' ? args.layer : null;
  const layer = layerId === null ? null : doc.layerById(layerId);
  if (layer === undefined) throw new Error(`There’s no layer ${layerId}. get_picture_info lists the layers.`);
  const frame = int(args.frame) ?? doc.timeline.frame + 1;
  if (frame < 1 || frame > length) throw new Error(`The animation has ${length} frame${length === 1 ? '' : 's'}: frame can be 1 to ${length}.`);
  const r = regionOf(args.region);
  const maxSize = int(args.maxSize) ?? DEFAULT_IMAGE_SIZE;
  const { canvas, scale } = engine.lookCanvas({ layer, r, frame: frame - 1, maxSize });
  const base64 = await pngBase64(canvas);
  const what = layer ? `The layer “${layer.name}”` : r.w === doc.width && r.h === doc.height ? 'The picture' : `The part of the picture at ${r.x}, ${r.y}, ${r.w} × ${r.h} pixels,`;
  const scaled = scale < 1 ? `, shown at ${canvas.width} × ${canvas.height} (${Math.round(scale * 1000) / 10}%)` : '';
  return {
    text: `${what}${length > 1 ? ` at frame ${frame} of ${length}` : ''}${scaled}.`,
    data: { width: canvas.width, height: canvas.height, scale, frame, region: { x: r.x, y: r.y, width: r.w, height: r.h }, layer: layer?.id ?? null },
    images: [{ mimeType: 'image/png', base64 }],
  };
}

/** What Pigmento has: its tools, brushes, shapes, effects or actions. */
function available(what: unknown): AssistantResult {
  const s = useUi.getState();
  const list: Record<string, () => unknown[]> = {
    tools: () => toolRegistry.all().filter((d) => !d.hidden).map((d) => ({ id: d.id, name: t(d.labelKey), group: d.group, shortcut: d.shortcut ?? null })),
    brushes: () => brushRegistry.all().map((d) => ({ id: d.id, name: d.name ?? t(d.labelKey), category: d.category, eraser: d.eraser, personal: !!d.custom })),
    shapes: () => shapeRegistry.all().map((d) => ({ id: d.id, name: d.name ?? t(d.labelKey), category: d.category, personal: !!d.custom, settings: d.params.map((p) => ({ key: p.key, name: t(p.labelKey), min: p.min, max: p.max, default: p.default })) })),
    effects: () =>
      filterRegistry.all().map((d) => ({
        id: d.id,
        name: t(d.labelKey),
        kind: d.kind,
        group: d.group,
        settings: d.params.map((p) => ({ key: p.key, name: t(p.labelKey), type: p.type, ...(p.type === 'slider' ? { min: p.min, max: p.max } : {}), ...(p.type === 'choice' ? { choices: p.choices.map((c) => c.value) } : {}) })),
      })),
    actions: () =>
      [...actions().values()]
        .filter((a) => !a.hidden)
        .map((a) => ({ id: a.id, name: t(a.labelKey), group: a.group, shortcut: shortcutFor(a.id) ?? null, enabled: a.enabled ? a.enabled(s) : true })),
  };
  const key = typeof what === 'string' ? what : '';
  const make = list[key];
  if (!make) throw new Error(`Ask for one of: ${Object.keys(list).join(', ')}.`);
  const items = make();
  return { text: `Pigmento has ${items.length} ${key}.`, data: { [key]: items } };
}

export const LOOK_HANDLERS: Record<string, Handler> = {
  get_picture_info: () => pictureInfo(),
  get_picture_image: (args) => pictureImage(args),
  list_available: (args) => available(args.what),
};
