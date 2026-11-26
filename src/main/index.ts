import { app, BrowserWindow, Menu, nativeTheme, systemPreferences } from 'electron';
import path from 'node:path';
import { parseLaunchArgs } from './args';
import { grantPath } from './files';
import { registerIpc } from './ipc';
import { handleAppProtocol, registerSchemes } from './protocol';
import { loadRecent, onRecentChanged, pruneRecent } from './recent';
import { applySecurityPolicy } from './security';
import { flushSettings, getSettings, loadSettings, onSettingsChanged, readSettingsFresh } from './settings';
import { AssistantHost } from './mcp/server';
import { IPC } from '@shared/ipc';
import { broadcastTheme, createWindow, openFileInApp } from './windows';
import { installErrorHandlers } from './errors';
import { spawn } from 'node:child_process';
import { MCP_SWITCH, mcpPipeName, runBridge, stdinStream } from './mcp/bridge';

const userDataOverride = process.env.PIGMENTO_USER_DATA;
app.setName('Pigmento');
app.setPath('userData', userDataOverride ?? path.join(app.getPath('appData'), 'Pigmento'));
if (process.platform === 'win32') app.setAppUserModelId('app.pigmento.desktop');

// Started by an MCP client: be its bridge to the Pigmento that's running (staying in standby until
// a tool is used when openOnDemand is on, or starting Pigmento right away when it's off), with no
// window and without the one-app lock, until the client ends the conversation.
const bridging = process.argv.includes(MCP_SWITCH);
if (bridging) {
  const start = () => spawn(process.execPath, app.isPackaged ? [] : [app.getAppPath()], { detached: true, stdio: 'ignore', env: process.env }).unref();
  const io = { input: stdinStream(), output: process.stdout, error: (m: string) => void process.stderr.write(`${m}\n`) };
  void readSettingsFresh()
    .then((s) =>
      runBridge(mcpPipeName(app.getPath('userData')), io, start, {
        onDemand: s.assistants.openOnDemand
          ? {
              version: app.getVersion(),
              canStart: async () => (await readSettingsFresh()).assistants.enabled,
            }
          : undefined,
      }),
    )
    .then((code) => app.exit(code));
} else {
  registerSchemes();
  installErrorHandlers();
}
const gotLock = !bridging && app.requestSingleInstanceLock();
if (bridging) {
  // The bridge runs on its own (above).
} else if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, cwd) => {
    const { files, newWindow } = parseLaunchArgs(argv, cwd);
    for (const f of files) {
      grantPath(f);
      openFileInApp(f);
    }
    if (files.length === 0) {
      if (newWindow || BrowserWindow.getAllWindows().length === 0) createWindow(null);
      else {
        const win = BrowserWindow.getAllWindows()[0];
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    }
  });

  app.on('window-all-closed', () => {
    void flushSettings().then(() => app.quit());
  });

  app.on('before-quit', () => {
    void flushSettings();
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    applySecurityPolicy(app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL);
    handleAppProtocol(path.join(__dirname, '../renderer'));
    await loadSettings();
    // AI assistants (MCP): listening as the settings say, and again whenever they change.
    const assistants = new AssistantHost(mcpPipeName(app.getPath('userData')), app.getVersion());
    assistants.apply(getSettings().assistants);
    let last = JSON.stringify(getSettings().assistants);
    onSettingsChanged((s) => {
      const now = JSON.stringify(s.assistants);
      if (now === last) return;
      last = now;
      assistants.apply(s.assistants);
    });
    app.on('will-quit', () => assistants.close());
    await loadRecent();
    void pruneRecent();
    registerIpc();

    onRecentChanged((list) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evRecentChanged, list);
    });
    nativeTheme.on('updated', broadcastTheme);
    systemPreferences.on('accent-color-changed', broadcastTheme);

    const { files } = parseLaunchArgs(process.argv, process.cwd());
    if (files.length === 0) createWindow(null);
    for (const f of files) {
      grantPath(f);
      createWindow(f);
    }
  });
}
