import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BRUSH_FILE_CATEGORIES, OWN_MASK, type BrushFileCategory } from '@shared/brushFormat';
import { CURVE_PRESETS } from '@engine/brush/curve';
import { CurveEditor } from '../components/CurveEditor';
import { editorMask, invertMask, paintMask, softenMask, textureFromImage, tipFromImage, TIP_EDITOR_SIZE } from '@engine/brush/masks';
import { brushPreview, PREVIEW_COLOR } from '@engine/brush/preview';
import { makeTip, textureStore, tipStore, type Mask } from '@engine/brush/tips';
import { DYNAMIC_SOURCES, DYNAMIC_TARGETS, LINEAR, type BrushSettings, type Dynamic, type DynamicSource, type DynamicTarget } from '@engine/brush/types';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Checkbox, Segmented, Slider } from '../components/Controls';
import { Icon } from '../icons/Icon';
import { engine } from '../state/engine';
import { closeDialog, showToast, useUi } from '../state/store';
import { brushRegistry } from '@engine/brush/BrushRegistry';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { brushName, brushTarget, customBrushCount, customBrushFile, deleteBrush, draftOf, resolveMasks, saveBrushDraft, type BrushDraft } from '../services/brushes';

/** While the Designer is open its own tip and texture are kept under these ids (for previews). */
const STAGE_TIP = 'designer-tip';
const STAGE_TEXTURE = 'designer-texture';

type Tab = 'tip' | 'stroke' | 'texture' | 'dynamics' | 'paint';
const TABS: Tab[] = ['tip', 'stroke', 'texture', 'dynamics', 'paint'];

const isBuiltin = (id: string) => !id.startsWith('my-') && !id.startsWith('designer-');

/** A mask drawn in the preview colour on white (tips) or as grey (textures, tiled). */
function MaskThumb({ mask, size = 40, texture = false }: { mask: Mask; size?: number; texture?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const px = texture ? size : Math.max(mask.w, mask.h);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(px, px);
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const v = texture ? mask.data[(y % mask.h) * mask.w + (x % mask.w)] : x < mask.w && y < mask.h ? mask.data[y * mask.w + x] : 0;
        const i = (y * px + x) * 4;
        if (texture) {
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        } else {
          img.data[i] = PREVIEW_COLOR.r;
          img.data[i + 1] = PREVIEW_COLOR.g;
          img.data[i + 2] = PREVIEW_COLOR.b;
          img.data[i + 3] = v;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [mask, px, texture]);
  return <canvas ref={ref} className="bd-thumb" width={px} height={px} style={{ width: size, height: size }} aria-hidden="true" />;
}

/** Round and square tips, drawn as their masks for the tip tiles. */
function shapeMask(kind: 'round' | 'square'): Mask {
  const n = 32;
  const data = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = Math.abs(x + 0.5 - n / 2) / (n / 2);
      const dy = Math.abs(y + 0.5 - n / 2) / (n / 2);
      const d = kind === 'round' ? Math.hypot(dx, dy) : Math.max(dx, dy);
      data[y * n + x] = d > 0.86 ? 0 : d > 0.7 ? Math.round(255 * (0.86 - d) / 0.16) : 255;
    }
  }
  return { w: n, h: n, data };
}
const SHAPE_MASKS = { round: shapeMask('round'), square: shapeMask('square') };

interface TileItem {
  value: string;
  label: string;
  thumb: ReactNode;
}

