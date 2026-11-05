import type { ThemeFamilyId, ThemeMode } from '@shared/settings';
import type { I18nKey } from '../../i18n';
import { bestOn, contrast, ensureContrast, mix, parseColor, withAlpha } from './colorMath';

/** Every colour token the stylesheet reads (see tokens.css for the pre-JS fallback). */
export const TOKENS = [
  'bg-top',
  'bg-ribbon',
  'bg-panel',
  'bg-sunken',
  'bg-workspace',
  'bg-input',
  'bg-hover',
  'bg-pressed',
  'bg-selected',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-faint',
  'accent',
  'accent-hover',
  'accent-text',
  'accent-fg',
  'accent-soft',
  'accent-2',
  'focus',
  'danger',
  'danger-soft',
  'success',
  'shadow-1',
  'shadow-2',
  'shadow-3',
  'checker-a',
  'checker-b',
  'page-shadow',
  'pixel-grid',
  'grid-line',
  'ruler-bg',
  'ruler-tick',
  'scroll-thumb',
  'scroll-thumb-hover',
] as const;

export type Token = (typeof TOKENS)[number];
export type Tokens = Record<Token, string>;
export type Scheme = 'light' | 'dark';

/**
 * The colours that define a theme. Everything else (hover states, readable accent text,
 * shadows, canvas helpers) is derived, and any derived token can be pinned in `overrides`.
 */
export interface Palette {
  /** Title bar and tab strip. */
  top: string;
  /** Ribbon, options bar and rulers. */
  ribbon: string;
  /** Side panels, menus and dialogs. */
  panel: string;
  /** Recessed areas: segmented tracks, key caps. */
  sunken: string;
  /** Behind the canvas: must contrast with white paper. */
  workspace: string;
  input: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Brand accent used for fills (buttons, selected tab marker, slider track). */
  accent: string;
  accentHover?: string;
  /** Text on accent fills; picked automatically for contrast when omitted. */
  accentText?: string;
  /** Accent as text on surfaces; derived for contrast when omitted. */
  accentFg?: string;
  accent2: string;
  danger: string;
  success: string;
  hover?: string;
  pressed?: string;
  selected?: string;
  overrides?: Partial<Tokens>;
}

export interface ThemeFamily {
  id: ThemeFamilyId;
  labelKey: I18nKey;
  light: Palette;
  dark: Palette;
}

export interface ResolvedTheme {
  id: string;
  family: ThemeFamilyId;
  scheme: Scheme;
  tokens: Tokens;
}

/** Minimum WCAG contrast the derivation guarantees for text tokens. */
export const MIN_TEXT_CONTRAST = 4.5;

function derive(p: Palette, scheme: Scheme): Tokens {
  const dark = scheme === 'dark';
  const surfaces = [p.ribbon, p.panel, p.top];
  // Keep the palette's own text-on-accent only if it is readable; otherwise pick the better one.
  const accentText =
    p.accentText && contrast(p.accentText, p.accent) >= MIN_TEXT_CONTRAST
      ? p.accentText
      : bestOn(p.accent, ['#ffffff', '#141414']);
  const accentFg =
    p.accentFg ?? ensureContrast(p.accent, surfaces, MIN_TEXT_CONTRAST, dark ? '#ffffff' : '#000000');
  const t: Tokens = {
    'bg-top': p.top,
    'bg-ribbon': p.ribbon,
    'bg-panel': p.panel,
    'bg-sunken': p.sunken,
    'bg-workspace': p.workspace,
    'bg-input': p.input,
    'bg-hover': p.hover ?? withAlpha(p.text, dark ? 0.08 : 0.06),
    'bg-pressed': p.pressed ?? withAlpha(p.text, dark ? 0.14 : 0.11),
    'bg-selected': p.selected ?? withAlpha(p.accent, dark ? 0.22 : 0.14),
    border: p.border,
    'border-strong': p.borderStrong,
    text: p.text,
    'text-muted': p.textMuted,
    'text-faint': p.textFaint,
    accent: p.accent,
    'accent-hover': p.accentHover ?? mix(p.accent, dark ? '#ffffff' : '#000000', dark ? 0.14 : 0.12),
    'accent-text': accentText,
    'accent-fg': accentFg,
    'accent-soft': withAlpha(p.accent, dark ? 0.18 : 0.12),
    'accent-2': p.accent2,
    focus: accentFg,
    danger: p.danger,
    'danger-soft': withAlpha(p.danger, dark ? 0.16 : 0.1),
    success: p.success,
    'shadow-1': dark ? '0 1px 2px rgba(0, 0, 0, 0.4)' : '0 1px 2px rgba(0, 0, 0, 0.08)',
    'shadow-2': dark
      ? '0 4px 16px rgba(0, 0, 0, 0.45)'
      : '0 4px 14px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.07)',
    'shadow-3': dark
      ? '0 20px 52px rgba(0, 0, 0, 0.6)'
      : '0 18px 48px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08)',
    'checker-a': dark ? '#cccccc' : '#ffffff',
    'checker-b': dark ? '#a6a6a6' : '#d9d9d9',
    'page-shadow': dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.2)',
    'pixel-grid': withAlpha(p.textMuted, 0.5),
    'grid-line': withAlpha(p.accent, dark ? 0.38 : 0.32),
    'ruler-bg': p.sunken,
    'ruler-tick': p.textFaint,
    'scroll-thumb': withAlpha(p.text, dark ? 0.25 : 0.28),
    'scroll-thumb-hover': withAlpha(p.text, dark ? 0.42 : 0.46),
  };
  return { ...t, ...p.overrides };
}

