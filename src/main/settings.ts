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

export async function loadSettings(): Promise<Settings> {
  if (current) return current;
  const raw = await readJsonFile(settingsFile());
  current = parseSettings(raw ?? {});
  return current;
}

export function getSettings(): Settings {
  if (!current) throw new Error('Settings not loaded');
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const merged = parseSettings({ ...getSettings(), ...patch });
  current = merged;
  scheduleWrite();
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
