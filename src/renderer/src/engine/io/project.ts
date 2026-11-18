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
import { walkShapes, type VectorNode } from '../vector/model';
import type { SubPaths } from '../vector/pathData';
import type { ShapeStyle } from '../live/ShapeObject';
import { MAX_STOPS } from '../raster/gradient';
import { addImageAsset, ASSET_ID, imageAsset, MAX_ASSET_PIXELS } from '../vector/assets';
import {
  ARROW_HEADS,
  CAP_STYLES,
  DASH_STYLES,
  FILL_KINDS,
  JOIN_STYLES,
  OUTLINE_KINDS,
  SHAPE_GRADIENT_TYPES,
  type PaintStop,
  type ShapeGradient,
} from '../vector/style';
import { Surface } from '../raster/Surface';
import { MAX_DIMENSION, MAX_PIXELS } from './protocol';
import { EASINGS, type Easing, type Keyframe } from '../anim/interpolate';
import { MAX_KEYFRAMES, MAX_PIECES, MAX_SCROLL, newPieceId, REPEATS, type Piece, type Repeat } from '../anim/piece';
import { LOOP_MODES, MAX_FPS, MAX_FRAMES, MIN_FPS, clampFrame, type LoopMode } from '../anim/timeline';
import { MAX_CELS, type Cel } from '../anim/cels';

/**
 * The `.pigm` project format: a zip holding `document.json` (described by the schemas below)
 * and one PNG per raster layer, cropped to the layer's content. See docs/project-format.md.
 */
export const PROJECT_MAGIC = 'pigmento-project';
/**
 * Version 2 adds animation, version 3 what 1.2 adds to pieces (repeat and scroll so far). A
 * picture is written as the oldest version that holds everything in it, so older Pigmentos open
 * whatever they can show correctly: 1 without animation, 2 with 1.1's animation only.
 */
export const PROJECT_VERSION = 3;

/** The oldest version that holds everything in `doc`. */
export function versionFor(doc: PaintDocument): 1 | 2 | 3 {
  if (doc.pieces.some((p) => p.repeat !== 'none' || p.keyframes.some((k) => k.scrollX !== 0 || k.scrollY !== 0))) return 3;
  return doc.pieces.length || doc.hasCels ? 2 : 1;
}

const MAX_LAYERS = 2000;
const MAX_DEPTH = 64;
const MAX_SAVED_SELECTIONS = 200;
/** Pictures used by image fills. */
const MAX_ASSETS = 256;
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

const placed = (file: RegExp) =>
  z
    .object({
      file: z.string().regex(file),
      x: int.min(-MAX_DIMENSION).max(MAX_DIMENSION),
      y: int.min(-MAX_DIMENSION).max(MAX_DIMENSION),
      w: int.min(1).max(MAX_DIMENSION),
      h: int.min(1).max(MAX_DIMENSION),
    })
    .nullable();
const CEL_FILE = /^cels\/\d{1,6}\.png$/;
/** Most drawings all frame-by-frame layers together may hold. */
const MAX_TOTAL_CELS = 20000;

