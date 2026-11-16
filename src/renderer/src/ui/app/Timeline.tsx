import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { EASINGS, type Easing } from '@engine/anim/interpolate';
import type { KeyChange } from '@engine/anim/piece';
import { LOOP_MODES, MAX_FPS, MAX_FRAMES, MIN_FPS, type LoopMode } from '@engine/anim/timeline';
import type { PieceInfo } from '@engine/anim/AnimationController';
import type { LayerNode } from '@engine/doc/LayerController';
import { t, type I18nKey } from '../../i18n';
import { Icon } from '../icons/Icon';
import { NumberField } from '../components/Controls';
import { Menu, MenuItem, MenuSeparator, SubMenu } from '../components/Menu';
import { engine } from '../state/engine';
import { updateSettings, useUi } from '../state/store';
import { action, addDrawing, runAction, setOnion } from '../actions/actions';
import { useShortcut } from '../actions/keymap';

/** Width of one frame on the timeline, in CSS px. */
const CELL = 14;
/** Width of the names column (matches .tl-names). */
const NAMES_W = 150;

/** A keyframe copied from the timeline (its values, not its frame). */
let copied: KeyChange | null = null;

function layerName(tree: LayerNode[], id: string): string {
  for (const n of tree) {
    if (n.id === id) return n.name;
    const inner = layerName(n.children, id);
    if (inner) return inner;
  }
  return '';
}

function TransportButton({ id, icon }: { id: string; icon?: string }) {
  const a = action(id);
  const kbd = useShortcut(id);
  const label = t(a.labelKey);
  const text = kbd ? `${label} (${kbd})` : label;
  return (
    <button type="button" className="icon-btn" aria-label={label} data-tip={text} onClick={() => runAction(id)}>
      <Icon name={icon ?? a.icon ?? 'info'} size={16} />
    </button>
  );
}

function pieceLabel(p: PieceInfo, i: number): string {
  return p.name || t('piece.defaultName', { n: i + 1 });
}

