import type { RGBA } from '../core/color';
import type { Rect } from '../core/geometry';
import type { Layer, PaintDocument } from '../doc/Document';
import type { Selection } from '../doc/Selection';
import type { Surface, TileDelta } from '../raster/Surface';
import type { I18nKey } from '../../i18n';
import type { Command } from './History';

/** What commands need from the engine to keep the display in sync. */
export interface CommandHost {
  readonly doc: PaintDocument;
  /** Pixels of `layer` changed inside r (null = everywhere). */
  layerChanged(layer: Layer, r: Rect | null): void;
  /** Document size, paper or layer list changed. */
  structureChanged(): void;
  setSelection(sel: Selection | null): void;
}

/** Pixel edit of one layer, stored as a tile delta (swap on undo/redo). */
export class PixelCommand implements Command {
  constructor(
    readonly label: I18nKey,
    private readonly host: CommandHost,
    private readonly layer: Layer,
    private readonly delta: TileDelta,
    private readonly selBefore: Selection | null = null,
    private readonly selAfter: Selection | null = null,
  ) {}

  get bytes(): number {
    return this.delta.bytes;
  }

  private apply(sel: Selection | null): void {
    const r = this.delta.swap();
    this.host.layerChanged(this.layer, r);
    this.host.setSelection(sel);
  }

  undo(): void {
    this.apply(this.selBefore);
  }

  redo(): void {
    this.apply(this.selAfter);
  }
}

/** Snapshot of everything a size-changing operation can alter. */
export interface DocState {
  width: number;
  height: number;
  dpi: number;
  paper: RGBA | null;
  surfaces: Surface[];
  selection: Selection | null;
}

export function captureDocState(doc: PaintDocument): DocState {
  return {
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    paper: doc.paper ? { ...doc.paper } : null,
    surfaces: doc.layers.map((l) => l.surface),
    selection: doc.selection,
  };
}

export function applyDocState(doc: PaintDocument, s: DocState): void {
  doc.width = s.width;
  doc.height = s.height;
  doc.dpi = s.dpi;
  doc.paper = s.paper ? { ...s.paper } : null;
  doc.layers.forEach((l, i) => {
    l.surface = s.surfaces[i];
  });
  doc.selection = s.selection;
}

/** Whole-document change (crop, resize, canvas size, rotate, properties): swaps states. */
export class DocStateCommand implements Command {
  constructor(
    readonly label: I18nKey,
    private readonly host: CommandHost,
    private readonly before: DocState,
    private readonly after: DocState,
  ) {}

  get bytes(): number {
    const sizeOf = (s: DocState) => s.surfaces.reduce((n, sf) => n + sf.bytes, 0);
    // Surfaces shared by both states are counted once.
    const shared = this.before.surfaces.filter((s) => this.after.surfaces.includes(s));
    return sizeOf(this.before) + sizeOf(this.after) - shared.reduce((n, s) => n + s.bytes, 0);
  }

  undo(): void {
    applyDocState(this.host.doc, this.before);
    this.host.structureChanged();
  }

  redo(): void {
    applyDocState(this.host.doc, this.after);
    this.host.structureChanged();
  }
}
