import { restoreTree, walkLayers, type Layer, type LayerProps, type LayerTree } from '../doc/Document';
import type { I18nKey } from '../../i18n';
import type { CommandHost } from './commands';
import type { Command } from './History';

function treeLayers(t: LayerTree): Set<Layer> {
  const s = new Set<Layer>();
  for (const l of walkLayers(t.layers)) s.add(l);
  return s;
}

function layerBytes(l: Layer): number {
  if (l.kind === 'raster') return l.surface.bytes;
  let n = 0;
  for (const c of l.children) n += layerBytes(c);
  return n;
}

/**
 * Structural change of the layer tree (add, delete, duplicate, reorder, merge, flatten, group).
 * Both trees share layer objects, so only layers present in one tree cost memory.
 */
export class LayerTreeCommand implements Command {
  readonly bytes: number;

  constructor(
    readonly label: I18nKey,
    private readonly host: CommandHost,
    private readonly before: LayerTree,
    private readonly after: LayerTree,
  ) {
    const a = treeLayers(before);
    const b = treeLayers(after);
    let n = 256;
    for (const l of a) if (!b.has(l) && l.kind === 'raster') n += layerBytes(l);
    for (const l of b) if (!a.has(l) && l.kind === 'raster') n += layerBytes(l);
    this.bytes = n;
  }

  undo(): void {
    restoreTree(this.host.doc, this.before);
    this.host.layersChanged();
  }

  redo(): void {
    restoreTree(this.host.doc, this.after);
    this.host.layersChanged();
  }
}

/** How long consecutive edits of the same property merge into one step (slider drags). */
const MERGE_MS = 1200;

/** Change of layer properties (name, opacity, blend, visibility, lock). */
export class LayerPropsCommand implements Command {
  readonly bytes = 128;
  private time = Date.now();

  constructor(
    readonly label: I18nKey,
    private readonly host: CommandHost,
    private readonly layerId: string,
    private readonly before: Partial<LayerProps>,
    private after: Partial<LayerProps>,
  ) {}

  private apply(p: Partial<LayerProps>): void {
    const layer = this.host.doc.layerById(this.layerId);
    if (!layer) return;
    layer.setProps(p);
    this.host.layersChanged();
  }

  undo(): void {
    this.apply(this.before);
  }

  redo(): void {
    this.apply(this.after);
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof LayerPropsCommand) || next.layerId !== this.layerId || next.label !== this.label) return false;
    const keys = (p: Partial<LayerProps>) => Object.keys(p).sort().join();
    if (keys(next.after) !== keys(this.after) || next.time - this.time > MERGE_MS) return false;
    this.after = next.after;
    this.time = next.time;
    return true;
  }
}
