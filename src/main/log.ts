import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * An error log (for reporting problems; never shown as-is to the user). Entries are appended to
 * `pigmento.log`; past 1 MB it is moved to `pigmento.old.log` and a new one begins.
 */
export const MAX_LOG_BYTES = 1024 * 1024;
const MAX_ENTRY = 8000;

export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ''}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function createLog(dir: string, now: () => Date = () => new Date()): { write(where: string, err: unknown): Promise<void>; file: string } {
  const file = path.join(dir, 'pigmento.log');
  let chain: Promise<void> = Promise.resolve();
  const write = async (where: string, err: unknown) => {
    const entry = `[${now().toISOString()}] ${where}: ${describeError(err)}`.slice(0, MAX_ENTRY).replace(/\r?\n/g, '\n  ');
    await mkdir(dir, { recursive: true });
    const size = await stat(file).then(
      (s) => s.size,
      () => 0,
    );
    if (size > MAX_LOG_BYTES) await rename(file, path.join(dir, 'pigmento.old.log')).catch(() => undefined);
    await appendFile(file, `${entry}\n`, 'utf8');
  };
  return {
    file,
    // One write at a time, in order; a failing log never throws at the caller.
    write: (where, err) => (chain = chain.then(() => write(where, err)).catch(() => undefined)),
  };
}
