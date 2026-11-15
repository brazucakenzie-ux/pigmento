import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast, parseColor } from '@ui/theme/colorMath';
import { MIN_TEXT_CONTRAST, THEME_FAMILIES, TOKENS, resolveTheme, schemeFor, type Scheme } from '@ui/theme/themes';
import { parseSettings } from '@shared/settings';

const schemes: Scheme[] = ['light', 'dark'];
const all = THEME_FAMILIES.flatMap((f) => schemes.map((s) => resolveTheme(f.id, s)));

describe('colour maths', () => {
  it('matches known WCAG contrast ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('parses hex and rgba, and composites translucent colours', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    // 50% black over white reads like mid grey.
    expect(contrast('rgba(0, 0, 0, 0.5)', '#ffffff')).toBeCloseTo(contrast('#808080', '#ffffff'), 0);
  });

  it('nudges a too-light accent until it is readable', () => {
    const fixed = ensureContrast('#009fff', ['#ffffff'], 4.5, '#000000');
    expect(contrast('#009fff', '#ffffff')).toBeLessThan(4.5);
    expect(contrast(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('theme registry', () => {
  it('has a light and dark variant for every requested family', () => {
    expect(THEME_FAMILIES.map((f) => f.id)).toEqual(['pigmento', 'github', 'vscode', 'claude', 'pierre', 'contrast']);
    expect(all).toHaveLength(12);
    expect(new Set(all.map((t) => t.id)).size).toBe(12);
  });

  it('defines every token with a parseable colour', () => {
    for (const theme of all) {
      for (const k of TOKENS) {
        const v = theme.tokens[k];
        expect(v, `${theme.id} ${k}`).toBeTruthy();
        if (!k.startsWith('shadow')) expect(() => parseColor(v), `${theme.id} ${k}=${v}`).not.toThrow();
      }
    }
  });

  for (const theme of all) {
    it(`${theme.id}: text, muted text and accents are readable`, () => {
      const t = theme.tokens;
      const surfaces = { top: t['bg-top'], ribbon: t['bg-ribbon'], panel: t['bg-panel'], input: t['bg-input'] };
      const min = theme.family === 'contrast' ? 7 : MIN_TEXT_CONTRAST;
      for (const [name, bg] of Object.entries(surfaces)) {
        expect(contrast(t.text, bg), `text on ${name}`).toBeGreaterThanOrEqual(min);
        expect(contrast(t['text-muted'], bg), `muted on ${name}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        expect(contrast(t['text-faint'], bg), `faint on ${name}`).toBeGreaterThanOrEqual(3);
      }
      for (const bg of [t['bg-ribbon'], t['bg-panel'], t['bg-top']]) {
        expect(contrast(t['accent-fg'], bg), 'accent text').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        expect(contrast(t['accent-2-fg'], bg), 'second accent text').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        expect(contrast(t.focus, bg), 'focus ring').toBeGreaterThanOrEqual(3);
      }
      expect(contrast(t['accent-text'], t.accent), 'text on accent').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      // Selected items (accent-fg text on the selected tint) must stay readable too.
      expect(contrast(t['accent-fg'], mixOver(t['bg-selected'], t['bg-ribbon'])), 'accent text on selected').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(contrast(t['accent-fg'], mixOver(t['bg-selected'], t['bg-panel'])), 'accent text on selected panel items').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      // White paper must stand out from the workspace behind it.
      expect(contrast('#ffffff', t['bg-workspace']), 'paper vs workspace').toBeGreaterThan(1.15);
    });
  }

  it('keeps brand accents for fills but derives readable text', () => {
    const pierre = resolveTheme('pierre', 'light').tokens;
    expect(pierre.accent).toBe('#009fff');
    expect(pierre['accent-fg']).not.toBe('#009fff');
    expect(resolveTheme('github', 'dark').tokens['bg-ribbon']).toBe('#0d1117');
    expect(resolveTheme('vscode', 'dark').tokens['bg-ribbon']).toBe('#181818');
    expect(resolveTheme('claude', 'light').tokens['bg-ribbon']).toBe('#faf9f5');
  });

  it('applies the Windows accent colour except to high contrast', () => {
    expect(resolveTheme('github', 'light', '#e81123').tokens.accent).toBe('#e81123');
    expect(resolveTheme('contrast', 'dark', '#e81123').tokens.accent).toBe('#ffe500');
  });

  it('follows Windows in Match Windows mode', () => {
    expect(schemeFor('system', true)).toBe('dark');
    expect(schemeFor('system', false)).toBe('light');
    expect(schemeFor('light', true)).toBe('light');
  });
});

describe('theme settings', () => {
  it('migrates the old single theme value to family + mode', () => {
    expect(parseSettings({ theme: 'dark' })).toMatchObject({ theme: 'pigmento', themeMode: 'dark' });
    expect(parseSettings({ theme: 'system' })).toMatchObject({ theme: 'pigmento', themeMode: 'system' });
    expect(parseSettings({ theme: 'contrast' })).toMatchObject({ theme: 'contrast', themeMode: 'dark' });
    expect(parseSettings({ theme: 'github', themeMode: 'light' })).toMatchObject({ theme: 'github', themeMode: 'light' });
    expect(parseSettings({ theme: 'nope' })).toMatchObject({ theme: 'pigmento', themeMode: 'system' });
  });
});

function mixOver(fg: string, bg: string): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const c = (x: number, y: number) => Math.round(x * f.a + y * (1 - f.a));
  return `rgb(${c(f.r, b.r)}, ${c(f.g, b.g)}, ${c(f.b, b.b)})`;
}