/** A row of picture tiles to choose one from (a radio group: arrows move, the choice follows). */
function TileGroup({ label, value, items, onChange }: { label: string; value: string; items: TileItem[]; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = Math.max(0, items.findIndex((it) => it.value === value));
    const next = items[(i + d + items.length) % items.length];
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div ref={ref} className="bd-tiles" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {items.map((it) => (
        <button key={it.value} type="button" role="radio" className="bd-tile" aria-checked={it.value === value} aria-label={it.label} data-tip={it.label} tabIndex={it.value === value ? 0 : -1} onClick={() => onChange(it.value)}>
          {it.thumb}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row">{children}</div>
    </div>
  );
}

/** A 0–1 setting shown as 0–100 %. */
function Percent({ label, value, onChange, min = 0, max = 100 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <Field label={label}>
      <Slider label={label} value={Math.round(value * 100)} min={min} max={max} unit="%" onChange={(v) => onChange(v / 100)} />
    </Field>
  );
}

/** The live sample stroke (seeded, so it only changes when the brush does). */
function PreviewStroke({ settings }: { settings: BrushSettings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = 600;
  const h = 120;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    // Drawn at the screen's resolution with the brush scaled to match, so sizes read true.
    const s = { ...settings, size: settings.size * dpr, texture: settings.texture ? { ...settings.texture, scale: settings.texture.scale * dpr } : null };
    const p = brushPreview(s, Math.round(w * dpr), Math.round(h * dpr));
    ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.w, p.h), 0, 0);
  }, [settings, dpr]);
  return <canvas ref={ref} className="bd-preview" width={Math.round(w * dpr)} height={Math.round(h * dpr)} role="img" aria-label={t('brushDesigner.preview')} />;
}

/** Draw a tip on a small grid: drag to paint, right-drag to rub out. */
function TipEditor({ mask, onChange }: { mask: Mask; onChange: (m: Mask) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(mask);
  latest.current = mask;
  const stroke = useRef<{ value: number; last: { x: number; y: number } } | null>(null);
  const [pen, setPen] = useState(3);
  const n = TIP_EDITOR_SIZE;
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = 255 - mask.data[i];
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [mask, n]);
  const cellAt = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * n, y: ((e.clientY - r.top) / r.height) * n };
  };
  const paintTo = (p: { x: number; y: number }) => {
    const s = stroke.current;
    if (!s) return;
    let m = latest.current;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - s.last.x, p.y - s.last.y) / Math.max(0.5, pen / 3)));
    for (let i = 1; i <= steps; i++) m = paintMask(m, s.last.x + ((p.x - s.last.x) * i) / steps, s.last.y + ((p.y - s.last.y) * i) / steps, pen / 2, s.value);
    s.last = p;
    latest.current = m;
    onChange(m);
  };
  return (
    <div className="bd-editor">
      <canvas
        ref={ref}
        className="bd-editor-grid"
        width={n}
        height={n}
        role="img"
        aria-label={t('brushDesigner.tipEditor')}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 2) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = cellAt(e);
          stroke.current = { value: e.button === 2 ? 0 : 255, last: p };
          paintTo(p);
        }}
        onPointerMove={(e) => {
          if (stroke.current) paintTo(cellAt(e));
        }}
        onPointerUp={() => (stroke.current = null)}
        onPointerCancel={() => (stroke.current = null)}
      />
      <div className="bd-editor-side">
        <p className="dialog-note">{t('brushDesigner.tipEditorHint')}</p>
        <Field label={t('brushDesigner.pen')}>
          <Slider label={t('brushDesigner.pen')} value={pen} min={1} max={12} unit="" onChange={setPen} />
        </Field>
        <div className="bd-buttons">
          <button type="button" className="btn small" onClick={() => onChange(editorMask(null))}>
            {t('brushDesigner.clear')}
          </button>
          <button type="button" className="btn small" onClick={() => onChange(invertMask(mask))}>
            {t('brushDesigner.invert')}
          </button>
          <button type="button" className="btn small" onClick={() => onChange(softenMask(mask))}>
            {t('brushDesigner.soften')}
          </button>
        </div>
      </div>
    </div>
  );
}

function initialDraft(id: string | undefined, from: string | undefined): BrushDraft {
  if (id && customBrushFile(id)) return draftOf(id);
  const d = draftOf(from ?? 'round');
  return { ...d, name: t('brushDesigner.defaultName', { n: customBrushCount() + 1 }), category: d.category === 'eraser' ? 'eraser' : 'custom' };
}

/**
 * Brush Designer: everything a brush is made of, with a live sample stroke. Saves to My brushes
 * (as a new brush, or over the personal brush being edited).
 */
