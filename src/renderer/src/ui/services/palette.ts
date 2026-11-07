import { parseHex, type RGBA } from '@engine/core/color';
import { PaletteError, paletteToJson, parsePalette } from '@engine/io/palette';
import { t } from '../../i18n';
import { PALETTE } from '../app/paletteDefaults';
import { showToast, updateSettings, useUi } from '../state/store';

const hex6 = (c: RGBA) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** The palette shown in the Colours group: an imported one, or Pigmento's. */
export function activePalette(): string[] {
  return useUi.getState().settings.colors.palette ?? PALETTE;
}

/** Use the colours in a palette file (JSON, GIMP .gpl or Adobe .ase) as the palette. */
export async function importPaletteFile(): Promise<boolean> {
  let file: { name: string; bytes: Uint8Array } | null;
  try {
    file = await window.pigmento.files.openAsset('palette');
  } catch {
    showToast({ kind: 'error', key: 'error.paletteInvalid', params: { name: '' } });
    return false;
  }
  if (!file) return false;
  try {
    const p = parsePalette(file.name, file.bytes);
    const colors = useUi.getState().settings.colors;
    updateSettings({ colors: { ...colors, palette: p.colors.map(hex6) } });
    showToast({ kind: 'info', key: 'notice.paletteImported', params: { name: file.name, count: p.colors.length } });
    return true;
  } catch (err) {
    showToast({ kind: 'error', key: 'error.paletteInvalid', params: { name: file.name } });
    if (!(err instanceof PaletteError)) console.error(err);
    return false;
  }
}

/** Save the palette and custom colours as a Pigmento palette (.json). */
export async function exportPaletteFile(): Promise<boolean> {
  const s = useUi.getState().settings.colors;
  const colors = [...activePalette(), ...s.custom.map((h) => h.slice(0, 7))].map((h) => parseHex(h)).filter((c): c is RGBA => c !== null);
  const bytes = new TextEncoder().encode(paletteToJson({ name: t('palette.defaultName'), colors }));
  let saved: string | null;
  try {
    saved = await window.pigmento.files.saveAsset('palette', `${t('palette.defaultName')}.json`, bytes);
  } catch {
    showToast({ kind: 'error', key: 'error.paletteSave' });
    return false;
  }
  if (!saved) return false;
  showToast({ kind: 'info', key: 'notice.paletteExported', params: { name: saved.split(/[\\/]/).pop() ?? saved } });
  return true;
}

export function resetPalette(): void {
  const colors = useUi.getState().settings.colors;
  const next = { ...colors };
  delete next.palette;
  updateSettings({ colors: next });
}
