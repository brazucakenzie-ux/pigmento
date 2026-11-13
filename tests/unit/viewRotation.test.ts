import { describe, expect, it } from 'vitest';
import { View } from '@engine/render/View';

function view(rotation: number): View {
  const v = new View();
  v.setDocSize(400, 300);
  v.setViewport(800, 600);
  v.fit();
  v.setRotation(rotation);
  return v;
}

describe('a turned view', () => {
  it('maps document points to the screen and back', () => {
    for (const deg of [0, 15, 90, -135, 180]) {
      const v = view(deg);
      for (const p of [
        { x: 0, y: 0 },
        { x: 123, y: 45 },
        { x: 400, y: 300 },
      ]) {
        const back = v.toDoc(v.toScreen(p.x, p.y).x, v.toScreen(p.x, p.y).y);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('turns about the middle of the viewport', () => {
    const v = view(90);
    const mid = v.toDoc(400, 300);
    expect(mid.x).toBeCloseTo(200);
    expect(mid.y).toBeCloseTo(150);
    // The document's x axis now points down the screen.
    const a = v.toScreen(100, 150);
    const b = v.toScreen(300, 150);
    expect(b.x - a.x).toBeCloseTo(0);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it('normalises angles and reports them in degrees', () => {
    const v = view(0);
    v.setRotation(370);
    expect(v.rotation).toBeCloseTo(10);
    v.setRotation(-190);
    expect(v.rotation).toBeCloseTo(170);
    v.setRotation(360);
    expect(v.rotation).toBe(0);
    expect(v.state().rotation).toBe(0);
  });

  it('zooms about the pointer and pans along the screen', () => {
    const v = view(30);
    v.zoomAt(4, 0, 0);
    const before = v.toDoc(500, 200);
    v.zoomAt(v.zoom * 1.5, 500, 200);
    const after = v.toDoc(500, 200);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // Dragging the view 50 px right moves what was under the pointer 50 px right.
    const p = v.toScreen(150, 120);
    v.panBy(50, 0);
    const q = v.toScreen(150, 120);
    expect(q.x - p.x).toBeCloseTo(50, 1);
    expect(q.y - p.y).toBeCloseTo(0, 1);
  });

  it('finds the visible part of the document from all four corners', () => {
    const v = view(45);
    v.zoomAt(8, 400, 300);
    const vis = v.visibleDocRect()!;
    const mid = v.toDoc(400, 300);
    expect(vis.x).toBeLessThan(mid.x);
    expect(vis.x + vis.w).toBeGreaterThan(mid.x);
    // Wider than an upright view's, since the corners reach further along both axes.
    expect(vis.w).toBeGreaterThan(800 / 8);
  });
});
