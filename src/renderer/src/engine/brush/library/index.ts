import { brushRegistry, defineBrush, type BrushDef } from '../BrushRegistry';
import { textureStore, tipStore } from '../tips';
import { LINEAR, type Dynamic, type DynamicTarget, type TextureSpec } from '../types';
import { builtinTextures, builtinTips } from './procedural';

/** Built-in tips and grains go into the stores before any brush can ask for them. */
for (const [id, tip] of Object.entries(builtinTips())) if (!tipStore.has(id)) tipStore.set(id, tip);
for (const [id, tex] of Object.entries(builtinTextures())) if (!textureStore.has(id)) textureStore.set(id, tex);

const pressure = (min: number, curve: Dynamic['curve'] = LINEAR): Dynamic => ({ source: 'pressure', curve, min });
const speed = (min: number): Dynamic => ({ source: 'speed', curve: [[0, 1], [1, 0]], min });
const random = (min: number): Dynamic => ({ source: 'random', curve: LINEAR, min });
const dyn = (d: Partial<Record<DynamicTarget, Dynamic>>) => d;
const grain = (id: string, depth: number, scale = 1, mode: TextureSpec['mode'] = 'multiply'): TextureSpec => ({ id, depth, scale, mode });
const image = (id: string) => ({ kind: 'image' as const, id });

