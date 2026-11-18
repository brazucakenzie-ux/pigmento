import { describe, expect, it } from 'vitest';
import { View } from '@engine/render/View';

/** A 1000 × 600 viewport on a 400 × 300 document at 100 %. */
function view(): View {
  const v = new View();
  v.setViewport(1000, 600);
  v.setDocSize(400, 300);
  v.zoomCentered(1);
  return v;
}

describe('the view reaches pieces outside the canvas', () => {
  it('without anything outside, scrolling and centring are as before', () => {
    const v = view();
    expect(v.panX).toBe(300);
    expect(v.scrollInfo('x')).toEqual({ content: 1000, viewport: 1000, offset: 0 });
    v.zoomCentered(4);
    // 1600 px of document plus a 48 px margin each side.
    expect(v.scrollInfo('x').content).toBe(1696);
  });

  it('keeps the canvas centred while what hangs off it still fits, moving it only to keep that in view', () => {
    const v = view();
    // A piece 200 px past the right edge: canvas and piece (600 px) fit, so the canvas stays centred.
    v.extent = { x: 100, y: 0, w: 500, h: 100 };
    v.panBy(0, 0);
    expect(v.panX).toBe(300);
    // 300 px past it: centred, its end would be past the right margin, so the canvas moves left just enough.
    v.extent = { x: 100, y: 0, w: 600, h: 100 };
    v.panBy(0, 0);
    expect(v.toScreen(700, 0).x).toBe(1000 - 48);
    // 1000 px past the edge no longer fits: the scrollbar covers it all.
    v.extent = { x: 200, y: 0, w: 1200, h: 100 };
    v.zoomCentered(1);
    const s = v.scrollInfo('x');
    expect(s.content).toBe(1400 + 96);
    v.scrollTo('x', s.content - s.viewport);
    // Scrolled to the end: the piece's far edge sits at the right margin.
    expect(v.toScreen(1400, 0).x).toBeCloseTo(1000 - 48, 6);
    v.scrollTo('x', 0);
    expect(v.toScreen(0, 0).x).toBeCloseTo(48, 6);
  });

  it('reaches pieces off the top-left as well', () => {
    const v = view();
    v.zoomCentered(2);
    v.extent = { x: -900, y: -500, w: 1000, h: 600 };
    v.scrollTo('x', 0);
    v.scrollTo('y', 0);
    expect(v.toScreen(-900, -500)).toEqual({ x: 48, y: 48 });
    expect(v.scrollInfo('x').offset).toBeCloseTo(0, 6);
  });

  it('Fit takes in everything outside the canvas, centred', () => {
    const v = view();
    v.extent = { x: -400, y: 50, w: 400, h: 50 };
    v.fitAll(true);
    // 800 px across (the piece, then the canvas) in 1000 − 96 px.
    expect(v.zoom).toBeCloseTo(904 / 800, 6);
    const left = v.toScreen(-400, 0).x;
    const right = v.toScreen(400, 0).x;
    expect(left + right).toBeCloseTo(1000, 6);
    // Without an extent it's the canvas alone.
    v.extent = null;
    v.fitAll(true);
    expect(v.zoom).toBeCloseTo(Math.min(904 / 400, 504 / 300), 6);
  });
});
