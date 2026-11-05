import { rectFromPoints, rectUnion, type Point } from '../../core/geometry';
import { TextObject, type TextStyle } from '../../live/TextObject';
import type { ToolContext } from '../Tool';
import { registerTool } from '../ToolRegistry';

let drag: { start: Point; current: Point; sp: Point } | null = null;
let moving: { at: Point; x: number; y: number } | null = null;

function liveText(ctx: ToolContext): TextObject | null {
  const l = ctx.live;
  return l && l.kind === 'text' ? (l as TextObject) : null;
}

function styleFrom(ctx: ToolContext): TextStyle {
  const o = ctx.options('text');
  return {
    family: String(o.font ?? 'Segoe UI'),
    sizePt: Number(o.size ?? 18),
    bold: o.bold === true,
    italic: o.italic === true,
    underline: o.underline === true,
    strike: o.strike === true,
    align: (o.align as TextStyle['align'] | undefined) ?? 'left',
    color: ctx.primary,
    background: o.background === 'opaque' ? ctx.secondary : null,
  };
}

function restyle(ctx: ToolContext): void {
  const t = liveText(ctx);
  if (!t) return;
  const before = t.bounds();
  t.setStyle(styleFrom(ctx));
  ctx.invalidate(rectUnion(before, t.bounds()));
  ctx.setTextEditing(t.editState());
}

export default registerTool({
  id: 'text',
  labelKey: 'tool.text',
  hintKey: 'tool.text.hint',
  icon: 'text',
  shortcut: 'T',
  group: 'tools',
  order: 70,
  paints: true,
  options: [
    { key: 'font', type: 'font', labelKey: 'opt.font', default: 'Segoe UI' },
    { key: 'size', type: 'slider', labelKey: 'opt.fontSize', min: 4, max: 400, step: 1, unit: 'pt', default: 18, presets: [12, 18, 24, 48], log: true },
    { key: 'bold', type: 'toggle', labelKey: 'opt.bold', default: false, icon: 'bold' },
    { key: 'italic', type: 'toggle', labelKey: 'opt.italic', default: false, icon: 'italic' },
    { key: 'underline', type: 'toggle', labelKey: 'opt.underline', default: false, icon: 'underline' },
    { key: 'strike', type: 'toggle', labelKey: 'opt.strike', default: false, icon: 'strike' },
    {
      key: 'align',
      type: 'segmented',
      labelKey: 'opt.align',
      default: 'left',
      iconsOnly: true,
      choices: [
        { value: 'left', labelKey: 'opt.align.left', icon: 'align-left' },
        { value: 'center', labelKey: 'opt.align.center', icon: 'align-center' },
        { value: 'right', labelKey: 'opt.align.right', icon: 'align-right' },
      ],
    },
    {
      key: 'background',
      type: 'segmented',
      labelKey: 'opt.textBg',
      default: 'transparent',
      choices: [
        { value: 'transparent', labelKey: 'opt.textBg.transparent' },
        { value: 'opaque', labelKey: 'opt.textBg.opaque' },
      ],
    },
  ],
  cursor: () => 'text',

  pointerDown(ctx, e) {
    const t = liveText(ctx);
    const p = { x: e.x, y: e.y };
    if (t && t.onBorder(p, ctx.view.zoom)) {
      moving = { at: p, x: t.x, y: t.y };
      return;
    }
    if (t && t.contains(p, ctx.view.zoom)) return;
    ctx.commitLive();
    if (!ctx.canPaint()) return;
    drag = { start: p, current: p, sp: { x: e.sx, y: e.sy } };
  },

  pointerMove(ctx, e) {
    const t = liveText(ctx);
    if (moving && t) {
      const before = t.bounds();
      t.moveTo(moving.x + (e.x - moving.at.x), moving.y + (e.y - moving.at.y));
      ctx.invalidate(rectUnion(before, t.bounds()));
      ctx.setTextEditing(t.editState());
      return;
    }
    if (drag) {
      drag.current = { x: e.x, y: e.y };
      ctx.invalidateOverlay();
    }
  },

  pointerUp(ctx, e) {
    if (moving) {
      moving = null;
      return;
    }
    const d = drag;
    drag = null;
    if (!d) return;
    const dragged = Math.hypot(e.sx - d.sp.x, e.sy - d.sp.y) > 6;
    const r = dragged ? rectFromPoints(d.start, { x: e.x, y: e.y }) : { x: d.start.x, y: d.start.y, w: 0, h: 0 };
    const doc = ctx.doc;
    const obj = new TextObject(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), styleFrom(ctx), doc.dpi, doc.width, doc.height);
    ctx.setLive(obj);
    ctx.setTextEditing(obj.editState());
  },

  hover(ctx, e) {
    const t = liveText(ctx);
    ctx.setCursor(t && t.onBorder({ x: e.x, y: e.y }, ctx.view.zoom) ? 'move' : 'text');
  },

  keyDown(ctx, e) {
    if (!liveText(ctx)) return false;
    if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) {
      ctx.commitLive();
      return true;
    }
    return false;
  },

  drawOverlay(_ctx, ov) {
    if (!drag) return;
    const a = ov.toScreen(drag.start);
    const b = ov.toScreen(drag.current);
    ov.outlineScreen(
      [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
      ],
      true,
      true,
    );
  },

  optionsChanged: restyle,
  colorsChanged: restyle,
  deactivate: () => {
    drag = null;
    moving = null;
  },
});
