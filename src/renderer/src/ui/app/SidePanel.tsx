import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { t, type I18nKey } from '../../i18n';
import { Icon } from '../icons/Icon';
import { engine } from '../state/engine';
import { updateSettings, useUi } from '../state/store';
import { LayersPanel } from './LayersPanel';

export function Section({ id, title, icon, children, grow }: { id: string; title: string; icon: string; children: ReactNode; grow?: boolean }) {
  const collapsed = useUi((s) => s.settings.panels.collapsed[id] === true);
  const toggle = () => {
    const p = useUi.getState().settings.panels;
    updateSettings({ panels: { ...p, collapsed: { ...p.collapsed, [id]: !collapsed } } });
  };
  const bodyId = `panel-${id}`;
  return (
    <section className={`panel-section panel-section-${id} ${grow && !collapsed ? 'grow' : ''}`} aria-label={title}>
      <button
        type="button"
        className="panel-section-head"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={toggle}
        data-tip={t(collapsed ? 'panel.expand' : 'panel.collapse', { name: title })}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
        <Icon name={icon} size={16} />
        {title}
      </button>
      {collapsed ? null : (
        <div className="panel-section-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

function HistoryList() {
  const h = useUi((s) => s.history);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Scroll only the panel body holding the list (scrollIntoView would move the whole panel).
    const row = listRef.current?.querySelector<HTMLElement>('.current');
    const body = listRef.current?.parentElement;
    if (!row || !body) return;
    const top = row.offsetTop;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (top + row.offsetHeight > body.scrollTop + body.clientHeight) body.scrollTop = top + row.offsetHeight - body.clientHeight;
  }, [h.index, h.length]);
  const rows: { label: I18nKey; index: number }[] = [{ label: h.initialLabel, index: 0 }, ...h.entries.map((e, i) => ({ label: e.label, index: i + 1 }))];
  return (
    <>
      <ol className="history-list" ref={listRef}>
        {rows.map((r) => (
          <li key={r.index}>
            <button
              type="button"
              className={r.index === h.index ? 'current' : r.index > h.index ? 'future' : ''}
              aria-current={r.index === h.index ? 'step' : undefined}
              aria-label={t('panel.history.jump', { name: t(r.label) })}
              onClick={() => engine.jumpTo(r.index)}
            >
              <Icon name={r.index === 0 ? 'new' : 'history'} size={14} />
              {t(r.label)}
            </button>
          </li>
        ))}
      </ol>
      {h.length === 0 ? <div className="history-empty">{t('panel.history.empty')}</div> : null}
    </>
  );
}

function Navigator() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useUi((s) => s.settings.panels.width);
  const doc = useUi((s) => s.doc);
  const view = useUi((s) => s.view);
  const [tick, setTick] = useState(0);
  const maxW = Math.max(120, width - 24);
  const maxH = 130;
  const scale = Math.min(maxW / doc.width, maxH / doc.height, 1);
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));

  useEffect(() => engine.on('pixels', () => setTick((n) => n + 1)), []);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (g) engine.renderer.drawThumbnail(g, c.width, c.height);
  }, [w, h, tick, doc]);

  // Visible document area from the current view (clamped to the document).
  const clampX = (v: number) => Math.min(doc.width, Math.max(0, v));
  const clampY = (v: number) => Math.min(doc.height, Math.max(0, v));
  const x0 = clampX(-view.panX / view.zoom);
  const y0 = clampY(-view.panY / view.zoom);
  const x1 = clampX((view.width - view.panX) / view.zoom);
  const y1 = clampY((view.height - view.panY) / view.zoom);
  const box = x1 > x0 && y1 > y0 ? { left: x0 * scale, top: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale } : null;
  const full = x1 - x0 >= doc.width && y1 - y0 >= doc.height;

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    engine.centerOn((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
  };
  return (
    <div className="navigator">
      <div style={{ position: 'relative', width: w, height: h }}>
        <canvas
          ref={canvas}
          style={{ width: w, height: h }}
          aria-label={t('panel.navigator')}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            move(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) move(e);
          }}
        />
        {box && !full ? <div className="viewbox" aria-label={t('a11y.navigatorView')} style={box} /> : null}
      </div>
    </div>
  );
}

export function SidePanel() {
  const panels = useUi((s) => s.settings.panels);
  const simple = useUi((s) => s.settings.ui.mode === 'simple');
  const [width, setWidth] = useState(panels.width);
  useEffect(() => setWidth(panels.width), [panels.width]);
  if (!panels.open) return null;
  const showHistory = panels.visible.history !== false;
  const showNav = panels.visible.navigator !== false;
  // Simple mode has no Layers panel (the picture keeps its layers).
  const showLayers = panels.visible.layers !== false && !simple;
  if (!showHistory && !showNav && !showLayers) return null;

  const onResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startW = width;
    const dir = panels.side === 'right' ? -1 : 1;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let latest = startW;
    const moveFn = (ev: PointerEvent) => {
      latest = Math.min(600, Math.max(180, startW + dir * (ev.clientX - startX)));
      setWidth(latest);
    };
    const up = () => {
      el.removeEventListener('pointermove', moveFn);
      el.removeEventListener('pointerup', up);
      updateSettings({ panels: { ...useUi.getState().settings.panels, width: latest } });
    };
    el.addEventListener('pointermove', moveFn);
    el.addEventListener('pointerup', up);
  };

  return (
    <aside className="sidepanel" data-tour="panels" style={{ width }} aria-label={t('action.panels')}>
      <div
        className="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('a11y.panelResize')}
        aria-valuenow={Math.round(width)}
        aria-valuemin={180}
        aria-valuemax={600}
        tabIndex={0}
        onPointerDown={onResize}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
          if (!d) return;
          const next = Math.min(600, Math.max(180, width + (panels.side === 'right' ? -d : d)));
          updateSettings({ panels: { ...panels, width: next } });
        }}
      />
      <div className="panel-head">
        <span>{t('panel.title')}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('panel.close')}
          data-tip={t('panel.close')}
          onClick={() => updateSettings({ panels: { ...panels, open: false } })}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      {showNav ? (
        <Section id="navigator" title={t('panel.navigator')} icon="navigator">
          <Navigator />
        </Section>
      ) : null}
      {showLayers ? (
        <Section id="layers" title={t('panel.layers')} icon="layers" grow>
          <LayersPanel />
        </Section>
      ) : null}
      {showHistory ? (
        <Section id="history" title={t('panel.history')} icon="history" grow>
          <HistoryList />
        </Section>
      ) : null}
    </aside>
  );
}
