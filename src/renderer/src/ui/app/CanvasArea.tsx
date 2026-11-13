import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import { updateSettings, useUi } from '../state/store';
import { PerfOverlay } from './PerfOverlay';
import { viewOptionsOf } from '../state/engine';
import { openDroppedFile } from '../services/files';

function niceStep(zoom: number): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  return steps.find((s) => s * zoom >= 56) ?? 10000;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function Ruler({ axis }: { axis: 'x' | 'y' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // The top ruler makes horizontal guides (constant y), the left one vertical guides.
  const guideAxis = axis === 'x' ? 'y' : 'x';
  const dragging = useRef(false);

  /** Where a guide dragged out of the ruler would go, and whether the pointer is over the canvas. */
  const guideAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const host = document.querySelector('.canvas-host')!.getBoundingClientRect();
    const sx = e.clientX - host.left;
    const sy = e.clientY - host.top;
    const p = engine.view.toDoc(sx, sy);
    const inside = sx >= 0 && sy >= 0 && sx <= host.width && sy <= host.height;
    return { inside, pos: engine.snapGuidePos(guideAxis, guideAxis === 'x' ? p.x : p.y) };
  };
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const v = useUi.getState().settings.view;
    if (!v.showGuides) {
      const next = { ...v, showGuides: true };
      updateSettings({ view: next });
      engine.setViewOptions(viewOptionsOf(next));
    }
    engine.setGuidePreview({ axis: guideAxis, pos: guideAt(e).pos, id: null });
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragging.current) engine.setGuidePreview({ axis: guideAxis, pos: guideAt(e).pos, id: null });
  };
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const { inside, pos } = guideAt(e);
    engine.setGuidePreview(null);
    if (inside) engine.addGuide(guideAxis, pos);
  };
  const view = useUi((s) => s.view);
  const cursor = useUi((s) => s.cursor);
  const theme = useUi((s) => s.settings.theme);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const len = axis === 'x' ? view.width : view.height;
    const thick = 20;
    c.width = Math.round((axis === 'x' ? len : thick) * dpr);
    c.height = Math.round((axis === 'x' ? thick : len) * dpr);
    c.style.width = `${axis === 'x' ? len : thick}px`;
    c.style.height = `${axis === 'x' ? thick : len}px`;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    // A turned view has no meaningful ruler marks (guides can still be dragged out).
    if (view.rotation !== 0) return;
    const tick = cssVar('--ruler-tick');
    g.strokeStyle = tick;
    g.fillStyle = tick;
    g.lineWidth = 1;
    g.font = '9.5px "Inter Variable", "Segoe UI", sans-serif';
    const step = niceStep(view.zoom);
    const pan = axis === 'x' ? view.panX : view.panY;
    const start = Math.floor(-pan / view.zoom / step) * step;
    const end = (len - pan) / view.zoom;
    g.beginPath();
    for (let v = start; v <= end; v += step) {
      const p = Math.round(pan + v * view.zoom) + 0.5;
      for (let k = 1; k < 5; k++) {
        const q = Math.round(pan + (v + (step * k) / 5) * view.zoom) + 0.5;
        if (axis === 'x') {
          g.moveTo(q, thick - 4);
          g.lineTo(q, thick);
        } else {
          g.moveTo(thick - 4, q);
          g.lineTo(thick, q);
        }
      }
      if (axis === 'x') {
        g.moveTo(p, 4);
        g.lineTo(p, thick);
        g.fillText(String(v), p + 3, 11);
      } else {
        g.moveTo(4, p);
        g.lineTo(thick, p);
        g.save();
        g.translate(11, p + 3);
        g.rotate(-Math.PI / 2);
        g.fillText(String(v), -g.measureText(String(v)).width - 4, 0);
        g.restore();
      }
    }
    g.stroke();
    if (cursor) {
      const p = Math.round(pan + ((axis === 'x' ? cursor.x : cursor.y) + 0.5) * view.zoom) + 0.5;
      g.strokeStyle = cssVar('--accent');
      g.lineWidth = 1.5;
      g.beginPath();
      if (axis === 'x') {
        g.moveTo(p, 0);
        g.lineTo(p, thick);
      } else {
        g.moveTo(0, p);
        g.lineTo(thick, p);
      }
      g.stroke();
    }
  }, [axis, view, cursor, theme]);

  return (
    <canvas
      ref={ref}
      className={`ruler ${axis === 'x' ? 'top' : 'left'}`}
      aria-hidden="true"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        dragging.current = false;
        engine.setGuidePreview(null);
      }}
    />
  );
}

