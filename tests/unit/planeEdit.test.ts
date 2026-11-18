import { describe, expect, it } from 'vitest';
import { identityState, type Keyframe, type PieceState } from '@engine/anim/interpolate';
import { depthDrag, DEPTH_PX, movePivot3D, resizeDrag, tiltDrag, TURN_PX, turnDrag } from '@engine/anim/planeEdit';
import { placementOf, project, worldOf, type Space } from '@engine/anim/space';

const space: Space = { cx: 400, cy: 300, f: 1000 };
const s0: PieceState = { ...identityState(400, 300), tilt: 0.1, turn: -0.2 };

describe('Perspective plane drags', () => {
  it('tilts from the top or bottom handle, and turns from the sides, like pushing paper', () => {
    // Top edge dragged down: pushed back. Bottom edge dragged down: pulled forward.
    expect(tiltDrag(s0, 'n', TURN_PX, false).tilt).toBeCloseTo(1.1, 9);
    expect(tiltDrag(s0, 's', TURN_PX, false).tilt).toBeCloseTo(-0.9, 9);
    // Right edge dragged in (left): it goes back like a door.
    expect(turnDrag(s0, 'e', -TURN_PX, false).turn).toBeCloseTo(0.8, 9);
    expect(turnDrag(s0, 'w', -TURN_PX, false).turn).toBeCloseTo(-1.2, 9);
    // Shift snaps to 15°.
    expect((tiltDrag(s0, 'n', 37, true).tilt * 180) / Math.PI).toBeCloseTo(15, 9);
  });

  it('pushes away with Ctrl-drag up, pulls closer down, and never past the camera', () => {
    expect(depthDrag(s0, -DEPTH_PX, space).depth).toBeCloseTo(1000 * Math.E - 1000, 6);
    expect(depthDrag(s0, DEPTH_PX, space).depth).toBeCloseTo(1000 / Math.E - 1000, 6);
    expect(depthDrag(s0, 1e6, space).depth).toBeCloseTo(-990, 6);
  });

  it('resizes on the sheet’s own plane: the corner follows the pointer', () => {
    const piece = { pivot: { x: 50, y: 30 }, w: 100, h: 60 };
    const corner = { x: 100, y: 60 };
    const pl0 = placementOf(s0, piece.pivot, piece.w, piece.h, space);
    // Drag the corner to where the sheet's point (75, 45) shows: half as big again… scaled about the pivot, ×0.5.
    const target = project(pl0, { x: 75, y: 45 })!;
    const s = resizeDrag(s0, piece, corner, target, space, false);
    expect(s.sx).toBeCloseTo(0.5, 6);
    expect(s.sy).toBeCloseTo(0.5, 6);
    // Shift keeps the proportions.
    const lop = resizeDrag(s0, piece, corner, project(pl0, { x: 100, y: 45 })!, space, true);
    expect(lop.sx).toBeCloseTo(lop.sy, 9);
  });

  it('moves the pivot without moving the piece in 3D, on every keyframe', () => {
    const keys: Keyframe[] = [
      { ...s0, frame: 0, easing: 'linear', in: null, out: null },
      { ...s0, frame: 10, tilt: 0.9, depth: 300, angle: 0.4, x: 500, easing: 'linear', in: null, out: null },
    ];
    const pivot = { x: 50, y: 30 };
    const next = { x: 10, y: 55 };
    const moved = movePivot3D(keys, pivot, next, space);
    for (let i = 0; i < keys.length; i++) {
      for (const q of [{ x: 0, y: 0 }, { x: 100, y: 60 }, { x: 37, y: 12 }]) {
        const a = worldOf(keys[i], pivot, q, space);
        const b = worldOf(moved[i], next, q, space);
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.y).toBeCloseTo(a.y, 6);
        expect(b.z).toBeCloseTo(a.z, 6);
      }
    }
  });
});