// ---- Palettes -------------------------------------------------------------------------
// Sources: GitHub Primer primitives (MIT), VS Code "Dark/Light Modern" (MIT), Pierre theme
// by The Pierre Computer Company (MIT), Anthropic brand colours for Claude. See LICENSES.md.

const pigmentoLight: Palette = {
  top: '#f1f0f8',
  ribbon: '#fbfbfe',
  panel: '#ffffff',
  sunken: '#f5f4fa',
  workspace: '#e6e5ee',
  input: '#ffffff',
  border: '#e0dfea',
  borderStrong: '#c5c2d6',
  text: '#1d1b2b',
  textMuted: '#5f5b75',
  textFaint: '#84809a',
  accent: '#4b4be0',
  accentHover: '#3d3dc9',
  accentText: '#ffffff',
  accent2: '#ff8a3d',
  danger: '#c4314b',
  success: '#1f8a5b',
  hover: 'rgba(75, 75, 224, 0.08)',
  pressed: 'rgba(75, 75, 224, 0.16)',
  selected: 'rgba(75, 75, 224, 0.13)',
  overrides: {
    'shadow-1': '0 1px 2px rgba(25, 20, 70, 0.08)',
    'shadow-2': '0 4px 14px rgba(25, 20, 70, 0.12), 0 1px 3px rgba(25, 20, 70, 0.08)',
    'shadow-3': '0 18px 48px rgba(25, 20, 70, 0.22), 0 4px 12px rgba(25, 20, 70, 0.1)',
    'checker-b': '#dcdbe5',
    'page-shadow': 'rgba(20, 16, 60, 0.22)',
    'pixel-grid': 'rgba(110, 108, 140, 0.5)',
    'ruler-bg': '#f6f5fb',
    'scroll-thumb': 'rgba(60, 56, 90, 0.32)',
    'scroll-thumb-hover': 'rgba(60, 56, 90, 0.5)',
  },
};

const pigmentoDark: Palette = {
  top: '#17161e',
  ribbon: '#1e1d27',
  panel: '#23222d',
  sunken: '#1a1922',
  workspace: '#111017',
  input: '#2a2936',
  border: '#33313f',
  borderStrong: '#4a4760',
  text: '#ecebf5',
  textMuted: '#aaa6c0',
  textFaint: '#7c7893',
  accent: '#8a8aff',
  accentHover: '#a1a1ff',
  accentText: '#0f0e1c',
  accent2: '#ff9d5c',
  danger: '#ff6b84',
  success: '#4cd39a',
  hover: 'rgba(160, 160, 255, 0.09)',
  pressed: 'rgba(160, 160, 255, 0.18)',
  selected: 'rgba(140, 140, 255, 0.2)',
  overrides: {
    focus: '#a3a3ff',
    'checker-a': '#c9c8d2',
    'checker-b': '#a9a8b4',
    'pixel-grid': 'rgba(150, 150, 175, 0.45)',
    'scroll-thumb': 'rgba(220, 218, 240, 0.25)',
    'scroll-thumb-hover': 'rgba(220, 218, 240, 0.42)',
  },
};

const githubLight: Palette = {
  top: '#f6f8fa',
  ribbon: '#ffffff',
  panel: '#ffffff',
  sunken: '#f6f8fa',
  workspace: '#e6eaef',
  input: '#ffffff',
  border: '#d1d9e0',
  borderStrong: '#818b98',
  text: '#1f2328',
  textMuted: '#59636e',
  textFaint: '#818b98',
  accent: '#0969da',
  accentText: '#ffffff',
  accent2: '#9a6700',
  danger: '#d1242f',
  success: '#1a7f37',
  hover: '#eff2f5',
  pressed: '#e6eaef',
  selected: '#ddf4ff',
};