/** A row of keyframes for one piece. */
function PieceRow({ piece, index, selected, frame }: { piece: PieceInfo; index: number; selected: boolean; frame: number }) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const name = pieceLabel(piece, index);

  const frameAt = (clientX: number, el: HTMLElement): number => {
    const row = el.closest('.tl-row');
    const left = row ? row.getBoundingClientRect().left : 0;
    return Math.max(0, Math.floor((clientX - left) / CELL));
  };

  const onKeyDown = (e: ReactPointerEvent<HTMLButtonElement>, k: number) => {
    if (e.button === 2) return;
    e.stopPropagation();
    engine.anim.select(piece.id);
    engine.anim.setFrame(k);
    const el = e.currentTarget;
    let to = k;
    // The window hears the rest of the drag (the diamond re-renders as it moves).
    const move = (ev: PointerEvent) => {
      to = Math.min(MAX_FRAMES - 1, frameAt(ev.clientX, el));
      setDrag({ from: k, to });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (to === k) return;
      // Dragged past the end: the timeline grows to fit, so a move can take longer.
      if (to >= engine.anim.timeline.length) engine.anim.setTimeline({ length: to + 1 });
      if (engine.anim.moveKey(piece.id, k, to)) engine.anim.setFrame(to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const openMenu = (el: HTMLElement, k: number) => {
    anchor.current = el;
    engine.anim.select(piece.id);
    setMenu(k);
  };

  // While a diamond is dragged it shows where it would land (keyed by where it was, so it stays one element).
  const keys = piece.keys.map((k) => ({ ...k, at: k.frame, frame: drag && k.frame === drag.from ? drag.to : k.frame })).sort((a, b) => a.frame - b.frame);
  return (
    <div
      className={`tl-row tl-piece-row ${selected ? 'selected' : ''}`}
      role="group"
      aria-label={name}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        engine.anim.select(piece.id);
        engine.anim.setFrame(frameAt(e.clientX, e.currentTarget));
      }}
    >
      {keys.slice(0, -1).map((k, i) => (
        <span
          key={`seg-${k.at}`}
          className={`tl-seg ${k.easing === 'hold' ? 'hold' : ''}`}
          style={{ left: k.frame * CELL + CELL / 2, width: (keys[i + 1].frame - k.frame) * CELL }}
        />
      ))}
      {keys.map((k) => (
        <button
          key={`key-${k.at}`}
          type="button"
          className={`tl-key ${selected && k.frame === frame ? 'current' : ''}`}
          style={{ left: k.frame * CELL }}
          aria-label={t('timeline.keyLabel', { n: k.frame + 1, piece: name, easing: t(`easing.${k.easing}` as I18nKey) })}
          aria-pressed={selected && k.frame === frame}
          data-tip={t('timeline.keyLabel', { n: k.frame + 1, piece: name, easing: t(`easing.${k.easing}` as I18nKey) })}
          onPointerDown={(e) => onKeyDown(e, k.frame)}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu(e.currentTarget, k.frame);
          }}
          onKeyDown={(e: ReactKeyboardEvent<HTMLButtonElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              engine.anim.select(piece.id);
              engine.anim.setFrame(k.frame);
            } else if (e.key === 'Delete') {
              e.preventDefault();
              engine.anim.removeKey(piece.id, k.frame);
            } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
              e.preventDefault();
              openMenu(e.currentTarget, k.frame);
            } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) {
              // Alt+arrows retime the keyframe one frame at a time.
              e.preventDefault();
              const to = k.frame + (e.key === 'ArrowLeft' ? -1 : 1);
              if (engine.anim.moveKey(piece.id, k.frame, to)) engine.anim.setFrame(to);
            }
          }}
        >
          <Icon name="keyframe" size={12} />
        </button>
      ))}
      {drag ? (
        <span className="tl-drag-label" aria-hidden="true" style={{ left: drag.to * CELL + CELL / 2 }}>
          {t('timeline.dragFrame', { n: drag.to + 1 })}
        </span>
      ) : null}
      {menu !== null ? (
        <Menu anchor={anchor} open onClose={() => setMenu(null)} label={t('timeline.keyMenu')}>
          <SubMenu label={t('timeline.easing')}>
            {(close) =>
              EASINGS.map((ease: Easing) => (
                <MenuItem
                  key={ease}
                  label={t(`easing.${ease}` as I18nKey)}
                  checked={piece.keys.find((k) => k.frame === menu)?.easing === ease}
                  close={close}
                  onSelect={() => engine.anim.setKey(piece.id, menu, { easing: ease })}
                />
              ))
            }
          </SubMenu>
          <MenuSeparator />
          <MenuItem
            label={t('timeline.copyKey')}
            icon="copy"
            close={() => setMenu(null)}
            onSelect={() => {
              const k = engine.anim.piece(piece.id)?.keyframes.find((q) => q.frame === menu);
              if (k) copied = { x: k.x, y: k.y, sx: k.sx, sy: k.sy, angle: k.angle, skew: k.skew, opacity: k.opacity, easing: k.easing };
            }}
          />
          <MenuItem
            label={t('timeline.pasteKey')}
            icon="paste"
            disabled={copied === null}
            close={() => setMenu(null)}
            onSelect={() => copied && engine.anim.setKey(piece.id, menu, copied)}
          />
          <MenuSeparator />
          <MenuItem
            label={t('timeline.deleteKey')}
            icon="keyframe-delete"
            disabled={piece.keys.length < 2}
            close={() => setMenu(null)}
            onSelect={() => engine.anim.removeKey(piece.id, menu)}
          />
        </Menu>
      ) : null}
    </div>
  );
}

/** A piece's name in the left column: click to select it, double-click (or F2) to rename it. */
function PieceName({ piece, index, selected, layer }: { piece: PieceInfo; index: number; selected: boolean; layer: string }) {
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const name = pieceLabel(piece, index);
  if (renaming) {
    return (
      <input
        className="tl-rename"
        aria-label={t('timeline.renameField')}
        defaultValue={piece.name}
        placeholder={name}
        autoFocus
        maxLength={200}
        onBlur={(e) => {
          engine.anim.rename(piece.id, e.currentTarget.value);
          setRenaming(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.preventDefault();
            setRenaming(false);
          }
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`tl-name ${selected ? 'selected' : ''}`}
        aria-pressed={selected}
        data-tip={layer ? t('timeline.layerOf', { layer }) : undefined}
        onClick={() => {
          engine.anim.select(piece.id);
          if (useUi.getState().tool !== 'animate') engine.setTool('animate');
        }}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'F2') {
            e.preventDefault();
            setRenaming(true);
          } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault();
            setMenu(true);
          }
        }}
      >
        <span className="tl-name-text">{name}</span>
      </button>
      {menu ? (
        <Menu anchor={anchor} open onClose={() => setMenu(false)} label={t('timeline.pieceMenu')}>
          <MenuItem label={t('timeline.rename')} icon="text" close={() => setMenu(false)} onSelect={() => setRenaming(true)} />
          <MenuItem label={t('timeline.deletePiece')} icon="delete" close={() => setMenu(false)} onSelect={() => engine.anim.remove(piece.id)} />
        </Menu>
      ) : null}
    </>
  );
}

