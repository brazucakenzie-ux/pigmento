import { dragBox, rectCorners, rectUnion, type Point } from '../core/geometry';
import { Selection, type SelectionMode } from '../doc/Selection';
import { ellipseOutline, SELECTION_MODES } from '../doc/selectionMath';
import { boxFromRect, handleCursor, handlePosition, hitHandle, RESIZE_HANDLES } from '../live/BoxGeom';
import type { FloatObject } from '../live/FloatObject';
import type { I18nKey } from '../../i18n';
import type { OptionSpec, Tool, ToolContext, ToolPointerEvent } from './Tool';

function floatOf(ctx: ToolContext): FloatObject | null {
  const l = ctx.live;
  return l && l.kind === 'float' ? (l as FloatObject) : null;
}

const screenOf = (ctx: ToolContext) => (q: Point) => ctx.view.toScreen(q.x, q.y);

/** New / Add / Subtract / Intersect, shared by every selection tool's options bar. */
export const SELECTION_MODE_OPTION: OptionSpec = {
  key: 'mode',
  type: 'segmented',
  labelKey: 'opt.selMode',
  default: 'replace',
  iconsOnly: true,
  choices: [
    { value: 'replace', labelKey: 'opt.selMode.replace', icon: 'sel-replace' },
    { value: 'add', labelKey: 'opt.selMode.add', icon: 'sel-add' },
    { value: 'subtract', labelKey: 'opt.selMode.subtract', icon: 'sel-subtract' },
    { value: 'intersect', labelKey: 'opt.selMode.intersect', icon: 'sel-intersect' },
  ],
};

/**
 * The mode for a new selection: Shift adds, Alt subtracts and Shift+Alt intersects when a
 * selection already exists; otherwise the options bar decides. `keys` says which modifiers
 * were used up choosing the mode (they don't also constrain the shape).
 */
export function selectionModeFor(ctx: ToolContext, toolId: string, e: { shift: boolean; alt: boolean }): { mode: SelectionMode; keys: { shift: boolean; alt: boolean } } {
  const opt = String(ctx.options(toolId).mode ?? 'replace');
  const base = (SELECTION_MODES as readonly string[]).includes(opt) ? (opt as SelectionMode) : 'replace';
  if (ctx.doc.selection && (e.shift || e.alt)) {
    const mode: SelectionMode = e.shift && e.alt ? 'intersect' : e.shift ? 'add' : 'subtract';
    return { mode, keys: { shift: e.shift, alt: e.alt } };
  }
  return { mode: base, keys: { shift: false, alt: false } };
}

type SelectKind = 'rect' | 'ellipse' | 'lasso' | 'polygon';

interface SelectToolConfig {
  id: string;
  kind: SelectKind;
  labelKey: I18nKey;
  hintKey: I18nKey;
  historyKey: I18nKey;
  icon: string;
  shortcut: string;
  order: number;
}

interface Creating {
  start: Point;
  current: Point;
  points: Point[];
  sp: Point;
  shift: boolean;
  alt: boolean;
  moved: boolean;
  mode: SelectionMode;
  /** Modifiers used to pick the mode; they constrain the shape only after a re-press. */
  modeKeys: { shift: boolean; alt: boolean };
  /** The selection before this gesture (hidden while a replacing selection is drawn). */
  before: Selection | null;
}

/** Corners closer than this (screen px) to the first one close a polygon. */
const CLOSE_PX = 8;

/**
 * Rectangle, ellipse, free-form and polygon selection. In "new selection" mode, dragging
 * inside (or on a handle of) a selection lifts it into a floating object that can be moved,
 * scaled and rotated; Ctrl+drag moves a copy.
 */
