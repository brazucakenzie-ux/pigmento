import { app } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { CUSTOM_BRUSH_ID, CustomBrushSchema, MAX_CUSTOM_BRUSHES, type CustomBrushFile } from '@shared/brushFormat';
import { atomicWrite } from './files';

/** Personal brushes, one validated JSON file each in %APPDATA%\Pigmento\brushes. */
const MAX_BRUSH_BYTES = 2 * 1024 * 1024;

function dir(): string {
  return path.join(app.getPath('userData'), 'brushes');
}

function file(id: string): string {
  if (!CUSTOM_BRUSH_ID.test(id)) throw new Error('Invalid brush id');
  return path.join(dir(), `${id}.json`);
}

export async function listBrushes(): Promise<CustomBrushFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir());
  } catch {
    return [];
  }
  const out: CustomBrushFile[] = [];
  for (const n of names) {
    const m = /^(my-[a-f0-9-]{36})\.json$/.exec(n);
    if (!m) continue;
    try {
      const f = file(m[1]);
      if ((await fs.stat(f)).size > MAX_BRUSH_BYTES) continue;
      const brush = CustomBrushSchema.parse(JSON.parse(await fs.readFile(f, 'utf8')));
      // The file name is the id; a file claiming another id is skipped.
      if (brush.id === m[1]) out.push(brush);
    } catch {
      // A broken or half-written brush is left out.
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt).slice(0, MAX_CUSTOM_BRUSHES);
}

/** Add or replace a brush (validated here too: the renderer is not trusted with the disk). */
export async function saveBrush(input: unknown): Promise<void> {
  const brush = CustomBrushSchema.parse(input);
  const json = JSON.stringify(brush);
  if (json.length > MAX_BRUSH_BYTES) throw new Error('Brush is too large');
  await fs.mkdir(dir(), { recursive: true });
  const existing = await fs.readdir(dir()).catch(() => [] as string[]);
  if (!existing.includes(`${brush.id}.json`) && existing.filter((n) => n.endsWith('.json')).length >= MAX_CUSTOM_BRUSHES) {
    throw new Error('Too many brushes');
  }
  await atomicWrite(file(brush.id), json);
}

export async function removeBrush(id: string): Promise<void> {
  await fs.rm(file(id), { force: true });
}
