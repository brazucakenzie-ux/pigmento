import type { ImageFormat } from './formats';
import type { Settings } from './settings';

/** IPC channel names. Main registers handlers, preload invokes them. */
export const IPC = {
  openDialog: 'files:open-dialog',
  saveDialog: 'files:save-dialog',
  readFile: 'files:read',
  writeFile: 'files:write',
  grantDropped: 'files:grant-dropped',
  clipboardRead: 'clipboard:read-image',
  clipboardWrite: 'clipboard:write-image',
  clipboardHas: 'clipboard:has-image',
  recentList: 'recent:list',
  recentAdd: 'recent:add',
  recentRemove: 'recent:remove',
  recentClear: 'recent:clear',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  confirmSave: 'window:confirm-save',
  showError: 'window:show-error',
  closeWindow: 'window:close',
  setOverlay: 'window:set-title-bar-overlay',
  toggleFullscreen: 'window:toggle-fullscreen',
  newWindow: 'window:new',
  getLaunchFile: 'window:get-launch-file',
  docState: 'window:doc-state',
  systemTheme: 'system:theme',
  print: 'system:print',
  wallpaper: 'system:wallpaper',
  appInfo: 'app:info',
  // main -> renderer events
  evCloseRequested: 'ev:close-requested',
  evOpenFile: 'ev:open-file',
  evThemeChanged: 'ev:theme-changed',
  evFullscreen: 'ev:fullscreen',
  evRecentChanged: 'ev:recent-changed',
} as const;

export interface OpenedFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

export interface SystemTheme {
  dark: boolean;
  highContrast: boolean;
  /** Windows accent colour as #rrggbb, or null if unavailable. */
  accent: string | null;
}

export type WallpaperStyle = 'fill' | 'fit' | 'stretch' | 'tile' | 'center';

export interface PrintRequest {
  png: Uint8Array;
  widthPx: number;
  heightPx: number;
  dpi: number;
  title: string;
}

export interface SaveDialogRequest {
  defaultName: string;
  format: ImageFormat;
}

export interface SaveDialogResult {
  path: string;
  format: ImageFormat;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  isE2E: boolean;
  isPackaged: boolean;
  userData: string;
}

export type Unsubscribe = () => void;

/** The API exposed on `window.pigmento` by the preload script. */
export interface PigmentoApi {
  files: {
    showOpenDialog(): Promise<string | null>;
    showSaveDialog(req: SaveDialogRequest): Promise<SaveDialogResult | null>;
    read(path: string): Promise<OpenedFile>;
    write(path: string, bytes: Uint8Array): Promise<void>;
    /** Resolve and grant a file dropped from Explorer; returns null if not openable. */
    pathForDroppedFile(file: File): Promise<string | null>;
  };
  clipboard: {
    readImage(): Promise<Uint8Array | null>;
    writeImage(png: Uint8Array): Promise<void>;
    hasImage(): Promise<boolean>;
  };
  recent: {
    list(): Promise<RecentFile[]>;
    add(path: string): Promise<void>;
    remove(path: string): Promise<void>;
    clear(): Promise<void>;
    onChanged(cb: (list: RecentFile[]) => void): Unsubscribe;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<void>;
  };
  window: {
    confirmSave(docName: string): Promise<'save' | 'discard' | 'cancel'>;
    showError(title: string, message: string): Promise<void>;
    close(): Promise<void>;
    setTitleBarOverlay(color: string, symbolColor: string, height: number): Promise<void>;
    toggleFullscreen(): Promise<boolean>;
    newWindow(): Promise<void>;
    getLaunchFile(): Promise<string | null>;
    /** Tells main whether this window holds work, so "Open with" can reuse blank windows. */
    setDocState(state: { dirty: boolean; hasFile: boolean }): void;
    onCloseRequested(cb: () => void): Unsubscribe;
    onOpenFile(cb: (path: string) => void): Unsubscribe;
    onFullscreenChanged(cb: (full: boolean) => void): Unsubscribe;
  };
  system: {
    getTheme(): Promise<SystemTheme>;
    onThemeChanged(cb: (t: SystemTheme) => void): Unsubscribe;
    print(req: PrintRequest): Promise<boolean>;
    setWallpaper(png: Uint8Array, style: WallpaperStyle): Promise<void>;
    appInfo(): Promise<AppInfo>;
  };
}
