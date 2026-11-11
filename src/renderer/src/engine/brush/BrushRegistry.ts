import type { I18nKey } from '../../i18n';
import { defaultBrush, type BrushSettings } from './types';

/** The brush picker's categories, in display order. */
export const BRUSH_CATEGORIES = ['basic', 'pencil', 'paint', 'spray', 'dry', 'textured', 'artistic', 'pixel', 'eraser'] as const;
/** Built-in categories, plus 'custom' for personal brushes filed nowhere else. */
export type BrushCategory = (typeof BRUSH_CATEGORIES)[number] | 'custom';

export interface BrushDef {
  readonly id: string;
  readonly category: BrushCategory;
  /** Built-in brushes are named by key (`brush.<id>`); personal ones by `name`. */
  readonly labelKey: I18nKey;
  readonly name?: string;
  readonly keywords: readonly string[];
  readonly settings: BrushSettings;
  /** Made for erasing: picking it switches to the Eraser. */
  readonly eraser: boolean;
  readonly custom?: boolean;
}

export function defineBrush(id: string, category: BrushCategory, settings: Partial<BrushSettings>, keywords: string[] = []): BrushDef {
  return { id, category, labelKey: `brush.${id}` as I18nKey, keywords, settings: defaultBrush(settings), eraser: category === 'eraser' };
}

export class BrushRegistry {
  private defs = new Map<string, BrushDef>();

  register(def: BrushDef): void {
    if (this.defs.has(def.id)) throw new Error(`Brush "${def.id}" is already registered`);
    this.defs.set(def.id, def);
  }

  /** Add or replace a personal brush. */
  set(def: BrushDef): void {
    this.defs.set(def.id, def);
  }

  remove(id: string): void {
    if (this.defs.get(id)?.custom) this.defs.delete(id);
  }

  get(id: string): BrushDef | undefined {
    return this.defs.get(id);
  }

  all(): BrushDef[] {
    return [...this.defs.values()];
  }

  byCategory(cat: BrushCategory): BrushDef[] {
    return this.all().filter((d) => d.category === cat);
  }

  /** Brushes whose name (as shown), id or keywords contain every word of `text`. */
  search(text: string, nameOf: (d: BrushDef) => string): BrushDef[] {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.all();
    return this.all().filter((d) => {
      const hay = [nameOf(d), d.id.replace(/-/g, ' '), ...d.keywords].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
}

export const brushRegistry = new BrushRegistry();