export function BrushDesignerDialog({ id, from }: { id?: string; from?: string }) {
  const editing = id ? customBrushFile(id) : undefined;
  const [draft, setDraft] = useState<BrushDraft>(() => initialDraft(id, from));
  const [tab, setTab] = useState<Tab>('tip');
  const [drawing, setDrawing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [target, setTarget] = useState<DynamicTarget>('size');
  const s = draft.settings;
  const set = (patch: Partial<BrushSettings>) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }));

  // The draft's own masks are staged in the stores so the preview (and nothing else) can use them.
  const preview = useMemo(() => {
    if (draft.tip) tipStore.set(STAGE_TIP, makeTip(draft.tip));
    else tipStore.remove(STAGE_TIP);
    if (draft.texture) textureStore.set(STAGE_TEXTURE, draft.texture);
    else textureStore.remove(STAGE_TEXTURE);
    return resolveMasks(draft.settings, STAGE_TIP, STAGE_TEXTURE);
  }, [draft]);
  useEffect(
    () => () => {
      tipStore.remove(STAGE_TIP);
      textureStore.remove(STAGE_TEXTURE);
    },
    [],
  );

  const ownTip = s.tip.kind === 'image' && s.tip.id === OWN_MASK;
  const emptyTip = ownTip && (!draft.tip || draft.tip.data.every((v) => v === 0));
  const setOwnTip = (m: Mask) => setDraft((d) => ({ ...d, tip: m, settings: { ...d.settings, tip: { kind: 'image', id: OWN_MASK } } }));
  const setOwnTexture = (m: Mask) =>
    setDraft((d) => ({ ...d, texture: m, settings: { ...d.settings, texture: { id: OWN_MASK, scale: d.settings.texture?.scale ?? 1, depth: d.settings.texture?.depth ?? 0.6, mode: d.settings.texture?.mode ?? 'multiply' } } }));

  const tipValue = s.tip.kind === 'image' ? (ownTip ? 'own' : `image:${s.tip.id}`) : s.tip.kind;
  const tipItems: TileItem[] = [
    { value: 'round', label: t('tip.round'), thumb: <MaskThumb mask={SHAPE_MASKS.round} /> },
    { value: 'square', label: t('tip.square'), thumb: <MaskThumb mask={SHAPE_MASKS.square} /> },
    ...tipStore
      .ids()
      .filter(isBuiltin)
      .map((tid) => ({ value: `image:${tid}`, label: t(`tip.${tid}` as I18nKey), thumb: <MaskThumb mask={tipStore.get(tid)!} /> })),
    ...(draft.tip ? [{ value: 'own', label: t('tip.own'), thumb: <MaskThumb mask={draft.tip} /> }] : []),
  ];
  const chooseTip = (v: string) => {
    setDrawing(false);
    if (v === 'round' || v === 'square') set({ tip: { kind: v } });
    else if (v === 'own') set({ tip: { kind: 'image', id: OWN_MASK } });
    else set({ tip: { kind: 'image', id: v.slice(6) } });
  };
  const startDrawing = () => {
    const from = ownTip ? draft.tip : s.tip.kind === 'image' ? (tipStore.get(s.tip.id) ?? null) : null;
    setOwnTip(from ? editorMask(from) : paintMask(editorMask(null), TIP_EDITOR_SIZE / 2, TIP_EDITOR_SIZE / 2, TIP_EDITOR_SIZE * 0.3, 255));
    setDrawing(true);
  };
  const tipFromSelection = () => {
    const img = engine.selectionImage();
    if (!img) return setNote(t('brushDesigner.needsSelection'));
    const m = tipFromImage(img, 'dark');
    if (!m) return setNote(t('brushDesigner.nothingToUse'));
    setNote(null);
    setDrawing(false);
    setOwnTip(m);
  };
  const importImage = async (kind: 'tip' | 'texture') => {
    let file: { name: string; bytes: Uint8Array } | null;
    try {
      file = await window.pigmento.files.openAsset('brushImage');
    } catch {
      return setNote(t('brushDesigner.importRefused'));
    }
    if (!file) return;
    try {
      const img = await engine.codecs.decode(file.bytes);
      if (kind === 'texture') {
        setOwnTexture(textureFromImage(img));
      } else {
        const m = tipFromImage(img, 'alpha');
        if (!m) return setNote(t('brushDesigner.nothingToUse'));
        setDrawing(false);
        setOwnTip(m);
      }
      setNote(null);
    } catch {
      setNote(t('brushDesigner.importFailed', { name: file.name }));
    }
  };

  const texValue = s.texture ? (s.texture.id === OWN_MASK ? 'own' : s.texture.id) : 'none';
  const texItems: TileItem[] = [
    { value: 'none', label: t('texture.none'), thumb: <span className="bd-none" /> },
    ...textureStore
      .ids()
      .filter(isBuiltin)
      .map((tid) => ({ value: tid, label: t(`texture.${tid}` as I18nKey), thumb: <MaskThumb mask={textureStore.get(tid)!} texture /> })),
    ...(draft.texture ? [{ value: 'own', label: t('texture.own'), thumb: <MaskThumb mask={draft.texture} texture /> }] : []),
  ];
  const chooseTexture = (v: string) => {
    if (v === 'none') return set({ texture: null });
    set({ texture: { id: v === 'own' ? OWN_MASK : v, scale: s.texture?.scale ?? 1, depth: s.texture?.depth ?? 0.6, mode: s.texture?.mode ?? 'multiply' } });
  };

  const dyn: Dynamic = s.dynamics[target] ?? { source: 'off', curve: LINEAR, min: 0 };
  const setDyn = (patch: Partial<Dynamic>) => {
    const next = { ...dyn, ...patch };
    const dynamics = { ...s.dynamics };
    if (next.source === 'off') delete dynamics[target];
    else dynamics[target] = next;
    set({ dynamics });
  };

  const save = () => {
    if (!draft.name.trim() || emptyTip) return;
    const { toolId } = brushTarget();
    closeDialog();
    void saveBrushDraft(draft, toolId, editing?.id);
  };

  return (
    <Dialog
      title={t(editing ? 'brushDesigner.editTitle' : 'brushDesigner.title')}
      onCancel={closeDialog}
      onSubmit={save}
      submitLabel={t('dialog.save')}
      submitDisabled={!draft.name.trim() || emptyTip}
      className="brush-designer"
    >
      <PreviewStroke settings={preview} />
      <div className="bd-head">
        <div className="field">
          <label htmlFor="bd-name">{t('brushDesigner.name')}</label>
          <input id="bd-name" className="text-input" value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="bd-category">{t('brushes.category')}</label>
          <select id="bd-category" className="select" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as BrushFileCategory }))}>
            {BRUSH_FILE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`brushcat.${c}` as I18nKey)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="bd-tabs" role="tablist" aria-label={t('brushDesigner.sections')}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            id={`bd-tab-${tb}`}
            aria-selected={tab === tb}
            aria-controls="bd-panel"
            tabIndex={tab === tb ? 0 : -1}
            className="bd-tab"
            onClick={() => setTab(tb)}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const next = TABS[(TABS.indexOf(tb) + d + TABS.length) % TABS.length];
              setTab(next);
              requestAnimationFrame(() => document.getElementById(`bd-tab-${next}`)?.focus());
            }}
          >
            {t(`brushDesigner.tab.${tb}` as I18nKey)}
          </button>
        ))}
      </div>
      <div className="bd-panel" id="bd-panel" role="tabpanel" aria-labelledby={`bd-tab-${tab}`}>
        {note ? (
          <p className="dialog-note bd-note" role="status">
            {note}
          </p>
        ) : null}
        {tab === 'tip' ? (
          <>
            <TileGroup label={t('brushDesigner.tip')} value={tipValue} items={tipItems} onChange={chooseTip} />
            <div className="bd-buttons">
              <button type="button" className="btn small" onClick={tipFromSelection}>
                <Icon name="select" size={15} />
                {t('brushDesigner.fromSelection')}
              </button>
              <button type="button" className="btn small" onClick={() => void importImage('tip')}>
                <Icon name="open" size={15} />
                {t('brushDesigner.importPng')}
              </button>
              <button type="button" className="btn small" aria-pressed={drawing} onClick={() => (drawing ? setDrawing(false) : startDrawing())}>
                <Icon name="pencil" size={15} />
                {t('brushDesigner.drawTip')}
              </button>
            </div>
            {drawing && draft.tip ? <TipEditor mask={draft.tip} onChange={setOwnTip} /> : null}
            {emptyTip ? <p className="dialog-note">{t('brushDesigner.emptyTip')}</p> : null}
            <Field label={t('opt.size')}>
              <Slider label={t('opt.size')} value={Math.round(s.size)} min={1} max={400} unit="px" log onChange={(v) => set({ size: v })} />
            </Field>
            {s.tip.kind !== 'image' ? <Percent label={t('opt.hardness')} value={s.hardness} onChange={(v) => set({ hardness: v })} /> : null}
            <Field label={t('brushDesigner.angle')}>
              <Slider label={t('brushDesigner.angle')} value={Math.round(s.angle)} min={-180} max={180} unit="°" onChange={(v) => set({ angle: v })} />
            </Field>
            <Percent label={t('brushDesigner.roundness')} value={s.roundness} min={5} onChange={(v) => set({ roundness: v })} />
            <div className="bd-checks">
              <Checkbox checked={s.followStroke} onChange={(v) => set({ followStroke: v })} label={t('brushDesigner.followStroke')} />
              <Checkbox checked={s.pixel} onChange={(v) => set({ pixel: v })} label={t('brushDesigner.pixel')} />
            </div>
          </>
        ) : null}
        {tab === 'stroke' ? (
          <>
            <Percent label={t('brushDesigner.spacing')} value={s.spacing} min={1} max={200} onChange={(v) => set({ spacing: v })} />
            <Percent label={t('brushDesigner.scatter')} value={s.scatter} max={1000} onChange={(v) => set({ scatter: v })} />
            <Field label={t('brushDesigner.count')}>
              <Slider label={t('brushDesigner.count')} value={s.count} min={1} max={16} unit="" onChange={(v) => set({ count: v })} />
            </Field>
            <Percent label={t('brushDesigner.sizeJitter')} value={s.sizeJitter} onChange={(v) => set({ sizeJitter: v })} />
            <Percent label={t('brushDesigner.opacityJitter')} value={s.opacityJitter} onChange={(v) => set({ opacityJitter: v })} />
            <Percent label={t('brushDesigner.angleJitter')} value={s.angleJitter} onChange={(v) => set({ angleJitter: v })} />
            <Percent label={t('brushDesigner.hueJitter')} value={s.hueJitter} onChange={(v) => set({ hueJitter: v })} />
            <Percent label={t('brushDesigner.lightJitter')} value={s.lightJitter} onChange={(v) => set({ lightJitter: v })} />
          </>
        ) : null}
        {tab === 'texture' ? (
          <>
            <TileGroup label={t('brushDesigner.texture')} value={texValue} items={texItems} onChange={chooseTexture} />
            <div className="bd-buttons">
              <button type="button" className="btn small" onClick={() => void importImage('texture')}>
                <Icon name="open" size={15} />
                {t('brushDesigner.importPng')}
              </button>
            </div>
            {s.texture ? (
              <>
                <Field label={t('brushDesigner.textureScale')}>
                  <Slider
                    label={t('brushDesigner.textureScale')}
                    value={Math.round(s.texture.scale * 100)}
                    min={25}
                    max={800}
                    unit="%"
                    log
                    onChange={(v) => s.texture && set({ texture: { ...s.texture, scale: v / 100 } })}
                  />
                </Field>
                <Percent label={t('brushDesigner.textureDepth')} value={s.texture.depth} onChange={(v) => s.texture && set({ texture: { ...s.texture, depth: v } })} />
                <Field label={t('brushDesigner.textureBlend')}>
                  <Segmented
                    label={t('brushDesigner.textureBlend')}
                    value={s.texture.mode}
                    choices={[
                      { value: 'multiply', label: t('brushDesigner.blend.multiply') },
                      { value: 'subtract', label: t('brushDesigner.blend.subtract') },
                    ]}
                    onChange={(v) => s.texture && set({ texture: { ...s.texture, mode: v === 'subtract' ? 'subtract' : 'multiply' } })}
                  />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
        {tab === 'dynamics' ? (
          <div className="bd-dynamics">
            <div className="bd-targets" role="group" aria-label={t('brushDesigner.dynamicsFor')}>
              {DYNAMIC_TARGETS.map((tg) => {
                const src = s.dynamics[tg]?.source ?? 'off';
                return (
                  <button
                    key={tg}
                    type="button"
                    aria-pressed={tg === target}
                    className="bd-target"
                    onClick={() => setTarget(tg)}
                  >
                    <span>{t(`dyn.target.${tg}` as I18nKey)}</span>
                    <span className="bd-target-src">{t(`dyn.source.${src}` as I18nKey)}</span>
                  </button>
                );
              })}
            </div>
            <div className="bd-dyn-edit">
              <Field label={t('brushDesigner.source')}>
                <select
                  className="select"
                  aria-label={t('brushDesigner.source')}
                  value={dyn.source}
                  onChange={(e) => setDyn({ source: e.target.value as DynamicSource })}
                >
                  {DYNAMIC_SOURCES.map((src) => (
                    <option key={src} value={src}>
                      {t(`dyn.source.${src}` as I18nKey)}
                    </option>
                  ))}
                </select>
              </Field>
              {dyn.source !== 'off' ? (
                <>
                  <Percent label={t('brushDesigner.dynMin')} value={dyn.min} onChange={(v) => setDyn({ min: v })} />
                  <div className="bd-curve-row">
                    <CurveEditor curve={dyn.curve} label={t('brushDesigner.curve')} onChange={(curve) => setDyn({ curve })} />
                    <div className="bd-presets" role="group" aria-label={t('brushDesigner.curvePresets')}>
                      {CURVE_PRESETS.map((p) => (
                        <button key={p.id} type="button" className="btn small" onClick={() => setDyn({ curve: p.curve })}>
                          {t(p.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="dialog-note">{t(`dyn.hint.${dyn.source}` as I18nKey)}</p>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        {tab === 'paint' ? (
          <>
            <Percent label={t('opt.opacity')} value={s.opacity} min={1} onChange={(v) => set({ opacity: v })} />
            <Percent label={t('opt.flow')} value={s.flow} min={1} onChange={(v) => set({ flow: v })} />
            <Percent label={t('brushDesigner.mix')} value={s.mix} onChange={(v) => set({ mix: v })} />
            <div className="bd-checks">
              <Checkbox checked={s.airbrush} onChange={(v) => set({ airbrush: v })} label={t('brushDesigner.airbrush')} />
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Remove a brush from My brushes (what was painted with it doesn't change). */
export function DeleteBrushDialog({ id }: { id: string }) {
  const f = customBrushFile(id);
  const submit = () => {
    closeDialog();
    void deleteBrush(id);
  };
  return (
    <Dialog title={t('dialog.deleteBrush.title')} onCancel={closeDialog} onSubmit={submit} submitLabel={t('dialog.deleteBrush.confirm')}>
      <p>{t('dialog.deleteBrush.body', { name: f?.name ?? '' })}</p>
    </Dialog>
  );
}

/** Whether outline strokes taper (kept while the app runs). */
let taperOutlines = true;

/** Stroke the selection's outline, or the selected shapes / path, with the brush in use. */
export function StrokeOutlineDialog({ source }: { source: 'selection' | 'path' }) {
  const [taper, setTaper] = useState(taperOutlines);
  const active = toolRegistry.get(useUi.getState().tool);
  const tool = active?.strokeBrush ? active : toolRegistry.get('brush');
  const b = tool?.strokeBrush?.(engine);
  const brushId = tool ? engine.options(tool.id).brushId : undefined;
  const def = typeof brushId === 'string' ? brushRegistry.get(brushId) : undefined;
  const onShapes = source === 'path' && engine.doc.activeLayer.kind === 'vector';
  const submit = () => {
    taperOutlines = taper;
    closeDialog();
    if (!engine.strokeOutline(source, taper)) showToast({ kind: 'info', key: 'notice.strokeNothing' });
  };
  return (
    <Dialog title={t(source === 'selection' ? 'dialog.strokeOutline.selection' : 'dialog.strokeOutline.path')} onCancel={closeDialog} onSubmit={submit} submitLabel={t('dialog.strokeOutline.confirm')}>
      {tool && b ? <p>{t('dialog.strokeOutline.with', { tool: t(tool.labelKey), brush: def ? brushName(def) : t(tool.labelKey), size: Math.round(b.size) })}</p> : null}
      <Checkbox checked={taper} onChange={setTaper} label={t('dialog.strokeOutline.taper')} />
      {onShapes ? <p className="dialog-note">{t('dialog.strokeOutline.newLayer')}</p> : null}
    </Dialog>
  );
}
