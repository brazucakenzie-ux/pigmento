import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import {
  BLEND_MODES,
  GroupLayer,
  PaintDocument,
  RasterLayer,
  VectorLayer,
  walkLayers,
  type BlendMode,
  type Layer,
  type SavedSelection,
} from '../doc/Document';
import { Selection } from '../doc/Selection';
import { guide } from '../doc/guides';
import { parseHex, toHex8 } from '../core/color';
import type { VectorNode } from '../vector/model';
import { Surface } from '../raster/Surface';
import { MAX_DIMENSION, MAX_PIXELS } from './protocol';

/**
 * The `.pigm` project format: a zip holding `document.json` (described by the schemas below)
 * and one PNG per raster layer, cropped to the layer's content. See docs/project-format.md.
 */
export const PROJECT_MAGIC = 'pigmento-project';
export const PROJECT_VERSION = 1;

const MAX_LAYERS = 2000;
const MAX_DEPTH = 64;
const MAX_SAVED_SELECTIONS = 200;
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

const int = z.number().int();
const Blend = z.enum(BLEND_MODES as [BlendMode, ...BlendMode[]]);
const Rgba = z.object({ r: int.min(0).max(255), g: int.min(0).max(255), b: int.min(0).max(255), a: int.min(0).max(255) });

const Common = {
  id: z.string().min(1).max(100),
  name: z.string().max(200),
  opacity: z.number().min(0).max(1),
  blend: Blend,
  visible: z.boolean(),
  locked: z.boolean(),
};

const RasterJson = z.object({
  kind: z.literal('raster'),
  ...Common,
  image: z
    .object({
      file: z.string().regex(/^layers\/\d{1,6}\.png$/),
      x: int.min(-MAX_DIMENSION).max(MAX_DIMENSION),
      y: int.min(-MAX_DIMENSION).max(MAX_DIMENSION),
      w: int.min(1).max(MAX_DIMENSION),
      h: int.min(1).max(MAX_DIMENSION),
    })
    .nullable(),
});

/** A saved selection: its coverage as a greyscale PNG (white = selected) placed at x, y. */
const SavedSelectionJson = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(200),
  mask: z.object({
    file: z.string().regex(/^selections\/\d{1,6}\.png$/),
    x: int.min(0).max(MAX_DIMENSION),
    y: int.min(0).max(MAX_DIMENSION),
    w: int.min(1).max(MAX_DIMENSION),
    h: int.min(1).max(MAX_DIMENSION),
  }),
});

