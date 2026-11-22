import type { AssistantCall, AssistantResult } from '@shared/ipc';
import { parseHex, type RGBA } from '@engine/core/color';
import type { Layer } from '@engine/doc/Document';
import { EngineError } from '@engine/Engine';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import type { AssistantChange } from './assistantChange';

/**
 * What the window's side of AI assistants shares: the shape of a tool's handler, and reading its
 * arguments. Main has checked them against each tool's schema; these narrow them for TypeScript
 * and check what only the window knows (layer ids, the picture's size).
 */

export type Handler = (args: Record<string, unknown>, call: AssistantCall) => AssistantResult | AssistantChange | Promise<AssistantResult | AssistantChange>;

export const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
export const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** A colour given as #rrggbb or #rrggbbaa. */
export function colorArg(v: unknown, what = 'colour'): RGBA | undefined {
  if (v === undefined) return undefined;
  const c = typeof v === 'string' ? parseHex(v) : null;
  if (!c) throw new Error(`The ${what} should be #rrggbb or #rrggbbaa (not ${String(v)}).`);
  return c;
}

/** A layer the assistant named (an id from get_picture_info). */
export function layerArg(v: unknown): Layer | undefined {
  if (v === undefined) return undefined;
  const layer = typeof v === 'string' ? engine.doc.layerById(v) : undefined;
  if (!layer) throw new Error(`There’s no layer ${String(v)}. get_picture_info lists the layers.`);
  return layer;
}

/** What went wrong, in words for the assistant (the engine's own errors are i18n keys). */
export function errorText(err: unknown): string {
  if (err instanceof EngineError) return t(err.key, err.params);
  return err instanceof Error ? err.message : String(err);
}
