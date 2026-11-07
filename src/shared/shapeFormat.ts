import { z } from 'zod';

/**
 * Personal shapes (made with the Shape Editor) as stored in %APPDATA%\Pigmento\shapes, one JSON
 * file each. The outline is in a unit box (0–1 on both axes; handles may reach a little past
 * it) and is stretched to whatever box the shape is drawn into. See docs/shape-format.md.
 */
export const SHAPE_FORMAT = 'pigmento-shape';
export const SHAPE_FORMAT_VERSION = 1;

/** The gallery's categories (must match the shape library's), plus "My shapes". */
export const SHAPE_FILE_CATEGORIES = ['basic', 'polygons', 'stars', 'arrows', 'callouts', 'flowchart', 'symbols', 'banners', 'brackets', 'math', 'nature', 'custom'] as const;
export type ShapeFileCategory = (typeof SHAPE_FILE_CATEGORIES)[number];

export const CUSTOM_SHAPE_ID = /^my-[a-f0-9-]{36}$/;
export const MAX_CUSTOM_SHAPES = 500;
/** Most points one shape may have, over all its subpaths. */
export const MAX_SHAPE_POINTS = 20000;

const coord = z.number().finite().min(-10).max(11);
const Pt = z.object({ x: coord, y: coord });

export const ShapeOutlineSchema = z
  .array(z.object({ closed: z.boolean(), anchors: z.array(z.object({ x: coord, y: coord, in: Pt.nullable(), out: Pt.nullable(), smooth: z.boolean() })).min(1).max(MAX_SHAPE_POINTS) }))
  .min(1)
  .max(500)
  .refine((subs) => subs.reduce((n, s) => n + s.anchors.length, 0) <= MAX_SHAPE_POINTS, 'Too many points');

export const CustomShapeSchema = z.object({
  format: z.literal(SHAPE_FORMAT),
  version: z.literal(SHAPE_FORMAT_VERSION),
  id: z.string().regex(CUSTOM_SHAPE_ID),
  name: z.string().trim().min(1).max(80),
  category: z.enum(SHAPE_FILE_CATEGORIES),
  /** Width ÷ height of the shape it was made from (for thumbnails). */
  aspect: z.number().min(0.01).max(100),
  fillRule: z.enum(['evenodd', 'nonzero']),
  outline: ShapeOutlineSchema,
  createdAt: z.number().int().nonnegative(),
});

export type CustomShapeFile = z.infer<typeof CustomShapeSchema>;

/**
 * A shape pack: personal shapes to share between PCs (File → Export my shapes). Ids aren't
 * kept; shapes get new ones when a pack is imported.
 */
export const SHAPE_PACK_FORMAT = 'pigmento-shape-pack';
export const MAX_PACK_SHAPES = MAX_CUSTOM_SHAPES;

export const PackShapeSchema = CustomShapeSchema.pick({ name: true, category: true, aspect: true, fillRule: true, outline: true });

export const ShapePackSchema = z.object({
  format: z.literal(SHAPE_PACK_FORMAT),
  version: z.literal(SHAPE_FORMAT_VERSION),
  name: z.string().trim().min(1).max(80),
  shapes: z.array(PackShapeSchema).min(1).max(MAX_PACK_SHAPES),
});

export type ShapePack = z.infer<typeof ShapePackSchema>;
