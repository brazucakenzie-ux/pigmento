import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkPath, samePath } from '../../src/main/mcp/paths';

let root: string;
let allowed: string;
let outside: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pigmento-paths-'));
  allowed = path.join(root, 'Allowed');
  outside = path.join(root, 'Elsewhere');
  await fs.mkdir(path.join(allowed, 'Sub'), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(allowed, 'there.png'), 'x');
  await fs.writeFile(path.join(outside, 'secret.png'), 'x');
  // A link inside the folder that leads out of it (a junction needs no special rights).
  await fs.symlink(outside, path.join(allowed, 'Link'), 'junction');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const anywhere = { folder: null, mustExist: false, overwrite: false };

describe('the files an assistant names', () => {
  it('are full Windows paths', async () => {
    await expect(checkPath('picture.png', anywhere)).rejects.toThrow(/full path/);
    await expect(checkPath('C:picture.png', anywhere)).rejects.toThrow(/full path/);
    await expect(checkPath(42, anywhere)).rejects.toThrow(/full path/);
    expect(await checkPath(path.join(allowed, 'Sub', '..', 'new.png'), anywhere)).toBe(path.join(allowed, 'new.png'));
  });

  it('exist when opened, sit in a folder that exists when saved, and are never a folder', async () => {
    await expect(checkPath(path.join(allowed, 'missing.png'), { ...anywhere, mustExist: true })).rejects.toThrow(/no file/);
    expect(await checkPath(path.join(allowed, 'there.png'), { ...anywhere, mustExist: true })).toBe(path.join(allowed, 'there.png'));
    await expect(checkPath(path.join(root, 'Nowhere', 'new.png'), anywhere)).rejects.toThrow(/folder .* doesn’t exist/);
    await expect(checkPath(path.join(allowed, 'Sub'), anywhere)).rejects.toThrow(/is a folder/);
  });

  it('replace a file only when told to', async () => {
    await expect(checkPath(path.join(allowed, 'there.png'), anywhere)).rejects.toThrow(/already exists\. Say overwrite: true/);
    expect(await checkPath(path.join(allowed, 'there.png'), { ...anywhere, overwrite: true })).toBe(path.join(allowed, 'there.png'));
  });

  it('stay inside the folder limit, even through a link that leads out', async () => {
    const limited = { folder: allowed, mustExist: false, overwrite: true };
    expect(await checkPath(path.join(allowed, 'Sub', 'new.png'), limited)).toBe(path.join(allowed, 'Sub', 'new.png'));
    // Case doesn't matter on Windows.
    expect(await checkPath(path.join(allowed.toUpperCase(), 'there.png'), limited)).toBeTruthy();
    await expect(checkPath(path.join(outside, 'secret.png'), limited)).rejects.toThrow(/only lets AI assistants use files in/);
    await expect(checkPath(path.join(allowed, '..', 'Elsewhere', 'new.png'), limited)).rejects.toThrow(/only lets/);
    await expect(checkPath(path.join(allowed, 'Link', 'secret.png'), limited)).rejects.toThrow(/only lets/);
    await expect(checkPath(path.join(allowed, 'Link', 'new.png'), limited)).rejects.toThrow(/only lets/);
    // A folder whose name only starts the same isn't inside.
    await fs.mkdir(`${allowed}2`, { recursive: true });
    await expect(checkPath(path.join(`${allowed}2`, 'new.png'), limited)).rejects.toThrow(/only lets/);
    await expect(checkPath(path.join(allowed, 'x.png'), { ...limited, folder: path.join(root, 'Gone') })).rejects.toThrow(/doesn’t exist any more/);
  });

  it('are the same file however they are written', () => {
    expect(samePath('C:\\Pictures\\A.png', 'c:/pictures/a.PNG')).toBe(true);
    expect(samePath('C:\\Pictures\\A.png', 'C:\\Pictures\\B.png')).toBe(false);
  });
});
