import {
  GroupLayer,
  RasterLayer,
  VectorLayer,
  captureTree,
  walkLayers,
  type BlendMode,
  type Layer,
  type LayerProps,
  type PaintDocument,
} from './Document';
import { compositeLayers } from '../raster/blend';
import { Surface } from '../raster/Surface';
import type { History } from '../history/History';
import type { CommandHost } from '../history/commands';
import { LayerPropsCommand, LayerTreeCommand } from '../history/layerCommands';
import type { I18nKey } from '../../i18n';
import { cloneNode } from '../vector/model';

export interface LayerNode {
  id: string;
  kind: Layer['kind'];
  name: string;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  locked: boolean;
  collapsed: boolean;
  depth: number;
  children: LayerNode[];
}

export interface LayersInfo {
  /** Bottom-to-top, like the document (the panel shows it reversed). */
  tree: LayerNode[];
  activeId: string;
  count: number;
}

/** Name generator supplied by the UI (the engine never stores English text). */
export type LayerNamer = (kind: 'layer' | 'group' | 'shapes' | 'copy', arg: number | string) => string;

/** What the layer controller needs from the engine. */
export interface LayerHost extends CommandHost {
  readonly history: History;
  commitLive(): void;
  notify(kind: 'info' | 'error', key: I18nKey): void;
}

const PROP_LABEL: Record<keyof LayerProps, I18nKey> = {
  name: 'history.layerRename',
  opacity: 'history.layerOpacity',
  blend: 'history.layerBlend',
  visible: 'history.layerVisibility',
  locked: 'history.layerLock',
};

function node(l: Layer, depth: number): LayerNode {
  return {
    id: l.id,
    kind: l.kind,
    name: l.name,
    opacity: l.opacity,
    blend: l.blend,
    visible: l.visible,
    locked: l.locked,
    collapsed: l.kind === 'group' ? l.collapsed : false,
    depth,
    children: l.kind === 'group' ? l.children.map((c) => node(c, depth + 1)) : [],
  };
}

function cloneLayer(l: Layer, name: string): Layer {
  const copy =
    l.kind === 'raster'
      ? new RasterLayer(name, l.surface.clone())
      : l.kind === 'vector'
        ? new VectorLayer(name, l.width, l.height, l.objects.map(cloneNode))
        : new GroupLayer(
            name,
            l.children.map((c) => cloneLayer(c, c.name)),
          );
  copy.setProps({ opacity: l.opacity, blend: l.blend, visible: l.visible, locked: false });
  if (copy.kind === 'group' && l.kind === 'group') copy.collapsed = l.collapsed;
  return copy;
}

/**
 * Layer operations. Every change goes through the history: structural edits as tree
 * snapshots (no pixels copied), property edits as small mergeable commands.
 */
export class LayerController {
  namer: LayerNamer = () => '';

  constructor(private readonly host: LayerHost) {}

  private get doc(): PaintDocument {
    return this.host.doc;
  }

  info(): LayersInfo {
    let count = 0;
    for (const _ of walkLayers(this.doc.layers)) count++;
    return { tree: this.doc.layers.map((l) => node(l, 0)), activeId: this.doc.activeId, count };
  }

  /** Next free number for an automatic name ("Layer 3", "Group 2"). */
  nextNumber(kind: Layer['kind']): number {
    let n = 0;
    for (const l of walkLayers(this.doc.layers)) if (l.kind === kind) n++;
    return n + 1;
  }

  /** Run a structural edit and record it as one undoable step. */
  private edit(label: I18nKey, fn: () => boolean | void): boolean {
    this.host.commitLive();
    const before = captureTree(this.doc);
    if (fn() === false) return false;
    const after = captureTree(this.doc);
    this.host.history.push(new LayerTreeCommand(label, this.host, before, after));
    this.host.layersChanged();
    return true;
  }

  setActive(id: string): void {
    if (id === this.doc.activeId || !this.doc.layerById(id)) return;
    this.host.commitLive();
    this.doc.activeId = id;
    this.host.layersChanged();
  }

  /** Insert above the active layer, in the same group. */
  private insertAboveActive(layer: Layer): void {
    const slot = this.doc.slotOf(this.doc.activeId);
    if (slot) slot.list.splice(slot.index + 1, 0, layer);
    else this.doc.layers.push(layer);
    this.doc.activeId = layer.id;
  }

  add(): string {
    const layer = new RasterLayer(this.namer('layer', this.nextNumber('raster')), new Surface(this.doc.width, this.doc.height));
    this.edit('history.layerAdd', () => this.insertAboveActive(layer));
    return layer.id;
  }

