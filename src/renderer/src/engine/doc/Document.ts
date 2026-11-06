import type { RGBA } from '../core/color';
import { Surface } from '../raster/Surface';
import type { Selection } from './Selection';

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
  surface: Surface;

  constructor(name: string, surface: Surface, id?: string) {
    super(name, id, 'layer');
    this.surface = surface;
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

export type Layer = RasterLayer | GroupLayer;

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
}

export function captureTree(doc: PaintDocument): LayerTree {
  const groups = new Map<GroupLayer, Layer[]>();
  for (const l of walkLayers(doc.layers)) if (l.kind === 'group') groups.set(l, [...l.children]);
  return { layers: [...doc.layers], groups, activeId: doc.activeId };
}

export function restoreTree(doc: PaintDocument, t: LayerTree): void {
  doc.layers = [...t.layers];
  for (const [g, children] of t.groups) g.children = [...children];
  doc.activeId = t.activeId;
}
