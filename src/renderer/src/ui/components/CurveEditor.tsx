import { useRef, useState } from 'react';
import { addCurvePoint, moveCurvePoint, removeCurvePoint, type Curve } from '@engine/brush/curve';
import { t } from '../../i18n';

/** A response curve: drag points, click empty space to add one, double-click a point to remove it. */
/** `shape` draws the line as the curve is used (e.g. smoothed); straight between points if not given. */
export function CurveEditor({ curve, onChange, label, shape }: { curve: Curve; onChange: (c: Curve) => void; label: string; shape?: (c: Curve, x: number) => number }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const [sel, setSel] = useState(0);
  const W = 200;
  const H = 140;
  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) };
  };
  const line: (readonly [number, number])[] = shape ? Array.from({ length: 65 }, (_, i) => [i / 64, Math.min(1, Math.max(0, shape(curve, i / 64)))] as const) : [...curve];
  const pts = line.map(([x, y]) => `${x * W},${(1 - y) * H}`).join(' ');
  return (
    <svg
      ref={ref}
      className="bd-curve"
      viewBox={`-6 -6 ${W + 12} ${H + 12}`}
      role="group"
      aria-label={label}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget && !(e.target instanceof SVGRectElement)) return;
        const p = at(e);
        const { curve: next, index } = addCurvePoint(curve, p.x, p.y);
        if (index < 0) return;
        onChange(next);
        setSel(index);
        drag.current = index;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        const p = at(e);
        onChange(moveCurvePoint(curve, drag.current, p.x, p.y));
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <rect x={0} y={0} width={W} height={H} className="bd-curve-bg" />
      <line x1={0} y1={H} x2={W} y2={0} className="bd-curve-diag" />
      <polyline points={pts} className="bd-curve-line" />
      {curve.map(([x, y], i) => (
        <circle
          key={i}
          cx={x * W}
          cy={(1 - y) * H}
          r={6}
          className={`bd-curve-pt${i === sel ? ' current' : ''}`}
          tabIndex={0}
          role="slider"
          aria-label={t('brushDesigner.curvePoint', { n: i + 1 })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(y * 100)}
          aria-valuetext={t('brushDesigner.curvePointValue', { x: Math.round(x * 100), y: Math.round(y * 100) })}
          onPointerDown={(e) => {
            e.stopPropagation();
            setSel(i);
            drag.current = i;
            ref.current?.setPointerCapture(e.pointerId);
          }}
          onDoubleClick={() => onChange(removeCurvePoint(curve, i))}
          onFocus={() => setSel(i)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.01;
            const d: Record<string, [number, number]> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowRight: [step, 0], ArrowLeft: [-step, 0] };
            if (d[e.key]) {
              e.preventDefault();
              onChange(moveCurvePoint(curve, i, x + d[e.key][0], y + d[e.key][1]));
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              onChange(removeCurvePoint(curve, i));
            }
          }}
        />
      ))}
    </svg>
  );
}
