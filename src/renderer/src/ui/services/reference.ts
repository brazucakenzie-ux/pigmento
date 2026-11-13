import { engine } from '../state/engine';
import { showToast } from '../state/store';

/**
 * Open a picture as a reference image over the canvas (to draw from). It is only shown: never
 * saved in the image or the project, and never exported.
 */
export async function loadReference(): Promise<boolean> {
  let file: { name: string; bytes: Uint8Array } | null;
  try {
    file = await window.pigmento.files.openAsset('referenceImage');
  } catch {
    showToast({ kind: 'error', key: 'error.reference', params: { name: '' } });
    return false;
  }
  if (!file) return false;
  try {
    const img = await engine.codecs.decode(file.bytes);
    const o = engine.options('reference');
    engine.setReference(img, Number(o.opacity ?? 50) / 100);
    engine.setToolOption('reference', 'visible', true);
    engine.setTool('reference');
    return true;
  } catch {
    showToast({ kind: 'error', key: 'error.reference', params: { name: file.name } });
    return false;
  }
}
