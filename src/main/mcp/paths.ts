import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The files AI assistants name: full Windows paths, checked before Pigmento touches them. With a
 * folder limit (Settings → AI assistants), a file must be inside that folder once every link on
 * the way is followed, so a shortcut folder can't lead out of it.
 */

export interface PathRules {
  /** The folder assistants are limited to, or null for anywhere. */
  folder: string | null;
  /** The file must be there already (opening), or may be new (saving, exporting). */
  mustExist: boolean;
  /** A file already there may be replaced. */
  overwrite: boolean;
}

const kindOf = (p: string): Promise<'file' | 'folder' | null> =>
  fs.stat(p).then(
    (s) => (s.isFile() ? 'file' : s.isDirectory() ? 'folder' : null),
    () => null,
  );

/** The same file, however its path is written (Windows paths ignore case). */
export function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/** `p` is inside `folder` (both real paths). */
function inside(p: string, folder: string): boolean {
  const rel = path.relative(folder.toLowerCase(), p.toLowerCase());
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The path an assistant gave, made whole and checked against the rules; errors say what to do instead. */
export async function checkPath(raw: unknown, rules: PathRules): Promise<string> {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 32_000 || raw.includes('\0')) throw new Error('Give the file’s full path.');
  // A full path: C:\… or \\server\share\… (not C:name, which depends on the drive's current folder).
  if (!/^([a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/])/.test(raw)) throw new Error(`Give a full path, like C:\\Users\\you\\Pictures\\picture.png (not ${raw}).`);
  const p = path.resolve(raw);
  const kind = await kindOf(p);
  if (kind === 'folder') throw new Error(`${p} is a folder, not a file.`);
  if (rules.mustExist && !kind) throw new Error(`There’s no file ${p}.`);
  if (!rules.mustExist) {
    if ((await kindOf(path.dirname(p))) !== 'folder') throw new Error(`The folder ${path.dirname(p)} doesn’t exist.`);
    if (kind && !rules.overwrite) throw new Error(`${p} already exists. Say overwrite: true to replace it.`);
  }
  if (rules.folder) {
    const folder = await fs.realpath(rules.folder).catch(() => null);
    if (!folder) throw new Error(`The folder AI assistants are limited to (${rules.folder}) doesn’t exist any more. The user can choose another in Settings → AI assistants.`);
    const real = kind ? await fs.realpath(p) : path.join(await fs.realpath(path.dirname(p)), path.basename(p));
    if (!inside(real, folder)) throw new Error(`Pigmento only lets AI assistants use files in ${rules.folder} (Settings → AI assistants).`);
  }
  return p;
}
