import { FILE_FORMATS, FORMATS, formatFromPath, type FileFormat, type ImageFormat } from '@shared/formats';
import type { WallpaperStyle } from '@shared/ipc';
import { CodecError } from '@engine/io/CodecClient';
import type { ExportOptions } from '@engine/Engine';
import { ProjectError, isZip, loadProject, saveProject, type PngCodec } from '@engine/io/project';
import { hasTransparency } from '@engine/raster/pixels';
import type { RGBA } from '@engine/core/color';
import type { ImageBuf } from '@engine/raster/transform';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import { openDialog, showToast, updateSettings, useUi } from '../state/store';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function docName(): string {
  return useUi.getState().file.name ?? t('doc.untitled');
}

function baseName(): string {
  const n = useUi.getState().file.name;
  return n ? n.replace(/\.[^.]+$/, '') : t('doc.untitled');
}

/** Ask to save unsaved changes. Resolves true when it's OK to discard the current image. */
export async function confirmDiscard(): Promise<boolean> {
  if (!useUi.getState().history.dirty) return true;
  const choice = await window.pigmento.window.confirmSave(docName());
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  return save();
}

export async function newImage(width: number, height: number, paper: RGBA | null, dpi: number): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  try {
    engine.newDocument(width, height, paper, dpi);
  } catch (err) {
    reportError(err);
    return false;
  }
  useUi.setState({ file: { path: null, name: null, format: null } });
  window.pigmento.window.setDocState({ dirty: false, hasFile: false });
  return true;
}

function reportError(err: unknown, fallbackKey: 'error.generic' = 'error.generic'): void {
  const e = err as { key?: string; params?: Record<string, string | number> };
  if (e && typeof e.key === 'string') {
    showToast({ kind: 'error', key: e.key as never, params: e.params });
    return;
  }
  showToast({ kind: 'error', key: fallbackKey, params: { message: errorMessage(err) } });
}

/** Decode bytes, mapping codec failures to friendly messages. */
async function decode(bytes: Uint8Array, name: string) {
  try {
    return await engine.codecs.decode(bytes);
  } catch (err) {
    if (err instanceof CodecError && err.code === 'too-large') {
      const [w, h] = err.message.split('x');
      showToast({ kind: 'error', key: 'error.tooLarge', params: { w, h, max: 250 } });
    } else {
      showToast({ kind: 'error', key: 'error.open', params: { name } });
    }
    return null;
  }
}

/** PNG through the codec worker, for layer images inside projects. */
export const pngCodec: PngCodec = {
  encode: (data, w, h) => engine.codecs.encode('png', w, h, data, 100, engine.doc.dpi),
  decode: async (bytes) => {
    const r = await engine.codecs.decode(bytes);
    return { w: r.w, h: r.h, data: r.data };
  },
};

/** More than one layer (or a group): a flat image format can't hold it. */
/** Saved selections live only in projects. */
function hasSavedSelections(): boolean {
  return engine.doc.savedSelections.length > 0;
}

export function isLayered(): boolean {
  const l = engine.doc.layers;
  return l.length > 1 || l[0].kind !== 'raster';
}

