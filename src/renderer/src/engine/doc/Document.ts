import type { RGBA } from '../core/color';
import { Surface } from '../raster/Surface';
import { defaultTimeline, type Timeline } from '../anim/timeline';
import { clonePiece, type Piece } from '../anim/piece';
import { celAt, celSurfaces, type Cel } from '../anim/cels';
import type { Selection } from './Selection';
import type { Guide } from './guides';
import type { VectorNode } from '../vector/model';

/** Canvas 2D composite operation names; also implemented in JS (raster/blend.ts). */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'difference'
  | 'soft-light'
  | 'hard-light'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'difference',
  'soft-light',
  'hard-light',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

let nextId = 1;
export function newId(prefix: string): string {
  return `${prefix}-${(nextId++).toString(36)}-${Date.now().toString(36)}`;
}

/** Properties every layer has (all user-editable, all undoable). */
export interface LayerProps {
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  locked: boolean;
}

abstract class LayerBase implements LayerProps {
  readonly id: string;
  name: string;
  opacity = 1;
  blend: BlendMode = 'normal';
  visible = true;
  locked = false;

  constructor(name: string, id: string | undefined, prefix: string) {
    this.id = id ?? newId(prefix);
    this.name = name;
  }

  props(): LayerProps {
    return { name: this.name, opacity: this.opacity, blend: this.blend, visible: this.visible, locked: this.locked };
  }

  setProps(p: Partial<LayerProps>): void {
    if (p.name !== undefined) this.name = p.name;
    if (p.opacity !== undefined) this.opacity = Math.min(1, Math.max(0, p.opacity));
    if (p.blend !== undefined) this.blend = p.blend;
    if (p.visible !== undefined) this.visible = p.visible;
    if (p.locked !== undefined) this.locked = p.locked;
  }
}

export class RasterLayer extends LayerBase {
  readonly kind = 'raster' as const;
  /** The pixels shown (and painted) at the current frame. */
  surface: Surface;
  /**
   * Frame-by-frame drawings, or null for a still layer (one drawing for every frame). When
   * set, `surface` is always the drawing of the cel shown at the document's current frame.
   */
  cels: Cel[] | null = null;

  constructor(name: string, surface: Surface, id?: string) {
    super(name, id, 'layer');
    this.surface = surface;
  }

  /** Every drawing the layer has (one for a still layer). */
  allSurfaces(): Surface[] {
    return this.cels ? celSurfaces(this.cels) : [this.surface];
  }

  /** Show the drawing for `frame` (frame-by-frame layers only). */
  showFrame(frame: number): void {
    if (this.cels) this.surface = celAt(this.cels, frame).surface;
  }

  /**
   * Replace every drawing with fn(drawing) (resize, crop, turn…); the one shown stays shown.
   * Copies that shared a surface still share the new one.
   */
  mapSurfaces(fn: (s: Surface) => Surface): void {
    if (!this.cels) {
      this.surface = fn(this.surface);
      return;
    }
    const mapped = new Map<Surface, Surface>();
    for (const s of celSurfaces(this.cels)) mapped.set(s, fn(s));
    this.cels = this.cels.map((c) => ({ start: c.start, surface: mapped.get(c.surface)! }));
    this.surface = mapped.get(this.surface) ?? this.cels[0].surface;
  }
}

/** A folder of layers, composited in isolation and then blended as one. */
export class GroupLayer extends LayerBase {
  readonly kind = 'group' as const;
  children: Layer[];
  collapsed = false;

  constructor(name: string, children: Layer[] = [], id?: string) {
    super(name, id, 'group');
    this.children = children;
  }
}

/**
 * A shape layer: vector objects that stay editable. Its pixels (for blending, export and the
 * colour picker) are made from the objects when needed.
 */
export class VectorLayer extends LayerBase {
  readonly kind = 'vector' as const;
  private list: VectorNode[];
  width: number;
  height: number;
  /** Bumped on every change, so the display knows to redraw. */
  version = 0;
  private cache: Surface | null = null;
  /** Turns objects into pixels; installed by the engine (it needs a canvas). */
  static rasterizer: ((l: VectorLayer) => Surface) | null = null;

  constructor(name: string, width: number, height: number, objects: VectorNode[] = [], id?: string) {
    super(name, id, 'shapes');
    this.width = width;
    this.height = height;
    this.list = objects;
  }

  get objects(): readonly VectorNode[] {
    return this.list;
  }

  setObjects(objects: readonly VectorNode[]): void {
    this.list = [...objects];
    this.version++;
    this.cache = null;
  }

  /** Something the objects use (a saved pattern) changed: draw them again. */
  redraw(): void {
    this.version++;
    this.cache = null;
  }

  /** The canvas size changed (objects are moved separately). */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.version++;
    this.cache = null;
  }

  /** The objects as pixels (made on first use after a change). */
  get surface(): Surface {
    this.cache ??= VectorLayer.rasterizer ? VectorLayer.rasterizer(this) : new Surface(this.width, this.height);
    return this.cache;
  }
}

