import type { WebContents } from 'electron';

/**
 * Windows carrying out one of Pigmento's actions for an AI assistant (run_action). Pigmento's
 * own dialogs (open, save, print, the unsaved-changes question) are for a person, so while it
 * runs they're cancelled at once instead of being put in front of the user.
 */
const acting = new WeakSet<WebContents>();

export function setActing(wc: WebContents, on: boolean): void {
  if (on) acting.add(wc);
  else acting.delete(wc);
}

export function isActing(wc: WebContents): boolean {
  return acting.has(wc);
}