const githubDark: Palette = {
  top: '#010409',
  ribbon: '#0d1117',
  panel: '#151b23',
  sunken: '#010409',
  workspace: '#010409',
  input: '#0d1117',
  border: '#3d444d',
  borderStrong: '#656c76',
  text: '#f0f6fc',
  textMuted: '#9198a1',
  textFaint: '#7d8590',
  accent: '#1f6feb',
  accentFg: '#4493f8',
  accentText: '#ffffff',
  accent2: '#d29922',
  danger: '#f85149',
  success: '#3fb950',
  hover: '#262c36',
  pressed: '#2a313c',
  selected: 'rgba(56, 139, 253, 0.15)',
};

const vscodeLight: Palette = {
  top: '#f8f8f8',
  ribbon: '#f8f8f8',
  panel: '#f8f8f8',
  sunken: '#ffffff',
  workspace: '#e5e5e5',
  input: '#ffffff',
  border: '#e5e5e5',
  borderStrong: '#cecece',
  text: '#3b3b3b',
  textMuted: '#616161',
  textFaint: '#767676',
  accent: '#005fb8',
  accentHover: '#0258a8',
  accentText: '#ffffff',
  accent2: '#895503',
  danger: '#c72e0f',
  success: '#388a34',
  hover: '#f2f2f2',
  pressed: '#e5e5e5',
};

const vscodeDark: Palette = {
  top: '#181818',
  ribbon: '#181818',
  panel: '#181818',
  sunken: '#1f1f1f',
  workspace: '#1f1f1f',
  input: '#313131',
  border: '#2b2b2b',
  borderStrong: '#3c3c3c',
  text: '#cccccc',
  textMuted: '#9d9d9d',
  textFaint: '#868686',
  accent: '#0078d4',
  accentHover: '#026ec1',
  accentFg: '#4daafc',
  accentText: '#ffffff',
  accent2: '#e2c08d',
  danger: '#f85149',
  success: '#81b88b',
  hover: '#2a2d2e',
  pressed: '#37373d',
};

const claudeLight: Palette = {
  top: '#f5f4ed',
  ribbon: '#faf9f5',
  panel: '#ffffff',
  sunken: '#f0eee6',
  workspace: '#e8e6dc',
  input: '#ffffff',
  border: '#e8e6dc',
  borderStrong: '#c9c6ba',
  text: '#141413',
  textMuted: '#5e5d59',
  textFaint: '#87867f',
  accent: '#c96442',
  accentHover: '#b85536',
  accent2: '#6a9bcc',
  danger: '#b5453a',
  success: '#5f7a45',
};

const claudeDark: Palette = {
  top: '#1f1e1d',
  ribbon: '#262624',
  panel: '#262624',
  sunken: '#1f1e1d',
  workspace: '#141413',
  input: '#30302e',
  border: '#3a3934',
  borderStrong: '#4f4d47',
  text: '#faf9f5',
  textMuted: '#c2c0b6',
  textFaint: '#9c9a92',
  accent: '#d97757',
  accentHover: '#e08869',
  accent2: '#6a9bcc',
  danger: '#e5675c',
  success: '#94ab78',
};

const pierreLight: Palette = {
  top: '#f5f5f5',
  ribbon: '#f5f5f5',
  panel: '#ffffff',
  sunken: '#ededed',
  workspace: '#e5e5e5',
  input: '#ededed',
  border: '#e5e5e5',
  borderStrong: '#d4d4d4',
  text: '#0a0a0a',
  textMuted: '#525252',
  textFaint: '#737373',
  accent: '#009fff',
  accentHover: '#1aa9ff',
  accent2: '#d47628',
  danger: '#d52c36',
  success: '#18a46c',
  hover: 'rgba(223, 235, 255, 0.55)',
  selected: 'rgba(223, 235, 255, 0.9)',
};

const pierreDark: Palette = {
  top: '#171717',
  ribbon: '#171717',
  panel: '#171717',
  sunken: '#101010',
  workspace: '#0a0a0a',
  input: '#1d1d1d',
  border: '#262626',
  borderStrong: '#404040',
  text: '#fafafa',
  textMuted: '#a3a3a3',
  textFaint: '#737373',
  accent: '#009fff',
  accentHover: '#0190e7',
  accentText: '#0a0a0a',
  accent2: '#ffa359',
  danger: '#ff2e3f',
  success: '#07c480',
  hover: 'rgba(25, 40, 60, 0.55)',
  selected: 'rgba(25, 40, 60, 0.85)',
};

