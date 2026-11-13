import type { I18nKey } from '../../i18n';
import type { RGBA } from '../core/color';
import type { Rect } from '../core/geometry';

/**
 * Adjustments and filters are pure functions over a band of pixels, so they run the same in a
 * worker, on the UI thread for small previews, and in unit tests.
 */
export type FilterValue = number | boolean | string | RGBA | readonly (readonly [number, number])[];
export type FilterParams = Record<string, FilterValue>;

interface ParamBase {
  key: string;
  labelKey: I18nKey;
  /** A heading the dialog shows above this parameter (the first of a section). */
  section?: I18nKey;
  /** Shown only when this holds (e.g. the curve of the chosen channel). */
  showIf?: (p: FilterParams) => boolean;
}

export type FilterParam =
  | (ParamBase & { type: 'slider'; min: number; max: number; step?: number; unit?: string; default: number })
  | (ParamBase & { type: 'toggle'; default: boolean })
  | (ParamBase & { type: 'choice'; default: string; choices: readonly { value: string; labelKey: I18nKey }[] })
  | (ParamBase & { type: 'color'; default: RGBA })
  | (ParamBase & { type: 'curve'; default: readonly (readonly [number, number])[] });

/** Where a filter is listed in the Effects tab. */
export type FilterGroup = 'tone' | 'color' | 'blur' | 'detail' | 'stylize' | 'light';

/**
 * One band of the image (straight RGBA). `x0`, `y0` place it in the image; `frame` is the area
 * being filtered (the selection's bounds or the whole layer); `scale` is below 1 for a
 * downscaled preview, and filters scale their pixel distances by it.
 */
export interface FilterInput {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  x0: number;
  y0: number;
  frame: Rect;
  scale: number;
}

export interface FilterDef {
  id: string;
  kind: 'adjustment' | 'filter';
  group: FilterGroup;
  /** Name, also the history label. */
  labelKey: I18nKey;
  icon: string;
  params: readonly FilterParam[];
  /** Rows (and columns) of neighbours an output pixel reads, at this scale. */
  pad?(p: FilterParams, scale: number): number;
  /** Returns a new w×h RGBA image for the band. */
  run(input: FilterInput, p: FilterParams): Uint8ClampedArray;
}

export function defaultParams(def: FilterDef): FilterParams {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/** A parameter's value, falling back to its default if missing or of the wrong type. */
export function num(p: FilterParams, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function bool(p: FilterParams, key: string, fallback: boolean): boolean {
  const v = p[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function str(p: FilterParams, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
}

export function color(p: FilterParams, key: string, fallback: RGBA): RGBA {
  const v = p[key];
  return v && typeof v === 'object' && !Array.isArray(v) && 'r' in v ? (v as RGBA) : fallback;
}

export function curve(p: FilterParams, key: string): readonly (readonly [number, number])[] {
  const v = p[key];
  return Array.isArray(v) && v.length >= 2 ? (v as readonly (readonly [number, number])[]) : [[0, 0], [1, 1]];
}
