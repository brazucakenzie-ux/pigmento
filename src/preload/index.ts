import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type AssistantCall, type PigmentoApi, type RecentFile, type SystemTheme } from '@shared/ipc';

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: PigmentoApi = {
  files: {
    showOpenDialog: () => ipcRenderer.invoke(IPC.openDialog),
    showSaveDialog: (req) => ipcRenderer.invoke(IPC.saveDialog, req),
    read: (path) => ipcRenderer.invoke(IPC.readFile, path),
    write: (path, bytes) => ipcRenderer.invoke(IPC.writeFile, path, bytes),
    openAsset: (kind) => ipcRenderer.invoke(IPC.assetOpen, kind),
    saveAsset: (kind, name, bytes) => ipcRenderer.invoke(IPC.assetSave, kind, name, bytes),
    pathForDroppedFile: async (file) => {
      const p = webUtils.getPathForFile(file);
      if (!p) return null;
      return ipcRenderer.invoke(IPC.grantDropped, p);
    },
  },
  clipboard: {
    readImage: () => ipcRenderer.invoke(IPC.clipboardRead),
    writeImage: (png) => ipcRenderer.invoke(IPC.clipboardWrite, png),
    hasImage: () => ipcRenderer.invoke(IPC.clipboardHas),
  },
  recent: {
    list: () => ipcRenderer.invoke(IPC.recentList),
    add: (path) => ipcRenderer.invoke(IPC.recentAdd, path),
    remove: (path) => ipcRenderer.invoke(IPC.recentRemove, path),
    clear: () => ipcRenderer.invoke(IPC.recentClear),
    onChanged: (cb) => subscribe<[RecentFile[]]>(IPC.evRecentChanged, cb),
  },
  assistant: {
    onCall: (cb) => subscribe<[AssistantCall]>(IPC.evAssistantCall, cb),
    reply: (id, reply) => ipcRenderer.send(IPC.assistantReply, id, reply),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  },
  window: {
    confirmSave: (name) => ipcRenderer.invoke(IPC.confirmSave, name),
    showError: (title, message) => ipcRenderer.invoke(IPC.showError, title, message),
    close: () => ipcRenderer.invoke(IPC.closeWindow),
    requestClose: () => ipcRenderer.invoke(IPC.requestClose),
    setUiScale: (scale) => {
      if (typeof scale === 'number' && Number.isFinite(scale)) webFrame.setZoomFactor(Math.min(2, Math.max(0.8, scale)));
    },
    setTitleBarOverlay: (color, symbolColor, height) =>
      ipcRenderer.invoke(IPC.setOverlay, color, symbolColor, height),
    toggleFullscreen: () => ipcRenderer.invoke(IPC.toggleFullscreen),
    newWindow: () => ipcRenderer.invoke(IPC.newWindow),
    getLaunchFile: () => ipcRenderer.invoke(IPC.getLaunchFile),
    setDocState: (st) => ipcRenderer.send(IPC.docState, st),
    onCloseRequested: (cb) => subscribe(IPC.evCloseRequested, cb),
    onOpenFile: (cb) => subscribe<[string]>(IPC.evOpenFile, cb),
    onFullscreenChanged: (cb) => subscribe<[boolean]>(IPC.evFullscreen, cb),
  },
  autosave: {
    register: (id) => ipcRenderer.invoke(IPC.autosaveRegister, id),
    write: (id, project, thumbnail, meta) => ipcRenderer.invoke(IPC.autosaveWrite, id, project, thumbnail, meta),
    clear: (id) => ipcRenderer.invoke(IPC.autosaveClear, id),
    list: () => ipcRenderer.invoke(IPC.autosaveList),
    read: (id) => ipcRenderer.invoke(IPC.autosaveRead, id),
  },
  patterns: {
    list: () => ipcRenderer.invoke(IPC.patternsList),
    save: (png, name) => ipcRenderer.invoke(IPC.patternsSave, png, name),
    remove: (id) => ipcRenderer.invoke(IPC.patternsRemove, id),
  },
  shapes: {
    list: () => ipcRenderer.invoke(IPC.shapesList),
    save: (shape) => ipcRenderer.invoke(IPC.shapesSave, shape),
    remove: (id) => ipcRenderer.invoke(IPC.shapesRemove, id),
  },
  brushes: {
    list: () => ipcRenderer.invoke(IPC.brushesList),
    save: (brush) => ipcRenderer.invoke(IPC.brushesSave, brush),
    remove: (id) => ipcRenderer.invoke(IPC.brushesRemove, id),
  },
  system: {
    getTheme: () => ipcRenderer.invoke(IPC.systemTheme),
    onThemeChanged: (cb) => subscribe<[SystemTheme]>(IPC.evThemeChanged, cb),
    print: (req) => ipcRenderer.invoke(IPC.print, req),
    setWallpaper: (png, style) => ipcRenderer.invoke(IPC.wallpaper, png, style),
    appInfo: () => ipcRenderer.invoke(IPC.appInfo),
    memory: () => ipcRenderer.invoke(IPC.memory),
    logError: (where, message) => ipcRenderer.send(IPC.logError, String(where).slice(0, 80), String(message).slice(0, 8000)),
    onNotice: (cb) => subscribe<[{ kind: 'error' | 'info'; key: string }]>(IPC.evNotice, cb),
  },
};

contextBridge.exposeInMainWorld('pigmento', api);
