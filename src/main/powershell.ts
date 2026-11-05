import { execFile } from 'node:child_process';
import type { WallpaperStyle } from '@shared/ipc';

/** Registry values under HKCU\Control Panel\Desktop for each style. */
export const WALLPAPER_STYLES: Record<WallpaperStyle, { style: string; tile: string }> = {
  fill: { style: '10', tile: '0' },
  fit: { style: '6', tile: '0' },
  stretch: { style: '2', tile: '0' },
  tile: { style: '0', tile: '1' },
  center: { style: '0', tile: '0' },
};

const PINVOKE = `Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PigmentoWallpaper {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "SystemParametersInfoW")]
  public static extern bool SystemParametersInfoGet(int uAction, int uParam, StringBuilder lpvParam, int fuWinIni);
}
"@`;

/** PowerShell that applies the wallpaper at $env:PIGMENTO_WALLPAPER with the given style. */
export function buildSetWallpaperScript(style: WallpaperStyle): string {
  const s = WALLPAPER_STYLES[style];
  return [
    "$ErrorActionPreference = 'Stop'",
    PINVOKE,
    `Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '${s.style}'`,
    `Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '${s.tile}'`,
    // SPI_SETDESKWALLPAPER = 0x14, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3
    'if (-not [PigmentoWallpaper]::SystemParametersInfo(0x14, 0, $env:PIGMENTO_WALLPAPER, 3)) { throw "SystemParametersInfo failed" }',
  ].join('\n');
}

/** Read-only query (SPI_GETDESKWALLPAPER) used to verify the P/Invoke path works. */
export function buildQueryWallpaperScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    PINVOKE,
    '$sb = New-Object System.Text.StringBuilder 520',
    'if (-not [PigmentoWallpaper]::SystemParametersInfoGet(0x73, 520, $sb, 0)) { throw "query failed" }',
    'Write-Output $sb.ToString()',
  ].join('\n');
}

export function runPowerShell(script: string, env: Record<string, string> = {}): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout.trim());
      },
    );
  });
}
