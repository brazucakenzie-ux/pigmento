import { BrowserWindow } from 'electron';
import type { PrintRequest } from '@shared/ipc';
import { registerPrintPage, releasePrintPage } from './protocol';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Prints the flattened image through the Windows print dialog. The image is shown at its
 * physical size (from DPI) and scaled down to fit the page when larger.
 */
export async function printImage(parent: BrowserWindow | null, req: PrintRequest): Promise<boolean> {
  const widthIn = req.widthPx / req.dpi;
  const heightIn = req.heightPx / req.dpi;
  const url = registerPrintPage(
    (img) => `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(req.title)}</title>
<style>
  @page { margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page { width: 100%; height: 100vh; display: flex; align-items: flex-start; justify-content: center; }
  img { width: ${widthIn}in; height: ${heightIn}in; max-width: 100%; max-height: 100vh; object-fit: contain; image-rendering: auto; }
</style></head><body><div class="page"><img src="${img}" alt=""></div></body></html>`,
    req.png,
  );

  const win = new BrowserWindow({
    show: false,
    parent: parent ?? undefined,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL(url);
    return await new Promise<boolean>((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (success) => resolve(success));
    });
  } finally {
    releasePrintPage(url);
    if (!win.isDestroyed()) win.destroy();
  }
}
