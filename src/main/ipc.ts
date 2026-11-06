import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import { FILE_FORMATS, OPENABLE_EXTENSIONS, isOpenablePath, type FileFormat } from '@shared/formats';
import {
  IPC,
  type AppInfo,
  type OpenedFile,
  type PrintRequest,
  type SaveDialogRequest,
  type SaveDialogResult,
  type WallpaperStyle,
} from '@shared/ipc';
import type { Settings } from '@shared/settings';
import { atomicWrite, grantPath, isGranted, readImageFile, validatePathArg } from './files';
import { tm, type MainStringKey } from './i18n';
import { printImage } from './print';
import { addRecent, clearRecent, getRecent, removeRecent } from './recent';
import { getSettings, updateSettings } from './settings';
import { setWallpaper } from './wallpaper';
import { clearAutosave, listRecoverable, readAutosave, registerSession, releaseSession, writeAutosave } from './autosave';
import {
  TOP_BAR_HEIGHT,
  allowCloseAndClose,
  createWindow,
  markWindowUsed,
  systemTheme,
  windowState,
} from './windows';

const MAX_WRITE_BYTES = 2048 * 1024 * 1024;
const WALLPAPER_STYLE_SET = new Set<WallpaperStyle>(['fill', 'fit', 'stretch', 'tile', 'center']);

function senderWindow(e: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) throw new Error('No window for sender');
  return win;
}

function bytesArg(v: unknown, max: number): Uint8Array {
  if (!(v instanceof Uint8Array)) throw new Error('Expected bytes');
  if (v.byteLength > max) throw new Error('Data too large');
  return v;
}

function isFormat(v: unknown): v is FileFormat {
  return typeof v === 'string' && v in FILE_FORMATS;
}

