import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLog, describeError, MAX_LOG_BYTES } from '../../src/main/log';

describe('the error log', () => {
  it('appends time-stamped entries in order, stack traces indented', async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'pigmento-log-')), 'logs');
    const log = createLog(dir, () => new Date('2026-11-15T10:00:00Z'));
    const err = new Error('Boom');
    err.stack = 'Error: Boom\n    at here';
    await Promise.all([log.write('main', err), log.write('window: script', 'second')]);
    const text = readFileSync(log.file, 'utf8');
    expect(text).toBe('[2026-11-15T10:00:00.000Z] main: Error: Boom\n  Error: Boom\n      at here\n[2026-11-15T10:00:00.000Z] window: script: second\n');
  });

  it('starts a new file once it passes 1 MB, keeping the old one', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pigmento-log-'));
    writeFileSync(path.join(dir, 'pigmento.log'), 'x'.repeat(MAX_LOG_BYTES + 10));
    const log = createLog(dir);
    await log.write('main', 'fresh');
    expect(readdirSync(dir).sort()).toEqual(['pigmento.log', 'pigmento.old.log']);
    expect(readFileSync(log.file, 'utf8')).toMatch(/main: fresh\n$/);
  });

  it('describes any thrown value', () => {
    expect(describeError('plain')).toBe('plain');
    expect(describeError({ code: 7 })).toBe('{"code":7}');
    expect(describeError(new TypeError('bad'))).toMatch(/^TypeError: bad/);
  });

  it('never throws at the caller, even when it can’t write', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'pigmento-log-')), 'not-a-dir');
    writeFileSync(file, 'a file where the folder should be');
    await expect(createLog(file).write('main', 'lost')).resolves.toBeUndefined();
  });
});
