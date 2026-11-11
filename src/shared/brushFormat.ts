import { z } from 'zod';

/**
 * Personal brushes (made with the Brush Designer) as stored in %APPDATA%\Pigmento\brushes, one
 * JSON file each: the brush's settings, plus its own tip and grain texture when it has them
 * (greyscale masks, base64). See docs/brush-format.md.
 */
export const BRUSH_FORMAT = 'pigmento-brush';
export const BRUSH_FORMAT_VERSION = 1;

/** The picker's categories (must match the brush library's), plus "My brushes". */
export const BRUSH_FILE_CATEGORIES = ['basic', 'pencil', 'paint', 'spray', 'dry', 'textured', 'artistic', 'pixel', 'eraser', 'custom'] as const;
export type BrushFileCategory = (typeof BRUSH_FILE_CATEGORIES)[number];

export const CUSTOM_BRUSH_ID = /^my-[a-f0-9-]{36}$/;
export const MAX_CUSTOM_BRUSHES = 500;
/** Largest side of a stored tip or texture mask. */
export const MAX_MASK_SIZE = 512;
/** A tip or texture id that means "the one stored with this brush". */
export const OWN_MASK = 'own';

/** Built-in tips and textures are referred to by id; `own` is the brush's own mask. */
const MaskRef = z.string().regex(/^[a-z0-9-]{1,60}$/);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** How many bytes base64 text decodes to. */
function base64Bytes(s: string): number {
  return (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
}

/** A greyscale mask, 0 (nothing) to 255 (full), row by row, as base64. */
export const MaskSchema = z
  .object({
    w: z.number().int().min(1).max(MAX_MASK_SIZE),
    h: z.number().int().min(1).max(MAX_MASK_SIZE),
    data: z.string().max(4 * Math.ceil((MAX_MASK_SIZE * MAX_MASK_SIZE) / 3)),
  })
  .refine((m) => BASE64.test(m.data) && m.data.length % 4 === 0 && base64Bytes(m.data) === m.w * m.h, 'Mask data does not match its size');

export type MaskFile = z.infer<typeof MaskSchema>;

const unit = z.number().finite().min(0).max(1);

export const DynamicSchema = z.object({
  source: z.enum(['off', 'pressure', 'tilt', 'speed', 'random']),
  /** Points (x, y) in 0–1 with x ascending. */
  curve: z
    .array(z.tuple([unit, unit]).readonly())
    .min(2)
    .max(16)
    .refine((c) => c.every((p, i) => i === 0 || p[0] >= c[i - 1][0]), 'Curve points must go left to right')
    .readonly(),
  min: unit,
});

const TARGETS = ['size', 'opacity', 'flow', 'angle', 'roundness', 'scatter', 'hardness'] as const;

export const BrushSettingsSchema = z.object({
  tip: z.discriminatedUnion('kind', [z.object({ kind: z.literal('round') }), z.object({ kind: z.literal('square') }), z.object({ kind: z.literal('image'), id: MaskRef })]),
  size: z.number().finite().min(1).max(1000),
  opacity: unit,
  flow: unit,
  hardness: unit,
  spacing: z.number().finite().min(0.01).max(5),
  angle: z.number().finite().min(-360).max(360),
  roundness: z.number().finite().min(0.05).max(1),
  scatter: z.number().finite().min(0).max(10),
  count: z.number().int().min(1).max(16),
  sizeJitter: unit,
  opacityJitter: unit,
  angleJitter: unit,
  hueJitter: unit,
  lightJitter: unit,
  followStroke: z.boolean(),
  pixel: z.boolean(),
  airbrush: z.boolean(),
  mix: unit,
  texture: z
    .object({
      id: MaskRef,
      scale: z.number().finite().min(0.25).max(8),
      depth: unit,
      mode: z.enum(['multiply', 'subtract']),
    })
    .nullable(),
  dynamics: z.partialRecord(z.enum(TARGETS), DynamicSchema),
});

export type BrushSettingsFile = z.infer<typeof BrushSettingsSchema>;

/** The fields a brush is made of (the file adds its id and when it was made). */
export const BrushBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(BRUSH_FILE_CATEGORIES),
  settings: BrushSettingsSchema,
  tip: MaskSchema.nullable(),
  texture: MaskSchema.nullable(),
});

/** A brush that uses its own tip or texture must carry it. */
export function checkOwnMasks(b: { settings: BrushSettingsFile; tip: MaskFile | null; texture: MaskFile | null }, ctx: z.RefinementCtx): void {
  if (b.settings.tip.kind === 'image' && b.settings.tip.id === OWN_MASK && !b.tip) ctx.addIssue({ code: 'custom', message: 'The brush uses its own tip but has none' });
  if (b.settings.texture?.id === OWN_MASK && !b.texture) ctx.addIssue({ code: 'custom', message: 'The brush uses its own texture but has none' });
}

export const CustomBrushSchema = BrushBodySchema.extend({
  format: z.literal(BRUSH_FORMAT),
  version: z.literal(BRUSH_FORMAT_VERSION),
  id: z.string().regex(CUSTOM_BRUSH_ID),
  createdAt: z.number().int().nonnegative(),
}).superRefine(checkOwnMasks);

export type CustomBrushFile = z.infer<typeof CustomBrushSchema>;

/** Mask bytes to base64 (in chunks, so big masks don't overflow the call stack). */
export function encodeMaskData(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodeMaskData(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
