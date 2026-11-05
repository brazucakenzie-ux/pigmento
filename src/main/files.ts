import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_OPEN_BYTES, isOpenablePath } from '@shared/formats';

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Write a file atomically: write a temp file beside the target, fsync, then rename over it.
 * A crash at any point leaves either the old or the new file, never a torn one.
 * Retries the rename on Windows sharing violations (antivirus, indexer, OneDrive).
 */
export async function atomicWrite(file: string, data: Uint8Array | string): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID().slice(0, 8)}.tmp`);
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt < 6 && RETRY_CODES.has(code)) {
        await sleep(40 * (attempt + 1));
        continue;
      }
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
}

export async function readJsonFile(file: string): Promise<unknown> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text) as unknown;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    if (err instanceof SyntaxError) {
      // Keep the corrupt file for inspection instead of silently overwriting it.
      await fs.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
      return undefined;
    }
    throw err;
  }
}

/**
 * Paths the renderer may write to. A path is granted when it comes from a native dialog, the
 * command line, a drop from Explorer, or the recent-files list, so a compromised renderer
 * cannot write arbitrary files.
 */
const granted = new Set<string>();

function key(p: string): string {
  return path.resolve(p).toLowerCase();
}

export function grantPath(p: string): void {
  granted.add(key(p));
}

export function isGranted(p: string): boolean {
  return granted.has(key(p));
}

export function validatePathArg(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 32767 || p.includes('\0')) {
    throw new Error('Invalid path');
  }
  if (!path.isAbsolute(p)) throw new Error('Path must be absolute');
  return path.resolve(p);
}

export async function readImageFile(p: string): Promise<Uint8Array> {
  if (!isOpenablePath(p)) throw new Error('Unsupported file type');
  const stat = await fs.stat(p);
  if (!stat.isFile()) throw new Error('Not a file');
  if (stat.size > MAX_OPEN_BYTES) throw new Error('File is too large');
  const buf = await fs.readFile(p);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
