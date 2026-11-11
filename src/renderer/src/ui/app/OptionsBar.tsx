import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react';
import { assetCanvas } from '@engine/vector/assets';
import { MAX_SEGMENTS, MIN_SEGMENTS, SYMMETRY_MODES, type Symmetry } from '@engine/brush/symmetry';
import { Popover } from '../components/Popover';
import { pickFillImage } from '../services/files';
import type { OptionSpec } from '@engine/tools/Tool';
import type { LayerNode } from '@engine/doc/LayerController';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { t, type I18nKey } from '../../i18n';
import { Icon } from '../icons/Icon';
import { NumberField, Segmented, Slider } from '../components/Controls';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { actions, runAction } from '../actions/actions';
import { GradientButton, PatternPicker } from './PaintOptions';
import { SelectedShapeParams, ShapeOption, ShapeToolParams } from './ShapeGallery';

const FALLBACK_FONTS = ['Segoe UI', 'Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Georgia', 'Impact', 'Segoe Print', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

function FontPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const fonts = useUi((s) => s.fonts);
  const list = fonts.length > 0 ? fonts : FALLBACK_FONTS;
  const options = list.includes(value) ? list : [value, ...list];
  return (
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 180 }}>
      {options.map((f) => (
        <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
          {f}
        </option>
      ))}
    </select>
  );
}

function OptionControl({ toolId, spec, values, inPopover = false }: { toolId: string; spec: OptionSpec; values: Record<string, unknown>; inPopover?: boolean }) {
  const set = (v: unknown) => engine.setToolOption(toolId, spec.key, v);
  const label = t(spec.labelKey);
  switch (spec.type) {
    case 'slider': {
      const v = Number(values[spec.key] ?? spec.default);
      return (
        <span className="opt">
          <span>{label}</span>
          {spec.presets ? (
            <span className="chips" role="group" aria-label={label}>
              {spec.presets.map((p) => (
                <button key={p} type="button" className="chip" aria-pressed={v === p} onClick={() => set(p)}>
                  {p}
                </button>
              ))}
            </span>
          ) : null}
          <Slider value={v} onChange={set} min={spec.min} max={spec.max} step={spec.step} unit={spec.unit} log={spec.log} label={label} />
        </span>
      );
    }
    case 'toggle': {
      const v = values[spec.key] === true;
      if (spec.icon) {
        return (
          <button type="button" className="icon-btn" aria-pressed={v} aria-label={label} data-tip={label} onClick={() => set(!v)}>
            <Icon name={spec.icon} size={17} />
          </button>
        );
      }
      return (
        <label className="check opt">
          <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} />
          {label}
        </label>
      );
    }
    case 'segmented':
      return (
        <span className="opt">
          {spec.iconsOnly && !inPopover ? null : <span>{label}</span>}
          <Segmented
            value={String(values[spec.key] ?? spec.default)}
            onChange={set}
            label={label}
            iconsOnly={spec.iconsOnly}
            choices={spec.choices.map((c) => ({ value: c.value, label: t(c.labelKey), icon: c.icon }))}
          />
        </span>
      );
    case 'font':
      return (
        <span className="opt">
          <FontPicker value={String(values[spec.key] ?? spec.default)} onChange={set} label={label} />
        </span>
      );
    case 'gradient':
      return <GradientButton value={values[spec.key] ?? spec.default} label={label} toolId={toolId} optKey={spec.key} />;
    case 'pattern':
      return <PatternPicker value={String(values[spec.key] ?? spec.default)} onChange={set} label={label} />;
    case 'shape':
      return <ShapeOption value={values[spec.key] ?? spec.default} />;
    case 'image':
      return <ImageOption value={String(values[spec.key] ?? '')} onChange={set} label={label} />;
    case 'popover':
      return <OptionPopover toolId={toolId} spec={spec} values={values} />;
    case 'shapeParams':
      return <ShapeToolParams values={values} />;
    case 'hint':
      return (
        <span className="opt-hint" data-tip={label}>
          {label}
        </span>
      );
  }
}

