import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicWrite, readJsonFile } from '../../src/main/files';
import { parseLaunchArgs } from '../../src/main/args';
import { buildQueryWallpaperScript, buildSetWallpaperScript, runPowerShell, WALLPAPER_STYLES } from '../../src/main/powershell';
import { defaultSettings, parseSettings } from '../../src/shared/settings';
import { formatFromPath } from '../../src/shared/formats';

describe('atomicWrite', () => {
  it('writes, replaces and leaves no temp files', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pigmento-atomic-'));
    const file = path.join(dir, 'nested', 'settings.json');
    await atomicWrite(file, '{"a":1}');
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}');
    await atomicWrite(file, new Uint8Array([1, 2, 3]));
    expect([...readFileSync(file)]).toEqual([1, 2, 3]);
    expect(readdirSync(path.dirname(file))).toEqual(['settings.json']);
  });

  it('moves corrupt JSON aside instead of overwriting it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pigmento-json-'));
    const file = path.join(dir, 'broken.json');
    writeFileSync(file, '{not json');
    expect(await readJsonFile(file)).toBeUndefined();
    expect(readdirSync(dir).some((f) => f.startsWith('broken.json.corrupt-'))).toBe(true);
    expect(await readJsonFile(path.join(dir, 'missing.json'))).toBeUndefined();
  });
});

describe('launch arguments', () => {
  it('picks existing image files and ignores switches and folders', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pigmento-args-'));
    const img = path.join(dir, 'Cat Photo.PNG');
    writeFileSync(img, 'x');
    const txt = path.join(dir, 'notes.txt');
    writeFileSync(txt, 'x');
    const r = parseLaunchArgs(['electron.exe', dir, '--allow-file-access', img, txt, path.join(dir, 'missing.jpg')], dir);
    expect(r.files).toEqual([img]);
    expect(r.newWindow).toBe(false);
    expect(parseLaunchArgs(['pigmento.exe', '--new-window'], dir).newWindow).toBe(true);
    // Relative paths resolve against the working directory of the second instance.
    expect(parseLaunchArgs(['pigmento.exe', 'Cat Photo.PNG'], dir).files).toEqual([img]);
  });

  it('maps file extensions to formats', () => {
    expect(formatFromPath('C:\\a\\b.JPEG')).toBe('jpeg');
    expect(formatFromPath('x.jfif')).toBe('jpeg');
    expect(formatFromPath('x.webp')).toBe('webp');
    expect(formatFromPath('x.psd')).toBeNull();
  });
});

describe('settings', () => {
  it('falls back to defaults per section for invalid data', () => {
    const s = parseSettings({ theme: 'neon', view: { rulers: true }, colors: { primary: 'red' } });
    expect(s.theme).toBe('system');
    expect(s.view.rulers).toBe(true);
    expect(s.colors).toEqual(defaultSettings().colors);
    expect(parseSettings(null)).toEqual(defaultSettings());
  });
});

describe('wallpaper (Windows)', () => {
  it('builds a script per style with the expected registry values', () => {
    for (const style of Object.keys(WALLPAPER_STYLES) as (keyof typeof WALLPAPER_STYLES)[]) {
      const s = buildSetWallpaperScript(style);
      expect(s).toContain(`-Name WallpaperStyle -Value '${WALLPAPER_STYLES[style].style}'`);
      expect(s).toContain('SystemParametersInfo(0x14');
      expect(s).toContain('$env:PIGMENTO_WALLPAPER');
    }
  });

  it.runIf(process.platform === 'win32')('runs the P/Invoke through PowerShell (read-only query)', async () => {
    // SPI_GETDESKWALLPAPER: proves Add-Type + user32 interop work without changing anything.
    const current = await runPowerShell(buildQueryWallpaperScript());
    expect(typeof current).toBe('string');
  });
});