function Scrollbar({ axis }: { axis: 'x' | 'y' }) {
  const view = useUi((s) => s.view);
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: number; offset: number } | null>(null);
  const info = engine.view.scrollInfo(axis);
  const len = axis === 'x' ? view.width : view.height;
  if (info.content <= info.viewport + 0.5) return <div className={`scrollbar ${axis === 'x' ? 'h' : 'v'}`} />;
  const thumbLen = Math.max(28, (info.viewport / info.content) * len);
  const thumbPos = (info.offset / (info.content - info.viewport)) * (len - thumbLen);
  const toOffset = (px: number) => (px / (len - thumbLen)) * (info.content - info.viewport);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ start: axis === 'x' ? e.clientX : e.clientY, offset: info.offset });
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const d = (axis === 'x' ? e.clientX : e.clientY) - drag.start;
    engine.scrollTo(axis, drag.offset + toOffset(d));
  };
  const onTrack = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== track.current) return;
    const r = track.current.getBoundingClientRect();
    const at = axis === 'x' ? e.clientX - r.left : e.clientY - r.top;
    const page = info.viewport * 0.9;
    engine.scrollTo(axis, info.offset + (at < thumbPos ? -page : page));
  };
  const style = axis === 'x' ? { left: thumbPos, width: thumbLen } : { top: thumbPos, height: thumbLen };
  return (
    <div ref={track} className={`scrollbar ${axis === 'x' ? 'h' : 'v'}`} onPointerDown={onTrack}>
      <div
        className={`thumb ${drag ? 'dragging' : ''}`}
        style={style}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      />
    </div>
  );
}

/**
 * In-place text editor: a transparent textarea laid exactly over the engine's rendering of
 * the text, so the caret and selection line up with the real pixels.
 */
function TextEditor() {
  const text = useUi((s) => s.text);
  const view = useUi((s) => s.view);
  const ref = useRef<HTMLTextAreaElement>(null);
  const session = text?.session;

  useEffect(() => {
    if (session === undefined) return;
    const el = ref.current;
    if (!el) return;
    el.value = engine.live?.kind === 'text' ? (useUi.getState().text?.text ?? '') : '';
    el.focus();
  }, [session]);

  if (!text) return null;
  const z = view.zoom;
  // Where the box's corner is on screen (turned with the view about its centre).
  const ux = text.x * z + view.panX - view.width / 2;
  const uy = text.y * z + view.panY - view.height / 2;
  const a = (view.rotation * Math.PI) / 180;
  const sx = view.width / 2 + ux * Math.cos(a) - uy * Math.sin(a);
  const sy = view.height / 2 + ux * Math.sin(a) + uy * Math.cos(a);
  const font = text.fontCss.replace(`${text.fontPx}px`, `${text.fontPx * z}px`);
  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label={t('tool.text')}
      spellCheck={false}
      autoComplete="off"
      wrap="off"
      style={{
        left: sx,
        top: sy,
        width: Math.max(4, text.w * z),
        height: Math.max(text.lineHeightPx * z, text.h * z),
        font,
        lineHeight: `${text.lineHeightPx * z}px`,
        padding: `0 ${z}px`,
        textAlign: text.align,
        caretColor: text.color,
        transform: view.rotation ? `rotate(${view.rotation}deg)` : undefined,
        transformOrigin: '0 0',
      }}
      onChange={(e) => engine.updateText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) {
          e.preventDefault();
          engine.commitLive();
        }
      }}
    />
  );
}

export function CanvasArea() {
  const host = useRef<HTMLDivElement>(null);
  const rulers = useUi((s) => s.settings.view.rulers);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    engine.attach(el);
    return () => engine.detach();
  }, []);

  return (
    <div className="canvas-wrap" style={rulers ? undefined : { gridTemplateColumns: '0 1fr 12px', gridTemplateRows: '0 1fr 12px' }}>
      {rulers ? (
        <>
          <div className="ruler-corner" />
          <Ruler axis="x" />
          <Ruler axis="y" />
        </>
      ) : null}
      <div
        ref={host}
        className={`canvas-host ${dropping ? 'drop-target' : ''}`}
        role="application"
        aria-label={t('a11y.canvas')}
        tabIndex={-1}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          const f = e.dataTransfer.files[0];
          if (f) void openDroppedFile(f);
        }}
      >
        <TextEditor />
        <PerfOverlay />
      </div>
      <Scrollbar axis="x" />
      <Scrollbar axis="y" />
    </div>
  );
}
