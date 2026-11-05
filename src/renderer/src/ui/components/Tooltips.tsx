import { useEffect, useState } from 'react';
import { displayCombo } from '../actions/keymap';

interface Tip {
  text: string;
  kbd: string | null;
  x: number;
  y: number;
}

/**
 * One tooltip layer for the whole app. Any element with `data-tip` (and optionally `data-kbd`)
 * gets a tooltip on hover or keyboard focus, so components don't each manage their own.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement, delay: number) => {
      window.clearTimeout(timer);
      current = el;
      timer = window.setTimeout(() => {
        if (!current || !document.contains(current)) return;
        const text = current.dataset.tip;
        if (!text) return;
        const r = current.getBoundingClientRect();
        setTip({ text, kbd: current.dataset.kbd ?? null, x: r.left + r.width / 2, y: r.bottom + 8 });
      }, delay);
    };
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
      if (el === current) return;
      if (!el) return hide();
      setTip(null);
      show(el, 500);
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el?.matches?.(':focus-visible') && el.dataset.tip) show(el, 250);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  const left = Math.max(8, Math.min(tip.x - 140, window.innerWidth - 300));
  return (
    <div
      className="tooltip"
      role="tooltip"
      ref={(el) => {
        if (el) placeTooltip(el, tip);
      }}
      style={{ left, top: tip.y }}
    >
      {tip.text}
      {tip.kbd ? <kbd>{displayCombo(tip.kbd)}</kbd> : null}
    </div>
  );
}

/** Centre the tooltip under its anchor, keeping it on screen (flip above near the bottom). */
function placeTooltip(el: HTMLElement, tip: Tip): void {
  const r = el.getBoundingClientRect();
  const x = Math.max(8, Math.min(tip.x - r.width / 2, window.innerWidth - r.width - 8));
  let y = tip.y;
  if (y + r.height > window.innerHeight - 8) y = tip.y - r.height - 40;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}
