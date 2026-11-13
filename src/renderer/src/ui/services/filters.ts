import { filterRegistry } from '@engine/filters/FilterRegistry';
import type { FilterSession } from '@engine/filters/FilterSession';
import { defaultParams } from '@engine/filters/types';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import { openDialog, showToast } from '../state/store';

/** The session the filter dialog takes over when it opens. */
let pending: FilterSession | null = null;

export function takeFilterSession(): FilterSession | null {
  const s = pending;
  pending = null;
  return s;
}

/**
 * Run an adjustment or filter on the active layer (the selection, if any): ones with settings
 * open their dialog; the rest (Greyscale, Invert) apply at once.
 */
export async function openFilter(id: string): Promise<void> {
  const def = filterRegistry.get(id);
  if (!def) return;
  const session = engine.startFilter(id);
  if (!session) return;
  if (def.params.length) {
    pending?.end();
    pending = session;
    openDialog({ kind: 'filter', id });
    return;
  }
  try {
    await session.apply(defaultParams(def));
  } catch {
    session.end();
    showToast({ kind: 'error', key: 'error.filter', params: { name: t(def.labelKey) } });
  }
}