const contrastLight: Palette = {
  top: '#ffffff',
  ribbon: '#ffffff',
  panel: '#ffffff',
  sunken: '#ffffff',
  workspace: '#cfcfcf',
  input: '#ffffff',
  border: '#000000',
  borderStrong: '#000000',
  text: '#000000',
  textMuted: '#000000',
  textFaint: '#262626',
  accent: '#0000c8',
  accentHover: '#2a2aff',
  accentText: '#ffffff',
  accentFg: '#0000c8',
  accent2: '#8a00b8',
  danger: '#b00020',
  success: '#006b1f',
  hover: '#e6e6ff',
  pressed: '#ccccff',
  selected: '#ccccff',
  overrides: {
    focus: '#c00060',
    'accent-soft': '#e6e6ff',
    'shadow-1': 'none',
    'shadow-2': 'none',
    'shadow-3': 'none',
    'checker-b': '#bdbdbd',
    'page-shadow': 'rgba(0, 0, 0, 0)',
    'pixel-grid': 'rgba(0, 0, 200, 0.5)',
    'grid-line': 'rgba(192, 0, 96, 0.55)',
    'scroll-thumb': '#000000',
    'scroll-thumb-hover': '#0000c8',
  },
};

const contrastDark: Palette = {
  top: '#000000',
  ribbon: '#000000',
  panel: '#000000',
  sunken: '#000000',
  workspace: '#000000',
  input: '#000000',
  border: '#ffffff',
  borderStrong: '#ffffff',
  text: '#ffffff',
  textMuted: '#ffffff',
  textFaint: '#e0e0e0',
  accent: '#ffe500',
  accentHover: '#fff27a',
  accentText: '#000000',
  accentFg: '#ffe500',
  accent2: '#00e5ff',
  danger: '#ff7a7a',
  success: '#7dff9a',
  hover: '#1a1a00',
  pressed: '#333300',
  selected: '#333300',
  overrides: {
    focus: '#00e5ff',
    'accent-soft': '#333300',
    'danger-soft': '#330000',
    'shadow-1': 'none',
    'shadow-2': 'none',
    'shadow-3': 'none',
    'checker-a': '#ffffff',
    'checker-b': '#bdbdbd',
    'page-shadow': 'rgba(255, 255, 255, 0)',
    'pixel-grid': 'rgba(255, 229, 0, 0.5)',
    'grid-line': 'rgba(0, 229, 255, 0.55)',
    'scroll-thumb': '#ffffff',
    'scroll-thumb-hover': '#ffe500',
  },
};

export const THEME_FAMILIES: ThemeFamily[] = [
  { id: 'pigmento', labelKey: 'theme.family.pigmento', light: pigmentoLight, dark: pigmentoDark },
  { id: 'github', labelKey: 'theme.family.github', light: githubLight, dark: githubDark },
  { id: 'vscode', labelKey: 'theme.family.vscode', light: vscodeLight, dark: vscodeDark },
  { id: 'claude', labelKey: 'theme.family.claude', light: claudeLight, dark: claudeDark },
  { id: 'pierre', labelKey: 'theme.family.pierre', light: pierreLight, dark: pierreDark },
  { id: 'contrast', labelKey: 'theme.family.contrast', light: contrastLight, dark: contrastDark },
];

export function themeFamily(id: ThemeFamilyId): ThemeFamily {
  return THEME_FAMILIES.find((f) => f.id === id) ?? THEME_FAMILIES[0];
}

/** Light or dark for a mode, following Windows when the mode is "system". */
export function schemeFor(mode: ThemeMode, systemDark: boolean): Scheme {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}

/**
 * Tokens for a family + scheme. `accent` (the Windows accent colour, when the user opts in)
 * replaces the brand accent; high contrast keeps its own accent.
 */
export function resolveTheme(family: ThemeFamilyId, scheme: Scheme, accent?: string | null): ResolvedTheme {
  const f = themeFamily(family);
  let p = f[scheme];
  if (accent && family !== 'contrast') {
    parseColor(accent);
    p = { ...p, accent, accentHover: undefined, accentText: undefined, accentFg: undefined };
  }
  return { id: `${f.id}-${scheme}`, family: f.id, scheme, tokens: derive(p, scheme) };
}

/** Apply tokens as CSS custom properties. Contrast themes set by Windows win over everything. */
export function applyTheme(root: HTMLElement, theme: ResolvedTheme, forcedColors: boolean): void {
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.scheme;
  for (const k of TOKENS) {
    if (forcedColors) root.style.removeProperty(`--${k}`);
    else root.style.setProperty(`--${k}`, theme.tokens[k]);
  }
}
