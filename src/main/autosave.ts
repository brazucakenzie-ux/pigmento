import { app } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { AutosaveEntry, AutosaveMeta } from '@shared/ipc';
import { atomicWrite } from './files';

/**
 * Crash recovery. Each window has a session id; while it has unsaved work the renderer writes
 * `<id>.pigm` (+ `.json` meta, `.png` thumbnail) here. A clean close removes them, so files
 * left behind at the next start belong to a session that crashed.
 */
const MetaSchema = z.object({
  name: z.string().max(260),
  path: z.string().max(32767).nullable(),
  savedAt: z.number(),
});

const SESSION = /^[a-f0-9-]{16,64}$/;

/** Sessions owned by windows that are open right now (never offered for recovery). */
const live = new Set<string>();
let offered = false;

function dir(): string {
  return path.join(app.getPath('userData'), 'autosave');
}

function file(id: string, ext: 'pigm' | 'json' | 'png'): string {
  if (!SESSION.test(id)) throw new Error('Invalid session id');
  return path.join(dir(), `${id}.${ext}`);
}

export function registerSession(id: string): void {
  if (!SESSION.test(id)) throw new Error('Invalid session id');
  live.add(id);
}

export function releaseSession(id: string): void {
  live.delete(id);
}

export async function writeAutosave(id: string, project: Uint8Array, thumbnail: Uint8Array | null, meta: AutosaveMeta): Promise<void> {
  const m = MetaSchema.parse({ name: meta.name, path: meta.path, savedAt: Date.now() });
  await atomicWrite(file(id, 'pigm'), project);
  if (thumbnail) await atomicWrite(file(id, 'png'), thumbnail);
  // Meta last: an entry only counts as recoverable once its project file is complete.
  await atomicWrite(file(id, 'json'), JSON.stringify(m));
}

export async function clearAutosave(id: string): Promise<void> {
  await Promise.all((['json', 'pigm', 'png'] as const).map((ext) => fs.rm(file(id, ext), { force: true })));
}

/** Leftovers from crashed sessions, newest first. Only offered once per app run. */
export async function listRecoverable(): Promise<AutosaveEntry[]> {
  if (offered) return [];
  let names: string[];
  try {
    names = await fs.readdir(dir());
  } catch {
    return [];
  }
  const out: AutosaveEntry[] = [];
  for (const n of names) {
    const m = /^(.+)\.json$/.exec(n);
    if (!m || !SESSION.test(m[1]) || live.has(m[1])) continue;
    try {
      const meta = MetaSchema.parse(JSON.parse(await fs.readFile(file(m[1], 'json'), 'utf8')));
      await fs.access(file(m[1], 'pigm'));
      const thumb = await fs.readFile(file(m[1], 'png')).catch(() => null);
      out.push({ id: m[1], ...meta, thumbnail: thumb ? new Uint8Array(thumb.buffer, thumb.byteOffset, thumb.byteLength) : null });
    } catch {
      // Incomplete or damaged entry: skip it (left for manual inspection).
    }
  }
  if (out.length > 0) offered = true;
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export async function readAutosave(id: string): Promise<Uint8Array> {
  const buf = await fs.readFile(file(id, 'pigm'));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