/** Most objects (shapes and groups) all shape layers together may hold. */
const MAX_OBJECTS = 50000;
const num = z.number().finite();
const PointJson = z.object({ x: num, y: num });
const ShapeStyleJson = z.object({
  mode: z.enum(['outline', 'fill', 'both']),
  width: z.number().min(0).max(1000),
  outline: z.string().regex(/^#[0-9a-f]{8}$/i),
  fill: z.string().regex(/^#[0-9a-f]{8}$/i),
  radius: z.number().min(0).max(1e6),
  antialias: z.boolean(),
});
const ShapeNodeJson = z.object({
  type: z.literal('shape'),
  id: z.string().min(1).max(100),
  shape: z.enum(['line', 'curve', 'rect', 'roundRect', 'ellipse', 'polygon', 'parametric']),
  box: z.object({ cx: num, cy: num, w: num, h: num, angle: num }).nullable(),
  points: z.array(PointJson).max(100000),
  style: ShapeStyleJson,
  /** Library shape id and slider values (parametric shapes). */
  shapeId: z.string().regex(/^[a-z0-9-]{1,100}$/i).optional(),
  params: z
    .record(z.string().regex(/^[a-z][a-z0-9]{0,39}$/i), num)
    .refine((r) => Object.keys(r).length <= 32)
    .optional(),
});
type VectorNodeJson = z.infer<typeof ShapeNodeJson> | { type: 'group'; id: string; children: VectorNodeJson[] };
const VectorNodeSchema: z.ZodType<VectorNodeJson> = z.lazy(() =>
  z.discriminatedUnion('type', [ShapeNodeJson, z.object({ type: z.literal('group'), id: z.string().min(1).max(100), children: z.array(VectorNodeSchema).max(MAX_OBJECTS) })]),
);
const VectorJson = z.object({ kind: z.literal('vector'), ...Common, objects: z.array(VectorNodeSchema).max(MAX_OBJECTS) });

function nodeToJson(n: VectorNode): VectorNodeJson {
  if (n.type === 'group') return { type: 'group', id: n.id, children: n.children.map(nodeToJson) };
  const s = n.style;
  return {
    type: 'shape',
    id: n.id,
    shape: n.shape,
    box: n.box ? { ...n.box } : null,
    points: n.points.map((p) => ({ x: p.x, y: p.y })),
    style: { mode: s.mode, width: s.width, outline: toHex8(s.outline), fill: toHex8(s.fill), radius: s.radius, antialias: s.antialias },
    ...(n.shapeId ? { shapeId: n.shapeId, params: { ...n.params } } : {}),
  };
}

function nodeFromJson(n: VectorNodeJson, depth: number, counter: { n: number }): VectorNode {
  if (depth > MAX_DEPTH || ++counter.n > MAX_OBJECTS) throw new ProjectError('error.projectInvalid', 'Too many shapes');
  if (n.type === 'group') return { type: 'group', id: n.id, children: n.children.map((c) => nodeFromJson(c, depth + 1, counter)) };
  const outline = parseHex(n.style.outline);
  const fill = parseHex(n.style.fill);
  if (!outline || !fill) throw new ProjectError('error.projectInvalid', 'Bad colour');
  // A library shape needs its box and id.
  if (n.shape === 'parametric' && (!n.box || !n.shapeId)) throw new ProjectError('error.projectInvalid', 'Bad shape');
  const library = n.shape === 'parametric' ? { shapeId: n.shapeId!, params: { ...n.params } } : {};
  return { type: 'shape', id: n.id, shape: n.shape, box: n.box ? { ...n.box } : null, points: n.points, style: { ...n.style, outline, fill }, ...library };
}

type LayerJson = z.infer<typeof RasterJson> | z.infer<typeof VectorJson> | GroupJson;
interface GroupJson {
  kind: 'group';
  id: string;
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  locked: boolean;
  collapsed: boolean;
  children: LayerJson[];
}

const LayerJsonSchema: z.ZodType<LayerJson> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    RasterJson,
    VectorJson,
    z.object({
      kind: z.literal('group'),
      ...Common,
      collapsed: z.boolean(),
      children: z.array(LayerJsonSchema).max(MAX_LAYERS),
    }),
  ]),
);

export const DocumentJsonSchema = z.object({
  format: z.literal(PROJECT_MAGIC),
  version: int.min(1),
  width: int.min(1).max(MAX_DIMENSION),
  height: int.min(1).max(MAX_DIMENSION),
  dpi: z.number().min(1).max(10000),
  paper: Rgba.nullable(),
  activeId: z.string(),
  layers: z.array(LayerJsonSchema).min(1).max(MAX_LAYERS),
  /** Optional: files without saved selections leave it out. */
  selections: z.array(SavedSelectionJson).max(MAX_SAVED_SELECTIONS).optional(),
  /** Ruler guides; optional. */
  guides: z
    .array(z.object({ axis: z.enum(['x', 'y']), pos: z.number().min(-MAX_DIMENSION).max(2 * MAX_DIMENSION) }))
    .max(1000)
    .optional(),
});

export type DocumentJson = z.infer<typeof DocumentJsonSchema>;

