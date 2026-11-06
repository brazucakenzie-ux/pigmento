import { MAX_PATTERN_SIZE } from '@engine/raster/patterns';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import { showToast, useUi } from '../state/store';

/** Load the patterns saved in earlier sessions into the engine (bad files are skipped). */
export async function loadSavedPatterns(): Promise<void> {
  const list = await window.pigmento.patterns.list().catch(() => []);
  for (const p of list) {
    try {
      const img = await engine.codecs.decode(p.png);
      if (img.w > MAX_PATTERN_SIZE || img.h > MAX_PATTERN_SIZE) continue;
      engine.addSavedPattern(p.id, p.name, { w: img.w, h: img.h, data: img.data });
    } catch {
      // Not a readable image: leave it out.
    }
  }
}

/** Edit → Make pattern from selection: save it and switch the Fill tool to it. */
export async function makePatternFromSelection(): Promise<boolean> {
  const img = engine.patternFromSelection();
  if (!img) {
    showToast({ kind: 'info', key: 'notice.patternNeedsSelection' });
    return false;
  }
  if (img.w > MAX_PATTERN_SIZE || img.h > MAX_PATTERN_SIZE) {
    showToast({ kind: 'info', key: 'notice.patternTooLarge', params: { max: MAX_PATTERN_SIZE } });
    return false;
  }
  const n = useUi.getState().patterns.filter((p) => !p.builtin).length + 1;
  const name = t('pattern.defaultName', { n });
  try {
    // The encoder takes ownership of the buffer it's given, so it gets a copy.
    const png = await engine.codecs.encode('png', img.w, img.h, img.data.slice(), 100, engine.doc.dpi);
    const id = await window.pigmento.patterns.save(png, name);
    engine.addSavedPattern(id, name, img);
    engine.setToolOption('fill', 'fillWith', 'pattern');
    engine.setToolOption('fill', 'pattern', id);
  } catch {
    showToast({ kind: 'error', key: 'error.pattern' });
    return false;
  }
  showToast({ kind: 'info', key: 'notice.patternSaved', params: { name } });
  return true;
}

export async function deletePattern(id: string): Promise<void> {
  await window.pigmento.patterns.remove(id).catch(() => undefined);
  engine.removeSavedPattern(id);
  if (engine.options('fill').pattern === id) engine.setToolOption('fill', 'pattern', 'checker');
}