/** A mouse wheel over the options scrolls them sideways. */
function scrollSideways(e: WheelEvent<HTMLDivElement>): void {
  const el = e.currentTarget;
  if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  el.scrollLeft += e.deltaY;
}

/** Options that don't fit scroll sideways, with arrow buttons at the clipped ends. */
function OptionScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  // Options come and go with the tool and its values, so watch every child's size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  });
  const scrollBy = (d: number) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollBy({ left: d, behavior: reduce ? 'auto' : 'smooth' });
  };
  return (
    <>
      {edges.left ? (
        <button type="button" className="opt-scroll-btn" tabIndex={-1} aria-label={t('a11y.scrollLeft')} onClick={() => scrollBy(-240)}>
          <Icon name="chevron-left" size={14} />
        </button>
      ) : null}
      <div ref={ref} className="opt-scroll" onScroll={update} onWheel={scrollSideways}>
        {children}
      </div>
      {edges.right ? (
        <button type="button" className="opt-scroll-btn" tabIndex={-1} aria-label={t('a11y.scrollRight')} onClick={() => scrollBy(240)}>
          <Icon name="chevron-right" size={14} />
        </button>
      ) : null}
    </>
  );
}

/** Brush symmetry (shared by every brush tool): mode, radial segments, centre. */
function SymmetryControl() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const sym = useUi((s) => s.symmetry);
  const label = t('opt.symmetry');
  return (
    <span className="opt">
      <button ref={ref} type="button" className="opt-pop-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="symmetry" size={15} />
        <span>{label}</span>
        <span className="opt-pop-summary">{t(`symmetry.${sym.mode}` as I18nKey)}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      <Popover anchor={ref} open={open} onClose={close} label={label} className="opt-popover">
        <span className="opt">
          <span>{t('opt.symmetryMode')}</span>
          <Segmented
            value={sym.mode}
            onChange={(v) => engine.setSymmetry({ mode: v as Symmetry['mode'] })}
            label={t('opt.symmetryMode')}
            choices={SYMMETRY_MODES.map((m) => ({ value: m, label: t(`symmetry.${m}` as I18nKey) }))}
          />
        </span>
        {sym.mode === 'radial' ? (
          <span className="opt">
            <span>{t('opt.symmetrySegments')}</span>
            <Slider value={sym.segments} min={MIN_SEGMENTS} max={MAX_SEGMENTS} step={1} label={t('opt.symmetrySegments')} onChange={(v) => engine.setSymmetry({ segments: v })} />
          </span>
        ) : null}
        {sym.mode !== 'off' ? (
          <span className="opt">
            <span className="opt-hint">{t('symmetry.hint')}</span>
            <button type="button" className="btn small" disabled={!sym.center} onClick={() => engine.setSymmetry({ center: null })}>
              {t('symmetry.recenter')}
            </button>
          </span>
        ) : null}
      </Popover>
    </span>
  );
}

/** A picture for image fills: a preview and a button to choose another. */
function ImageOption({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const img = value ? assetCanvas(value) : null;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!img) return;
    const k = Math.max(c.width / img.width, c.height / img.height);
    ctx.drawImage(img, (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k);
  }, [img]);
  return (
    <span className="opt">
      <span>{label}</span>
      {img ? <canvas ref={ref} className="image-swatch checker-bg" width={48} height={48} aria-hidden="true" /> : null}
      <button type="button" className="btn small" onClick={() => void pickFillImage().then((id) => id && onChange(id))}>
        {t(img ? 'opt.fillImage.change' : 'opt.fillImage.choose')}
      </button>
    </span>
  );
}