const RasterJson = z.object({
  kind: z.literal('raster'),
  ...Common,
  image: placed(/^layers\/\d{1,6}\.png$/),
  /** Version 2: frame-by-frame drawings, each from its start frame (then `image` is null). */
  cels: z
    .array(z.object({ start: int.min(0).max(MAX_FRAMES - 1), image: placed(CEL_FILE) }))
    .min(2)
    .max(MAX_CELS)
    .optional(),
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
const Hex8 = z.string().regex(/^#[0-9a-f]{8}$/i);
const GradientJson = z.object({
  type: z.enum(SHAPE_GRADIENT_TYPES),
  stops: z
    .array(z.object({ pos: z.number().min(0).max(1), color: Hex8 }))
    .min(2)
    .max(MAX_STOPS)
    .nullable(),
  angle: num,
});
const ShapeStyleJson = z.object({
  mode: z.enum(['outline', 'fill', 'both']),
  width: z.number().min(0).max(1000),
  outline: Hex8,
  fill: Hex8,
  radius: z.number().min(0).max(1e6),
  antialias: z.boolean(),
  // Fill and outline styles (all optional: a solid colour and the shape's usual line).
  fillKind: z.enum(FILL_KINDS).optional(),
  fillGradient: GradientJson.optional(),
  fillPattern: z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/i), scale: int.min(1).max(8) }).optional(),
  fillImage: z.string().regex(ASSET_ID).optional(),
  outlineKind: z.enum(OUTLINE_KINDS).optional(),
  outlineGradient: GradientJson.optional(),
  dash: z.enum(DASH_STYLES).optional(),
  cap: z.enum(CAP_STYLES).optional(),
  join: z.enum(JOIN_STYLES).optional(),
  arrowStart: z.enum(ARROW_HEADS).optional(),
  arrowEnd: z.enum(ARROW_HEADS).optional(),
});
type ShapeStyleJsonT = z.infer<typeof ShapeStyleJson>;

function gradientToJson(g: ShapeGradient): z.infer<typeof GradientJson> {
  return { type: g.type, angle: g.angle, stops: g.stops ? g.stops.map((s) => ({ pos: s.pos, color: toHex8(s.color) })) : null };
}

function gradientFromJson(g: z.infer<typeof GradientJson>): ShapeGradient {
  const stops = g.stops?.map((s) => ({ pos: s.pos, color: parseHex(s.color) })) ?? null;
  if (stops?.some((s) => !s.color)) throw new ProjectError('error.projectInvalid', 'Bad gradient colour');
  return { type: g.type, angle: g.angle, stops: stops as PaintStop[] | null };
}

function styleToJson(s: ShapeStyle): ShapeStyleJsonT {
  const out: ShapeStyleJsonT = { mode: s.mode, width: s.width, outline: toHex8(s.outline), fill: toHex8(s.fill), radius: s.radius, antialias: s.antialias };
  if (s.fillKind) out.fillKind = s.fillKind;
  if (s.fillGradient) out.fillGradient = gradientToJson(s.fillGradient);
  if (s.fillPattern) out.fillPattern = { id: s.fillPattern.id, scale: s.fillPattern.scale };
  if (s.fillImage) out.fillImage = s.fillImage;
  if (s.outlineKind) out.outlineKind = s.outlineKind;
  if (s.outlineGradient) out.outlineGradient = gradientToJson(s.outlineGradient);
  for (const k of ['dash', 'cap', 'join', 'arrowStart', 'arrowEnd'] as const) if (s[k]) (out as Record<string, unknown>)[k] = s[k];
  return out;
}

function styleFromJson(j: ShapeStyleJsonT): ShapeStyle {
  const outline = parseHex(j.outline);
  const fill = parseHex(j.fill);
  if (!outline || !fill) throw new ProjectError('error.projectInvalid', 'Bad colour');
  const s: ShapeStyle = { mode: j.mode, width: j.width, outline, fill, radius: j.radius, antialias: j.antialias };
  if (j.fillKind) s.fillKind = j.fillKind;
  if (j.fillGradient) s.fillGradient = gradientFromJson(j.fillGradient);
  if (j.fillPattern) s.fillPattern = { ...j.fillPattern };
  if (j.fillImage) s.fillImage = j.fillImage;
  if (j.outlineKind) s.outlineKind = j.outlineKind;
  if (j.outlineGradient) s.outlineGradient = gradientFromJson(j.outlineGradient);
  for (const k of ['dash', 'cap', 'join', 'arrowStart', 'arrowEnd'] as const) if (j[k]) (s as unknown as Record<string, unknown>)[k] = j[k];
  return s;
}
const AnchorJson = z.object({ x: num, y: num, in: PointJson.nullable(), out: PointJson.nullable(), smooth: z.boolean() });
/** Paths: subpaths of points with Bézier handles (document coordinates, or a unit box). */
const SubPathsJson = z.array(z.object({ closed: z.boolean(), anchors: z.array(AnchorJson).min(1).max(100000) })).min(1).max(2000);
/** Most path points all shape layers together may hold. */
const MAX_ANCHORS = 2_000_000;

