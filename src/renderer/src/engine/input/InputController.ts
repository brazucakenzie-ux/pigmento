import type { Point } from '../core/geometry';
import type { Engine } from '../Engine';
import type { Overlay } from '../render/Overlay';
import type { ToolPointerEvent } from '../tools/Tool';

type CanvasHandle = 'e' | 's' | 'se';

const HANDLE_SIZE = 7;
const PALM_REJECT_MS = 600;

/**
 * Turns Pointer Events into tool calls: coalesced events for smooth strokes, pressure/tilt,
 * pen eraser end, palm rejection, middle-button/Space panning, wheel and pinch zoom, and the
 * Paint-style canvas resize handles.
 */
export class InputController {
  private toolPointer: number | null = null;
  private toolPointerType: string | null = null;
  private toolButton: 0 | 2 = 0;
  private eraserOverride: string | null = null;
  private panning: { id: number; last: Point } | null = null;
  /** A guide being dragged on the canvas (dropping it outside the view deletes it). */
  private guideDrag: { id: number; guideId: string; axis: 'x' | 'y' } | null = null;
  /** Ctrl was held at the last pointer event (Ctrl+drag moves guides). */
  private ctrlHeld = false;
  /** The status bar is showing the "Ctrl+drag a guide" hint. */
  private guideHint = false;
  private spaceDown = false;
  private touches = new Map<number, Point>();
  private pinch: { dist: number; mid: Point; zoom: number } | null = null;
  private lastPenTime = -Infinity;
  private canvasDrag: { id: number; handle: CanvasHandle; w: number; h: number } | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly el: HTMLCanvasElement,
  ) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  get isDrawing(): boolean {
    return this.toolPointer !== null;
  }

  /** Any drag in progress (drawing, panning, pinching, resizing the canvas). */
  get isBusy(): boolean {
    return this.toolPointer !== null || this.panning !== null || this.pinch !== null || this.canvasDrag !== null || this.guideDrag !== null;
  }

  private local(e: PointerEvent | WheelEvent): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toToolEvent(e: PointerEvent, button: 0 | 2): ToolPointerEvent {
    const sp = this.local(e);
    const p = this.engine.view.toDoc(sp.x, sp.y);
    const type = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse';
    // Mice report 0.5 while pressed; only pens give meaningful pressure.
    const pressure = type === 'pen' ? Math.max(0.02, e.pressure || 0) : 1;
    return {
      x: p.x,
      y: p.y,
      sx: sp.x,
      sy: sp.y,
      pressure,
      tiltX: e.tiltX || 0,
      tiltY: e.tiltY || 0,
      pointerType: type,
      button,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      eraser: type === 'pen' && (e.buttons & 32) !== 0,
      detail: this.clickCount,
      timeStamp: e.timeStamp,
    };
  }

  /**
   * Pointer events don't carry a reliable click count, so double-clicks are detected here
   * (Windows defaults: 500 ms, a few pixels).
   */
  private clickCount = 1;
  private lastDown: { t: number; x: number; y: number; button: number } | null = null;

  /** Capture can fail (e.g. the pointer was already released); input keeps working without it. */
  private capture(id: number): void {
    try {
      this.el.setPointerCapture(id);
    } catch {
      // ignore
    }
  }

  private countClick(e: PointerEvent): void {
    const sp = this.local(e);
    const prev = this.lastDown;
    const repeat =
      prev !== null &&
      prev.button === e.button &&
      e.timeStamp - prev.t < 500 &&
      Math.abs(sp.x - prev.x) <= 5 &&
      Math.abs(sp.y - prev.y) <= 5;
    this.clickCount = repeat ? this.clickCount + 1 : 1;
    this.lastDown = { t: e.timeStamp, x: sp.x, y: sp.y, button: e.button };
  }

  // ---- canvas resize handles ------------------------------------------------------------

  private handlePoints(): Record<CanvasHandle, Point> {
    const d = this.engine.view.docRectOnScreen();
    const o = HANDLE_SIZE / 2 + 3;
    return {
      e: { x: d.x + d.w + o, y: d.y + d.h / 2 },
      s: { x: d.x + d.w / 2, y: d.y + d.h + o },
      se: { x: d.x + d.w + o, y: d.y + d.h + o },
    };
  }

  private hitCanvasHandle(sp: Point): CanvasHandle | null {
    if (this.engine.view.rotation !== 0) return null;
    const pts = this.handlePoints();
    for (const k of ['se', 'e', 's'] as CanvasHandle[]) {
      if (Math.abs(pts[k].x - sp.x) <= HANDLE_SIZE && Math.abs(pts[k].y - sp.y) <= HANDLE_SIZE) return k;
    }
    return null;
  }

  drawOverlay(ov: Overlay): void {
    // A turned view has no canvas resize handles (they work only upright).
    if (this.engine.view.rotation !== 0) return;
    const c = ov.ctx;
    const pts = this.handlePoints();
    c.save();
    for (const k of ['e', 's', 'se'] as CanvasHandle[]) {
      const p = pts[k];
      c.fillStyle = ov.theme.handleFill;
      c.strokeStyle = ov.theme.handleStroke;
      c.lineWidth = 1;
      c.fillRect(Math.round(p.x - HANDLE_SIZE / 2), Math.round(p.y - HANDLE_SIZE / 2), HANDLE_SIZE, HANDLE_SIZE);
      c.strokeRect(Math.round(p.x - HANDLE_SIZE / 2) + 0.5, Math.round(p.y - HANDLE_SIZE / 2) + 0.5, HANDLE_SIZE - 1, HANDLE_SIZE - 1);
    }
    c.restore();
    const d = this.canvasDrag;
    if (d) {
      const v = this.engine.view;
      const a = v.toScreen(0, 0);
      const b = v.toScreen(d.w, d.h);
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
    }
  }

  // ---- pointer events -------------------------------------------------------------------

  private onDown = (e: PointerEvent): void => {
    this.engine.perf.input(e.timeStamp);
    const engine = this.engine;
    // An AI assistant's step is being made: the canvas waits for it.
    if (engine.history.held) return;
    if (e.pointerType === 'pen') this.lastPenTime = e.timeStamp;
    if (e.pointerType === 'touch') {
      if (e.timeStamp - this.lastPenTime < PALM_REJECT_MS || this.toolPointerIsPen()) return;
      this.touches.set(e.pointerId, this.local(e));
      if (this.touches.size === 2) {
        // Second finger: finish any stroke and switch to pinch/pan.
        if (this.toolPointer !== null) this.endTool(e);
        this.startPinch();
        this.capture(e.pointerId);
        return;
      }
      if (this.touches.size > 2) return;
    }
    if (this.toolPointer !== null || this.panning || this.canvasDrag || this.guideDrag) return;
    const sp = this.local(e);

    if (e.button === 1 || (this.spaceDown && e.button === 0)) {
      e.preventDefault();
      this.panning = { id: e.pointerId, last: sp };
      this.capture(e.pointerId);
      this.refreshCursor();
      return;
    }

    const ch = e.button === 0 ? this.hitCanvasHandle(sp) : null;
    if (ch) {
      this.canvasDrag = { id: e.pointerId, handle: ch, w: engine.doc.width, h: engine.doc.height };
      this.capture(e.pointerId);
      return;
    }

    // Ctrl+drag moves a guide with any tool; without Ctrl, tools work right up to the guide (and snap to it).
    const g = e.button === 0 && (e.ctrlKey || e.metaKey) && this.canGrabGuide() ? engine.hitGuide(sp) : null;
    if (g) {
      this.guideDrag = { id: e.pointerId, guideId: g.id, axis: g.axis };
      engine.setGuidePreview({ axis: g.axis, pos: g.pos, id: g.id });
      this.capture(e.pointerId);
      return;
    }

    if (e.button !== 0 && e.button !== 2 && e.button !== 5) return;
    this.countClick(e);
    const button: 0 | 2 = e.button === 2 || (e.pointerType === 'pen' && (e.buttons & 2) !== 0) ? 2 : 0;
    const te = this.toToolEvent(e, button);
    if (te.eraser && engine.activeTool.paints && engine.activeTool.id !== 'eraser') {
      this.eraserOverride = engine.activeTool.id;
      engine.setTool('eraser');
    }
    this.toolPointer = e.pointerId;
    this.toolPointerType = e.pointerType;
    this.toolButton = button;
    this.capture(e.pointerId);
    this.el.focus({ preventScroll: true });
    // Touching the picture stops playback, so it holds still under the tool.
    engine.anim.stop();
    engine.activeTool.pointerDown(engine, te);
    engine.requestRender();
  };

  private toolPointerIsPen(): boolean {
    return this.toolPointerType === 'pen';
  }

  private onMove = (e: PointerEvent): void => {
    this.engine.perf.input(e.timeStamp);
    const engine = this.engine;
    const sp = this.local(e);
    if (e.pointerType === 'pen') this.lastPenTime = e.timeStamp;

    if (this.pinch && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, sp);
      this.updatePinch();
      return;
    }
    if (this.panning && e.pointerId === this.panning.id) {
      engine.panBy(sp.x - this.panning.last.x, sp.y - this.panning.last.y);
      this.panning.last = sp;
      return;
    }
    if (this.canvasDrag && e.pointerId === this.canvasDrag.id) {
      const p = engine.view.toDoc(sp.x, sp.y);
      const h = this.canvasDrag.handle;
      if (h !== 's') this.canvasDrag.w = Math.max(1, Math.round(p.x));
      if (h !== 'e') this.canvasDrag.h = Math.max(1, Math.round(p.y));
      engine.emit('canvasDrag', { w: this.canvasDrag.w, h: this.canvasDrag.h });
      engine.requestRender();
      return;
    }

    if (this.guideDrag && e.pointerId === this.guideDrag.id) {
      const p = engine.view.toDoc(sp.x, sp.y);
      const { axis, guideId } = this.guideDrag;
      engine.setGuidePreview({ axis, pos: engine.snapGuidePos(axis, axis === 'x' ? p.x : p.y), id: guideId });
      return;
    }

    const docP = engine.view.toDoc(sp.x, sp.y);
    engine.hover = docP;
    this.emitCursor(docP);

    if (this.toolPointer === e.pointerId) {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const list = events.length > 0 ? events : [e];
      for (const ce of list) engine.activeTool.pointerMove(engine, this.toToolEvent(ce, this.toolButton));
      engine.requestRender();
      return;
    }
    if (this.toolPointer === null) {
      this.ctrlHeld = e.ctrlKey || e.metaKey;
      engine.activeTool.hover?.(engine, this.toToolEvent(e, 0));
      const overGuide = this.canGrabGuide() && engine.hitGuide(sp) !== null;
      if (overGuide !== this.guideHint) {
        this.guideHint = overGuide;
        engine.setHint(overGuide ? 'hint.guide' : null);
      }
      this.refreshCursor(sp);
      engine.requestRender();
    }
  };

  private emitCursor(p: Point | null): void {
    const d = this.engine.doc;
    if (!p || p.x < 0 || p.y < 0 || p.x >= d.width || p.y >= d.height) this.engine.emit('cursor', null);
    else this.engine.emit('cursor', { x: Math.floor(p.x), y: Math.floor(p.y) });
  }

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.pinch) {
        if (this.touches.size < 2) this.pinch = null;
        return;
      }
    }
    if (this.panning && e.pointerId === this.panning.id) {
      this.panning = null;
      this.refreshCursor();
      return;
    }
    if (this.canvasDrag && e.pointerId === this.canvasDrag.id) {
      const { w, h } = this.canvasDrag;
      this.canvasDrag = null;
      this.engine.emit('canvasDrag', null);
      try {
        this.engine.canvasSize(w, h, 'nw');
      } catch (err) {
        reportEngineError(this.engine, err);
      }
      this.engine.requestRender();
      return;
    }
    if (this.guideDrag && e.pointerId === this.guideDrag.id) {
      const { guideId } = this.guideDrag;
      this.guideDrag = null;
      const sp = this.local(e);
      const pos = this.engine.guidePreview?.pos;
      this.engine.setGuidePreview(null);
      // Dragged back onto a ruler (or anywhere off the canvas view): the guide goes away.
      const inside = sp.x >= 0 && sp.y >= 0 && sp.x <= this.el.clientWidth && sp.y <= this.el.clientHeight;
      if (!inside) this.engine.removeGuide(guideId);
      else if (pos !== undefined) this.engine.moveGuide(guideId, pos);
      this.refreshCursor(sp);
      return;
    }
    if (this.toolPointer === e.pointerId) this.endTool(e);
  };

  /** Guides can be dragged with any tool, unless locked or something is being edited. */
  private canGrabGuide(): boolean {
    return !this.engine.viewSettings.lockGuides && this.engine.live === null;
  }

  private endTool(e: PointerEvent): void {
    const engine = this.engine;
    engine.activeTool.pointerUp(engine, this.toToolEvent(e, this.toolButton));
    this.toolPointer = null;
    this.toolPointerType = null;
    engine.endSnap();
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (this.eraserOverride) {
      const back = this.eraserOverride;
      this.eraserOverride = null;
      engine.setTool(back);
    }
    this.refreshCursor(this.local(e));
    engine.requestRender();
  }

  private onCancel = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (this.panning?.id === e.pointerId) this.panning = null;
    if (this.canvasDrag?.id === e.pointerId) {
      this.canvasDrag = null;
      this.engine.emit('canvasDrag', null);
    }
    if (this.guideDrag?.id === e.pointerId) {
      this.guideDrag = null;
      this.engine.setGuidePreview(null);
    }
    if (this.toolPointer === e.pointerId) this.endTool(e);
  };

  private onLeave = (e: PointerEvent): void => {
    if (this.toolPointer !== null) return;
    if (e.pointerType !== 'touch') {
      this.engine.hover = null;
      this.engine.emit('cursor', null);
      this.engine.requestRender();
    }
  };

  private onContext = (e: Event): void => {
    e.preventDefault();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const engine = this.engine;
    const sp = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? engine.view.height : 1;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+wheel and touchpad pinch zoom around the pointer.
      const factor = Math.exp((-e.deltaY * unit) / 300);
      engine.zoomAt(engine.view.zoom * factor, sp.x, sp.y);
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? e.deltaX : e.deltaY;
    engine.panBy(-dx * unit, -dy * unit);
  };

  private startPinch(): void {
    const [a, b] = [...this.touches.values()];
    this.pinch = {
      dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      zoom: this.engine.view.zoom,
    };
  }

  private updatePinch(): void {
    const p = this.pinch;
    if (!p || this.touches.size < 2) return;
    const [a, b] = [...this.touches.values()];
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.engine.panBy(mid.x - p.mid.x, mid.y - p.mid.y);
    this.engine.zoomAt(p.zoom * (dist / p.dist), mid.x, mid.y);
    p.mid = mid;
  }

  // ---- keyboard -------------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === ' ' && !isTyping(e)) {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.refreshCursor();
      }
      if (document.activeElement === this.el || document.activeElement === document.body) e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      this.spaceDown = false;
      this.refreshCursor();
    }
  };

  private onBlur = (): void => {
    this.spaceDown = false;
    this.refreshCursor();
  };

  /** Pick the CSS cursor for the current state and hover point. */
  refreshCursor(sp?: Point): void {
    const engine = this.engine;
    if (this.panning) return engine.setCursor('grabbing');
    if (this.spaceDown) return engine.setCursor('grab');
    if (sp) {
      const h = this.hitCanvasHandle(sp);
      if (h) return engine.setCursor(h === 'e' ? 'ew-resize' : h === 's' ? 'ns-resize' : 'nwse-resize');
      const g = this.ctrlHeld && this.canGrabGuide() ? engine.hitGuide(sp) : null;
      if (g) return engine.setCursor(g.axis === 'x' ? 'ew-resize' : 'ns-resize');
    }
    engine.setCursor(engine.activeTool.cursor(engine, engine.hover));
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

export function reportEngineError(engine: Engine, err: unknown): void {
  const key = (err as { key?: unknown })?.key;
  if (typeof key === 'string') engine.notify('error', key as never, (err as { params?: Record<string, string> }).params);
  else engine.notify('error', 'error.generic', { message: err instanceof Error ? err.message : String(err) });
}