/** The frame ruler: click or drag to move through the frames; it's a slider for the keyboard. */
function Ruler({ length, frame }: { length: number; frame: number }) {
  const frameAt = (clientX: number, el: HTMLElement) => Math.max(0, Math.min(length - 1, Math.floor((clientX - el.getBoundingClientRect().left) / CELL)));
  const labels: number[] = [];
  for (let f = 0; f < length; f += 5) labels.push(f);
  return (
    <div
      className="tl-ruler"
      role="slider"
      tabIndex={0}
      aria-label={t('timeline.ruler')}
      aria-valuemin={1}
      aria-valuemax={length}
      aria-valuenow={frame + 1}
      aria-valuetext={t('timeline.frameValue', { n: frame + 1, total: length })}
      style={{ width: length * CELL }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        engine.anim.stop();
        engine.anim.setFrame(frameAt(e.clientX, el));
        const move = (ev: PointerEvent) => engine.anim.setFrame(frameAt(ev.clientX, el));
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'PageUp' ? -10 : e.key === 'PageDown' ? 10 : 0;
        if (step) engine.anim.setFrame(frame + step);
        else if (e.key === 'Home') engine.anim.setFrame(0);
        else if (e.key === 'End') engine.anim.setFrame(length - 1);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {labels.map((f) => (
        <span key={f} className="tl-label" style={{ left: f * CELL }}>
          {f + 1}
        </span>
      ))}
    </div>
  );
}

/** Pixel layers, top to bottom like the Layers panel. */
function pixelLayers(tree: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  const walk = (nodes: LayerNode[]) => {
    for (const n of [...nodes].reverse()) {
      if (n.kind === 'raster') out.push(n);
      else if (n.kind === 'group') walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** The frame commands for one layer at the frame shown. */
function DrawingMenu({ layerId, anchor, onClose }: { layerId: string; anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const cels = useUi((s) => s.animation.cels[layerId]);
  return (
    <Menu anchor={anchor} open onClose={onClose} label={t('timeline.celMenu')}>
      <MenuItem label={t('action.newDrawing')} icon="new" close={onClose} onSelect={() => void addDrawing(layerId, false)} />
      <MenuItem label={t('action.copyDrawing')} icon="copy" close={onClose} onSelect={() => void addDrawing(layerId, true)} />
      <MenuSeparator />
      <MenuItem label={t('action.clearDrawing')} icon="eraser" close={onClose} onSelect={() => engine.anim.clearDrawing(layerId)} />
      <MenuItem label={t('action.deleteDrawing')} icon="delete" disabled={!cels} close={onClose} onSelect={() => engine.anim.deleteDrawing(layerId)} />
    </Menu>
  );
}

/** A pixel layer's row: one bar for a still layer, a block per drawing for a frame-by-frame one. */
function LayerRow({ layer, starts, length, frame, active }: { layer: LayerNode; starts: number[] | undefined; length: number; frame: number; active: boolean }) {
  const [drag, setDrag] = useState<{ index: number; to: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const pick = (f: number) => {
    if (useUi.getState().layers.activeId !== layer.id) engine.layers.setActive(layer.id);
    engine.anim.setFrame(f);
  };
  const frameAt = (clientX: number, el: HTMLElement) => {
    const row = el.closest('.tl-row');
    return Math.max(0, Math.min(length - 1, Math.floor((clientX - (row ? row.getBoundingClientRect().left : 0)) / CELL)));
  };
  const openMenu = (el: HTMLElement, f: number) => {
    pick(f);
    anchor.current = el;
    setMenu(true);
  };
  const shown = starts && drag ? starts.map((s, i) => (i === drag.index ? drag.to : s)) : starts;
  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pick(starts![index]);
    if (index === 0) return;
    const el = e.currentTarget;
    let to = starts![index];
    const move = (ev: PointerEvent) => {
      to = frameAt(ev.clientX, el);
      setDrag({ index, to });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (to !== starts![index] && engine.anim.moveDrawing(layer.id, index, to)) engine.anim.setFrame(to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className={`tl-row tl-layer-row ${active ? 'selected' : ''}`}
      role="group"
      aria-label={layer.name}
      onPointerDown={(e) => e.button === 0 && pick(frameAt(e.clientX, e.currentTarget))}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.currentTarget, frameAt(e.clientX, e.currentTarget));
      }}
    >
      {!shown ? <span className="tl-still" data-tip={t('timeline.still')} style={{ width: length * CELL }} /> : null}
      {shown?.map((s, i) => {
        const end = i + 1 < shown.length ? shown[i + 1] - 1 : length - 1;
        const label = t('timeline.celLabel', { n: s + 1, layer: layer.name, end: end + 1 });
        return (
          <span key={`cel-${starts![i]}`} className={`tl-cel ${frame >= s && frame <= end ? 'current' : ''}`} style={{ left: s * CELL, width: Math.max(1, end - s + 1) * CELL }}>
            <button
              type="button"
              className="tl-cel-start"
              aria-label={label}
              data-tip={label}
              onPointerDown={(e) => startDrag(e, i)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openMenu(e.currentTarget, s);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pick(s);
                } else if (e.key === 'Delete') {
                  e.preventDefault();
                  pick(s);
                  engine.anim.deleteDrawing(layer.id);
                } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                  e.preventDefault();
                  openMenu(e.currentTarget, s);
                } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey && i > 0) {
                  // Alt+arrows hold the drawing before this one a frame shorter or longer.
                  e.preventDefault();
                  const to = s + (e.key === 'ArrowLeft' ? -1 : 1);
                  if (engine.anim.moveDrawing(layer.id, i, to)) engine.anim.setFrame(to);
                }
              }}
            />
          </span>
        );
      })}
      {menu ? <DrawingMenu layerId={layer.id} anchor={anchor} onClose={() => setMenu(false)} /> : null}
    </div>
  );
}