export function createSelectTool(cfg: SelectToolConfig): Tool {
  let creating: Creating | null = null;
  let draggingFloat = false;
  /** Polygon being clicked out, with the rubber-band end following the pointer. */
  let hoverPoint: Point | null = null;

  const snap = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

  /** Shift on a polygon edge snaps it to 45° steps. */
  const constrain = (from: Point, p: Point): Point => {
    const a = Math.atan2(p.y - from.y, p.x - from.x);
    const step = Math.PI / 4;
    const q = Math.round(a / step) * step;
    const len = Math.hypot(p.x - from.x, p.y - from.y);
    return { x: from.x + Math.cos(q) * len, y: from.y + Math.sin(q) * len };
  };

  const shapeOf = (c: Creating, end: Point, doc: { width: number; height: number }): Selection | null => {
    const shift = c.shift && !c.modeKeys.shift;
    const alt = c.alt && !c.modeKeys.alt;
    if (cfg.kind === 'rect') return Selection.fromRect(dragBox(snap(c.start), snap(end), shift, alt), doc.width, doc.height);
    if (cfg.kind === 'ellipse') return Selection.fromEllipse(dragBox(snap(c.start), snap(end), shift, alt), doc.width, doc.height);
    return Selection.fromPolygon(c.points, doc.width, doc.height);
  };

  /** Finish: put the old selection back, then apply the new one as a single step. */
  const finish = (ctx: ToolContext, c: Creating, sel: Selection | null): void => {
    ctx.setSelection(c.before);
    ctx.applySelection(sel, c.mode, cfg.historyKey);
  };

  const cancel = (ctx: ToolContext): void => {
    if (!creating) return;
    ctx.setSelection(creating.before);
    creating = null;
    hoverPoint = null;
    ctx.invalidateOverlay();
  };

  const closePolygon = (ctx: ToolContext): void => {
    const c = creating;
    if (!c) return;
    creating = null;
    hoverPoint = null;
    if (c.points.length < 3) {
      ctx.setSelection(c.before);
      ctx.invalidateOverlay();
      return;
    }
    finish(ctx, c, Selection.fromPolygon(c.points, ctx.doc.width, ctx.doc.height));
  };

  const begin = (ctx: ToolContext, e: ToolPointerEvent, p: Point, mode: SelectionMode, modeKeys: { shift: boolean; alt: boolean }): void => {
    const before = ctx.doc.selection;
    // A new selection hides the old one while it's drawn; combining keeps it visible.
    if (mode === 'replace') ctx.setSelection(null);
    creating = { start: p, current: p, points: [p], sp: { x: e.sx, y: e.sy }, shift: e.shift, alt: e.alt, moved: false, mode, modeKeys, before };
  };

  return {
    id: cfg.id,
    labelKey: cfg.labelKey,
    hintKey: cfg.hintKey,
    icon: cfg.icon,
    shortcut: cfg.shortcut,
    group: 'selection',
    order: cfg.order,
    options: [SELECTION_MODE_OPTION, { key: 'transparentHint', type: 'hint', labelKey: 'action.transparentSelection.hint' }],
    cursor: () => 'crosshair',

    pointerDown(ctx, e) {
      const p = { x: e.x, y: e.y };
      const sp = { x: e.sx, y: e.sy };
      const zoom = ctx.view.zoom;

      if (cfg.kind === 'polygon' && creating) {
        const c = creating;
        const first = ctx.view.toScreen(c.points[0].x, c.points[0].y);
        if (c.points.length >= 3 && Math.hypot(first.x - sp.x, first.y - sp.y) <= CLOSE_PX) return closePolygon(ctx);
        // The second click of a double-click finishes (the first one already placed the corner).
        if (e.detail >= 2) return closePolygon(ctx);
        const last = c.points[c.points.length - 1];
        c.points.push(e.shift ? constrain(last, p) : p);
        ctx.invalidateOverlay();
        return;
      }

      const { mode, keys } = selectionModeFor(ctx, cfg.id, e);
      let f = floatOf(ctx);
      if (f) {
        const hit = mode === 'replace' ? f.hit(p, sp, screenOf(ctx), zoom) : null;
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
        // Put the floating pixels down; combining modes keep their selection to build on.
        ctx.commitLive(mode !== 'replace');
      } else if (ctx.doc.selection && mode === 'replace' && cfg.kind !== 'polygon') {
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
      }
      begin(ctx, e, p, mode, keys);
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
      const c = creating;
      if (cfg.kind === 'polygon') {
        hoverPoint = e.shift ? constrain(c.points[c.points.length - 1], p) : p;
        ctx.invalidateOverlay();
        return;
      }
      c.current = p;
      // A lasso ends where it began, so "was it a click?" must look at the whole gesture.
      if (Math.hypot(e.sx - c.sp.x, e.sy - c.sp.y) >= 3) c.moved = true;
      // A modifier that picked the mode constrains the shape once it's released and pressed again.
      if (!e.shift) c.modeKeys.shift = false;
      if (!e.alt) c.modeKeys.alt = false;
      c.shift = e.shift;
      c.alt = e.alt;
      if (cfg.kind === 'lasso') {
        const last = c.points[c.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * ctx.view.zoom >= 1.5) c.points.push(p);
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
      if (cfg.kind === 'polygon') return;
      const c = creating;
      creating = null;
      if (!c) return;
      if (!c.moved) {
        // A click: deselect in "new selection" mode; combining modes leave the selection alone.
        ctx.setSelection(c.before);
        if (c.mode === 'replace') ctx.changeSelection(null, 'history.deselect');
        ctx.invalidateOverlay();
        return;
      }
      finish(ctx, c, shapeOf(c, { x: e.x, y: e.y }, ctx.doc));
    },

    hover(ctx, e) {
      const p = { x: e.x, y: e.y };
      const sp = { x: e.sx, y: e.sy };
      if (cfg.kind === 'polygon' && creating) {
        hoverPoint = e.shift ? constrain(creating.points[creating.points.length - 1], p) : p;
        const first = ctx.view.toScreen(creating.points[0].x, creating.points[0].y);
        const closing = creating.points.length >= 3 && Math.hypot(first.x - sp.x, first.y - sp.y) <= CLOSE_PX;
        ctx.setCursor(closing ? 'pointer' : 'crosshair');
        ctx.invalidateOverlay();
        return;
      }
      const f = floatOf(ctx);
      const { mode } = selectionModeFor(ctx, cfg.id, e);
      if (f && mode === 'replace') {
        ctx.setCursor(f.cursorFor(f.hit(p, sp, screenOf(ctx), ctx.view.zoom)) ?? 'crosshair');
        return;
      }
      const sel = ctx.doc.selection;
      if (sel && !f && mode === 'replace') {
        const h = hitHandle(boxFromRect(sel.bounds), screenOf(ctx), sp, ctx.view.zoom, true);
        if (h) return ctx.setCursor(handleCursor(h, 0));
        if (sel.contains(p.x, p.y)) return ctx.setCursor('move');
      }
      ctx.setCursor('crosshair');
    },

    keyDown(ctx, e) {
      if (cfg.kind === 'polygon' && creating) {
        if (e.key === 'Enter') {
          closePolygon(ctx);
          return true;
        }
        if (e.key === 'Escape') {
          cancel(ctx);
          return true;
        }
        if (e.key === 'Backspace') {
          if (creating.points.length > 1) creating.points.pop();
          else cancel(ctx);
          ctx.invalidateOverlay();
          return true;
        }
      }
      if (e.key === 'Escape' || e.key === 'Enter') {
        if (creating) {
          cancel(ctx);
          return true;
        }
        if (ctx.live || ctx.doc.selection) {
          ctx.commitLive();
          ctx.changeSelection(null, 'history.deselect');
          return true;
        }
      }
      return false;
    },

    drawOverlay(ctx, ov) {
      if (creating) {
        const c = creating;
        if (cfg.kind === 'polygon') {
          ov.ants(hoverPoint ? [...c.points, hoverPoint] : c.points, false);
          return;
        }
        if (cfg.kind === 'lasso') {
          ov.ants(c.points, false);
          return;
        }
        const r = dragBox(snap(c.start), snap(c.current), c.shift && !c.modeKeys.shift, c.alt && !c.modeKeys.alt);
        ov.ants(cfg.kind === 'ellipse' ? ellipseOutline(r) : rectCorners(r), true);
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

    deactivate(ctx) {
      if (creating) cancel(ctx);
      creating = null;
      hoverPoint = null;
      draggingFloat = false;
    },
  };
}
