import { importSvg, SvgImportError } from '@engine/io/svgImport';
import { engine } from '../state/engine';
import { showToast } from '../state/store';

/** Decode an SVG file's text (UTF-8, with or without a byte-order mark; UTF-16 if marked). */
export function svgText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Import an SVG drawing's shapes as editable paths on a new shape layer. */
export async function importSvgFile(): Promise<boolean> {
  let file: { name: string; bytes: Uint8Array } | null;
  try {
    file = await window.pigmento.files.openAsset('svg');
  } catch {
    showToast({ kind: 'error', key: 'error.svgInvalid', params: { name: '' } });
    return false;
  }
  if (!file) return false;
  const name = file.name;
  try {
    const drawing = importSvg(svgText(file.bytes));
    engine.addSvgDrawing(drawing, name.replace(/\.svg$/i, ''));
    showToast({ kind: 'info', key: 'notice.svgImported', params: { count: drawing.shapes.length, name } });
    return true;
  } catch (err) {
    showToast({ kind: 'error', key: err instanceof SvgImportError ? err.key : 'error.svgInvalid', params: { name } });
    return false;
  }
}
