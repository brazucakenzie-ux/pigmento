import { Emitter } from '../core/emitter';
import type { I18nKey } from '../../i18n';

/** A reversible, already-applied action. */
export interface Command {
  readonly label: I18nKey;
  /** Approximate memory held by this command, for the history budget. */
  readonly bytes: number;
  undo(): void;
  redo(): void;
  /** Release resources when the command falls off the history. */
  dispose?(): void;
  /**
   * Absorb an immediately following command into this one (e.g. one opacity slider drag
   * becomes one step). Return true if merged; `next` is then discarded.
   */
  mergeWith?(next: Command): boolean;
}

export interface HistoryEntry {
  label: I18nKey;
}

interface HistoryEvents {
  change: { index: number; length: number };
}

export interface HistoryLimits {
  maxBytes: number;
  maxEntries: number;
}

/**
 * Linear undo stack. `index` counts applied commands; entries past it are redoable.
 * Oldest entries are dropped when the byte or entry budget is exceeded.
 */
export class History extends Emitter<HistoryEvents> {
  private items: Command[] = [];
  private _index = 0;
  private savedIndex: number | null = 0;
  /** Label for the state before the first command ("New image" / "Open image"). */
  initialLabel: I18nKey = 'history.initial.new';
  private busy = false;

  constructor(
    private limits: HistoryLimits = { maxBytes: 1024 * 1024 * 1024, maxEntries: 2000 },
  ) {
    super();
  }

  get index(): number {
    return this._index;
  }

  get length(): number {
    return this.items.length;
  }

  get canUndo(): boolean {
    return this._index > 0;
  }

  get canRedo(): boolean {
    return this._index < this.items.length;
  }

  get isDirty(): boolean {
    return this.savedIndex !== this._index;
  }

  get bytes(): number {
    return this.items.reduce((n, c) => n + c.bytes, 0);
  }

  entries(): HistoryEntry[] {
    return this.items.map((c) => ({ label: c.label }));
  }

  /** Record a command whose effect has already been applied. */
  push(cmd: Command): void {
    if (this.busy) throw new Error('Cannot push while undoing/redoing');
    const top = this._index === this.items.length ? this.items[this._index - 1] : undefined;
    if (top?.mergeWith?.(cmd)) {
      // The merged step no longer matches a save made right after it.
      if (this.savedIndex === this._index) this.savedIndex = null;
      this.changed();
      return;
    }
    for (const c of this.items.splice(this._index)) c.dispose?.();
    if (this.savedIndex !== null && this.savedIndex > this._index) this.savedIndex = null;
    this.items.push(cmd);
    this._index = this.items.length;
    this.enforceLimits();
    this.changed();
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    this.busy = true;
    try {
      this.items[this._index - 1].undo();
      this._index--;
    } finally {
      this.busy = false;
    }
    this.changed();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.busy = true;
    try {
      this.items[this._index].redo();
      this._index++;
    } finally {
      this.busy = false;
    }
    this.changed();
    return true;
  }

  /** Undo/redo until `index` commands are applied. */
  jumpTo(index: number): void {
    const target = Math.max(0, Math.min(this.items.length, index));
    while (this._index > target) if (!this.undo()) break;
    while (this._index < target) if (!this.redo()) break;
  }

  markSaved(): void {
    this.savedIndex = this._index;
    this.changed();
  }

  /** The current state isn't saved anywhere (e.g. a recovered autosave). */
  markUnsaved(): void {
    this.savedIndex = null;
    this.changed();
  }

  reset(initialLabel: I18nKey): void {
    for (const c of this.items) c.dispose?.();
    this.items = [];
    this._index = 0;
    this.savedIndex = 0;
    this.initialLabel = initialLabel;
    this.changed();
  }

  setLimits(limits: HistoryLimits): void {
    this.limits = limits;
    this.enforceLimits();
  }

  private enforceLimits(): void {
    let total = this.bytes;
    // Always keep at least the most recent command.
    while (
      this.items.length > 1 &&
      this._index > 1 &&
      (total > this.limits.maxBytes || this.items.length > this.limits.maxEntries)
    ) {
      const dropped = this.items.shift()!;
      total -= dropped.bytes;
      dropped.dispose?.();
      this._index--;
      if (this.savedIndex !== null) this.savedIndex = this.savedIndex > 0 ? this.savedIndex - 1 : null;
    }
  }

  private changed(): void {
    this.emit('change', { index: this._index, length: this.items.length });
  }
}