/** A button that opens more options (fill or outline styles) in a popover. */
function OptionPopover({ toolId, spec, values }: { toolId: string; spec: Extract<OptionSpec, { type: 'popover' }>; values: Record<string, unknown> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const label = t(spec.labelKey);
  const summary = spec.summary ? t(spec.summary(values)) : null;
  const inner = spec.options.filter((o) => !o.visibleIf || o.visibleIf(values));
  return (
    <span className="opt">
      <button ref={ref} type="button" className="opt-pop-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={spec.icon} size={15} />
        <span>{label}</span>
        {summary ? <span className="opt-pop-summary">{summary}</span> : null}
        <Icon name="chevron-down" size={12} />
      </button>
      <Popover anchor={ref} open={open} onClose={close} label={label} className="opt-popover">
        {inner.map((o) => (
          <OptionControl key={o.key} toolId={toolId} spec={o} values={values} inPopover />
        ))}
      </Popover>
    </span>
  );
}

/** Kind of a layer in the tree (the Layers info the store mirrors). */
function findKind(tree: LayerNode[], id: string): LayerNode['kind'] | null {
  for (const n of tree) {
    if (n.id === id) return n.kind;
    const k = findKind(n.children, id);
    if (k) return k;
  }
  return null;
}

/** An action as a small icon button (enabled state from the action). */
function ActionIcon({ id }: { id: string }) {
  const a = actions().get(id)!;
  const enabled = useUi((s) => (a.enabled ? a.enabled(s) : true));
  return (
    <button type="button" className="icon-btn" aria-label={t(a.labelKey)} data-tip={t(a.labelKey)} disabled={!enabled} onClick={() => runAction(id)}>
      <Icon name={a.icon ?? 'info'} size={16} />
    </button>
  );
}

/** Move tool on a shape layer: align, distribute, arrange, group and rasterise. */
function VectorBar() {
  const isVector = useUi((s) => findKind(s.layers.tree, s.layers.activeId)) === 'vector';
  if (!isVector) return null;
  const group = (ids: string[]) => (
    <span className="opt tf-field" role="group">
      {ids.map((id) => (
        <ActionIcon key={id} id={id} />
      ))}
    </span>
  );
  return (
    <span className="opt vector-bar" role="group" aria-label={t('a11y.shapeTools')}>
      {group(['alignLeft', 'alignHCenter', 'alignRight', 'alignTop', 'alignVCenter', 'alignBottom'])}
      {group(['distributeH', 'distributeV'])}
      {group(['bringToFront', 'bringForward', 'sendBackward', 'sendToBack'])}
      {group(['groupShapes', 'ungroupShapes'])}
      {group(['convertToPath', 'saveShape', 'rasterizeLayer'])}
    </span>
  );
}

/** A path being drawn or edited: finish, close or open it, and change or remove its points. */
function PathBar() {
  const info = useUi((s) => s.path);
  if (!info) return null;
  const btn = (label: string, icon: string, run: () => void, disabled = false, pressed?: boolean) => (
    <button type="button" className="icon-btn" aria-label={label} data-tip={label} disabled={disabled} aria-pressed={pressed} onClick={run}>
      <Icon name={icon} size={16} />
    </button>
  );
  return (
    <span className="opt tf-field" role="group" aria-label={t('a11y.pathTools')}>
      {info.drawing ? btn(t('path.finish'), 'check', () => engine.pathCommand('finish'), info.anchors < 2) : null}
      {btn(t(info.closed ? 'path.open' : 'path.close'), info.closed ? 'path-open' : 'path-close', () => engine.pathCommand(info.closed ? 'open' : 'close'), info.anchors < 2)}
      {btn(t('path.smooth'), 'point-smooth', () => engine.pathCommand('smooth'), !info.selected || info.drawing, info.selected?.smooth === true)}
      {btn(t('path.corner'), 'point-corner', () => engine.pathCommand('corner'), !info.selected || info.drawing, info.selected ? !info.selected.smooth : undefined)}
      {btn(t('path.deletePoint'), 'delete', () => engine.pathCommand('delete'), !info.selected || info.drawing)}
      {info.drawing ? null : <ActionIcon id="saveShape" />}
    </span>
  );
}

/** Free transform: position, scale, rotation and skew as numbers, plus flips. */
function TransformFields() {
  const info = useUi((s) => s.transform);
  if (!info) return null;
  const field = (key: 'x' | 'y' | 'w' | 'h' | 'angle' | 'skew', unit: string, min: number, max: number, decimals: number) => {
    const label = t(`transform.${key}`);
    return (
      <span className="opt tf-field">
        <span>{label}</span>
        <NumberField
          className="num tf-num"
          value={Math.round(info[key] * 10 ** decimals) / 10 ** decimals}
          decimals={decimals}
          min={min}
          max={max}
          label={label}
          onChange={(v) => engine.setTransformValues({ [key]: v })}
          // Enter sets the value and returns to the canvas, so the next Enter applies.
          onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
        />
        <span className="unit">{unit}</span>
      </span>
    );
  };
  return (
    <>
      {field('x', 'px', -100000, 100000, 0)}
      {field('y', 'px', -100000, 100000, 0)}
      {field('w', '%', -100000, 100000, 1)}
      {field('h', '%', -100000, 100000, 1)}
      {field('angle', '°', -3600, 3600, 1)}
      {field('skew', '°', -85, 85, 1)}
      <button type="button" className="icon-btn" aria-label={t('transform.flipH')} data-tip={t('transform.flipH')} onClick={() => engine.flip('h')}>
        <Icon name="flip-h" size={16} />
      </button>
      <button type="button" className="icon-btn" aria-label={t('transform.flipV')} data-tip={t('transform.flipV')} onClick={() => engine.flip('v')}>
        <Icon name="flip-v" size={16} />
      </button>
      {info.distorted ? (
        <span className="opt-hint" data-tip={t('transform.perspective')}>
          <Icon name="tf-perspective" size={16} />
        </span>
      ) : null}
    </>
  );
}

export function OptionsBar() {
  const toolId = useUi((s) => s.tool);
  const values = useUi((s) => s.toolOptions[toolId]) ?? engine.options(toolId);
  const live = useUi((s) => s.live);
  const transparent = useUi((s) => s.transparentSelection);
  // Move's style options only mean something on a shape layer.
  const shapeLayer = useUi((s) => findKind(s.layers.tree, s.layers.activeId)) === 'vector';
  const tool = toolRegistry.get(toolId);
  if (!tool) return <div className="optionsbar" />;
  const visible = tool.id === 'move' && !shapeLayer ? [] : tool.options.filter((o) => !o.visibleIf || o.visibleIf(values));
  return (
    <div className="optionsbar" role="toolbar" aria-label={t('a11y.toolOptions')}>
      <span className="tool-name">
        <Icon name={tool.icon} size={18} />
        {t(tool.labelKey)}
      </span>
      {/* Options scroll sideways when they don't fit; Apply and Cancel always stay in view. */}
      <OptionScroller>
        {tool.group === 'selection' && !tool.hidden && tool.id !== 'move' ? (
          <label className="check opt">
            <input type="checkbox" checked={transparent} onChange={() => runAction('transparentSelection')} />
            {t('action.transparentSelection')}
          </label>
        ) : null}
        {visible.map((spec) => (
          <OptionControl key={spec.key} toolId={toolId} spec={spec} values={values} />
        ))}
        {toolId === 'transform' ? <TransformFields /> : null}
        {tool.symmetry ? <SymmetryControl /> : null}
        <PathBar />
        {toolId === 'move' && shapeLayer ? <SelectedShapeParams /> : null}
        {toolId === 'move' ? <VectorBar /> : null}
      </OptionScroller>
      {live ? (
        <span className="opt-live">
          <button type="button" className="btn small" onClick={() => engine.cancelLive()}>
            {t('action.cancel')}
          </button>
          <button type="button" className="btn small primary" onClick={() => engine.commitLive()}>
            <Icon name="check" size={15} />
            {t('action.commit')}
          </button>
        </span>
      ) : null}
    </div>
  );
}
