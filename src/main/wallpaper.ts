import { app } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { WallpaperStyle } from '@shared/ipc';
import { atomicWrite } from './files';
import { buildSetWallpaperScript, runPowerShell } from './powershell';

/** Saves the PNG under %APPDATA%\Pigmento\wallpaper and applies it as the desktop background. */
export async function setWallpaper(png: Uint8Array, style: WallpaperStyle): Promise<void> {
  const dir = path.join(app.getPath('userData'), 'wallpaper');
  await fs.mkdir(dir, { recursive: true });
  // A fresh file name forces Windows to refresh its cached copy.
  for (const old of await fs.readdir(dir)) {
    if (old.endsWith('.png')) await fs.rm(path.join(dir, old), { force: true });
  }
  const file = path.join(dir, `wallpaper-${Date.now()}.png`);
  await atomicWrite(file, png);
  await runPowerShell(buildSetWallpaperScript(style), { PIGMENTO_WALLPAPER: file });
}
