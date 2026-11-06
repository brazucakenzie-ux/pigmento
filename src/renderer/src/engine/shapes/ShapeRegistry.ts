import type { I18nKey } from '../../i18n';
import { PathBuilder, type PathCmd } from './path';

/** The gallery's categories, in display order. */
export const SHAPE_CATEGORIES = [
  'basic',
  'polygons',
  'stars',
  'arrows',
  'callouts',
  'flowchart',
  'symbols',
  'banners',
  'brackets',
  'math',
  'nature',
] as const;
export type ShapeCategory = (typeof SHAPE_CATEGORIES)[number];

/** A slider on the shape (values in display units: %, degrees or a count). */
export interface ShapeParam {
  key: string;
  labelKey: I18nKey;
  min: number;
  max: number;
  step: number;
  default: number;
  unit: '%' | '°' | '';
}

export type ShapeParams = Readonly<Record<string, number>>;

/** A parametric shape drawn into a w×h box whose top-left is (0, 0). */
export interface ShapeDef {
  readonly id: string;
  readonly category: ShapeCategory;
  readonly labelKey: I18nKey;
  /** Extra search words (English). */
  readonly keywords: readonly string[];
  readonly params: readonly ShapeParam[];
  /** "evenodd" makes nested outlines holes; "nonzero" fills overlapping parts. */
  readonly fillRule: 'evenodd' | 'nonzero';
  /** Lines only (brackets, spirals): never filled. */
  readonly strokeOnly: boolean;
  build(b: PathBuilder, w: number, h: number, p: ShapeParams): void;
}

type ParamInit = Omit<ShapeParam, 'labelKey' | 'step' | 'unit'> & {
  step?: number;
  unit?: ShapeParam['unit'];
};

export interface ShapeInit {
  keywords?: string[];
  params?: ParamInit[];
  fillRule?: 'evenodd' | 'nonzero';
  strokeOnly?: boolean;
  build(b: PathBuilder, w: number, h: number, p: ShapeParams): void;
}

/** Shape ids and parameter keys double as i18n keys: `shape.<id>`, `shapeparam.<key>`. */
export function defineShape(id: string, category: ShapeCategory, init: ShapeInit): ShapeDef {
  return {
    id,
    category,
    labelKey: `shape.${id}` as I18nKey,
    keywords: init.keywords ?? [],
    params: (init.params ?? []).map((p) => ({
      step: 1,
      unit: '%' as const,
      ...p,
      labelKey: `shapeparam.${p.key}` as I18nKey,
    })),
    fillRule: init.fillRule ?? 'evenodd',
    strokeOnly: init.strokeOnly ?? false,
    build: init.build,
  };
}

export function defaultParams(def: ShapeDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

/** Parameters with defaults filled in and every value clamped to its slider. */
export function resolveParams(def: ShapeDef, params?: ShapeParams): Record<string, number> {
  const out = defaultParams(def);
  for (const p of def.params) {
    const v = params?.[p.key];
    if (typeof v === 'number' && Number.isFinite(v))
      out[p.key] = Math.min(p.max, Math.max(p.min, v));
  }
  return out;
}

/** The outline of a shape in a w×h box. */
export function shapePath(def: ShapeDef, w: number, h: number, params?: ShapeParams): PathCmd[] {
  const b = new PathBuilder();
  def.build(b, Math.max(0.5, w), Math.max(0.5, h), resolveParams(def, params));
  return b.cmds;
}

export class ShapeRegistry {
  private defs = new Map<string, ShapeDef>();

  register(def: ShapeDef): void {
    if (this.defs.has(def.id)) throw new Error(`Shape "${def.id}" is already registered`);
    this.defs.set(def.id, def);
  }

  get(id: string): ShapeDef | undefined {
    return this.defs.get(id);
  }

  all(): ShapeDef[] {
    return [...this.defs.values()];
  }

  byCategory(cat: ShapeCategory): ShapeDef[] {
    return this.all().filter((d) => d.category === cat);
  }

  /** Shapes whose name (as shown), id or keywords contain every word of `text`. */
  search(text: string, nameOf: (d: ShapeDef) => string): ShapeDef[] {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.all();
    return this.all().filter((d) => {
      const hay = [nameOf(d), d.id.replace(/-/g, ' '), ...d.keywords].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
}

export const shapeRegistry = new ShapeRegistry();
