/** Small colour helpers for theme derivation and WCAG contrast checks (sRGB, 0–255). */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

export function parseColor(input: string): Rgba {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) throw new Error(`Bad colour ${input}`);
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(s);
  if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3], a: fn[4] === undefined ? 1 : +fn[4] };
  throw new Error(`Bad colour ${input}`);
}

const h2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

export function toHex(c: Rgba): string {
  return `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`;
}

export function toCssColor(c: Rgba): string {
  if (c.a >= 1) return toHex(c);
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+c.a.toFixed(3)})`;
}

/** Same colour at a new alpha, as a CSS string. */
export function withAlpha(color: string, alpha: number): string {
  return toCssColor({ ...parseColor(color), a: alpha });
}

/** Linear mix of two colours (t = 0 → a, 1 → b), opaque result. */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: 1 });
}

/** Composite a possibly translucent colour over an opaque background. */
export function over(fg: string, bg: string): Rgba {
  const f = parseColor(fg);
  const b = parseColor(bg);
  return { r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 };
}

export function relativeLuminance(c: Rgba): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG 2 contrast ratio of `fg` (composited over `bg`) against `bg`. */
export function contrast(fg: string, bg: string): number {
  const b = over(bg, '#ffffff');
  const f = over(fg, toHex(b));
  const l1 = relativeLuminance(f);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Nudge `color` toward `toward` until it reaches `ratio` against every background. Used to
 * derive a readable text variant of a brand accent that is too light (or dark) for text.
 */
export function ensureContrast(color: string, backgrounds: string[], ratio: number, toward: string): string {
  const ok = (c: string) => backgrounds.every((bg) => contrast(c, bg) >= ratio);
  if (ok(color)) return color;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mix(color, toward, t);
    if (ok(c)) return c;
  }
  return toward;
}

/** Whichever of the candidates reads best on `bg`. */
export function bestOn(bg: string, candidates: string[]): string {
  return candidates.reduce((best, c) => (contrast(c, bg) > contrast(best, bg) ? c : best), candidates[0]);
}