export interface PngCodec {
  encode(data: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array>;
  decode(bytes: Uint8Array): Promise<{ w: number; h: number; data: Uint8ClampedArray }>;
}

export class ProjectError extends Error {
  constructor(
    readonly key: 'error.projectInvalid' | 'error.projectNewer' | 'error.tooLarge',
    message: string,
  ) {
    super(message);
  }
}

/** Serialise a document to `.pigm` bytes. */
export async function saveProject(doc: PaintDocument, codec: PngCodec, thumbnail?: Uint8Array): Promise<Uint8Array> {
  const files: Zippable = {};
  let n = 0;
  const toJson = async (l: Layer): Promise<LayerJson> => {
    const common = { id: l.id, name: l.name, opacity: l.opacity, blend: l.blend, visible: l.visible, locked: l.locked };
    if (l.kind === 'group') {
      const children: LayerJson[] = [];
      for (const c of l.children) children.push(await toJson(c));
      return { kind: 'group', ...common, collapsed: l.collapsed, children };
    }
    // Shape layers are kept as objects, not pixels.
    if (l.kind === 'vector') return { kind: 'vector', ...common, objects: l.objects.map(nodeToJson) };
    const b = l.surface.contentBounds();
    if (!b) return { kind: 'raster', ...common, image: null };
    const file = `layers/${String(++n).padStart(4, '0')}.png`;
    // PNG data is already compressed, so it is stored, not deflated again.
    files[file] = [await codec.encode(l.surface.readRect(b), b.w, b.h), { level: 0 }];
    return { kind: 'raster', ...common, image: { file, x: b.x, y: b.y, w: b.w, h: b.h } };
  };
  const layers: LayerJson[] = [];
  for (const l of doc.layers) layers.push(await toJson(l));
  const selections: NonNullable<DocumentJson['selections']> = [];
  for (const [i, s] of doc.savedSelections.entries()) {
    const b = s.selection.bounds;
    const grey = new Uint8ClampedArray(b.w * b.h * 4);
    for (let p = 0; p < s.selection.mask.length; p++) {
      const v = s.selection.mask[p];
      grey[p * 4] = v;
      grey[p * 4 + 1] = v;
      grey[p * 4 + 2] = v;
      grey[p * 4 + 3] = 255;
    }
    const file = `selections/${String(i + 1).padStart(4, '0')}.png`;
    files[file] = [await codec.encode(grey, b.w, b.h), { level: 0 }];
    selections.push({ id: s.id, name: s.name, mask: { file, x: b.x, y: b.y, w: b.w, h: b.h } });
  }
  const json: DocumentJson = {
    format: PROJECT_MAGIC,
    version: PROJECT_VERSION,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    paper: doc.paper ? { ...doc.paper } : null,
    activeId: doc.activeId,
    layers,
    ...(selections.length ? { selections } : {}),
    ...(doc.guides.length ? { guides: doc.guides.map((g) => ({ axis: g.axis, pos: g.pos })) } : {}),
  };
  files['document.json'] = [strToU8(JSON.stringify(json, null, 1)), { level: 6 }];
  if (thumbnail) files['thumbnail.png'] = [thumbnail, { level: 0 }];
  return zipSync(files);
}

/** True if the bytes look like a zip archive (projects); used to sniff dropped files. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function unzipSafely(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let entries = 0;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        entries++;
        total += f.originalSize;
        if (entries > MAX_LAYERS + MAX_SAVED_SELECTIONS + 16 || f.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) {
          throw new ProjectError('error.projectInvalid', 'Archive is too large');
        }
        return (
          f.name === 'document.json' ||
          /^layers\/\d{1,6}\.png$/.test(f.name) ||
          /^selections\/\d{1,6}\.png$/.test(f.name) ||
          f.name === 'thumbnail.png'
        );
      },
    });
  } catch (err) {
    if (err instanceof ProjectError) throw err;
    throw new ProjectError('error.projectInvalid', 'Not a Pigmento project');
  }
}

/** Read `.pigm` bytes into a document (validated; never executes anything from the file). */
export async function loadProject(bytes: Uint8Array, codec: PngCodec): Promise<PaintDocument> {
  const files = unzipSafely(bytes);
  const raw = files['document.json'];
  if (!raw) throw new ProjectError('error.projectInvalid', 'document.json missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(raw));
  } catch {
    throw new ProjectError('error.projectInvalid', 'document.json is not JSON');
  }
  const version = (parsed as { version?: unknown })?.version;
  if (typeof version === 'number' && version > PROJECT_VERSION) {
    throw new ProjectError('error.projectNewer', `Project version ${version}`);
  }
  const res = DocumentJsonSchema.safeParse(parsed);
  if (!res.success) throw new ProjectError('error.projectInvalid', res.error.message);
  const json = res.data;
  if (json.width * json.height > MAX_PIXELS) throw new ProjectError('error.tooLarge', `${json.width}x${json.height}`);

  const seen = new Set<string>();
  let count = 0;
  const objectCount = { n: 0 };
  const build = async (l: LayerJson, depth: number): Promise<Layer> => {
    if (depth > MAX_DEPTH || ++count > MAX_LAYERS) throw new ProjectError('error.projectInvalid', 'Too many layers');
    // Duplicate ids would confuse the layer tree; give repeats fresh ones.
    const id = seen.has(l.id) ? undefined : l.id;
    seen.add(l.id);
    let layer: Layer;
    if (l.kind === 'group') {
      const children: Layer[] = [];
      for (const c of l.children) children.push(await build(c, depth + 1));
      const g = new GroupLayer(l.name, children, id);
      g.collapsed = l.collapsed;
      layer = g;
    } else if (l.kind === 'vector') {
      layer = new VectorLayer(l.name, json.width, json.height, l.objects.map((n) => nodeFromJson(n, 0, objectCount)), id);
    } else {
      const surface = new Surface(json.width, json.height);
      if (l.image) {
        const png = files[l.image.file];
        if (!png) throw new ProjectError('error.projectInvalid', `${l.image.file} missing`);
        const img = await codec.decode(png);
        if (img.w !== l.image.w || img.h !== l.image.h) {
          throw new ProjectError('error.projectInvalid', `${l.image.file} has the wrong size`);
        }
        surface.writeRect({ x: l.image.x, y: l.image.y, w: img.w, h: img.h }, { data: img.data, stride: img.w, ox: l.image.x, oy: l.image.y });
        surface.compact();
      }
      layer = new RasterLayer(l.name, surface, id);
    }
    layer.setProps({ opacity: l.opacity, blend: l.blend, visible: l.visible, locked: l.locked });
    return layer;
  };
  const layers: Layer[] = [];
  for (const l of json.layers) layers.push(await build(l, 0));
  const doc = new PaintDocument({ width: json.width, height: json.height, dpi: json.dpi, paper: json.paper }, layers);
  if ([...walkLayers(layers)].some((l) => l.id === json.activeId)) doc.activeId = json.activeId;
  const saved: SavedSelection[] = [];
  const savedIds = new Set<string>();
  for (const s of json.selections ?? []) {
    const png = files[s.mask.file];
    if (!png) throw new ProjectError('error.projectInvalid', `${s.mask.file} missing`);
    const img = await codec.decode(png);
    if (img.w !== s.mask.w || img.h !== s.mask.h) throw new ProjectError('error.projectInvalid', `${s.mask.file} has the wrong size`);
    const mask = new Uint8Array(img.w * img.h);
    for (let p = 0; p < mask.length; p++) mask[p] = img.data[p * 4];
    const placed = Selection.fromPlaced({ bounds: { x: s.mask.x, y: s.mask.y, w: img.w, h: img.h }, mask });
    const sel = placed?.clipped(json.width, json.height) ?? null;
    if (!sel || savedIds.has(s.id)) continue;
    savedIds.add(s.id);
    saved.push({ id: s.id, name: s.name, selection: sel });
  }
  doc.savedSelections = saved;
  doc.guides = (json.guides ?? []).map((g) => guide(g.axis, g.pos));
  return doc;
}

/** The embedded preview, if present (for the crash-recovery list). */
export function readProjectThumbnail(bytes: Uint8Array): Uint8Array | null {
  try {
    return unzipSync(bytes, { filter: (f) => f.name === 'thumbnail.png' && f.originalSize < 8 * 1024 * 1024 })['thumbnail.png'] ?? null;
  } catch {
    return null;
  }
}

