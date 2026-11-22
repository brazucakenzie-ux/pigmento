import type { CustomBrushFile } from './brushFormat';
import type { CustomShapeFile } from './shapeFormat';
import type { AssetKind, OpenedAsset } from './assets';
import type { FileFormat } from './formats';
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
  requestClose: 'window:request-close',
  setOverlay: 'window:set-title-bar-overlay',
  toggleFullscreen: 'window:toggle-fullscreen',
  newWindow: 'window:new',
  getLaunchFile: 'window:get-launch-file',
  docState: 'window:doc-state',
  systemTheme: 'system:theme',
  print: 'system:print',
  wallpaper: 'system:wallpaper',
  appInfo: 'app:info',
  logError: 'log:error',
  memory: 'system:memory',
  autosaveRegister: 'autosave:register',
  autosaveWrite: 'autosave:write',
  autosaveClear: 'autosave:clear',
  autosaveList: 'autosave:list',
  autosaveRead: 'autosave:read',
  patternsList: 'patterns:list',
  patternsSave: 'patterns:save',
  patternsRemove: 'patterns:remove',
  assetOpen: 'asset:open',
  assetSave: 'asset:save',
  shapesList: 'shapes:list',
  shapesSave: 'shapes:save',
  shapesRemove: 'shapes:remove',
  brushesList: 'brushes:list',
  brushesSave: 'brushes:save',
  brushesRemove: 'brushes:remove',
  // main -> renderer events
  evCloseRequested: 'ev:close-requested',
  evOpenFile: 'ev:open-file',
  evNotice: 'ev:notice',
  evThemeChanged: 'ev:theme-changed',
  evFullscreen: 'ev:fullscreen',
  evRecentChanged: 'ev:recent-changed',
  assistantReply: 'assistant:reply',
  evAssistantCall: 'ev:assistant-call',
} as const;

/** A tool call from an AI assistant, for a window to carry out. */
export interface AssistantCall {
  id: number;
  tool: string;
  args: Record<string, unknown>;
  /** The assistant's name, as its client gives it. */
  client: string;
}

/** What an assistant gets back: words, data and pictures (PNG, base64). */
export interface AssistantResult {
  text?: string;
  data?: unknown;
  images?: { mimeType: 'image/png'; base64: string }[];
}

/** A window's answer to a tool call: what it did, or why it couldn't (in plain words). */
export type AssistantReply = { ok: true; result: AssistantResult } | { ok: false; error: string };

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
  format: FileFormat;
  /** Export: offer only `format` (an image format), titled "Export image". */
  exportOnly?: boolean;
}

export interface SaveDialogResult {
  path: string;
  format: FileFormat;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  isE2E: boolean;
  /** The first-run tour may show (always outside tests; in tests only when asked for). */
  firstRunTour: boolean;
  isPackaged: boolean;
  userData: string;
}

export interface AutosaveMeta {
  /** Document name shown in the recovery list. */
  name: string;
  /** File the document was last saved to, if any. */
  path: string | null;
}

export interface AutosaveEntry extends AutosaveMeta {
  id: string;
  savedAt: number;
  thumbnail: Uint8Array | null;
}

/** A fill pattern made from a selection, as stored on disk. */
export interface SavedPattern {
  id: string;
  name: string;
  png: Uint8Array;
}

export type Unsubscribe = () => void;

/** The API exposed on `window.pigmento` by the preload script. */
export interface PigmentoApi {
  files: {
    showOpenDialog(): Promise<string | null>;
    showSaveDialog(req: SaveDialogRequest): Promise<SaveDialogResult | null>;
    read(path: string): Promise<OpenedFile>;
    write(path: string, bytes: Uint8Array): Promise<void>;
    /** Pick and read a non-image file (SVG, shape pack, palette); null if cancelled. */
    openAsset(kind: AssetKind): Promise<OpenedAsset | null>;
    /** Save bytes as a non-image file through a Save dialog; resolves the path, or null. */
    saveAsset(kind: AssetKind, defaultName: string, bytes: Uint8Array): Promise<string | null>;
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
  /** AI assistants' tool calls (see main/mcp): carried out by the window, which answers each one. */
  assistant: {
    onCall(cb: (call: AssistantCall) => void): Unsubscribe;
    reply(id: number, reply: AssistantReply): void;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<void>;
  };
  window: {
    confirmSave(docName: string): Promise<'save' | 'discard' | 'cancel'>;
    showError(title: string, message: string): Promise<void>;
    /** Close for real (after the unsaved-changes check passed). */
    close(): Promise<void>;
    /** Ask to close, as if the title-bar X was clicked (runs the unsaved-changes check). */
    requestClose(): Promise<void>;
    setTitleBarOverlay(color: string, symbolColor: string, height: number): Promise<void>;
    /** Scale the whole interface (0.8–1.5). */
    setUiScale(scale: number): void;
    toggleFullscreen(): Promise<boolean>;
    newWindow(): Promise<void>;
    getLaunchFile(): Promise<string | null>;
    /** Tells main whether this window holds work, so "Open with" can reuse blank windows. */
    setDocState(state: { dirty: boolean; hasFile: boolean }): void;
    onCloseRequested(cb: () => void): Unsubscribe;
    onOpenFile(cb: (path: string) => void): Unsubscribe;
    onFullscreenChanged(cb: (full: boolean) => void): Unsubscribe;
  };
  autosave: {
    /** Claim a session id for this window (its autosave is never offered for recovery). */
    register(sessionId: string): Promise<void>;
    write(sessionId: string, project: Uint8Array, thumbnail: Uint8Array | null, meta: AutosaveMeta): Promise<void>;
    /** Remove this session's autosave (after a save or a clean close). */
    clear(sessionId: string): Promise<void>;
    /** Autosaves left by sessions that didn't close cleanly (offered once per app run). */
    list(): Promise<AutosaveEntry[]>;
    read(sessionId: string): Promise<Uint8Array>;
  };
  patterns: {
    list(): Promise<SavedPattern[]>;
    /** Store a PNG under a name; resolves the new id. */
    save(png: Uint8Array, name: string): Promise<string>;
    remove(id: string): Promise<void>;
  };
  /** Personal shapes made with the Shape Editor. */
  shapes: {
    list(): Promise<CustomShapeFile[]>;
    /** Add or replace one (by id). */
    save(shape: CustomShapeFile): Promise<void>;
    remove(id: string): Promise<void>;
  };
  /** Personal brushes made with the Brush Designer. */
  brushes: {
    list(): Promise<CustomBrushFile[]>;
    /** Add or replace one (by id). */
    save(brush: CustomBrushFile): Promise<void>;
    remove(id: string): Promise<void>;
  };
  system: {
    getTheme(): Promise<SystemTheme>;
    onThemeChanged(cb: (t: SystemTheme) => void): Unsubscribe;
    print(req: PrintRequest): Promise<boolean>;
    setWallpaper(png: Uint8Array, style: WallpaperStyle): Promise<void>;
    appInfo(): Promise<AppInfo>;
    /** Memory the system has (bytes): free now, and in all. */
    memory(): Promise<{ free: number; total: number }>;
    /** Record an error in the app's log. */
    logError(where: string, message: string): void;
    /** A notice from the main process (e.g. it hit an error). */
    onNotice(cb: (n: { kind: 'error' | 'info'; key: string }) => void): Unsubscribe;
  };
}
