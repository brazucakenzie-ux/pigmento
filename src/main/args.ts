import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { isOpenablePath } from '@shared/formats';

export interface LaunchArgs {
  files: string[];
  newWindow: boolean;
}

/**
 * Extract files to open from a command line ("Open with", jump list, second instance).
 * In dev the first argument after the executable is the app folder, which is skipped
 * because it is a directory. Chromium switches (`--foo`) are ignored.
 */
export function parseLaunchArgs(argv: string[], cwd: string): LaunchArgs {
  const files: string[] = [];
  let newWindow = false;
  for (const arg of argv.slice(1)) {
    if (arg === '--new-window') {
      newWindow = true;
      continue;
    }
    if (arg.startsWith('-')) continue;
    const full = path.resolve(cwd, arg);
    if (!isOpenablePath(full) || !existsSync(full)) continue;
    try {
      if (statSync(full).isFile()) files.push(full);
    } catch {
      // unreadable: skip
    }
  }
  return { files, newWindow };
}
