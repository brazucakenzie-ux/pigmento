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
  /** Doesn't change what a save would write (e.g. the active selection), so it never makes the document unsaved. */
  readonly keepsSaved?: boolean;
}

/** Several commands recorded as one step (e.g. "new shape layer" + "rectangle"). */
export class CompoundCommand implements Command {
  readonly bytes: number;
  readonly keepsSaved: boolean;

  constructor(
    readonly label: I18nKey,
    private readonly parts: Command[],
  ) {
    this.bytes = parts.reduce((n, c) => n + c.bytes, 0);
    this.keepsSaved = parts.every((c) => c.keepsSaved === true);
  }

  undo(): void {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i].undo();
  }

  redo(): void {
    for (const c of this.parts) c.redo();
  }

  dispose(): void {
    for (const c of this.parts) c.dispose?.();
  }
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
    if (this.savedIndex === null) return true;
    const lo = Math.min(this.savedIndex, this._index);
    const hi = Math.max(this.savedIndex, this._index);
    for (let i = lo; i < hi; i++) if (!this.items[i].keepsSaved) return true;
    return false;
  }

  get bytes(): number {
    return this.items.reduce((n, c) => n + c.bytes, 0);
  }

  entries(): HistoryEntry[] {
    return this.items.map((c) => ({ label: c.label }));
  }

  private collecting: Command[] | null = null;

  /**
   * Looks at each step as it's recorded (already applied) and may add a follow-on change that
   * belongs to it (pieces that followed a path the step deleted keep their motion), so undo takes
   * both back together.
   */
  amend: ((cmd: Command) => Command | null) | null = null;

  /** Record everything pushed while `fn` runs as one undoable step. */
  group<T>(label: I18nKey, fn: () => T): T {
    if (this.collecting) return fn();
    this.collecting = [];
    try {
      return fn();
    } finally {
      const parts = this.collecting;
      this.collecting = null;
      if (parts.length === 1) this.push(parts[0]);
      else if (parts.length > 1) this.push(new CompoundCommand(label, parts));
    }
  }

  /**
   * One AI assistant's step: everything recorded until `fn` has finished (it may wait, for work
   * done on workers) is one step named `label`, even a single command. Meanwhile the history is
   * held: undo and redo do nothing, and the canvas and shortcuts wait, so nothing of yours mixes in.
   */
  async named<T>(label: I18nKey, fn: () => T | Promise<T>): Promise<T> {
    if (this.collecting) return fn();
    this.collecting = [];
    this._held = true;
    try {
      return await fn();
    } finally {
      const parts = this.collecting;
      this.collecting = null;
      this._held = false;
      if (parts.length) this.push(new CompoundCommand(label, parts));
    }
  }

  private _held = false;

  /** An assistant's step is being made (see named). */
  get held(): boolean {
    return this._held;
  }

  /** Record a command whose effect has already been applied. */
  push(cmd: Command): void {
    if (this.busy) throw new Error('Cannot push while undoing/redoing');
    if (this.collecting) {
      this.collecting.push(cmd);
      return;
    }
    const extra = this.amend?.(cmd) ?? null;
    if (extra) cmd = new CompoundCommand(cmd.label, [cmd, extra]);
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
    if (!this.canUndo || this._held) return false;
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
    if (!this.canRedo || this._held) return false;
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
