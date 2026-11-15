import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { IPC } from '@shared/ipc';
import { createLog } from './log';
import { tm } from './i18n';

let log: ReturnType<typeof createLog> | null = null;

/** Write an error to the log in %APPDATA%\Pigmento\logs. */
export function logError(where: string, err: unknown): Promise<void> {
  log ??= createLog(path.join(app.getPath('userData'), 'logs'));
  return log.write(where, err);
}

/** Something went wrong in the main process: log it, and tell the user in plain words. */
function report(err: unknown): void {
  void logError('main', err);
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.isCrashed());
  if (win) win.webContents.send(IPC.evNotice, { kind: 'error', key: 'error.internal' });
  else dialog.showErrorBox(tm('error.title'), tm('error.internal'));
}

/** Catch what would otherwise go unnoticed in the main process. */
export function installErrorHandlers(): void {
  process.on('uncaughtException', report);
  process.on('unhandledRejection', report);
}

/** A window's page crashed or stopped answering: log it and offer to bring it back. */
export function watchWindow(win: BrowserWindow): void {
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    void logError('window', `The window's page stopped (${details.reason}, exit code ${details.exitCode})`);
    if (win.isDestroyed()) return;
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: tm('error.title'),
        message: tm('error.windowGone'),
        detail: tm('error.windowGoneDetail'),
        buttons: [tm('error.reload'), tm('error.closeWindow')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (win.isDestroyed()) return;
        if (response === 0) win.webContents.reload();
        else win.destroy();
      });
  });
  win.on('unresponsive', () => {
    void logError('window', 'The window stopped responding');
    if (win.isDestroyed()) return;
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: tm('error.title'),
        message: tm('error.unresponsive'),
        detail: tm('error.unresponsiveDetail'),
        buttons: [tm('error.wait'), tm('error.reload')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 1 && !win.isDestroyed()) win.webContents.forcefullyCrashRenderer();
      });
  });
}