const ShapeNodeJson = z.object({
  type: z.literal('shape'),
  id: z.string().min(1).max(100),
  shape: z.enum(['line', 'curve', 'rect', 'roundRect', 'ellipse', 'polygon', 'parametric', 'path']),
  box: z.object({ cx: num, cy: num, w: num, h: num, angle: num }).nullable(),
  points: z.array(PointJson).max(100000),
  style: ShapeStyleJson,
  /** Library shape id and slider values (parametric shapes). */
  shapeId: z.string().regex(/^[a-z0-9-]{1,100}$/i).optional(),
  params: z
    .record(z.string().regex(/^[a-z][a-z0-9]{0,39}$/i), num)
    .refine((r) => Object.keys(r).length <= 32)
    .optional(),
  /** Paths: the outline. Personal library shapes: their outline in a unit box. */
  subpaths: SubPathsJson.optional(),
  unitPath: SubPathsJson.optional(),
  fillRule: z.enum(['evenodd', 'nonzero']).optional(),
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
    style: styleToJson(s),
    ...(n.shapeId ? { shapeId: n.shapeId, params: { ...n.params } } : {}),
    ...(n.subpaths ? { subpaths: subpathsToJson(n.subpaths) } : {}),
    ...(n.unitPath ? { unitPath: subpathsToJson(n.unitPath) } : {}),
    ...(n.fillRule ? { fillRule: n.fillRule } : {}),
  };
}

function subpathsToJson(subs: SubPaths): z.infer<typeof SubPathsJson> {
  return subs.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => ({ x: a.x, y: a.y, in: a.in ? { x: a.in.x, y: a.in.y } : null, out: a.out ? { x: a.out.x, y: a.out.y } : null, smooth: a.smooth })),
  }));
}

