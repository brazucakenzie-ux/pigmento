import { app } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { CUSTOM_SHAPE_ID, CustomShapeSchema, MAX_CUSTOM_SHAPES, type CustomShapeFile } from '@shared/shapeFormat';
import { atomicWrite } from './files';

/** Personal shapes, one validated JSON file each in %APPDATA%\Pigmento\shapes. */
const MAX_SHAPE_BYTES = 4 * 1024 * 1024;

function dir(): string {
  return path.join(app.getPath('userData'), 'shapes');
}

function file(id: string): string {
  if (!CUSTOM_SHAPE_ID.test(id)) throw new Error('Invalid shape id');
  return path.join(dir(), `${id}.json`);
}

export async function listShapes(): Promise<CustomShapeFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir());
  } catch {
    return [];
  }
  const out: CustomShapeFile[] = [];
  for (const n of names) {
    const m = /^(my-[a-f0-9-]{36})\.json$/.exec(n);
    if (!m) continue;
    try {
      const f = file(m[1]);
      if ((await fs.stat(f)).size > MAX_SHAPE_BYTES) continue;
      const shape = CustomShapeSchema.parse(JSON.parse(await fs.readFile(f, 'utf8')));
      // The file name is the id; a file claiming another id is skipped.
      if (shape.id === m[1]) out.push(shape);
    } catch {
      // A broken or half-written shape is left out.
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt).slice(0, MAX_CUSTOM_SHAPES);
}

/** Add or replace a shape (validated here too: the renderer is not trusted with the disk). */
export async function saveShape(input: unknown): Promise<void> {
  const shape = CustomShapeSchema.parse(input);
  const json = JSON.stringify(shape);
  if (json.length > MAX_SHAPE_BYTES) throw new Error('Shape is too large');
  await fs.mkdir(dir(), { recursive: true });
  const existing = await fs.readdir(dir()).catch(() => [] as string[]);
  if (!existing.includes(`${shape.id}.json`) && existing.filter((n) => n.endsWith('.json')).length >= MAX_CUSTOM_SHAPES) {
    throw new Error('Too many shapes');
  }
  await atomicWrite(file(shape.id), json);
}

export async function removeShape(id: string): Promise<void> {
  await fs.rm(file(id), { force: true });
}
