import { app } from 'electron';
import path from 'node:path';
import { parseSettings, type Settings } from '@shared/settings';
import { atomicWrite, readJsonFile } from './files';

let current: Settings | null = null;
let writeTimer: NodeJS.Timeout | null = null;
let pendingWrite: Promise<void> = Promise.resolve();

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** Read settings straight from disk without caching (used by the standalone --mcp bridge). */
export async function readSettingsFresh(): Promise<Settings> {
  const raw = await readJsonFile(settingsFile());
  return parseSettings(raw ?? {});
}

export async function loadSettings(): Promise<Settings> {
  if (current) return current;
  current = await readSettingsFresh();
  return current;
}

export function getSettings(): Settings {
  if (!current) throw new Error('Settings not loaded');
  return current;
}

const listeners = new Set<(s: Settings) => void>();

/** Call fn with the settings each time they change. */
export function onSettingsChanged(fn: (s: Settings) => void): void {
  listeners.add(fn);
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const merged = parseSettings({ ...getSettings(), ...patch });
  current = merged;
  scheduleWrite();
  for (const fn of listeners) fn(merged);
  return merged;
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void flushSettings();
  }, 300);
}

export function flushSettings(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (!current) return pendingWrite;
  const snapshot = JSON.stringify(current, null, 2);
  pendingWrite = pendingWrite
    .then(() => atomicWrite(settingsFile(), snapshot))
    .catch((err: unknown) => console.error('Failed to write settings', err));
  return pendingWrite;
}
