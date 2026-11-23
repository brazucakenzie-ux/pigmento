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
import { openDialog, useUi } from '../state/store';
import { actions, runAction } from '../actions/actions';
import { GradientButton, PatternPicker } from './PaintOptions';
import { SelectedShapeParams, ShapeOption, ShapeToolParams } from './ShapeGallery';
import { BrushPicker } from './BrushPicker';
import { CameraField, LightFields } from './CameraField';
import { TrailButton } from './TrailOptions';
import { SpinButton } from './SpinOptions';
import { EASINGS, type Easing } from '@engine/anim/interpolate';
import { BACKS, REPEATS, repeatAxes, type Back, type Follow, type Repeat } from '@engine/anim/piece';
import type { CameraMoveFields } from '@engine/anim/AnimationController';

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

function attachedUnitKeys(specs: readonly OptionSpec[]): Set<string> {
  const keys = new Set<string>();
  for (const s of specs) if (s.type === 'slider' && s.unitOption) keys.add(s.unitOption);
  return keys;
}

function OptionControl({ toolId, spec, values, specs, inPopover = false }: { toolId: string; spec: OptionSpec; values: Record<string, unknown>; specs: readonly OptionSpec[]; inPopover?: boolean }) {
  const set = (v: unknown) => engine.setToolOption(toolId, spec.key, v);
  const label = t(spec.labelKey);
  switch (spec.type) {
    case 'slider': {
      const v = Number(values[spec.key] ?? spec.default);
      const unit = typeof spec.unit === 'function' ? spec.unit(values) : spec.unit;
      const presets = typeof spec.presets === 'function' ? spec.presets(values) : spec.presets;
      const unitSpec = spec.unitOption ? specs.find((o): o is Extract<OptionSpec, { type: 'segmented' }> => o.key === spec.unitOption && o.type === 'segmented') : undefined;
      const unitVal = unitSpec ? String(values[unitSpec.key] ?? unitSpec.default) : undefined;
      const setUnit = (nextUnit: string) => {
        if (!unitSpec || nextUnit === unitVal) return;
        if (spec.convertOnUnit && unitVal) {
          const converted = Math.min(spec.max, Math.max(spec.min, Math.round(spec.convertOnUnit(v, unitVal, nextUnit, engine.doc.dpi))));
          engine.setToolOptions(toolId, { [unitSpec.key]: nextUnit, [spec.key]: converted });
        } else {
          engine.setToolOption(toolId, unitSpec.key, nextUnit);
        }
      };
      return (
        <span className="opt">
          <span>{label}</span>
          {presets ? (
            <span className="chips" role="group" aria-label={label}>
              {presets.map((p) => (
                <button key={p} type="button" className="chip" aria-pressed={v === p} onClick={() => set(p)}>
                  {p}
                </button>
              ))}
            </span>
          ) : null}
          <Slider value={v} onChange={set} min={spec.min} max={spec.max} step={spec.step} unit={unit} showUnit={!unitSpec} log={spec.log} label={label} />
          {unitSpec && unitVal ? (
            <Segmented
              value={unitVal}
              onChange={setUnit}
              label={t(unitSpec.labelKey)}
              iconsOnly={unitSpec.iconsOnly}
              choices={unitSpec.choices.map((c) => ({ value: c.value, label: t(c.labelKey), icon: c.icon }))}
            />
          ) : null}
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
    case 'brush':
      return <BrushPicker toolId={toolId} value={String(values[spec.key] ?? spec.default)} label={label} />;
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
  const attached = attachedUnitKeys(inner);
  return (
    <span className="opt">
      <button ref={ref} type="button" className="opt-pop-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={spec.icon} size={15} />
        <span>{label}</span>
        {summary ? <span className="opt-pop-summary">{summary}</span> : null}
        <Icon name="chevron-down" size={12} />
      </button>
      <Popover anchor={ref} open={open} onClose={close} label={label} className="opt-popover">
        {inner.filter((o) => !attached.has(o.key)).map((o) => (
          <OptionControl key={o.key} toolId={toolId} spec={o} values={values} specs={inner} inPopover />
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

/** How much of the selected shapes' outlines shows: Start, End and Offset, in percent of their length. */
function TrimFields() {
  const sel = useUi((s) => s.vectorSelection);
  const length = useUi((s) => s.animation.length);
  const pieces = useUi((s) => s.animation.pieces);
  const trim = sel.trim;
  if (!trim) return null;
  const keyed = sel.trimKey !== null;
  const pieceName = (id: string) => {
    const i = pieces.findIndex((p) => p.id === id);
    return i < 0 ? '' : pieces[i].name || t('piece.defaultName', { n: i + 1 });
  };
  const tieValue = sel.tie ? `${sel.tie.end}:${sel.tie.piece}` : '';
  const blur = () => (document.activeElement as HTMLElement | null)?.blur();
  const field = (key: 'start' | 'end' | 'offset', labelKey: I18nKey, min: number, max: number) => {
    const label = t(labelKey);
    return (
      <span className="opt tf-field">
        <span>{label}</span>
        <NumberField className="num tf-num" value={Math.round(trim[key] * 1000) / 10} decimals={1} min={min} max={max} shiftStep={10} label={label} onChange={(v) => engine.trimVector({ [key]: v / 100 })} onEnter={blur} />
        <span className="unit">%</span>
      </span>
    );
  };
  return (
    <span className="opt trim-bar" role="group" aria-label={t('trim.group')} data-tip={t('trim.tip')}>
      <span>{t('trim.group')}</span>
      {length > 1 ? (
        <>
          <button type="button" className="icon-btn" aria-pressed={keyed} aria-label={t(keyed ? 'trim.keyed' : 'trim.addKey')} data-tip={t(keyed ? 'trim.keyed' : 'trim.addKey')} onClick={() => !keyed && engine.keyTrim()}>
            <Icon name={keyed ? 'keyframe' : 'keyframe-add'} size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label={t('trim.deleteKey')} data-tip={t('trim.deleteKey')} disabled={!keyed} onClick={() => engine.unkeyTrim()}>
            <Icon name="keyframe-delete" size={16} />
          </button>
        </>
      ) : null}
      {field('start', 'trim.start', 0, 100)}
      {field('end', 'trim.end', 0, 100)}
      {field('offset', 'trim.offset', -100000, 100000)}
      {sel.followers.length || sel.tie ? (
        <label className="opt" data-tip={t('trim.tieTip')}>
          <span>{t('trim.tie')}</span>
          <select
            className="select"
            aria-label={t('trim.tie')}
            value={tieValue}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return engine.tieTrim(null);
              const [end, piece] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
              engine.tieTrim({ piece, end: end === 'end' ? 'end' : 'start', gap: sel.tie?.gap ?? 0 });
            }}
          >
            <option value="">{t('trim.tieNone')}</option>
            {[...new Set([...sel.followers, ...(sel.tie ? [sel.tie.piece] : [])])].flatMap((id) => [
              <option key={`start:${id}`} value={`start:${id}`}>
                {t('trim.tieStart', { piece: pieceName(id) })}
              </option>,
              <option key={`end:${id}`} value={`end:${id}`}>
                {t('trim.tieEnd', { piece: pieceName(id) })}
              </option>,
            ])}
          </select>
        </label>
      ) : null}
      {sel.tie ? (
        <span className="opt tf-field" data-tip={t('trim.gapTip')}>
          <span>{t('trim.gap')}</span>
          <NumberField className="num tf-num" value={Math.round(sel.tie.gap)} min={-100000} max={100000} label={t('trim.gap')} onChange={(v) => sel.tie && engine.tieTrim({ ...sel.tie, gap: v })} onEnter={blur} />
          <span className="unit">px</span>
        </span>
      ) : null}
      {sel.trimKey ? (
        <label className="opt">
          <span>{t('trim.easing')}</span>
          <select className="select" aria-label={t('trim.easing')} value={sel.trimKey.easing} onChange={(e) => engine.setTrimEasing(e.target.value as Easing)}>
            {EASINGS.map((e) => (
              <option key={e} value={e}>
                {t(`easing.${e}` as I18nKey)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {length > 1 ? (
        <>
          <button type="button" className="btn" data-tip={t('trim.drawOnTip')} onClick={() => openDialog({ kind: 'drawOn', mode: 'drawOn' })}>
            {t('trim.drawOn')}
          </button>
          <button type="button" className="btn" data-tip={t('trim.eraseBehindTip')} onClick={() => openDialog({ kind: 'drawOn', mode: 'eraseBehind' })}>
            {t('trim.eraseBehind')}
          </button>
        </>
      ) : null}
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

/**
 * The selected piece at the frame shown: position, size, turn, skew, opacity and easing
 * (auto-key). For the Perspective plane tool (`plane`): position, depth, tilt, turn and spin,
 * size, opacity and what shows of its back.
 */
function PieceFields({ plane = false }: { plane?: boolean }) {
  const info = useUi((s) => s.animation.current);
  const keys = useUi((s) => s.animation.pieces.find((p) => p.id === s.animation.selectedId)?.keys.length ?? 0);
  const cameraMove = useUi((s) => s.animation.cameraMove);
  if (cameraMove) return <CameraMoveBar move={cameraMove} />;
  if (!info) return <span className="opt-hint">{t('piece.noneSelected')}</span>;
  const axes = repeatAxes(info.repeat);
  // A hinged piece is placed by its hinge (it only folds); a group carries pieces and has no pixels.
  const hinged = info.link === 'hinged';
  const group = info.group;
  // On a path, it's placed along the path (by how far along it is) instead of by x and y.
  const onPath = info.follow !== null;
  const field = (key: 'x' | 'y' | 'w' | 'h' | 'angle' | 'skew' | 'opacity' | 'scrollX' | 'scrollY' | 'depth' | 'tilt' | 'turn' | 'fold' | 'progress', labelKey: I18nKey, unit: string, min: number, max: number, decimals: number, shiftStep?: number, tip?: I18nKey) => {
    const label = t(labelKey);
    return (
      <span className="opt tf-field" data-tip={tip ? t(tip) : undefined}>
        <span>{label}</span>
        <NumberField
          className="num tf-num"
          value={Math.round(info[key] * 10 ** decimals) / 10 ** decimals}
          decimals={decimals}
          min={min}
          max={max}
          shiftStep={shiftStep}
          label={label}
          onChange={(v) => engine.anim.setFields({ [key]: v })}
          onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
        />
        <span className="unit">{unit}</span>
      </span>
    );
  };
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={info.keyed}
        aria-label={t(info.keyed ? 'piece.keyed' : 'piece.addKey')}
        data-tip={t(info.keyed ? 'piece.keyed' : 'piece.addKey')}
        onClick={() => !info.keyed && engine.anim.setFields({})}
      >
        <Icon name={info.keyed ? 'keyframe' : 'keyframe-add'} size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('piece.deleteKey')}
        data-tip={t('piece.deleteKey')}
        disabled={!info.keyed || keys < 2}
        onClick={() => {
          const id = engine.anim.selectedId;
          if (id) engine.anim.removeKey(id, engine.anim.frame);
        }}
      >
        <Icon name="keyframe-delete" size={16} />
      </button>
      {hinged || onPath ? null : field('x', 'transform.x', 'px', -100000, 100000, 0)}
      {hinged || onPath ? null : field('y', 'transform.y', 'px', -100000, 100000, 0)}
      {onPath ? field('progress', 'piece.progress', '%', -100000, 100000, 1, 10, 'piece.progressTip') : null}
      {hinged ? field('fold', 'piece.fold', '°', -36000, 36000, 1, 15) : null}
      {plane && !hinged ? (
        <>
          {field('depth', 'piece.depth', 'px', -100000, 1000000, 0)}
          {field('tilt', 'piece.tilt', '°', -36000, 36000, 1)}
          {field('turn', 'piece.turn', '°', -36000, 36000, 1)}
          {field('angle', 'piece.spin', '°', -36000, 36000, 1)}
        </>
      ) : null}
      {hinged ? null : field('w', 'transform.w', '%', -100000, 100000, 1)}
      {hinged ? null : field('h', 'transform.h', '%', -100000, 100000, 1)}
      {plane || hinged ? null : field('angle', 'transform.angle', '°', -36000, 36000, 1)}
      {plane || hinged ? null : field('skew', 'transform.skew', '°', -85, 85, 1)}
      {field('opacity', 'opt.opacity', '%', 0, 100, 0)}
      {plane && !group ? (
        <span className="opt tf-field" data-tip={t('piece.shadeTip')}>
          <span>{t('piece.shade')}</span>
          <NumberField
            className="num tf-num"
            value={Math.round(info.shade)}
            decimals={0}
            min={0}
            max={100}
            label={t('piece.shade')}
            onChange={(v) => {
              const id = engine.anim.selectedId;
              if (id) engine.anim.setShade(id, v / 100);
            }}
            onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
          />
          <span className="unit">%</span>
        </span>
      ) : null}
      {plane && !group ? (
        <label className="opt">
          <span>{t('piece.back')}</span>
          <select
            className="select"
            aria-label={t('piece.back')}
            value={info.back}
            onChange={(e) => {
              const id = engine.anim.selectedId;
              if (id) engine.anim.setBack(id, e.target.value as Back);
            }}
          >
            {BACKS.map((b) => (
              <option key={b} value={b}>
                {t(`back.${b}` as I18nKey)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="opt" data-tip={t('loop.pieceTip')}>
        <span>{t('loop.piece')}</span>
        <select
          className="select"
          aria-label={t('loop.piece')}
          value={info.loop}
          onChange={(e) => {
            const id = engine.anim.selectedId;
            const v = e.target.value;
            if (id) engine.anim.setPieceLoop(id, v === 'loop' ? 'loop' : v === 'pingpong' ? 'pingpong' : 'off');
          }}
        >
          <option value="off">{t('loop.off')}</option>
          <option value="loop">{t('loop.again')}</option>
          <option value="pingpong">{t('loop.backAndForth')}</option>
        </select>
      </label>
      <label className="opt">
        <span>{t('piece.easing')}</span>
        <select className="select" aria-label={t('piece.easing')} value={info.easing} onChange={(e) => engine.anim.setFields({ easing: e.target.value as Easing })}>
          {EASINGS.map((e) => (
            <option key={e} value={e}>
              {t(`easing.${e}` as I18nKey)}
            </option>
          ))}
        </select>
      </label>
      {info.link === 'none' && !onPath ? (
        <button
          type="button"
          className="icon-btn"
          aria-label={t('piece.straighten')}
          data-tip={t('piece.straighten')}
          disabled={!info.curved}
          onClick={() => {
            const id = engine.anim.selectedId;
            if (id) engine.anim.straighten(id, engine.anim.frame);
          }}
        >
          <Icon name="line" size={16} />
        </button>
      ) : null}
      {info.link === 'none' && !onPath ? (
        <button type="button" className="icon-btn" aria-label={t('action.motionToShape')} data-tip={t('piece.motionToShapeTip')} disabled={keys < 2} onClick={() => runAction('motionToShape')}>
          <Icon name="pen" size={16} />
        </button>
      ) : null}
      {hinged ? null : (
        <>
          <button type="button" className="icon-btn" aria-label={t('transform.flipH')} data-tip={t('transform.flipH')} onClick={() => engine.anim.setFields({ w: -info.w })}>
            <Icon name="flip-h" size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label={t('transform.flipV')} data-tip={t('transform.flipV')} onClick={() => engine.anim.setFields({ h: -info.h })}>
            <Icon name="flip-v" size={16} />
          </button>
        </>
      )}
      {info.inGroup ? (
        <button
          type="button"
          className="btn"
          data-tip={t('piece.centrePivotTip')}
          onClick={() => {
            const id = engine.anim.selectedId;
            if (id) engine.anim.centrePivot(id);
          }}
        >
          {t('piece.centrePivot')}
        </button>
      ) : null}
      {hinged ? (
        <button
          type="button"
          className="btn"
          data-tip={t('piece.unhingeTip')}
          onClick={() => {
            const id = engine.anim.selectedId;
            if (id) engine.anim.detach(id);
          }}
        >
          {t('piece.unhinge')}
        </button>
      ) : (
        <>
          {onPath ? null : <FollowsField />}
          {info.link === 'none' ? <PathField follow={info.follow} /> : null}
          {info.link === 'none' ? <FaceField on={info.face} angle={info.faceAngle} /> : null}
          <TrailButton trails={info.trails} />
          <SpinButton spin={info.spin} plane={plane} />
        </>
      )}
      {group ? null : (
        <>
          <label className="opt">
            <span>{t('piece.repeat')}</span>
            <select
              className="select"
              aria-label={t('piece.repeat')}
              value={info.repeat}
              onChange={(e) => {
                const id = engine.anim.selectedId;
                if (id) engine.anim.setRepeat(id, e.target.value as Repeat);
              }}
            >
              {REPEATS.map((r) => (
                <option key={r} value={r}>
                  {t(`repeat.${r}` as I18nKey)}
                </option>
              ))}
            </select>
          </label>
          {axes.x ? field('scrollX', 'piece.scrollX', 'px', -1e6, 1e6, 0) : null}
          {axes.y ? field('scrollY', 'piece.scrollY', 'px', -1e6, 1e6, 0) : null}
          {info.repeat !== 'none' ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={t('piece.loopScroll')}
              data-tip={t('piece.loopScroll')}
              onClick={() => {
                const id = engine.anim.selectedId;
                if (id) engine.anim.loopScroll(id);
              }}
            >
              <Icon name="loop" size={16} />
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

/** The camera's move at the frame shown, while its timeline row is selected (auto-key, like a piece). */
function CameraMoveBar({ move }: { move: CameraMoveFields }) {
  const blur = () => (document.activeElement as HTMLElement | null)?.blur();
  const field = (key: 'panX' | 'panY' | 'push', labelKey: I18nKey, tip?: I18nKey) => {
    const label = t(labelKey);
    return (
      <span className="opt tf-field" data-tip={tip ? t(tip) : undefined}>
        <span>{label}</span>
        <NumberField className="num tf-num" value={Math.round(move[key])} min={-1e6} max={1e6} label={label} onChange={(v) => engine.anim.setCameraKey(engine.anim.frame, { [key]: v })} onEnter={blur} />
        <span className="unit">px</span>
      </span>
    );
  };
  return (
    <>
      <span className="opt">
        <Icon name="camera" size={16} />
        <span>{t('camera.row')}</span>
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={move.keyed}
        aria-label={t(move.keyed ? 'camera.keyed' : 'camera.addKey')}
        data-tip={t(move.keyed ? 'camera.keyed' : 'camera.addKey')}
        onClick={() => !move.keyed && engine.anim.setCameraKey(engine.anim.frame, {})}
      >
        <Icon name={move.keyed ? 'keyframe' : 'keyframe-add'} size={16} />
      </button>
      <button type="button" className="icon-btn" aria-label={t('camera.deleteKey')} data-tip={t('camera.deleteKey')} disabled={!move.keyed} onClick={() => engine.anim.removeCameraKey(engine.anim.frame)}>
        <Icon name="keyframe-delete" size={16} />
      </button>
      {field('panX', 'camera.panX')}
      {field('panY', 'camera.panY')}
      {field('push', 'camera.push', 'camera.pushTip')}
      <label className="opt">
        <span>{t('piece.easing')}</span>
        <select className="select" aria-label={t('piece.easing')} value={move.easing} onChange={(e) => engine.anim.setCameraKey(engine.anim.frame, { easing: e.target.value as Easing })}>
          {EASINGS.map((e) => (
            <option key={e} value={e}>
              {t(`easing.${e}` as I18nKey)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/**
 * The piece the selected one follows (moving with it): nothing, or another piece or group on its
 * layer that isn't one of the pieces under it.
 */
function FollowsField() {
  const pieces = useUi((s) => s.animation.pieces);
  const id = useUi((s) => s.animation.selectedId);
  const me = pieces.find((p) => p.id === id);
  if (!me || me.kind === 'group' || me.hinged) return null;
  // The pieces under it can't be followed: that would be a loop.
  const under = new Set([me.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of pieces) {
      if (p.parent && under.has(p.parent) && !under.has(p.id)) {
        under.add(p.id);
        grew = true;
      }
    }
  }
  const name = (i: number) => pieces[i].name || t(pieces[i].kind === 'group' ? 'piece.groupName' : 'piece.defaultName', { n: i + 1 });
  return (
    <label className="opt" data-tip={t('piece.followsTip')}>
      <span>{t('piece.follows')}</span>
      <select
        className="select"
        aria-label={t('piece.follows')}
        value={me.parent ?? ''}
        onChange={(e) => {
          if (e.target.value) engine.anim.attach(me.id, e.target.value);
          else engine.anim.detach(me.id);
        }}
      >
        <option value="">{t('piece.followsNone')}</option>
        {pieces.map((p, i) =>
          p.layerId === me.layerId && !under.has(p.id) ? (
            <option key={p.id} value={p.id}>
              {name(i)}
            </option>
          ) : null,
        )}
      </select>
    </label>
  );
}

/** The path a piece that follows no other piece moves along: none, or an outline of a shape on a shape layer. */
function PathField({ follow }: { follow: Follow | null }) {
  // Read again whenever the picture or its layers change (shapes come and go with them).
  useUi((s) => s.history);
  useUi((s) => s.layers);
  const id = useUi((s) => s.animation.selectedId);
  const choices = engine.anim.pathChoices();
  if (!id || (!choices.length && !follow)) return null;
  const same = (c: Follow) => follow !== null && c.layerId === follow.layerId && c.objectId === follow.objectId && c.sub === follow.sub;
  const current = choices.findIndex(same);
  return (
    <label className="opt" data-tip={t('piece.pathTip')}>
      <span>{t('piece.path')}</span>
      <select
        className="select"
        aria-label={t('piece.path')}
        value={current < 0 ? '' : String(current)}
        onChange={(e) => {
          const c = e.target.value === '' ? null : choices[Number(e.target.value)];
          engine.anim.follow(id, c ? { layerId: c.layerId, objectId: c.objectId, sub: c.sub } : null);
        }}
      >
        <option value="">{t('piece.pathNone')}</option>
        {choices.map((c, i) => (
          <option key={`${c.layerId}/${c.objectId}/${c.sub}`} value={String(i)}>
            {c.part === null ? t('piece.pathItem', { layer: c.layerName, n: c.shape }) : t('piece.pathPart', { layer: c.layerName, n: c.shape, part: c.part })}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Facing the way it goes, and which way the art points as drawn (shown while it's on). */
function FaceField({ on, angle }: { on: boolean; angle: number }) {
  const id = useUi((s) => s.animation.selectedId);
  if (!id) return null;
  return (
    <>
      <label className="check opt" data-tip={t('piece.faceTip')}>
        <input type="checkbox" checked={on} onChange={() => engine.anim.setFace(id, { on: !on })} />
        {t('piece.face')}
      </label>
      {on ? (
        <span className="opt tf-field" data-tip={t('piece.faceAngleTip')}>
          <span>{t('piece.faceAngle')}</span>
          <NumberField
            className="num tf-num"
            value={Math.round(angle * 10) / 10}
            decimals={1}
            min={-180}
            max={180}
            shiftStep={15}
            label={t('piece.faceAngle')}
            onChange={(v) => engine.anim.setFace(id, { angle: (v * Math.PI) / 180 })}
            onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
          />
          <span className="unit">°</span>
        </span>
      ) : null}
    </>
  );
}

/** Paint on piece, for the tools that can paint a piece's own pixels, while a piece is selected. */
function PaintOnPiece() {
  const pieces = useUi((s) => s.animation.pieces);
  const selectedId = useUi((s) => s.animation.selectedId);
  const on = useUi((s) => s.animation.paintOnPiece);
  const i = pieces.findIndex((p) => p.id === selectedId);
  if (i < 0) return null;
  const name = pieces[i].name || t('piece.defaultName', { n: i + 1 });
  return (
    <label className="check opt" data-tip={t('piece.paintOn', { piece: name })}>
      <input type="checkbox" checked={on} onChange={() => engine.anim.setPaintOnPiece(!on)} />
      {t('action.paintOnPiece')}
    </label>
  );
}

export function OptionsBar() {
  const simple = useUi((s) => s.settings.ui.mode === 'simple');
  const toolId = useUi((s) => s.tool);
  const values = useUi((s) => s.toolOptions[toolId]) ?? engine.options(toolId);
  const live = useUi((s) => s.live);
  const transparent = useUi((s) => s.transparentSelection);
  // Move's style options only mean something on a shape layer.
  const shapeLayer = useUi((s) => findKind(s.layers.tree, s.layers.activeId)) === 'vector';
  const tool = toolRegistry.get(toolId);
  if (!tool) return <div className="optionsbar" />;
  const visible = tool.id === 'move' && !shapeLayer ? [] : tool.options.filter((o) => (!o.visibleIf || o.visibleIf(values)) && !(simple && o.advanced));
  const attached = attachedUnitKeys(visible);
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
        {tool.paintsPieces && !simple ? <PaintOnPiece /> : null}
        {visible.filter((o) => !attached.has(o.key)).map((spec) => (
          <OptionControl key={spec.key} toolId={toolId} spec={spec} values={values} specs={visible} />
        ))}
        {toolId === 'transform' ? <TransformFields /> : null}
        {toolId === 'animate' ? <PieceFields /> : null}
        {toolId === 'plane' ? <CameraField /> : null}
        {toolId === 'plane' ? <LightFields /> : null}
        {toolId === 'plane' ? <PieceFields plane /> : null}
        {tool.symmetry && !simple ? <SymmetryControl /> : null}
        <PathBar />
        {toolId === 'move' && shapeLayer ? <SelectedShapeParams /> : null}
        {toolId === 'move' && shapeLayer ? <TrimFields /> : null}
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