export function registerIpc(): void {
  ipcMain.handle(IPC.openDialog, async (e) => {
    const win = senderWindow(e);
    const res = await dialog.showOpenDialog(win, {
      title: tm('dialog.open.title'),
      properties: ['openFile'],
      defaultPath: getSettings().export.lastFolder,
      filters: [
        { name: tm('dialog.filter.images'), extensions: OPENABLE_EXTENSIONS },
        ...Object.values(FILE_FORMATS).map((f) => ({
          name: tm(f.labelKey as MainStringKey),
          extensions: f.extensions,
        })),
        { name: tm('dialog.filter.all'), extensions: ['*'] },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const p = res.filePaths[0];
    grantPath(p);
    updateSettings({ export: { ...getSettings().export, lastFolder: path.dirname(p) } });
    return p;
  });

  ipcMain.handle(IPC.saveDialog, async (e, req: SaveDialogRequest): Promise<SaveDialogResult | null> => {
    const win = senderWindow(e);
    if (!req || typeof req.defaultName !== 'string' || !isFormat(req.format)) {
      throw new Error('Invalid save request');
    }
    const exportOnly = req.exportOnly === true;
    if (exportOnly && req.format === 'pigm') throw new Error('Invalid export request');
    const order: FileFormat[] = exportOnly
      ? [req.format]
      : [req.format, ...(Object.keys(FILE_FORMATS) as FileFormat[]).filter((f) => f !== req.format)];
    const base = path.basename(req.defaultName).replace(/[<>:"/\\|?*]/g, '_') || 'Untitled';
    const folder = getSettings().export.lastFolder ?? app.getPath('pictures');
    const res = await dialog.showSaveDialog(win, {
      title: tm(exportOnly ? 'dialog.export.title' : 'dialog.save.title'),
      defaultPath: path.join(folder, base),
      filters: order.map((f) => ({
        name: tm(FILE_FORMATS[f].labelKey as MainStringKey),
        extensions: FILE_FORMATS[f].extensions,
      })),
      properties: ['showOverwriteConfirmation'],
    });
    if (res.canceled || !res.filePath) return null;
    let p = res.filePath;
    let format = order[0];
    const ext = path.extname(p).slice(1).toLowerCase();
    // An export was set up for one format, so its file always gets that format's extension.
    const byExt = exportOnly
      ? FILE_FORMATS[format].extensions.includes(ext)
        ? format
        : null
      : (Object.values(FILE_FORMATS).find((f) => f.extensions.includes(ext)) ?? null)?.id;
    if (byExt) format = byExt;
    else p = `${p}.${FILE_FORMATS[format].extensions[0]}`;
    grantPath(p);
    updateSettings({ export: { ...getSettings().export, lastFolder: path.dirname(p) } });
    return { path: p, format };
  });

  ipcMain.handle(IPC.readFile, async (e, rawPath: unknown): Promise<OpenedFile> => {
    const p = validatePathArg(rawPath);
    if (!isGranted(p)) throw new Error('Access to this file was not granted');
    const bytes = await readImageFile(p);
    markWindowUsed(senderWindow(e));
    return { path: p, name: path.basename(p), bytes };
  });

  ipcMain.handle(IPC.writeFile, async (_e, rawPath: unknown, data: unknown) => {
    const p = validatePathArg(rawPath);
    if (!isGranted(p)) throw new Error('Access to this file was not granted');
    if (!isOpenablePath(p)) throw new Error('Unsupported file type');
    await atomicWrite(p, bytesArg(data, MAX_WRITE_BYTES));
  });

  ipcMain.handle(IPC.grantDropped, (_e, rawPath: unknown) => {
    const p = validatePathArg(rawPath);
    if (!isOpenablePath(p)) return null;
    grantPath(p);
    return p;
  });

  ipcMain.handle(IPC.clipboardRead, async () => {
    const items = await clipboard.read();
    for (const item of items) {
      const type =
        item.types.find((t) => t === 'image/png') ?? item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      if (!(blob instanceof Blob)) continue;
      return new Uint8Array(await blob.arrayBuffer());
    }
    return null;
  });

  ipcMain.handle(IPC.clipboardWrite, async (_e, data: unknown) => {
    const png = bytesArg(data, MAX_WRITE_BYTES);
    const blob = new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });

  ipcMain.handle(IPC.clipboardHas, async () => {
    const items = await clipboard.read();
    return items.some((i) => i.types.some((t) => t.startsWith('image/')));
  });

  ipcMain.handle(IPC.recentList, () => getRecent());
  ipcMain.handle(IPC.recentAdd, async (_e, rawPath: unknown) => {
    const p = validatePathArg(rawPath);
    if (!isGranted(p)) throw new Error('Access to this file was not granted');
    await addRecent(p);
  });
  ipcMain.handle(IPC.recentRemove, async (_e, rawPath: unknown) => {
    await removeRecent(validatePathArg(rawPath));
  });
  ipcMain.handle(IPC.recentClear, () => clearRecent());

  ipcMain.handle(IPC.settingsGet, () => getSettings());
  ipcMain.handle(IPC.settingsSet, (_e, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) throw new Error('Invalid settings patch');
    const { window: _ignored, ...rest } = patch as Partial<Settings>;
    updateSettings(rest);
  });

  ipcMain.handle(IPC.confirmSave, async (e, docName: unknown) => {
    const win = senderWindow(e);
    const name = typeof docName === 'string' ? docName : 'Untitled';
    const res = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Pigmento',
      message: tm('dialog.unsaved.message', { name }),
      detail: tm('dialog.unsaved.detail'),
      buttons: [tm('dialog.unsaved.save'), tm('dialog.unsaved.discard'), tm('dialog.unsaved.cancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return (['save', 'discard', 'cancel'] as const)[res.response] ?? 'cancel';
  });

  ipcMain.handle(IPC.showError, async (e, title: unknown, message: unknown) => {
    const win = senderWindow(e);
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Pigmento',
      message: String(title ?? ''),
      detail: String(message ?? ''),
      buttons: [tm('dialog.ok')],
      noLink: true,
    });
  });

  ipcMain.handle(IPC.closeWindow, (e) => allowCloseAndClose(senderWindow(e)));
  ipcMain.handle(IPC.requestClose, (e) => senderWindow(e).close());

  ipcMain.handle(IPC.setOverlay, (e, color: unknown, symbolColor: unknown, height: unknown) => {
    const win = senderWindow(e);
    const css = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
    if (typeof color !== 'string' || !css.test(color)) return;
    if (typeof symbolColor !== 'string' || !css.test(symbolColor)) return;
    const h = typeof height === 'number' && height >= 24 && height <= 120 ? Math.round(height) : TOP_BAR_HEIGHT;
    win.setTitleBarOverlay({ color, symbolColor, height: h });
    win.setBackgroundColor(color.slice(0, 7));
  });

  ipcMain.handle(IPC.toggleFullscreen, (e) => {
    const win = senderWindow(e);
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });

  ipcMain.handle(IPC.newWindow, () => {
    createWindow(null);
  });

  ipcMain.handle(IPC.getLaunchFile, (e) => {
    const s = windowState(senderWindow(e));
    const f = s?.launchFile ?? null;
    if (s) s.launchFile = null;
    return f;
  });

  ipcMain.on(IPC.docState, (e, st: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || typeof st !== 'object' || st === null) return;
    const { dirty, hasFile } = st as { dirty?: unknown; hasFile?: unknown };
    if (dirty === true || hasFile === true) markWindowUsed(win);
  });

  ipcMain.handle(IPC.systemTheme, () => systemTheme());

  ipcMain.handle(IPC.print, async (e, req: PrintRequest) => {
    const win = senderWindow(e);
    if (!req || typeof req.widthPx !== 'number' || typeof req.heightPx !== 'number') {
      throw new Error('Invalid print request');
    }
    const dpi = typeof req.dpi === 'number' && req.dpi > 0 ? req.dpi : 96;
    return printImage(win, {
      png: bytesArg(req.png, MAX_WRITE_BYTES),
      widthPx: req.widthPx,
      heightPx: req.heightPx,
      dpi,
      title: typeof req.title === 'string' ? req.title : 'Pigmento',
    });
  });

  ipcMain.handle(IPC.wallpaper, async (_e, png: unknown, style: unknown) => {
    if (typeof style !== 'string' || !WALLPAPER_STYLE_SET.has(style as WallpaperStyle)) {
      throw new Error('Invalid wallpaper style');
    }
    await setWallpaper(bytesArg(png, MAX_WRITE_BYTES), style as WallpaperStyle);
  });

  ipcMain.handle(IPC.autosaveRegister, (e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid session id');
    registerSession(id);
    // A window that goes away for any reason stops owning its session.
    e.sender.once('destroyed', () => releaseSession(id));
  });
  ipcMain.handle(IPC.autosaveWrite, async (_e, id: unknown, project: unknown, thumb: unknown, meta: unknown) => {
    if (typeof id !== 'string' || typeof meta !== 'object' || meta === null) throw new Error('Invalid autosave');
    const m = meta as { name?: unknown; path?: unknown };
    await writeAutosave(id, bytesArg(project, MAX_WRITE_BYTES), thumb === null ? null : bytesArg(thumb, 16 * 1024 * 1024), {
      name: typeof m.name === 'string' ? m.name : '',
      path: typeof m.path === 'string' ? m.path : null,
    });
  });
  ipcMain.handle(IPC.autosaveClear, async (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid session id');
    await clearAutosave(id);
  });
  ipcMain.handle(IPC.autosaveList, () => listRecoverable());
  ipcMain.handle(IPC.autosaveRead, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid session id');
    return readAutosave(id);
  });

  ipcMain.handle(
    IPC.appInfo,
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      isE2E: process.env.PIGMENTO_E2E === '1',
      isPackaged: app.isPackaged,
      userData: app.getPath('userData'),
    }),
  );
}