export type Layer = RasterLayer | GroupLayer | VectorLayer;

export interface DocumentInit {
  width: number;
  height: number;
  dpi?: number;
  paper?: RGBA | null;
}

/** Location of a layer inside the tree: its parent list and index (bottom = 0). */
export interface LayerSlot {
  parent: GroupLayer | null;
  list: Layer[];
  index: number;
}

/**
 * The image being edited. `paper` is the canvas colour shown under all layers (null means
 * transparent). Layers form a tree (groups hold children); every list is bottom-to-top.
 */
/** A named selection kept with the document (Select → Save selection). Immutable. */
export interface SavedSelection {
  readonly id: string;
  readonly name: string;
  readonly selection: Selection;
}

export class PaintDocument {
  width: number;
  height: number;
  dpi: number;
  paper: RGBA | null;
  layers: Layer[];
  activeId: string;
  selection: Selection | null = null;
  /** Named selections saved in the project file. */
  savedSelections: SavedSelection[] = [];
  /** Ruler guides (saved in projects). */
  guides: Guide[] = [];
  /** Animation timing and the frame shown (saved in projects). */
  timeline: Timeline = defaultTimeline();
  /** Animated pieces, bottom to top within each layer (saved in projects). */
  pieces: Piece[] = [];

  constructor(init: DocumentInit, layers?: Layer[]) {
    this.width = init.width;
    this.height = init.height;
    this.dpi = init.dpi ?? 96;
    this.paper = init.paper === undefined ? { r: 255, g: 255, b: 255, a: 255 } : init.paper;
    // Layer names are user content; '' means "unnamed" and the UI shows a localised default.
    this.layers = layers ?? [new RasterLayer('', new Surface(init.width, init.height))];
    this.activeId = this.layers[this.layers.length - 1].id;
  }

  get activeLayer(): Layer {
    return this.layerById(this.activeId) ?? this.layers[this.layers.length - 1];
  }

  /** The active layer if it can hold pixels, otherwise null. */
  get activeRaster(): RasterLayer | null {
    const l = this.activeLayer;
    return l.kind === 'raster' ? l : null;
  }

  layerById(id: string): Layer | undefined {
    for (const l of walkLayers(this.layers)) if (l.id === id) return l;
    return undefined;
  }

  slotOf(id: string): LayerSlot | null {
    return findSlot(this.layers, null, id);
  }

  /** Every shape layer, bottom to top, including inside groups. */
  vectorLayers(): VectorLayer[] {
    return [...walkLayers(this.layers)].filter((l): l is VectorLayer => l.kind === 'vector');
  }

  /** Put each frame-by-frame layer's drawing for `frame` on show. */
  showFrame(frame: number): void {
    for (const l of this.rasterLayers()) l.showFrame(frame);
  }

  /** True if any pixel layer has frame-by-frame drawings. */
  get hasCels(): boolean {
    return this.rasterLayers().some((l) => l.cels !== null);
  }

  /** Every raster layer, bottom to top, including inside groups. */
  rasterLayers(): RasterLayer[] {
    return [...walkLayers(this.layers)].filter((l): l is RasterLayer => l.kind === 'raster');
  }

  /** True if the layer and all its ancestors are visible. */
  isEffectivelyVisible(id: string): boolean {
    let slot = this.slotOf(id);
    const layer = this.layerById(id);
    if (!layer?.visible) return false;
    while (slot?.parent) {
      if (!slot.parent.visible) return false;
      slot = this.slotOf(slot.parent.id);
    }
    return true;
  }

  get bounds() {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }
}

/** Depth-first, bottom-to-top walk (a group is yielded before its children). */
export function* walkLayers(list: Layer[]): Generator<Layer> {
  for (const l of list) {
    yield l;
    if (l.kind === 'group') yield* walkLayers(l.children);
  }
}

function findSlot(list: Layer[], parent: GroupLayer | null, id: string): LayerSlot | null {
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (l.id === id) return { parent, list, index: i };
    if (l.kind === 'group') {
      const s = findSlot(l.children, l, id);
      if (s) return s;
    }
  }
  return null;
}

/** Snapshot of the layer tree's structure (lists are copied; layer objects are shared). */
export interface LayerTree {
  layers: Layer[];
  groups: Map<GroupLayer, Layer[]>;
  activeId: string;
  /** Animated pieces (deleting, duplicating or merging layers changes them). */
  pieces: Piece[];
}

export function captureTree(doc: PaintDocument): LayerTree {
  const groups = new Map<GroupLayer, Layer[]>();
  for (const l of walkLayers(doc.layers)) if (l.kind === 'group') groups.set(l, [...l.children]);
  return { layers: [...doc.layers], groups, activeId: doc.activeId, pieces: doc.pieces.map(clonePiece) };
}

export function restoreTree(doc: PaintDocument, t: LayerTree): void {
  doc.layers = [...t.layers];
  for (const [g, children] of t.groups) g.children = [...children];
  doc.activeId = t.activeId;
  doc.pieces = t.pieces.map(clonePiece);
}
