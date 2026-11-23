import { describe, expect, it } from 'vitest';
import { convertFontSize, fontSizePx } from '@engine/live/TextObject';
import { defaultOptions } from '@engine/tools/Tool';
import textTool from '@engine/tools/builtin/text';

describe('text font sizing (px and pt)', () => {
  it('keeps px sizes independent of document DPI', () => {
    expect(fontSizePx(12, 'px', 72)).toBe(12);
    expect(fontSizePx(12, 'px', 96)).toBe(12);
    expect(fontSizePx(12, 'px', 300)).toBe(12);
    expect(fontSizePx(12, 'px', 900)).toBe(12);
    expect(fontSizePx(0.2, 'px', 96)).toBe(1);
  });

  it('scales pt sizes by document DPI (1 pt = 1/72 inch)', () => {
    expect(fontSizePx(12, 'pt', 72)).toBe(12);
    expect(fontSizePx(12, 'pt', 96)).toBe(16);
    expect(fontSizePx(12, 'pt', 300)).toBe(50);
    expect(fontSizePx(12, 'pt', 900)).toBe(150);
  });

  it('converts between px and pt while preserving drawn height', () => {
    expect(convertFontSize(24, 'px', 'pt', 96)).toBeCloseTo(18, 6);
    expect(convertFontSize(18, 'pt', 'px', 96)).toBeCloseTo(24, 6);
    expect(convertFontSize(50, 'px', 'pt', 300)).toBeCloseTo(12, 6);
    expect(convertFontSize(12, 'pt', 'px', 300)).toBeCloseTo(50, 6);
    expect(convertFontSize(12, 'pt', 'px', 900)).toBeCloseTo(150, 6);
    expect(convertFontSize(24, 'px', 'px', 900)).toBe(24);
  });

  it('defaults the Text tool to 24 px', () => {
    expect(defaultOptions(textTool)).toMatchObject({ size: 24, sizeUnit: 'px' });
  });
});
