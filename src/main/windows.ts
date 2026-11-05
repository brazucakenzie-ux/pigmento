import { app, BrowserWindow, nativeTheme, screen, systemPreferences } from 'electron';
import path from 'node:path';
import { IPC, type SystemTheme } from '@shared/ipc';
import { APP_ORIGIN } from './protocol';
import { getSettings, updateSettings } from './settings';

export const TOP_BAR_HEIGHT = 40;

interface WindowState {
  launchFile: string | null;
  allowClose: boolean;
  /** True once the renderer has loaded something other than an untouched blank doc. */
  used: boolean;
}

const state = new WeakMap<BrowserWindow, WindowState>();

export function windowState(win: BrowserWindow): WindowState | undefined {
  return state.get(win);
}

export function markWindowUsed(win: BrowserWindow): void {
  const s = state.get(win);
  if (s) s.used = true;
}

export function systemTheme(): SystemTheme {
  let accent: string | null = null;
  try {
    const raw = systemPreferences.getAccentColor(); // RRGGBBAA
    if (/^[0-9a-f]{6,8}$/i.test(raw)) accent = `#${raw.slice(0, 6).toLowerCase()}`;
  } catch {
    accent = null;
  }
  return {
    dark: nativeTheme.shouldUseDarkColors,
    highContrast: nativeTheme.shouldUseHighContrastColors,
    accent,
  };
}

function chromeColors(): { bg: string; fg: string } {
  return nativeTheme.shouldUseDarkColors
    ? { bg: '#1a1922', fg: '#ecebf5' }
    : { bg: '#f3f2f9', fg: '#1d1b2b' };
}

function iconPath(): string {
  return path.join(app.getAppPath(), 'resources', 'icon.png');
}

function clampBounds(b: { x?: number; y?: number; width: number; height: number }) {
  if (b.x === undefined || b.y === undefined) return { width: b.width, height: b.height };
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x! < a.x + a.width - 80 && b.x! + b.width > a.x + 80 && b.y! >= a.y - 10 && b.y! < a.y + a.height - 80;
  });
  return visible ? b : { width: b.width, height: b.height };
}

export function createWindow(launchFile: string | null): BrowserWindow {
  const saved = getSettings().window;
  const colors = chromeColors();
  const cascade = BrowserWindow.getAllWindows().length * 28;
  const bounds = clampBounds(saved);
  const win = new BrowserWindow({
    ...bounds,
    ...(bounds.x !== undefined && cascade
      ? { x: (bounds.x ?? 0) + cascade, y: (bounds.y ?? 0) + cascade }
      : {}),
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Pigmento',
    icon: iconPath(),
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: TOP_BAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.PIGMENTO_E2E === '1',
    },
  });
  state.set(win, { launchFile, allowClose: false, used: launchFile !== null });

  win.once('ready-to-show', () => {
    if (saved.maximized && BrowserWindow.getAllWindows().length === 1) win.maximize();
    win.show();
  });

  win.on('close', (event) => {
    const s = state.get(win);
    if (s?.allowClose) {
      saveBounds(win);
      return;
    }
    if (win.webContents.isCrashed()) return;
    event.preventDefault();
    win.webContents.send(IPC.evCloseRequested);
  });

  win.on('enter-full-screen', () => win.webContents.send(IPC.evFullscreen, true));
  win.on('leave-full-screen', () => win.webContents.send(IPC.evFullscreen, false));

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

function saveBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isFullScreen()) return;
  const maximized = win.isMaximized();
  const b = maximized ? win.getNormalBounds() : win.getBounds();
  updateSettings({
    window: { x: b.x, y: b.y, width: b.width, height: b.height, maximized },
  });
}

export function allowCloseAndClose(win: BrowserWindow): void {
  const s = state.get(win);
  if (s) s.allowClose = true;
  win.close();
}

/** Open a file from argv / jump list / second instance: reuse an unused window, else a new one. */
export function openFileInApp(file: string): void {
  const wins = BrowserWindow.getAllWindows();
  const reusable = wins.find((w) => !state.get(w)?.used);
  if (reusable) {
    markWindowUsed(reusable);
    reusable.webContents.send(IPC.evOpenFile, file);
    if (reusable.isMinimized()) reusable.restore();
    reusable.focus();
    return;
  }
  createWindow(file);
}

export function broadcastTheme(): void {
  const t = systemTheme();
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evThemeChanged, t);
}
