import { formatFromPath } from '@shared/formats';
import type { AutosaveEntry } from '@shared/ipc';
import { loadProject, saveProject } from '@engine/io/project';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import { openDialog, showToast, useUi } from '../state/store';
import { makeThumbnail, pngCodec } from './files';

/** How often unsaved work is written to %APPDATA%\Pigmento\autosave. */
export const AUTOSAVE_MS = 60_000;

const sessionId = crypto.randomUUID();
let changes = 0;
let savedChanges = 0;
let busy = false;
let hasFile = false;

/** Write the current document if it has changes the autosave doesn't have yet. */
export async function autosaveNow(): Promise<boolean> {
  const dirty = useUi.getState().history.dirty;
  if (!dirty || busy || changes === savedChanges) return false;
  busy = true;
  const at = changes;
  try {
    engine.commitLive();
    const project = await saveProject(engine.doc, pngCodec, await makeThumbnail());
    const f = useUi.getState().file;
    await window.pigmento.autosave.write(sessionId, project, await makeThumbnail(160), {
      name: f.name ?? t('doc.untitled'),
      path: f.path,
    });
    savedChanges = at;
    hasFile = true;
    return true;
  } catch (err) {
    // Autosave must never interrupt work; the next tick tries again.
    console.warn('Autosave failed', err);
    return false;
  } finally {
    busy = false;
  }
}

/** Remove this window's autosave (the work is saved, discarded or the window closes). */
export async function clearOwnAutosave(): Promise<void> {
  if (!hasFile) return;
  hasFile = false;
  savedChanges = changes;
  await window.pigmento.autosave.clear(sessionId).catch(() => undefined);
}

export function startAutosave(): void {
  void window.pigmento.autosave.register(sessionId);
  engine.on('history', (h) => {
    changes++;
    // Saved (or a fresh document): nothing left to recover.
    if (!h.dirty) void clearOwnAutosave();
  });
  window.setInterval(() => void autosaveNow(), AUTOSAVE_MS);
}

/** On startup: offer autosaves left behind by a crash. */
export async function offerRecovery(): Promise<void> {
  const items = await window.pigmento.autosave.list().catch(() => [] as AutosaveEntry[]);
  if (items.length > 0) openDialog({ kind: 'recover', items });
}

/** Restore one recovered autosave into this window (it stays unsaved until the user saves). */
export async function restoreAutosave(entry: AutosaveEntry): Promise<boolean> {
  try {
    const bytes = await window.pigmento.autosave.read(entry.id);
    engine.loadDocument(await loadProject(bytes, pngCodec));
  } catch {
    showToast({ kind: 'error', key: 'error.projectInvalid', params: { name: entry.name } });
    return false;
  }
  engine.markUnsaved();
  // The original file may be a flat image; saving goes through Save as so nothing is overwritten by surprise.
  useUi.setState({ file: { path: null, name: entry.name, format: entry.path ? formatFromPath(entry.path) : null } });
  window.pigmento.window.setDocState({ dirty: true, hasFile: false });
  await window.pigmento.autosave.clear(entry.id).catch(() => undefined);
  showToast({ kind: 'info', key: 'notice.recovered', params: { name: entry.name } });
  return true;
}

export async function discardAutosave(entry: AutosaveEntry): Promise<void> {
  await window.pigmento.autosave.clear(entry.id).catch(() => undefined);
}