  /** A new, empty shape layer above the active one. */
  addVector(): string {
    const layer = new VectorLayer(this.namer('shapes', this.nextNumber('vector')), this.doc.width, this.doc.height);
    this.edit('history.layerAddShapes', () => this.insertAboveActive(layer));
    return layer.id;
  }

  /** Turn a shape layer into a pixel layer (its objects become pixels). */
  rasterize(id = this.doc.activeId): boolean {
    const slot = this.doc.slotOf(id);
    const layer = this.doc.layerById(id);
    if (!slot || layer?.kind !== 'vector') return false;
    const raster = new RasterLayer(layer.name, layer.surface.clone(), undefined);
    raster.setProps({ opacity: layer.opacity, blend: layer.blend, visible: layer.visible, locked: layer.locked });
    return this.edit('history.rasterizeLayer', () => {
      slot.list.splice(slot.index, 1, raster);
      this.doc.activeId = raster.id;
    });
  }

  /** Add a layer holding pixels (e.g. "paste as new layer"); `pixels` must be doc-sized. */
  addWithSurface(surface: Surface): string {
    const layer = new RasterLayer(this.namer('layer', this.nextNumber('raster')), surface);
    this.edit('history.layerAdd', () => this.insertAboveActive(layer));
    return layer.id;
  }

  duplicate(id = this.doc.activeId): string | null {
    const src = this.doc.layerById(id);
    if (!src) return null;
    const copy = cloneLayer(src, this.namer('copy', src.name || this.namer('layer', 1)));
    this.edit('history.layerDuplicate', () => {
      const slot = this.doc.slotOf(id)!;
      slot.list.splice(slot.index + 1, 0, copy);
      this.doc.activeId = copy.id;
    });
    return copy.id;
  }

  /** False for the last top-level layer (an image always keeps one). */
  canRemove(id = this.doc.activeId): boolean {
    const slot = this.doc.slotOf(id);
    return slot !== null && (slot.parent !== null || this.doc.layers.length > 1);
  }

  /** Delete a layer (or group with its contents). The last remaining layer can't be deleted. */
  remove(id = this.doc.activeId): boolean {
    const slot = this.doc.slotOf(id);
    if (!slot) return false;
    if (slot.parent === null && this.doc.layers.length === 1) {
      this.host.notify('info', 'notice.lastLayer');
      return false;
    }
    return this.edit('history.layerDelete', () => {
      slot.list.splice(slot.index, 1);
      const next = slot.list[Math.max(0, slot.index - 1)] ?? slot.parent ?? this.doc.layers[this.doc.layers.length - 1];
      this.doc.activeId = next.id;
    });
  }

  /** True if `id` is `ancestor` or inside it. */
  private isWithin(id: string, ancestor: Layer): boolean {
    if (ancestor.id === id) return true;
    if (ancestor.kind !== 'group') return false;
    return ancestor.children.some((c) => this.isWithin(id, c));
  }

  /**
   * Move a layer into `parentId` (null = top level) at `index` (bottom = 0), counted in the
   * target list as it is before the move.
   */
  move(id: string, parentId: string | null, index: number): boolean {
    const slot = this.doc.slotOf(id);
    const layer = this.doc.layerById(id);
    if (!slot || !layer) return false;
    let target: Layer[];
    if (parentId === null) target = this.doc.layers;
    else {
      const parent = this.doc.layerById(parentId);
      if (!parent || parent.kind !== 'group' || this.isWithin(parentId, layer)) return false;
      target = parent.children;
    }
    let at = Math.max(0, Math.min(index, target.length));
    if (target === slot.list) {
      if (at === slot.index || at === slot.index + 1) return false;
      if (at > slot.index) at--;
    }
    return this.edit('history.layerMove', () => {
      slot.list.splice(slot.index, 1);
      if (slot.parent === null && this.doc.layers.length === 0 && target !== this.doc.layers) {
        // Moving the only top-level layer into a group would leave the tree empty: refuse.
        slot.list.splice(slot.index, 0, layer);
        return false;
      }
      target.splice(at, 0, layer);
    });
  }

  /** Move one step up (+1) or down (-1) among siblings. */
  step(id: string, dir: 1 | -1): boolean {
    const slot = this.doc.slotOf(id);
    if (!slot) return false;
    const to = slot.index + dir;
    if (to < 0 || to >= slot.list.length) return false;
    return this.edit('history.layerMove', () => {
      const [l] = slot.list.splice(slot.index, 1);
      slot.list.splice(to, 0, l);
    });
  }

