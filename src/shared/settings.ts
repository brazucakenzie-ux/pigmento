import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-f]{8}$/i);

/** Theme families; each has a light and a dark variant. */
export const ThemeFamilyId = z.enum(['pigmento', 'github', 'vscode', 'claude', 'pierre', 'contrast']);
export type ThemeFamilyId = z.infer<typeof ThemeFamilyId>;

/** Light, dark, or follow the Windows app mode. */
export const ThemeMode = z.enum(['system', 'light', 'dark']);
export type ThemeMode = z.infer<typeof ThemeMode>;

const hex6 = z.string().regex(/^#[0-9a-f]{6}$/i);

/** A key combination as stored: optional Ctrl, Alt, Shift, then one key ("Ctrl+Shift+S", "F1", "Mouse5"). */
export const SHORTCUT_COMBO = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(\[|\]|[A-Za-z0-9]{1,12})$/;

export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  theme: ThemeFamilyId.default('pigmento'),
  themeMode: ThemeMode.default('system'),
  /** Title-bar colours of the last applied theme, so new windows open without a colour flash. */
  chrome: z.object({ bg: hex6, fg: hex6 }).optional(),
  useWindowsAccent: z.boolean().default(false),
  panels: z
    .object({
      side: z.enum(['left', 'right']).default('right'),
      open: z.boolean().default(true),
      width: z.number().min(180).max(600).default(290),
      collapsed: z.record(z.string(), z.boolean()).default({}),
      visible: z.record(z.string(), z.boolean()).default({ history: true, navigator: true }),
    })
    .default({
      side: 'right',
      open: true,
      width: 290,
      collapsed: {},
      visible: { history: true, navigator: true },
    }),
  view: z
    .object({
      rulers: z.boolean().default(false),
      gridlines: z.boolean().default(false),
      gridSize: z.number().int().min(2).max(512).default(16),
      pixelGrid: z.boolean().default(true),
      statusBar: z.boolean().default(true),
      showGuides: z.boolean().default(true),
      lockGuides: z.boolean().default(false),
      snap: z.boolean().default(true),
      snapGrid: z.boolean().default(false),
      snapGuides: z.boolean().default(true),
      snapCanvas: z.boolean().default(true),
      snapObjects: z.boolean().default(true),
    })
    .default({
      rulers: false,
      gridlines: false,
      gridSize: 16,
      pixelGrid: true,
      statusBar: true,
      showGuides: true,
      lockGuides: false,
      snap: true,
      snapGrid: false,
      snapGuides: true,
      snapCanvas: true,
      snapObjects: true,
    }),
  colors: z
    .object({
      primary: hex.default('#000000ff'),
      secondary: hex.default('#ffffffff'),
      recent: z.array(hex).max(16).default([]),
      custom: z.array(hex).max(24).default([]),
      /** An imported palette (replaces Pigmento's 24 colours); missing = Pigmento's. */
      palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).min(1).max(256).optional(),
    })
    .default({ primary: '#000000ff', secondary: '#ffffffff', recent: [], custom: [] }),
  tools: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /** Brush library: starred brushes, in the order they were starred. */
  brushes: z
    .object({ favorites: z.array(z.string().regex(/^[a-z0-9-]{1,100}$/i)).max(500).default([]) })
    .default({ favorites: [] }),
  /** Brush symmetry (its centre is per image and not saved). */
  drawing: z
    .object({
      symmetry: z.enum(['off', 'leftRight', 'topBottom', 'both', 'radial']).default('off'),
      segments: z.number().int().min(2).max(32).default(6),
    })
    .default({ symmetry: 'off', segments: 6 }),
  /** Shape library: starred shapes, in the order they were starred. */
  shapes: z
    .object({ favorites: z.array(z.string().regex(/^[a-z0-9-]{1,100}$/i)).max(500).default([]) })
    .default({ favorites: [] }),
  activeTool: z.string().default('pencil'),
  newImage: z
    .object({
      width: z.number().int().min(1).max(30000).default(1280),
      height: z.number().int().min(1).max(30000).default(800),
      dpi: z.number().min(1).max(10000).default(96),
      paper: z.enum(['white', 'transparent', 'secondary']).default('white'),
    })
    .default({ width: 1280, height: 800, dpi: 96, paper: 'white' }),
  export: z
    .object({
      jpegQuality: z.number().min(1).max(100).default(90),
      webpQuality: z.number().min(1).max(100).default(90),
      lastFolder: z.string().optional(),
      /** Last choices in the Export dialog. */
      format: z.enum(['png', 'jpeg', 'webp', 'bmp', 'gif']).default('png'),
      scale: z.number().int().min(1).max(3).default(1),
      resample: z.enum(['nearest', 'bilinear', 'bicubic']).default('bicubic'),
    })
    .default({ jpegQuality: 90, webpQuality: 90, format: 'png', scale: 1, resample: 'bicubic' }),
  resample: z.enum(['nearest', 'bilinear', 'bicubic']).default('bicubic'),
  /** Keyboard shortcuts the user changed: action id → its key combinations ([] = none). */
  shortcuts: z.record(z.string().max(80), z.array(z.string().max(40).regex(SHORTCUT_COMBO)).max(4)).default({}),
  /** The interface: its scale (80–200 %), Simple (the Paint essentials) or Full, and the tour. */
  ui: z
    .object({
      scale: z.number().min(0.8).max(2).default(1),
      mode: z.enum(['simple', 'full']).default('full'),
      /** The welcome tour has been seen (or skipped). */
      tour: z.boolean().default(false),
    })
    .default({ scale: 1, mode: 'full', tour: false }),
  window: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().default(1360),
      height: z.number().default(880),
      maximized: z.boolean().default(false),
    })
    .default({ width: 1360, height: 880, maximized: false }),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

/** Earlier builds stored one `theme` value: system | light | dark | contrast. */
const LEGACY_THEME: Record<string, { theme: ThemeFamilyId; themeMode: ThemeMode }> = {
  system: { theme: 'pigmento', themeMode: 'system' },
  light: { theme: 'pigmento', themeMode: 'light' },
  dark: { theme: 'pigmento', themeMode: 'dark' },
  contrast: { theme: 'contrast', themeMode: 'dark' },
};

function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const r = raw as Record<string, unknown>;
  const legacy = typeof r.theme === 'string' && !('themeMode' in r) ? LEGACY_THEME[r.theme] : undefined;
  return legacy ? { ...r, ...legacy } : r;
}

/** Parse untrusted settings JSON, falling back to defaults section-by-section. */
export function parseSettings(input: unknown): Settings {
  const raw = migrate(input);
  const full = SettingsSchema.safeParse(raw);
  if (full.success) return full.data;
  const base = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(SettingsSchema.shape) as (keyof Settings)[]) {
    const field = SettingsSchema.shape[key];
    const r = field.safeParse((raw as Record<string, unknown>)[key]);
    if (r.success) out[key] = r.data;
  }
  return SettingsSchema.parse(out);
}
