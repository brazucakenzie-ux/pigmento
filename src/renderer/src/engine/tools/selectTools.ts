import { dragBox, rectCorners, rectUnion, type Point } from '../core/geometry';
import { Selection } from '../doc/Selection';
import { boxFromRect, handleCursor, handlePosition, hitHandle, RESIZE_HANDLES } from '../live/BoxGeom';
import type { FloatObject } from '../live/FloatObject';
import type { I18nKey } from '../../i18n';
import type { Tool, ToolContext } from './Tool';

function floatOf(ctx: ToolContext): FloatObject | null {
  const l = ctx.live;
  return l && l.kind === 'float' ? (l as FloatObject) : null;
}

const screenOf = (ctx: ToolContext) => (q: Point) => ctx.view.toScreen(q.x, q.y);

interface SelectToolConfig {
  id: string;
  kind: 'rect' | 'lasso';
  labelKey: I18nKey;
  hintKey: I18nKey;
  icon: string;
  shortcut: string;
  order: number;
}

/**
 * Rectangle and free-form selection. Dragging inside (or on a handle of) a selection lifts it
 * into a floating object that can be moved, scaled and rotated; Ctrl+drag moves a copy.
 */
export function createSelectTool(cfg: SelectToolConfig): Tool {
  let creating: { start: Point; current: Point; points: Point[]; sp: Point; shift: boolean; alt: boolean } | null = null;
  let draggingFloat = false;

  const snap = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

  return {
    id: cfg.id,
    labelKey: cfg.labelKey,
    hintKey: cfg.hintKey,
    icon: cfg.icon,
    shortcut: cfg.shortcut,
    group: 'selection',
    order: cfg.order,
    options: [{ key: 'transparentHint', type: 'hint', labelKey: 'action.transparentSelection.hint' }],
    cursor: () => 'crosshair',

    pointerDown(ctx, e) {
      const p = { x: e.x, y: e.y };
      const sp = { x: e.sx, y: e.sy };
      const zoom = ctx.view.zoom;
      let f = floatOf(ctx);
      if (f) {
        const hit = f.hit(p, sp, screenOf(ctx), zoom);
        if (hit) {
          if (hit.type === 'body' && e.ctrl) {
            // Ctrl+drag: drop a copy here and keep moving another copy.
            ctx.commitLive(true);
            f = ctx.liftSelection(true) as FloatObject | null;
            if (!f) return;
          }
          f.beginDrag(hit, p);
          draggingFloat = true;
          return;
        }
        ctx.commitLive();
        ctx.setSelection(null);
      } else if (ctx.doc.selection) {
        const sel = ctx.doc.selection;
        const h = hitHandle(boxFromRect(sel.bounds), screenOf(ctx), sp, zoom, true);
        if (h || sel.contains(p.x, p.y)) {
          if (!ctx.canPaint()) return;
          f = ctx.liftSelection(e.ctrl && !h) as FloatObject | null;
          if (f) {
            f.beginDrag(h ? { type: 'handle', handle: h } : { type: 'body' }, p);
            draggingFloat = true;
          }
          return;
        }
        ctx.setSelection(null);
      }
      creating = { start: p, current: p, points: [p], sp, shift: e.shift, alt: e.alt };
    },

    pointerMove(ctx, e) {
      const p = { x: e.x, y: e.y };
      const f = floatOf(ctx);
      if (draggingFloat && f) {
        const before = f.bounds();
        f.drag(p, { shift: e.shift, alt: e.alt });
        ctx.invalidate(rectUnion(before, f.bounds()));
        ctx.emitSelectionInfo();
        return;
      }
      if (!creating) return;
      creating.current = p;
      creating.shift = e.shift;
      creating.alt = e.alt;
      if (cfg.kind === 'lasso') {
        const last = creating.points[creating.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * ctx.view.zoom >= 1.5) creating.points.push(p);
      }
      ctx.invalidateOverlay();
    },

    pointerUp(ctx, e) {
      const f = floatOf(ctx);
      if (draggingFloat) {
        f?.endDrag();
        draggingFloat = false;
        return;
      }
      const c = creating;
      creating = null;
      if (!c) return;
      const doc = ctx.doc;
      if (Math.hypot(e.sx - c.sp.x, e.sy - c.sp.y) < 3) {
        ctx.setSelection(null);
        return;
      }
      const sel =
        cfg.kind === 'rect'
          ? Selection.fromRect(dragBox(snap(c.start), snap({ x: e.x, y: e.y }), e.shift, e.alt), doc.width, doc.height)
          : Selection.fromPolygon(c.points, doc.width, doc.height);
      ctx.setSelection(sel);
    },

    hover(ctx, e) {
      const p = { x: e.x, y: e.y };
      const sp = { x: e.sx, y: e.sy };
      const f = floatOf(ctx);
      if (f) {
        ctx.setCursor(f.cursorFor(f.hit(p, sp, screenOf(ctx), ctx.view.zoom)) ?? 'crosshair');
        return;
      }
      const sel = ctx.doc.selection;
      if (sel) {
        const h = hitHandle(boxFromRect(sel.bounds), screenOf(ctx), sp, ctx.view.zoom, true);
        if (h) return ctx.setCursor(handleCursor(h, 0));
        if (sel.contains(p.x, p.y)) return ctx.setCursor('move');
      }
      ctx.setCursor('crosshair');
    },

    keyDown(ctx, e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        if (creating) {
          creating = null;
          ctx.invalidateOverlay();
          return true;
        }
        if (ctx.live || ctx.doc.selection) {
          ctx.commitLive();
          ctx.setSelection(null);
          return true;
        }
      }
      return false;
    },

    drawOverlay(ctx, ov) {
      if (creating) {
        if (cfg.kind === 'rect') {
          const r = dragBox(snap(creating.start), snap(creating.current), creating.shift, creating.alt);
          ov.ants(rectCorners(r), true);
        } else ov.ants(creating.points, false);
        return;
      }
      const sel = ctx.doc.selection;
      if (sel && !ctx.live) {
        const g = boxFromRect(sel.bounds);
        const zoom = ctx.view.zoom;
        const top = ov.toScreen(handlePosition(g, 'n', zoom));
        const rot = ov.toScreen(handlePosition(g, 'rotate', zoom));
        ov.line(top, rot);
        for (const h of RESIZE_HANDLES) ov.handle(ov.toScreen(handlePosition(g, h, zoom)));
        ov.handle(rot, 'circle');
      }
    },

    deactivate() {
      creating = null;
      draggingFloat = false;
    },
  };
}
