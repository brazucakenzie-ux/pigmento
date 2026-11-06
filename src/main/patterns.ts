import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { SavedPattern } from '@shared/ipc';
import { atomicWrite } from './files';

/**
 * Fill patterns made from a selection, kept across sessions as `<id>.png` + `<id>.json`
 * (name) in %APPDATA%\Pigmento\patterns. The renderer decodes and validates the PNGs.
 */
const MetaSchema = z.object({ name: z.string().max(80), createdAt: z.number() });

const ID = /^[a-f0-9-]{36}$/;
export const MAX_PATTERN_BYTES = 8 * 1024 * 1024;
const MAX_PATTERNS = 100;

function dir(): string {
  return path.join(app.getPath('userData'), 'patterns');
}

function file(id: string, ext: 'png' | 'json'): string {
  if (!ID.test(id)) throw new Error('Invalid pattern id');
  return path.join(dir(), `${id}.${ext}`);
}

export async function listPatterns(): Promise<SavedPattern[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir());
  } catch {
    return [];
  }
  const out: (SavedPattern & { createdAt: number })[] = [];
  for (const n of names) {
    const m = /^([a-f0-9-]{36})\.json$/.exec(n);
    if (!m) continue;
    try {
      const meta = MetaSchema.parse(JSON.parse(await fs.readFile(file(m[1], 'json'), 'utf8')));
      const stat = await fs.stat(file(m[1], 'png'));
      if (stat.size > MAX_PATTERN_BYTES) continue;
      out.push({ id: m[1], name: meta.name, png: new Uint8Array(await fs.readFile(file(m[1], 'png'))), createdAt: meta.createdAt });
    } catch {
      // A broken or half-written pattern is skipped.
    }
  }
  return out
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, MAX_PATTERNS)
    .map(({ id, name, png }) => ({ id, name, png }));
}

export async function savePattern(png: Uint8Array, name: string): Promise<string> {
  const id = randomUUID();
  await fs.mkdir(dir(), { recursive: true });
  await atomicWrite(file(id, 'png'), png);
  // The metadata goes last: a pattern without it is never listed.
  await atomicWrite(file(id, 'json'), JSON.stringify({ name: name.slice(0, 80), createdAt: Date.now() }));
  return id;
}

export async function removePattern(id: string): Promise<void> {
  await fs.rm(file(id, 'json'), { force: true });
  await fs.rm(file(id, 'png'), { force: true });
}