/** Small PNG preview of the composite (projects, crash-recovery list). */
export async function makeThumbnail(max = 256): Promise<Uint8Array> {
  const { width, height } = engine.doc;
  const k = Math.min(1, max / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  engine.renderer.drawThumbnail(ctx, w, h);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** Load file bytes as a project or an image. */
async function loadBytes(path: string, bytes: Uint8Array, name: string): Promise<boolean> {
  if (formatFromPath(path) === 'pigm' || isZip(bytes)) {
    try {
      engine.loadDocument(await loadProject(bytes, pngCodec));
    } catch (err) {
      if (err instanceof ProjectError && err.key !== 'error.tooLarge') showToast({ kind: 'error', key: err.key, params: { name } });
      else reportError(err);
      return false;
    }
    return true;
  }
  const img = await decode(bytes, name);
  if (!img) return false;
  try {
    engine.loadImage(img);
  } catch (err) {
    reportError(err);
    return false;
  }
  return true;
}

export async function openPath(path: string, skipConfirm = false): Promise<boolean> {
  if (!skipConfirm && !(await confirmDiscard())) return false;
  const name = path.split(/[\\/]/).pop() ?? path;
  let bytes: Uint8Array;
  try {
    bytes = (await window.pigmento.files.read(path)).bytes;
  } catch {
    showToast({ kind: 'error', key: 'error.open', params: { name } });
    void window.pigmento.recent.remove(path).catch(() => undefined);
    return false;
  }
  if (!(await loadBytes(path, bytes, name))) return false;
  useUi.setState({ file: { path, name, format: formatFromPath(path) } });
  window.pigmento.window.setDocState({ dirty: false, hasFile: true });
  void window.pigmento.recent.add(path).catch(() => undefined);
  return true;
}

export async function open(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const path = await window.pigmento.files.showOpenDialog();
  if (path) await openPath(path, true);
}

/**
 * Ask for JPEG/WebP quality and warn about anything the format loses (transparency, layers).
 * Resolves the quality, or null when cancelled.
 */
async function askQuality(format: ImageFormat, transparent: boolean, layers: boolean, selections: boolean): Promise<number | null> {
  const needsDialog = FORMATS[format].lossy || (transparent && !FORMATS[format].alpha) || layers || selections;
  if (!needsDialog) return 100;
  return new Promise((resolve) => openDialog({ kind: 'quality', format, transparent, layers, selections, resolve }));
}

async function encodeFlattened(format: ImageFormat, quality: number): Promise<Uint8Array> {
  const img = engine.flatten(!FORMATS[format].alpha);
  return engine.codecs.encode(format, img.w, img.h, img.data, quality, engine.doc.dpi);
}

async function writeTo(path: string, format: FileFormat, fromSaveAs: boolean): Promise<boolean> {
  engine.commitLive();
  const name = path.split(/[\\/]/).pop() ?? path;
  let bytes: Uint8Array;
  // A flat file can't hold layers: the document stays "unsaved" so closing still asks.
  let complete = true;
  try {
    if (format === 'pigm') {
      bytes = await saveProject(engine.doc, pngCodec, await makeThumbnail());
    } else {
      const layers = isLayered();
      const selections = hasSavedSelections();
      const transparent = hasTransparency(engine.flatten(false).data);
      const settings = useUi.getState().settings.export;
      let quality = format === 'jpeg' ? settings.jpegQuality : settings.webpQuality;
      if (fromSaveAs || layers || selections) {
        const q = await askQuality(format, transparent, layers, selections);
        if (q === null) return false;
        quality = q;
      }
      complete = !layers && !selections;
      bytes = await encodeFlattened(format, quality);
    }
    await window.pigmento.files.write(path, bytes);
  } catch {
    showToast({ kind: 'error', key: 'error.save', params: { name } });
    return false;
  }
  if (complete) engine.markSaved();
  useUi.setState({ file: { path, name, format } });
  window.pigmento.window.setDocState({ dirty: !complete, hasFile: true });
  void window.pigmento.recent.add(path).catch(() => undefined);
  showToast({ kind: 'info', key: 'notice.saved', params: { name } });
  return true;
}

export async function save(): Promise<boolean> {
  const f = useUi.getState().file;
  if (!f.path || !f.format) return saveAs();
  return writeTo(f.path, f.format, false);
}

export async function saveAs(preferred?: FileFormat): Promise<boolean> {
  const f = useUi.getState().file;
  // Layered work (or saved selections) defaults to the project format so nothing is lost by accident.
  const format = preferred ?? (isLayered() || hasSavedSelections() ? 'pigm' : (f.format ?? 'png'));
  const res = await window.pigmento.files.showSaveDialog({
    defaultName: `${baseName()}.${FILE_FORMATS[format].extensions[0]}`,
    format,
  });
  if (!res) return false;
  return writeTo(res.path, res.format, true);
}

/** Everything the Export dialog decides. */
export interface ExportChoice extends ExportOptions {
  format: ImageFormat;
  quality: number;
}

/** Suggested export file name: the image name, plus the layer name and "@2x" when they apply. */
export function exportFileName(c: ExportChoice): string {
  let n = baseName();
  const layer = c.layerId ? engine.doc.layerById(c.layerId) : null;
  if (layer) n += ` - ${layer.name}`;
  if (c.scale !== 1) n += `@${c.scale}x`;
  return `${n}.${FORMATS[c.format].extensions[0]}`;
}

/** Render and encode an export; formats without alpha always get a solid background. */
async function encodeExport(c: ExportChoice): Promise<Uint8Array> {
  engine.commitLive();
  const img = engine.exportPixels({ ...c, transparent: c.transparent && FORMATS[c.format].alpha });
  // The DPI scales with the pixels, so a 2× export prints at the same physical size.
  return engine.codecs.encode(c.format, img.w, img.h, img.data, c.quality, Math.round(engine.doc.dpi * c.scale));
}

/** Export a copy of the image. The open document, its file and its saved state don't change. */
export async function exportImage(c: ExportChoice): Promise<boolean> {
  const res = await window.pigmento.files.showSaveDialog({ defaultName: exportFileName(c), format: c.format, exportOnly: true });
  if (!res) return false;
  const name = res.path.split(/[\\/]/).pop() ?? res.path;
  try {
    await window.pigmento.files.write(res.path, await encodeExport(c));
  } catch (err) {
    const e = err as { key?: unknown };
    if (typeof e?.key === 'string') reportError(err);
    else showToast({ kind: 'error', key: 'error.export', params: { name } });
    return false;
  }
  showToast({ kind: 'info', key: 'notice.exported', params: { name } });
  return true;
}

/**
 * Copy the whole image to the clipboard as PNG (whatever is selected). Transparent images
 * stay transparent; the Export dialog can pass its own choices.
 */
export async function copyImage(c?: Partial<ExportOptions>): Promise<void> {
  engine.commitLive();
  let img: ImageBuf;
  try {
    img = engine.exportPixels({ layerId: null, transparent: engine.doc.paper === null, scale: 1, method: 'bicubic', ...c });
  } catch (err) {
    reportError(err);
    return;
  }
  if (await writeClipboard(img)) showToast({ kind: 'info', key: 'notice.copiedImage' });
}

export async function printImage(): Promise<void> {
  engine.commitLive();
  try {
    const img = engine.flatten(false);
    const png = await engine.codecs.encode('png', img.w, img.h, img.data, 100, engine.doc.dpi);
    await window.pigmento.system.print({ png, widthPx: img.w, heightPx: img.h, dpi: engine.doc.dpi, title: docName() });
  } catch {
    showToast({ kind: 'error', key: 'error.print' });
  }
}

export async function setWallpaper(style: WallpaperStyle): Promise<void> {
  engine.commitLive();
  try {
    const img = engine.flatten(true);
    const png = await engine.codecs.encode('png', img.w, img.h, img.data, 100, engine.doc.dpi);
    await window.pigmento.system.setWallpaper(png, style);
    showToast({ kind: 'info', key: 'notice.wallpaper' });
  } catch {
    showToast({ kind: 'error', key: 'error.wallpaper' });
  }
}

// ---- clipboard ------------------------------------------------------------------------

/** Copy finishes asynchronously; a paste right after a copy must see the new content. */
let pendingCopy: Promise<void> = Promise.resolve();

/** Resolves true once the PNG is on the clipboard. */
function writeClipboard(img: ImageBuf): Promise<boolean> {
  const data = img.data.slice();
  const done = pendingCopy.then(async () => {
    try {
      const png = await engine.codecs.encode('png', img.w, img.h, data, 100, engine.doc.dpi);
      await window.pigmento.clipboard.writeImage(png);
      return true;
    } catch {
      showToast({ kind: 'error', key: 'error.clipboard' });
      return false;
    }
  });
  pendingCopy = done.then(() => undefined);
  return done;
}

export async function copy(): Promise<void> {
  const img = engine.copyImage();
  if (img) await writeClipboard(img);
}

export async function cut(): Promise<void> {
  const img = engine.cut();
  if (img) await writeClipboard(img);
}

async function readClipboard(): Promise<ImageBuf | null> {
  await pendingCopy;
  let bytes: Uint8Array | null;
  try {
    bytes = await window.pigmento.clipboard.readImage();
  } catch {
    showToast({ kind: 'error', key: 'error.clipboard' });
    return null;
  }
  if (!bytes) {
    showToast({ kind: 'info', key: 'error.clipboardEmpty' });
    return null;
  }
  const img = await decode(bytes, 'clipboard');
  return img ? { w: img.w, h: img.h, data: img.data } : null;
}

/** Paste as a floating selection, offering to enlarge the canvas when needed. */
async function pasteBuffer(img: ImageBuf): Promise<void> {
  const { width, height } = engine.doc;
  if (img.w > width || img.h > height) {
    const answer = await new Promise<'enlarge' | 'keep' | null>((resolve) =>
      openDialog({ kind: 'pasteLarger', w: img.w, h: img.h, resolve }),
    );
    if (answer === null) return;
    if (answer === 'enlarge') {
      try {
        engine.ensureCanvasFits(img.w, img.h);
      } catch (err) {
        reportError(err);
        return;
      }
    }
  }
  engine.pasteImage(img);
}

export async function paste(): Promise<void> {
  const img = await readClipboard();
  if (img) await pasteBuffer(img);
}

export async function pasteAsNew(): Promise<void> {
  if (!(await confirmDiscard())) return;
  await pendingCopy;
  const bytes = await window.pigmento.clipboard.readImage().catch(() => null);
  if (!bytes) {
    showToast({ kind: 'info', key: 'error.clipboardEmpty' });
    return;
  }
  const img = await decode(bytes, 'clipboard');
  if (!img) return;
  try {
    engine.loadImage(img);
  } catch (err) {
    reportError(err);
    return;
  }
  useUi.setState({ file: { path: null, name: null, format: null } });
}

export async function pasteFromFile(): Promise<void> {
  const path = await window.pigmento.files.showOpenDialog();
  if (!path) return;
  const name = path.split(/[\\/]/).pop() ?? path;
  try {
    const { bytes } = await window.pigmento.files.read(path);
    const img = await decode(bytes, name);
    if (img) await pasteBuffer({ w: img.w, h: img.h, data: img.data });
  } catch {
    showToast({ kind: 'error', key: 'error.open', params: { name } });
  }
}

export async function openDroppedFile(file: File): Promise<void> {
  const path = await window.pigmento.files.pathForDroppedFile(file);
  if (!path) {
    showToast({ kind: 'error', key: 'error.open', params: { name: file.name } });
    return;
  }
  await openPath(path);
}

export function rememberExport(c: ExportChoice): void {
  const cur = useUi.getState().settings.export;
  updateSettings({
    export: {
      ...cur,
      format: c.format,
      scale: c.scale,
      resample: c.method,
      ...(c.format === 'jpeg' ? { jpegQuality: c.quality } : c.format === 'webp' ? { webpQuality: c.quality } : {}),
    },
  });
}

export async function rememberQuality(format: ImageFormat, q: number): Promise<void> {
  const cur = useUi.getState().settings.export;
  if (format === 'jpeg') updateSettings({ export: { ...cur, jpegQuality: q } });
  if (format === 'webp') updateSettings({ export: { ...cur, webpQuality: q } });
}