function nodeFromJson(n: VectorNodeJson, depth: number, counter: { n: number; anchors?: number }): VectorNode {
  if (depth > MAX_DEPTH || ++counter.n > MAX_OBJECTS) throw new ProjectError('error.projectInvalid', 'Too many shapes');
  if (n.type === 'group') return { type: 'group', id: n.id, children: n.children.map((c) => nodeFromJson(c, depth + 1, counter)) };
  // A library shape needs its box and id.
  if (n.shape === 'parametric' && (!n.box || !n.shapeId)) throw new ProjectError('error.projectInvalid', 'Bad shape');
  // A path needs its outline.
  if (n.shape === 'path' && !n.subpaths) throw new ProjectError('error.projectInvalid', 'Path without points');
  for (const subs of [n.subpaths, n.unitPath]) {
    counter.anchors = (counter.anchors ?? 0) + (subs?.reduce((k, sp) => k + sp.anchors.length, 0) ?? 0);
    if (counter.anchors > MAX_ANCHORS) throw new ProjectError('error.projectInvalid', 'Too many path points');
  }
  const library = n.shape === 'parametric' ? { shapeId: n.shapeId!, params: { ...n.params }, ...(n.unitPath ? { unitPath: n.unitPath } : {}) } : {};
  const outline = n.shape === 'path' ? { subpaths: n.subpaths! } : {};
  return {
    type: 'shape',
    id: n.id,
    shape: n.shape,
    box: n.box ? { ...n.box } : null,
    points: n.points,
    style: styleFromJson(n.style),
    ...library,
    ...outline,
    ...(n.fillRule ? { fillRule: n.fillRule } : {}),
  };
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

const PIECE_FILE = /^pieces\/\d{1,6}\.png$/;
const KeyframeJson = z.object({
  frame: int.min(0).max(MAX_FRAMES - 1),
  x: num,
  y: num,
  sx: z.number().min(-1000).max(1000),
  sy: z.number().min(-1000).max(1000),
  angle: z.number().min(-1e6).max(1e6),
  skew: z.number().min(-1.5).max(1.5),
  opacity: z.number().min(0).max(1),
  /** Version 3: where a repeating piece's tiles have slid (version 2 has none). */
  scrollX: z.number().min(-MAX_SCROLL).max(MAX_SCROLL).default(0),
  scrollY: z.number().min(-MAX_SCROLL).max(MAX_SCROLL).default(0),
  easing: z.enum(EASINGS as [Easing, ...Easing[]]),
  in: PointJson.nullable(),
  out: PointJson.nullable(),
});
const PieceJson = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(200),
  layerId: z.string().min(1).max(100),
  image: z.object({ file: z.string().regex(PIECE_FILE), w: int.min(1).max(MAX_DIMENSION), h: int.min(1).max(MAX_DIMENSION) }),
  home: z.object({ x: num, y: num, w: num, h: num }),
  pivot: PointJson,
  keyframes: z.array(KeyframeJson).min(1).max(MAX_KEYFRAMES),
  /** Version 3: copies tiling on; version 2 pieces don't repeat. */
  repeat: z.enum(REPEATS as [Repeat, ...Repeat[]]).default('none'),
});
const AnimationJson = z.object({
  fps: int.min(MIN_FPS).max(MAX_FPS),
  length: int.min(1).max(MAX_FRAMES),
  loop: z.enum(LOOP_MODES as [LoopMode, ...LoopMode[]]),
  frame: int.min(0).max(MAX_FRAMES - 1),
  pieces: z.array(PieceJson).max(MAX_PIECES),
});

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
  /** Pictures used by image fills; optional. */
  assets: z
    .array(z.object({ id: z.string().regex(ASSET_ID), file: z.string().regex(/^assets\/\d{1,6}\.png$/), w: int.min(1).max(MAX_DIMENSION), h: int.min(1).max(MAX_DIMENSION) }))
    .max(MAX_ASSETS)
    .optional(),
  /** Ruler guides; optional. */
  guides: z
    .array(z.object({ axis: z.enum(['x', 'y']), pos: z.number().min(-MAX_DIMENSION).max(2 * MAX_DIMENSION) }))
    .max(1000)
    .optional(),
  /** Version 2: the timeline and animated pieces; optional. */
  animation: AnimationJson.optional(),
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
  let celCount = 0;
  const toJson = async (l: Layer): Promise<LayerJson> => {
    const common = { id: l.id, name: l.name, opacity: l.opacity, blend: l.blend, visible: l.visible, locked: l.locked };
    if (l.kind === 'group') {
      const children: LayerJson[] = [];
      for (const c of l.children) children.push(await toJson(c));
      return { kind: 'group', ...common, collapsed: l.collapsed, children };
    }
    // Shape layers are kept as objects, not pixels.
    if (l.kind === 'vector') return { kind: 'vector', ...common, objects: l.objects.map(nodeToJson) };
    if (l.cels) {
      const cels: NonNullable<Extract<LayerJson, { kind: 'raster' }>['cels']> = [];
      for (const c of l.cels) {
        const cb = c.surface.contentBounds();
        if (!cb) {
          cels.push({ start: c.start, image: null });
          continue;
        }
        const file = `cels/${String(++celCount).padStart(4, '0')}.png`;
        files[file] = [await codec.encode(c.surface.readRect(cb), cb.w, cb.h), { level: 0 }];
        cels.push({ start: c.start, image: { file, x: cb.x, y: cb.y, w: cb.w, h: cb.h } });
      }
      return { kind: 'raster', ...common, image: null, cels };
    }
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
  // Pictures used by image fills on shape layers.
  const assets: NonNullable<DocumentJson['assets']> = [];
  const used = new Set<string>();
  for (const l of walkLayers(doc.layers)) {
    if (l.kind !== 'vector') continue;
    for (const s of walkShapes(l.objects)) if (s.style.fillImage) used.add(s.style.fillImage);
  }
  for (const id of used) {
    const a = imageAsset(id);
    if (!a) continue;
    const file = `assets/${String(assets.length + 1).padStart(4, '0')}.png`;
    files[file] = [await codec.encode(a.data, a.w, a.h), { level: 0 }];
    assets.push({ id, file, w: a.w, h: a.h });
  }
  // Animated pieces on pixel layers that are still there.
  const rasterIds = new Set(doc.rasterLayers().map((l) => l.id));
  const pieces: z.input<typeof PieceJson>[] = [];
  // A version 2 file is written exactly as 1.1 wrote it, without the fields 1.2 added.
  const v3 = versionFor(doc) >= 3;
  for (const p of doc.pieces) {
    if (!rasterIds.has(p.layerId)) continue;
    const file = `pieces/${String(pieces.length + 1).padStart(4, '0')}.png`;
    files[file] = [await codec.encode(p.src.toRGBA(), p.src.width, p.src.height), { level: 0 }];
    pieces.push({
      id: p.id,
      name: p.name,
      layerId: p.layerId,
      image: { file, w: p.src.width, h: p.src.height },
      home: { ...p.home },
      pivot: { ...p.pivot },
      keyframes: p.keyframes.map(({ scrollX, scrollY, ...k }) => ({
        ...k,
        in: k.in && { ...k.in },
        out: k.out && { ...k.out },
        ...(v3 ? { scrollX, scrollY } : {}),
      })),
      ...(v3 ? { repeat: p.repeat } : {}),
    });
  }
  const t = doc.timeline;
  const animation = pieces.length || doc.hasCels ? { fps: t.fps, length: t.length, loop: t.loop, frame: t.frame, pieces } : null;
  // What is written: fields with defaults may be left out (older versions don't have them).
  const json: z.input<typeof DocumentJsonSchema> = {
    format: PROJECT_MAGIC,
    version: animation ? versionFor(doc) : 1,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    paper: doc.paper ? { ...doc.paper } : null,
    activeId: doc.activeId,
    layers,
    ...(selections.length ? { selections } : {}),
    ...(assets.length ? { assets } : {}),
    ...(doc.guides.length ? { guides: doc.guides.map((g) => ({ axis: g.axis, pos: g.pos })) } : {}),
    ...(animation ? { animation } : {}),
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
        if (entries > MAX_LAYERS + MAX_SAVED_SELECTIONS + MAX_ASSETS + MAX_PIECES + MAX_TOTAL_CELS + 16 || f.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) {
          throw new ProjectError('error.projectInvalid', 'Archive is too large');
        }
        return (
          f.name === 'document.json' ||
          /^layers\/\d{1,6}\.png$/.test(f.name) ||
          /^selections\/\d{1,6}\.png$/.test(f.name) ||
          /^assets\/\d{1,6}\.png$/.test(f.name) ||
          PIECE_FILE.test(f.name) ||
          CEL_FILE.test(f.name) ||
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

  // Pictures first, so the shapes that use them can draw.
  for (const a of json.assets ?? []) {
    if (a.w * a.h > MAX_ASSET_PIXELS) throw new ProjectError('error.projectInvalid', `${a.file} is too large`);
    const png = files[a.file];
    if (!png) throw new ProjectError('error.projectInvalid', `${a.file} missing`);
    const img = await codec.decode(png);
    if (img.w !== a.w || img.h !== a.h) throw new ProjectError('error.projectInvalid', `${a.file} has the wrong size`);
    addImageAsset(img.w, img.h, img.data, a.id);
  }

  const seen = new Set<string>();
  let count = 0;
  let celTotal = 0;
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
      if (l.cels) {
        if ((celTotal += l.cels.length) > MAX_TOTAL_CELS) throw new ProjectError('error.projectInvalid', 'Too many drawings');
        // One drawing per start frame, in order, the first from frame 0.
        const byStart = new Map<number, Cel>();
        for (const c of l.cels) {
          const cs = new Surface(json.width, json.height);
          if (c.image) {
            const png = files[c.image.file];
            if (!png) throw new ProjectError('error.projectInvalid', `${c.image.file} missing`);
            const img = await codec.decode(png);
            if (img.w !== c.image.w || img.h !== c.image.h) throw new ProjectError('error.projectInvalid', `${c.image.file} has the wrong size`);
            cs.writeRect({ x: c.image.x, y: c.image.y, w: img.w, h: img.h }, { data: img.data, stride: img.w, ox: c.image.x, oy: c.image.y });
            cs.compact();
          }
          byStart.set(c.start, { start: c.start, surface: cs });
        }
        const cels = [...byStart.values()].sort((a, b) => a.start - b.start);
        cels[0] = { ...cels[0], start: 0 };
        if (cels.length > 1) {
          layer.cels = cels;
          layer.surface = cels[0].surface;
        } else layer.surface = cels[0].surface;
      }
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
  if (json.animation) await readAnimation(doc, json.animation, files, codec);
  // Frame-by-frame layers show the drawing for the frame the file was saved at.
  doc.showFrame(doc.timeline.frame);
  return doc;
}

/** The timeline and pieces of a version 2 project. Pieces on missing or non-pixel layers are left out. */
async function readAnimation(doc: PaintDocument, a: NonNullable<DocumentJson['animation']>, files: Record<string, Uint8Array>, codec: PngCodec): Promise<void> {
  doc.timeline = { fps: a.fps, length: a.length, loop: a.loop, frame: clampFrame(a.frame, a.length) };
  const rasters = new Set(doc.rasterLayers().map((l) => l.id));
  const ids = new Set<string>();
  const pieces: Piece[] = [];
  for (const p of a.pieces) {
    if (!rasters.has(p.layerId)) continue;
    if (p.image.w * p.image.h > MAX_PIXELS) throw new ProjectError('error.projectInvalid', `${p.image.file} is too large`);
    const png = files[p.image.file];
    if (!png) throw new ProjectError('error.projectInvalid', `${p.image.file} missing`);
    const img = await codec.decode(png);
    if (img.w !== p.image.w || img.h !== p.image.h) throw new ProjectError('error.projectInvalid', `${p.image.file} has the wrong size`);
    // One keyframe per frame, in order, inside the timeline (the last one given for a frame wins).
    const byFrame = new Map<number, Keyframe>();
    for (const k of p.keyframes) {
      const frame = clampFrame(k.frame, a.length);
      byFrame.set(frame, { ...k, frame, in: k.in && { ...k.in }, out: k.out && { ...k.out } });
    }
    const id = ids.has(p.id) ? newPieceId() : p.id;
    ids.add(id);
    pieces.push({
      id,
      name: p.name,
      layerId: p.layerId,
      src: Surface.fromRGBA(img.w, img.h, img.data),
      home: { ...p.home },
      pivot: { ...p.pivot },
      keyframes: [...byFrame.values()].sort((x, y) => x.frame - y.frame),
      repeat: p.repeat,
    });
  }
  doc.pieces = pieces;
}

/** The embedded preview, if present (for the crash-recovery list). */
export function readProjectThumbnail(bytes: Uint8Array): Uint8Array | null {
  try {
    return unzipSync(bytes, { filter: (f) => f.name === 'thumbnail.png' && f.originalSize < 8 * 1024 * 1024 })['thumbnail.png'] ?? null;
  } catch {
    return null;
  }
}

