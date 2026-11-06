import type { RGBA } from '../core/color';
import type { Rect } from '../core/geometry';
import type { PaintDocument, RasterLayer, SavedSelection } from '../doc/Document';
import type { Selection } from '../doc/Selection';
import type { Surface, TileDelta } from '../raster/Surface';
import type { I18nKey } from '../../i18n';
import type { Command } from './History';

/** What commands need from the engine to keep the display in sync. */
export interface CommandHost {
  readonly doc: PaintDocument;
  /** Pixels of `layer` changed inside r (null = everywhere). */
  layerChanged(layer: RasterLayer, r: Rect | null): void;
  /** Document size or paper changed (every canvas is rebuilt). */
  structureChanged(): void;
  /** Layer tree or layer properties changed (recomposite, refresh the Layers panel). */
  layersChanged(): void;
  setSelection(sel: Selection | null): void;
  /** The list of saved selections changed. */
  savedSelectionsChanged(): void;
}

/** Pixel edit of one layer, stored as a tile delta (swap on undo/redo). */
export class PixelCommand implements Command {
  constructor(
    readonly label: I18nKey,
    private readonly host: CommandHost,
    private readonly layer: RasterLayer,
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
  /** Surface of every raster layer (including inside groups) at capture time. */
  surfaces: Map<RasterLayer, Surface>;
  selection: Selection | null;
  saved: SavedSelection[];
}

export function captureDocState(doc: PaintDocument): DocState {
  return {
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    paper: doc.paper ? { ...doc.paper } : null,
    surfaces: new Map(doc.rasterLayers().map((l) => [l, l.surface])),
    selection: doc.selection,
    saved: doc.savedSelections,
  };
}

export function applyDocState(doc: PaintDocument, s: DocState): void {
  doc.width = s.width;
  doc.height = s.height;
  doc.dpi = s.dpi;
  doc.paper = s.paper ? { ...s.paper } : null;
  for (const [layer, surface] of s.surfaces) layer.surface = surface;
  doc.selection = s.selection;
  doc.savedSelections = s.saved;
}

/**
 * A selection change (marquee, wand, modify…). Undoable, but it doesn't make the document
 * "unsaved": the active selection isn't part of the file.
 */
export class SelectionCommand implements Command {
  readonly keepsSaved = true;
  readonly bytes: number;

  constructor(
    readonly label: I18nKey,
    private readonly host: CommandHost,
    private readonly before: Selection | null,
    private readonly after: Selection | null,
  ) {
    this.bytes = 64 + (before?.mask.length ?? 0) + (after?.mask.length ?? 0);
  }

  undo(): void {
    this.host.setSelection(this.before);
  }

  redo(): void {
    this.host.setSelection(this.after);
  }
}

/** Saving or deleting a named selection (these are stored in the project). */
export class SavedSelectionsCommand implements Command {
  readonly bytes: number;

  constructor(
    readonly label: I18nKey,
    private readonly host: CommandHost,
    private readonly before: SavedSelection[],
    private readonly after: SavedSelection[],
  ) {
    this.bytes = 64 + after.reduce((n, s) => n + s.selection.mask.length, 0);
  }

  undo(): void {
    this.host.doc.savedSelections = this.before;
    this.host.savedSelectionsChanged();
  }

  redo(): void {
    this.host.doc.savedSelections = this.after;
    this.host.savedSelectionsChanged();
  }
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
    // Surfaces shared by both states are counted once.
    const all = new Set([...this.before.surfaces.values(), ...this.after.surfaces.values()]);
    let n = 0;
    for (const sf of all) n += sf.bytes;
    return n;
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
