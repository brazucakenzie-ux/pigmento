import type { AssistantResult } from '@shared/ipc';
import type { History } from '@engine/history/History';
import type { I18nKey } from '../../i18n';

/**
 * A change an AI assistant makes to the picture: shown first at a pace you can follow (`watch`,
 * which changes nothing: a preview that plays out), then made all at once (`apply`), as one undo
 * step with its own name, so your own work never mixes into it.
 */
export interface AssistantChange {
  /** The undo step's name (e.g. "Assistant: draw a shape"). */
  label: I18nKey;
  /** Plays the change out on screen without making it (skipped when drawing is instant). */
  watch?: () => Promise<void>;
  /** Makes the change; what it returns goes back to the assistant. */
  apply: () => AssistantResult;
}

export function isChange(r: AssistantResult | AssistantChange): r is AssistantChange {
  return typeof (r as AssistantChange).apply === 'function';
}

/** Watch it (unless drawing is instant), then make it as one undo step. */
export async function carryOutChange(history: History, change: AssistantChange, pace: 'watch' | 'instant'): Promise<AssistantResult> {
  if (pace === 'watch' && change.watch) await change.watch();
  return history.group(change.label, change.apply);
}