export function Timeline() {
  const anim = useUi((s) => s.animation);
  const settings = useUi((s) => s.settings.anim);
  const tree = useUi((s) => s.layers.tree);
  const activeId = useUi((s) => s.layers.activeId);
  const layers = pixelLayers(tree);
  const [height, setHeight] = useState(settings.timelineHeight);
  const body = useRef<HTMLDivElement | null>(null);
  useEffect(() => setHeight(settings.timelineHeight), [settings.timelineHeight]);

  // Keep the playhead in view (while playing, or after jumping to a frame), beside the names.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const x = anim.frame * CELL;
    const view = el.clientWidth - NAMES_W;
    if (x < el.scrollLeft || x + CELL > el.scrollLeft + view) el.scrollLeft = Math.max(0, x - view / 3);
  }, [anim.frame]);

  // Each layer, then the pieces on it (top first), as the Layers panel stacks them.
  const pieceIndex = new Map(anim.pieces.map((p, i) => [p.id, i]));
  const rows: ({ kind: 'layer'; layer: LayerNode } | { kind: 'piece'; piece: PieceInfo; index: number })[] = [];
  for (const l of layers) {
    rows.push({ kind: 'layer', layer: l });
    for (const p of [...anim.pieces].reverse()) if (p.layerId === l.id) rows.push({ kind: 'piece', piece: p, index: pieceIndex.get(p.id)! });
  }
  const listed = new Set(layers.map((l) => l.id));
  for (const p of anim.pieces) if (!listed.has(p.layerId)) rows.push({ kind: 'piece', piece: p, index: pieceIndex.get(p.id)! });

  const onResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const startY = e.clientY;
    const start = height;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let latest = start;
    const move = (ev: PointerEvent) => {
      latest = Math.min(480, Math.max(120, start - (ev.clientY - startY)));
      setHeight(latest);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      updateSettings({ anim: { ...useUi.getState().settings.anim, timelineHeight: latest } });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <section className="timeline" aria-label={t('timeline.label')} style={{ height }}>
      <div
        className="tl-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('timeline.resize')}
        aria-valuenow={height}
        aria-valuemin={120}
        aria-valuemax={480}
        tabIndex={0}
        onPointerDown={onResize}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowUp' ? 16 : e.key === 'ArrowDown' ? -16 : 0;
          if (!d) return;
          e.preventDefault();
          updateSettings({ anim: { ...settings, timelineHeight: Math.min(480, Math.max(120, height + d)) } });
        }}
      />
      <div className="tl-bar" role="toolbar" aria-label={t('group.playback')}>
        <TransportButton id="animFirstFrame" />
        <TransportButton id="animPrevFrame" />
        <TransportButton id="animPlay" icon={anim.playing ? 'pause' : 'play'} />
        <TransportButton id="animNextFrame" />
        <TransportButton id="animLastFrame" />
        <span className="opt tl-field">
          <span>{t('timeline.frame')}</span>
          <NumberField className="num tl-num" value={anim.frame + 1} min={1} max={anim.length} label={t('timeline.frame')} onChange={(v) => engine.anim.setFrame(v - 1)} />
          <span className="unit">{t('timeline.ofFrames', { n: anim.length })}</span>
        </span>
        <span className="opt tl-field">
          <span>{t('timeline.length')}</span>
          <NumberField className="num tl-num" value={anim.length} min={1} max={MAX_FRAMES} label={t('timeline.length')} onChange={(v) => engine.anim.setTimeline({ length: v })} />
          <span className="unit">{t('timeline.lengthUnit')}</span>
        </span>
        <span className="opt tl-field">
          <NumberField className="num tl-num" value={anim.fps} min={MIN_FPS} max={MAX_FPS} label={t('timeline.fps')} onChange={(v) => engine.anim.setTimeline({ fps: v })} />
          <span className="unit" data-tip={t('timeline.fps')}>
            {t('timeline.fpsShort')}
          </span>
        </span>
        <label className="opt">
          <span>{t('timeline.loop')}</span>
          <select className="select" aria-label={t('timeline.loop')} value={anim.loop} onChange={(e) => engine.anim.setTimeline({ loop: e.target.value as LoopMode })}>
            {LOOP_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`loop.${m}` as I18nKey)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="icon-btn tl-onion"
          aria-pressed={settings.onion}
          aria-label={t('action.onionSkin')}
          data-tip={t('timeline.onionTip')}
          onClick={() => setOnion({ onion: !settings.onion })}
        >
          <Icon name="layers" size={16} />
        </button>
        {settings.onion ? (
          <>
            <label className="opt">
              <span className="sr-only">{t('timeline.onionCount')}</span>
              <select className="select" aria-label={t('timeline.onionCount')} value={settings.onionCount} onChange={(e) => setOnion({ onionCount: Number(e.target.value) })}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {t('timeline.onionN', { n })}
                  </option>
                ))}
              </select>
            </label>
            <span className="opt tl-field">
              <NumberField
                className="num tl-num"
                value={Math.round(settings.onionOpacity * 100)}
                min={10}
                max={80}
                label={t('timeline.onionOpacity')}
                onChange={(v) => setOnion({ onionOpacity: v / 100 })}
              />
              <span className="unit">%</span>
            </span>
          </>
        ) : null}
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn"
          aria-label={t('timeline.close')}
          data-tip={t('timeline.close')}
          onClick={() => updateSettings({ anim: { ...settings, timeline: false } })}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="tl-body" ref={body}>
        <div className="tl-names">
          <div className="tl-names-head" aria-hidden="true" />
          <div role="list" aria-label={t('timeline.rows')}>
            {rows.map((r) =>
              r.kind === 'layer' ? (
                <div key={r.layer.id} role="listitem" className="tl-name-row">
                  <button
                    type="button"
                    className={`tl-name ${r.layer.id === activeId ? 'selected' : ''}`}
                    aria-pressed={r.layer.id === activeId}
                    onClick={() => engine.layers.setActive(r.layer.id)}
                  >
                    <Icon name="layers" size={13} />
                    <span className="tl-name-text">{r.layer.name}</span>
                  </button>
                </div>
              ) : (
                <div key={r.piece.id} role="listitem" className="tl-name-row tl-piece-name">
                  <PieceName piece={r.piece} index={r.index} selected={r.piece.id === anim.selectedId} layer={layerName(tree, r.piece.layerId)} />
                </div>
              ),
            )}
          </div>
        </div>
        <div className="tl-tracks" style={{ width: anim.length * CELL }}>
          <Ruler length={anim.length} frame={anim.frame} />
          <div className="tl-rows" style={{ width: anim.length * CELL }}>
            {rows.map((r) =>
              r.kind === 'layer' ? (
                <LayerRow key={r.layer.id} layer={r.layer} starts={anim.cels[r.layer.id]} length={anim.length} frame={anim.frame} active={r.layer.id === activeId} />
              ) : (
                <PieceRow key={r.piece.id} piece={r.piece} index={r.index} selected={r.piece.id === anim.selectedId} frame={anim.frame} />
              ),
            )}
            {anim.pieces.length === 0 && Object.keys(anim.cels).length === 0 ? <p className="tl-empty">{t('timeline.empty')}</p> : null}
          </div>
          <div className="tl-playhead" aria-hidden="true" style={{ left: anim.frame * CELL + CELL / 2 }} />
        </div>
      </div>
    </section>
  );
}