  setProps(id: string, props: Partial<LayerProps>): void {
    const layer = this.doc.layerById(id);
    if (!layer) return;
    const keys = Object.keys(props) as (keyof LayerProps)[];
    const before: Partial<LayerProps> = {};
    const after: Partial<LayerProps> = {};
    for (const k of keys) {
      if (layer[k] === props[k]) continue;
      (before as Record<string, unknown>)[k] = layer[k];
      (after as Record<string, unknown>)[k] = props[k];
    }
    if (Object.keys(after).length === 0) return;
    layer.setProps(after);
    const label = PROP_LABEL[Object.keys(after)[0] as keyof LayerProps];
    this.host.history.push(new LayerPropsCommand(label, this.host, id, before, after));
    this.host.layersChanged();
  }

  /** Collapsing a group in the panel is view state, not an edit. */
  setCollapsed(id: string, collapsed: boolean): void {
    const layer = this.doc.layerById(id);
    if (layer?.kind !== 'group') return;
    layer.collapsed = collapsed;
    this.host.layersChanged();
  }

  canMergeDown(id = this.doc.activeId): boolean {
    const slot = this.doc.slotOf(id);
    if (!slot || slot.index === 0) return false;
    const upper = slot.list[slot.index];
    const lower = slot.list[slot.index - 1];
    return lower.kind === 'raster' && upper.visible && !lower.locked;
  }

  /** Merge a layer (or group) into the raster layer directly below it. */
  mergeDown(id = this.doc.activeId): boolean {
    if (!this.canMergeDown(id)) return false;
    const slot = this.doc.slotOf(id)!;
    const upper = slot.list[slot.index];
    const lower = slot.list[slot.index - 1] as RasterLayer;
    const surface = lower.surface.clone();
    surface.forEachTile(this.doc.bounds, (view, sub) => compositeLayers([upper], sub, view), true);
    surface.compact();
    const merged = new RasterLayer(lower.name, surface);
    merged.setProps({ opacity: lower.opacity, blend: lower.blend, visible: lower.visible, locked: false });
    return this.edit('history.mergeDown', () => {
      slot.list.splice(slot.index - 1, 2, merged);
      this.doc.activeId = merged.id;
    });
  }

  /** Flatten every visible layer into one (hidden layers are discarded; the paper stays). */
  flatten(): boolean {
    const { width: w, height: h } = this.doc;
    const data = new Uint8ClampedArray(w * h * 4);
    compositeLayers(this.doc.layers, this.doc.bounds, { data, stride: w, ox: 0, oy: 0 });
    const flat = new RasterLayer(this.namer('layer', 1), Surface.fromRGBA(w, h, data));
    return this.edit('history.flatten', () => {
      this.doc.layers = [flat];
      this.doc.activeId = flat.id;
    });
  }

  /** Put layers (default: the active one) into a new group at the position of the topmost. */
  group(ids: string[] = [this.doc.activeId]): string | null {
    const slots = ids.map((id) => this.doc.slotOf(id)).filter((s) => s !== null);
    if (slots.length === 0) return null;
    // All layers must share a parent so the group has one well-defined position.
    const list = slots[0].list;
    if (!slots.every((s) => s.list === list)) return null;
    const indices = slots.map((s) => s.index).sort((a, b) => a - b);
    const g = new GroupLayer(this.namer('group', this.nextNumber('group')));
    this.edit('history.group', () => {
      const members = indices.map((i) => list[i]);
      for (const i of [...indices].reverse()) list.splice(i, 1);
      g.children = members;
      list.splice(indices[0], 0, g);
      this.doc.activeId = g.id;
    });
    return g.id;
  }

  /** Replace a group by its children (its own opacity/blend are dropped). */
  ungroup(id = this.doc.activeId): boolean {
    const slot = this.doc.slotOf(id);
    const g = this.doc.layerById(id);
    if (!slot || !g || g.kind !== 'group') return false;
    // An empty group that is the only top-level layer can't go away (the image needs a layer).
    if (g.children.length === 0 && slot.parent === null && this.doc.layers.length === 1) return false;
    return this.edit('history.ungroup', () => {
      slot.list.splice(slot.index, 1, ...g.children);
      this.doc.activeId = g.children[g.children.length - 1]?.id ?? slot.list[Math.max(0, slot.index - 1)]?.id ?? this.doc.layers[0].id;
    });
  }
}
