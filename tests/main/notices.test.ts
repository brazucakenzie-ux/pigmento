import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listedPackages, NOTICES_FILE, PACKAGES, renderNotices } from '../../scripts/notices.mjs';

describe('THIRD-PARTY-NOTICES.md', () => {
  const file = readFileSync(NOTICES_FILE, 'utf8');

  it('has the licence texts of the installed packages (run npm run notices if not)', () => {
    expect(file).toBe(renderNotices());
  });

  it('lists every package once, with a version', () => {
    const listed = listedPackages(file);
    expect([...listed.keys()]).toEqual([...PACKAGES]);
    for (const version of listed.values()) expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('includes the permission notices the licences require', () => {
    expect(file.split('Permission is hereby granted').length - 1).toBeGreaterThanOrEqual(7);
    expect(file).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(file).toContain('Permission to use, copy, modify, and/or distribute this software');
  });
});
