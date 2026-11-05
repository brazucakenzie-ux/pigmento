/** Colour with 0–255 channels and straight (non-premultiplied) alpha. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HSV {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
export const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };
export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function rgba(r: number, g: number, b: number, a = 255): RGBA {
  return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp255(a) };
}

function hex2(n: number): string {
  return clamp255(n).toString(16).padStart(2, '0');
}

/** `#rrggbbaa` (lower case). */
export function toHex8(c: RGBA): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${hex2(c.a)}`;
}

/** `#rrggbb` (alpha dropped). */
export function toHex6(c: RGBA): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/** Parse #rgb, #rgba, #rrggbb or #rrggbbaa (leading # optional). */
export function parseHex(input: string): RGBA | null {
  let s = input.trim().replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(s)) return null;
  if (s.length === 3 || s.length === 4) {
    s = s
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (s.length !== 6 && s.length !== 8) return null;
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) : 255 };
}

export function toCss(c: RGBA): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(3)})`;
}

export function colorEquals(a: RGBA, b: RGBA): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

export function rgbToHsv(c: RGBA): HSV {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(hsv: HSV, a = 255): RGBA {
  const h = (((hsv.h % 360) + 360) % 360) / 60;
  const s = Math.min(1, Math.max(0, hsv.s));
  const v = Math.min(1, Math.max(0, hsv.v));
  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = v - c;
  const sector: [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = sector[Math.min(5, Math.floor(h))];
  return rgba((r + m) * 255, (g + m) * 255, (b + m) * 255, a);
}

/**
 * Distance between two colours for fill tolerance, 0–255. Compared premultiplied so that all
 * fully transparent pixels are equal regardless of their RGB.
 */
export function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  a1: number,
  r2: number,
  g2: number,
  b2: number,
  a2: number,
): number {
  const pa1 = a1 / 255;
  const pa2 = a2 / 255;
  const dr = Math.abs(r1 * pa1 - r2 * pa2);
  const dg = Math.abs(g1 * pa1 - g2 * pa2);
  const db = Math.abs(b1 * pa1 - b2 * pa2);
  const da = Math.abs(a1 - a2);
  return Math.max(dr, dg, db, da);
}

/** Relative luminance (0–1), for picking readable contrast colours. */
export function luminance(c: RGBA): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function invertColor(c: RGBA): RGBA {
  return { r: 255 - c.r, g: 255 - c.g, b: 255 - c.b, a: c.a };
}
