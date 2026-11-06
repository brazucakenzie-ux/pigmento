import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-f]{8}$/i);

/** Theme families; each has a light and a dark variant. */
export const ThemeFamilyId = z.enum(['pigmento', 'github', 'vscode', 'claude', 'pierre', 'contrast']);
export type ThemeFamilyId = z.infer<typeof ThemeFamilyId>;

/** Light, dark, or follow the Windows app mode. */
export const ThemeMode = z.enum(['system', 'light', 'dark']);
export type ThemeMode = z.infer<typeof ThemeMode>;

const hex6 = z.string().regex(/^#[0-9a-f]{6}$/i);

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
    })
    .default({ rulers: false, gridlines: false, gridSize: 16, pixelGrid: true, statusBar: true }),
  colors: z
    .object({
      primary: hex.default('#000000ff'),
      secondary: hex.default('#ffffffff'),
      recent: z.array(hex).max(16).default([]),
      custom: z.array(hex).max(24).default([]),
    })
    .default({ primary: '#000000ff', secondary: '#ffffffff', recent: [], custom: [] }),
  tools: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
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
    })
    .default({ jpegQuality: 90, webpQuality: 90 }),
  resample: z.enum(['nearest', 'bilinear', 'bicubic']).default('bicubic'),
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