/** Pigmento's built-in brushes (original settings over original procedural tips). */
export const BUILTIN_BRUSHES: BrushDef[] = [
  // ---- Basic ---------------------------------------------------------------------------------
  defineBrush('round', 'basic', { size: 8, hardness: 0.8, dynamics: dyn({ size: pressure(0.08) }) }, ['default']),
  defineBrush('round-hard', 'basic', { size: 12, hardness: 1, dynamics: dyn({ size: pressure(0.25) }) }, ['crisp']),
  defineBrush('round-soft', 'basic', { size: 40, hardness: 0, flow: 0.6, spacing: 0.08, dynamics: dyn({ flow: pressure(0.1) }) }, ['feather', 'blur']),
  defineBrush('square', 'basic', { tip: { kind: 'square' }, size: 14, hardness: 1 }),
  defineBrush('round-taper', 'basic', { size: 14, hardness: 0.9, dynamics: dyn({ size: pressure(0.02, [[0, 0], [0.6, 0.85], [1, 1]]), opacity: pressure(0.6) }) }, ['pressure', 'line']),

  // ---- Pencil and pen ------------------------------------------------------------------------
  defineBrush('graphite', 'pencil', { tip: image('graphite'), size: 4, spacing: 0.15, angleJitter: 1, texture: grain('grain', 0.55), dynamics: dyn({ opacity: pressure(0.2) }) }, ['pencil', 'sketch']),
  defineBrush('graphite-soft', 'pencil', { tip: image('graphite'), size: 9, flow: 0.55, spacing: 0.12, angleJitter: 1, texture: grain('paper', 0.6), dynamics: dyn({ flow: pressure(0.15) }) }, ['pencil', 'shade', '6b']),
  defineBrush('ink', 'pencil', { size: 6, hardness: 1, spacing: 0.06, dynamics: dyn({ size: pressure(0.05, [[0, 0], [0.4, 0.7], [1, 1]]) }) }, ['pen', 'dip', 'comic']),
  defineBrush('fineliner', 'pencil', { size: 3, hardness: 1, spacing: 0.08 }, ['pen', 'technical']),
  defineBrush('ballpoint', 'pencil', { size: 2, hardness: 0.9, spacing: 0.1, dynamics: dyn({ opacity: pressure(0.55), size: pressure(0.7) }) }, ['pen', 'biro']),
  defineBrush('marker', 'pencil', { size: 18, hardness: 0.85, roundness: 0.45, angle: 30, flow: 0.35, spacing: 0.05, opacity: 0.9 }, ['felt tip', 'chisel']),
  defineBrush('highlighter', 'pencil', { tip: { kind: 'square' }, size: 22, hardness: 0.9, roundness: 0.3, angle: 0, opacity: 0.45, spacing: 0.05 }, ['marker', 'text']),

  // ---- Paint ---------------------------------------------------------------------------------
  defineBrush('oil', 'paint', { tip: image('bristle'), size: 28, spacing: 0.06, followStroke: true, mix: 0.4, flow: 0.9, dynamics: dyn({ size: pressure(0.5), flow: pressure(0.4) }) }, ['bristle', 'impasto']),
  defineBrush('acrylic', 'paint', { tip: image('bristle'), size: 24, spacing: 0.06, followStroke: true, mix: 0.15, angleJitter: 0.05, dynamics: dyn({ size: pressure(0.6) }) }, ['bristle', 'opaque']),
  defineBrush('watercolor', 'paint', { tip: image('watercolor'), size: 44, flow: 0.25, spacing: 0.12, mix: 0.25, angleJitter: 1, texture: grain('paper', 0.45), dynamics: dyn({ size: pressure(0.6) }) }, ['wash', 'wet']),
  defineBrush('gouache', 'paint', { size: 26, hardness: 0.7, roundness: 0.75, spacing: 0.08, mix: 0.1, texture: grain('paper', 0.25), dynamics: dyn({ size: pressure(0.5) }) }, ['matte', 'flat']),
  defineBrush('wet-blend', 'paint', { size: 32, hardness: 0.3, flow: 0.5, spacing: 0.08, mix: 0.75, dynamics: dyn({ flow: pressure(0.2) }) }, ['blend', 'mix', 'smudge']),

  // ---- Spray and airbrush --------------------------------------------------------------------
  defineBrush('airbrush', 'spray', { size: 60, hardness: 0, flow: 0.06, spacing: 0.08, airbrush: true, dynamics: dyn({ flow: pressure(0.1) }) }, ['soft', 'build up']),
  defineBrush('spray-can', 'spray', { tip: image('spray'), size: 50, flow: 0.5, spacing: 0.15, angleJitter: 1, airbrush: true, dynamics: dyn({ size: pressure(0.6) }) }, ['graffiti', 'aerosol']),
  defineBrush('fine-spray', 'spray', { size: 2, hardness: 1, scatter: 6, count: 8, spacing: 0.5, sizeJitter: 0.6, opacityJitter: 0.6, airbrush: true }, ['speckle', 'dots']),
  defineBrush('mist', 'spray', { size: 90, hardness: 0, flow: 0.03, spacing: 0.1, airbrush: true, scatter: 0.3 }, ['fog', 'haze', 'glow']),

  // ---- Chalk, charcoal and crayon ------------------------------------------------------------
  defineBrush('chalk', 'dry', { tip: image('chalk'), size: 22, spacing: 0.12, angleJitter: 1, texture: grain('paper', 0.6, 1, 'subtract'), dynamics: dyn({ opacity: pressure(0.3) }) }, ['board', 'pastel']),
  defineBrush('charcoal', 'dry', { tip: image('charcoal'), size: 20, spacing: 0.1, followStroke: true, angleJitter: 0.1, texture: grain('grain', 0.7, 1, 'subtract'), dynamics: dyn({ opacity: pressure(0.25), size: pressure(0.6) }) }, ['stick', 'sketch']),
  defineBrush('crayon', 'dry', { tip: image('crayon'), size: 14, spacing: 0.1, followStroke: true, texture: grain('paper', 0.55, 1, 'subtract'), dynamics: dyn({ opacity: pressure(0.4) }) }, ['wax', 'kids']),
  defineBrush('soft-pastel', 'dry', { tip: image('chalk'), size: 36, flow: 0.6, spacing: 0.1, angleJitter: 1, texture: grain('canvas', 0.5), dynamics: dyn({ flow: pressure(0.2) }) }, ['chalk', 'blend']),

  // ---- Textured ------------------------------------------------------------------------------
  defineBrush('canvas-brush', 'textured', { size: 30, hardness: 0.6, spacing: 0.08, texture: grain('canvas', 0.75), dynamics: dyn({ size: pressure(0.5) }) }, ['weave', 'linen']),
  defineBrush('paper-grain', 'textured', { size: 30, hardness: 0.5, spacing: 0.08, texture: grain('paper', 0.8, 1.5), dynamics: dyn({ size: pressure(0.5) }) }, ['grain', 'tooth']),
  defineBrush('noise-brush', 'textured', { size: 28, hardness: 0.7, spacing: 0.08, texture: grain('noise', 0.7) }, ['grit', 'static']),
  defineBrush('sponge', 'textured', { tip: image('sponge'), size: 46, spacing: 0.3, angleJitter: 1, sizeJitter: 0.25, opacityJitter: 0.3 }, ['dab', 'foliage']),
  // The Distress eraser's worn, scattered marks, as paint.
  defineBrush('distress', 'textured', { size: 30, hardness: 0.5, flow: 0.7, scatter: 0.4, dynamics: dyn({ flow: random(0.2) }) }, ['grunge', 'worn', 'rough']),

  // ---- Artistic ------------------------------------------------------------------------------
  // A broad-edge nib leaning like "/" (tip angles turn clockwise): hairlines along "/", full width along "\".
  defineBrush('calligraphy', 'artistic', { size: 20, hardness: 0.95, roundness: 0.15, angle: -45, spacing: 0.04, dynamics: dyn({ size: pressure(0.4) }) }, ['nib', 'lettering']),
  defineBrush('splatter', 'artistic', { tip: image('splatter'), size: 60, spacing: 0.9, angleJitter: 1, sizeJitter: 0.5, scatter: 0.6, opacityJitter: 0.2 }, ['drops', 'paint']),
  defineBrush('fur', 'artistic', { tip: image('fur'), size: 40, spacing: 0.18, followStroke: true, angleJitter: 0.08, lightJitter: 0.2, sizeJitter: 0.2 }, ['hair', 'animal']),
  defineBrush('grass', 'artistic', { tip: image('grass'), size: 56, spacing: 0.3, sizeJitter: 0.45, angleJitter: 0.08, scatter: 0.3, hueJitter: 0.06, lightJitter: 0.3 }, ['lawn', 'meadow']),
  defineBrush('stars', 'artistic', { tip: image('star'), size: 22, spacing: 1.4, scatter: 1.6, sizeJitter: 0.7, angleJitter: 1, hueJitter: 0.15, lightJitter: 0.25 }, ['space', 'night']),
  defineBrush('sparkles', 'artistic', { tip: image('sparkle'), size: 40, spacing: 1.4, scatter: 1.4, sizeJitter: 0.5, angleJitter: 0.15, opacityJitter: 0.3 }, ['glitter', 'shine']),
  defineBrush('leaves', 'artistic', { tip: image('leaf'), size: 30, spacing: 0.9, scatter: 1, sizeJitter: 0.5, angleJitter: 1, hueJitter: 0.08, lightJitter: 0.3 }, ['foliage', 'tree']),
  defineBrush('confetti', 'artistic', { tip: { kind: 'square' }, size: 8, hardness: 1, spacing: 1.2, scatter: 2.5, count: 2, sizeJitter: 0.5, angleJitter: 1, roundness: 0.5, hueJitter: 1, lightJitter: 0.3 }, ['party', 'celebration']),

  // ---- Pixel ---------------------------------------------------------------------------------
  defineBrush('pixel-1', 'pixel', { tip: { kind: 'square' }, size: 1, pixel: true }, ['pixel art', 'aliased']),
  defineBrush('pixel-2', 'pixel', { tip: { kind: 'square' }, size: 2, pixel: true }, ['pixel art']),
  defineBrush('pixel-4', 'pixel', { tip: { kind: 'square' }, size: 4, pixel: true }, ['pixel art']),
  defineBrush('pixel-round', 'pixel', { size: 6, pixel: true }, ['pixel art', 'circle']),
  defineBrush('dither-checker', 'pixel', { tip: { kind: 'square' }, size: 8, pixel: true, texture: grain('checker', 1, 1, 'subtract') }, ['dither', '50%']),
  defineBrush('dither-bayer', 'pixel', { tip: { kind: 'square' }, size: 8, pixel: true, texture: grain('bayer', 0.75, 1, 'subtract') }, ['dither', 'ordered']),

  // ---- Erasers -------------------------------------------------------------------------------
  defineBrush('eraser-pixel', 'eraser', { tip: { kind: 'square' }, size: 10, pixel: true }, ['square', 'paint']),
  defineBrush('eraser-hard', 'eraser', { size: 16, hardness: 0.95, dynamics: dyn({ size: pressure(0.2) }) }, ['round']),
  defineBrush('eraser-soft', 'eraser', { size: 40, hardness: 0, flow: 0.7, spacing: 0.08, dynamics: dyn({ size: pressure(0.08) }) }, ['feather']),
  defineBrush('eraser-chalk', 'eraser', { tip: image('chalk'), size: 26, spacing: 0.12, angleJitter: 1, texture: grain('paper', 0.6, 1, 'subtract') }, ['rough', 'texture']),
  defineBrush('eraser-airbrush', 'eraser', { size: 60, hardness: 0, flow: 0.08, spacing: 0.08, airbrush: true, dynamics: dyn({ flow: speed(0.4) }) }, ['fade', 'soft']),
  defineBrush('eraser-random', 'eraser', { size: 30, hardness: 0.5, flow: 0.7, scatter: 0.4, dynamics: dyn({ flow: random(0.2) }) }, ['distress', 'grunge']),
];

for (const d of BUILTIN_BRUSHES) if (!brushRegistry.get(d.id)) brushRegistry.register(d);
