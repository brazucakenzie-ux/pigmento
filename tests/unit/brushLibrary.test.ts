import { describe, expect, it } from 'vitest';
import { en } from '../../src/renderer/src/i18n/en';
import { BRUSH_CATEGORIES, brushRegistry, defineBrush } from '@engine/brush/BrushRegistry';
import { BUILTIN_BRUSHES } from '@engine/brush/library';
import { brushPreview } from '@engine/brush/preview';
import { textureStore, tipStore } from '@engine/brush/tips';
import { brushOptionsFor } from '@engine/tools/brushTool';

const all = brushRegistry.all().filter((d) => !d.custom);
const keys = en as Record<string, string>;

describe('brush library', () => {
  it('has 40+ brushes in 9 categories, each with a name and a unique id', () => {
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(all.length).toBe(BUILTIN_BRUSHES.length);
    expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
    expect(BRUSH_CATEGORIES).toHaveLength(9);
    for (const c of BRUSH_CATEGORIES) {
      expect(brushRegistry.byCategory(c).length, c).toBeGreaterThanOrEqual(4);
      expect(keys[`brushcat.${c}`], c).toBeTruthy();
    }
    for (const d of all) expect(keys[d.labelKey], d.labelKey).toBeTruthy();
  });

  it('only uses tips and grains that exist, with settings in range', () => {
    for (const d of all) {
      const s = d.settings;
      if (s.tip.kind === 'image') expect(tipStore.has(s.tip.id), `${d.id} tip ${s.tip.id}`).toBe(true);
      if (s.texture) expect(textureStore.has(s.texture.id), `${d.id} grain ${s.texture.id}`).toBe(true);
      expect(s.size, d.id).toBeGreaterThanOrEqual(1);
      expect(s.size, d.id).toBeLessThanOrEqual(400);
      for (const k of ['opacity', 'flow', 'hardness', 'sizeJitter', 'opacityJitter', 'angleJitter', 'hueJitter', 'lightJitter', 'mix'] as const) {
        expect(s[k], `${d.id}.${k}`).toBeGreaterThanOrEqual(0);
        expect(s[k], `${d.id}.${k}`).toBeLessThanOrEqual(1);
      }
      expect(s.roundness, d.id).toBeGreaterThan(0);
      expect(s.spacing, d.id).toBeGreaterThan(0);
      expect(d.eraser).toBe(d.category === 'eraser');
    }
  });

  it('paints something with every brush', () => {
    for (const d of all) {
      const p = brushPreview(d.settings, 96, 32);
      let covered = 0;
      for (let i = 3; i < p.data.length; i += 4) if (p.data[i] > 32) covered++;
      // Something visible (sparse brushes like sparkles leave little), never the whole box.
      expect(covered, d.id).toBeGreaterThan(15);
      expect(covered, d.id).toBeLessThan(96 * 32 * 0.9);
    }
  });

  it('draws the same preview every time', () => {
    const d = brushRegistry.get('stars')!;
    expect(brushPreview(d.settings, 64, 24).data).toEqual(brushPreview(d.settings, 64, 24).data);
  });

  it('loads a brush into a tool’s sliders', () => {
    expect(brushOptionsFor(brushRegistry.get('highlighter')!)).toEqual({ brushId: 'highlighter', size: 22, opacity: 45, flow: 100, hardness: 90 });
  });

  it('finds brushes by name, id and keyword', () => {
    const name = (d: (typeof all)[number]) => keys[d.labelKey];
    expect(brushRegistry.search('water', name).map((d) => d.id)).toContain('watercolor');
    expect(brushRegistry.search('pixel art', name).every((d) => d.category === 'pixel')).toBe(true);
    expect(brushRegistry.search('graffiti', name).map((d) => d.id)).toEqual(['spray-can']);
  });

  it('refuses a second brush with the same id', () => {
    expect(() => brushRegistry.register(defineBrush('round', 'basic', {}))).toThrow();
  });
});
