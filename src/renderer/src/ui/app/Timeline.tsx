import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { EASINGS, type Easing } from '@engine/anim/interpolate';
import type { KeyChange } from '@engine/anim/piece';
import { LOOP_MODES, MAX_FPS, MAX_FRAMES, MIN_FPS, type LoopMode } from '@engine/anim/timeline';
import type { PieceInfo, ShapeKeysInfo } from '@engine/anim/AnimationController';
import { celRepeats, type CelLoop } from '@engine/anim/cels';
import { loopFrame } from '@engine/anim/piece';
import type { LayerNode } from '@engine/doc/LayerController';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { t, type I18nKey } from '../../i18n';
import { Icon } from '../icons/Icon';
import { NumberField } from '../components/Controls';
import { Menu, MenuItem, MenuSeparator, SubMenu } from '../components/Menu';
import { engine } from '../state/engine';
import { updateSettings, useUi } from '../state/store';
import { action, addDrawing, ownerDrawings, runAction, setOnion } from '../actions/actions';
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
  return p.name || t(p.kind === 'group' ? 'piece.groupName' : 'piece.defaultName', { n: i + 1 });
}

/** A row of keyframes for one piece. */
function PieceRow({ piece, index, selected, frame, length }: { piece: PieceInfo; index: number; selected: boolean; frame: number; length: number }) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const row = useRef<HTMLDivElement | null>(null);
  // After Alt+arrows move a keyframe, the focus follows it to its new frame.
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    const f = refocus.current;
    if (f === null) return;
    refocus.current = null;
    row.current?.querySelector<HTMLElement>(`.tl-key[data-frame="${f}"]`)?.focus();
  }, [piece.keys]);
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
  // A looping piece's keyframes again after its last one, faded (where its moves repeat them).
  const ghosts: number[] = [];
  const lastKey = keys[keys.length - 1]?.frame ?? 0;
  if (piece.loop !== 'off' && keys.length > 1) {
    const at = new Set(keys.map((k) => k.frame));
    for (let f = lastKey + 1; f < length; f++) if (at.has(loopFrame(keys, piece.loop, f))) ghosts.push(f);
  }
  return (
    <div
      ref={row}
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
      {ghosts.length ? <span className="tl-seg ghost" aria-hidden="true" style={{ left: lastKey * CELL + CELL / 2, width: (length - 1 - lastKey) * CELL }} /> : null}
      {ghosts.map((f) => (
        <span key={`ghost-${f}`} className="tl-key ghost" aria-hidden="true" data-tip={t('timeline.keyRepeat', { n: loopFrame(keys, piece.loop, f) + 1 })} style={{ left: f * CELL }}>
          <Icon name="keyframe" size={12} />
        </span>
      ))}
      {keys.map((k) => (
        <button
          key={`key-${k.at}`}
          type="button"
          className={`tl-key ${selected && k.frame === frame ? 'current' : ''}`}
          data-frame={k.frame}
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
              refocus.current = to;
              if (engine.anim.moveKey(piece.id, k.frame, to)) engine.anim.setFrame(to);
              else refocus.current = null;
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

/** What a row of keyframes (the camera's, a shape's trim) does when it's used. */
interface KeyRowProps {
  name: string;
  /** Extra class for the row. */
  kind: string;
  keys: { frame: number; easing: Easing }[];
  selected: boolean;
  frame: number;
  select(): void;
  move(from: number, to: number): boolean;
  remove(frame: number): void;
  setEasing(frame: number, easing: Easing): void;
}

/** A row of keyframes edited like a piece's: drag a diamond to retime it, right-click for its easing and Delete. */
function KeyRow({ name, kind, keys: list, selected, frame, select, move: moveKey, remove, setEasing }: KeyRowProps) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const frameAt = (clientX: number, el: HTMLElement): number => {
    const row = el.closest('.tl-row');
    const left = row ? row.getBoundingClientRect().left : 0;
    return Math.max(0, Math.floor((clientX - left) / CELL));
  };
  const onKeyDown = (e: ReactPointerEvent<HTMLButtonElement>, k: number) => {
    if (e.button === 2) return;
    e.stopPropagation();
    select();
    engine.anim.setFrame(k);
    const el = e.currentTarget;
    let to = k;
    const move = (ev: PointerEvent) => {
      to = Math.min(MAX_FRAMES - 1, frameAt(ev.clientX, el));
      setDrag({ from: k, to });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (to === k) return;
      if (to >= engine.anim.timeline.length) engine.anim.setTimeline({ length: to + 1 });
      if (moveKey(k, to)) engine.anim.setFrame(to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const keys = list.map((k) => ({ ...k, at: k.frame, frame: drag && k.frame === drag.from ? drag.to : k.frame })).sort((a, b) => a.frame - b.frame);
  return (
    <div
      className={`tl-row tl-piece-row ${kind} ${selected ? 'selected' : ''}`}
      role="group"
      aria-label={name}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        select();
        engine.anim.setFrame(frameAt(e.clientX, e.currentTarget));
      }}
    >
      {keys.slice(0, -1).map((k, i) => (
        <span key={`seg-${k.at}`} className={`tl-seg ${k.easing === 'hold' ? 'hold' : ''}`} style={{ left: k.frame * CELL + CELL / 2, width: (keys[i + 1].frame - k.frame) * CELL }} />
      ))}
      {keys.map((k) => {
        const label = t('timeline.keyLabel', { n: k.frame + 1, piece: name, easing: t(`easing.${k.easing}` as I18nKey) });
        return (
          <button
            key={`key-${k.at}`}
            type="button"
            className={`tl-key ${selected && k.frame === frame ? 'current' : ''}`}
            data-frame={k.frame}
            style={{ left: k.frame * CELL }}
            aria-label={label}
            aria-pressed={selected && k.frame === frame}
            data-tip={label}
            onPointerDown={(e) => onKeyDown(e, k.frame)}
            onContextMenu={(e) => {
              e.preventDefault();
              anchor.current = e.currentTarget;
              select();
              setMenu(k.frame);
            }}
            onKeyDown={(e: ReactKeyboardEvent<HTMLButtonElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                select();
                engine.anim.setFrame(k.frame);
              } else if (e.key === 'Delete') {
                e.preventDefault();
                remove(k.frame);
              } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                e.preventDefault();
                anchor.current = e.currentTarget;
                setMenu(k.frame);
              } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) {
                e.preventDefault();
                const to = k.frame + (e.key === 'ArrowLeft' ? -1 : 1);
                if (moveKey(k.frame, to)) engine.anim.setFrame(to);
              }
            }}
          >
            <Icon name="keyframe" size={12} />
          </button>
        );
      })}
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
                <MenuItem key={ease} label={t(`easing.${ease}` as I18nKey)} checked={list.find((k) => k.frame === menu)?.easing === ease} close={close} onSelect={() => setEasing(menu, ease)} />
              ))
            }
          </SubMenu>
          <MenuSeparator />
          <MenuItem label={t('timeline.deleteKey')} icon="keyframe-delete" close={() => setMenu(null)} onSelect={() => remove(menu)} />
        </Menu>
      ) : null}
    </div>
  );
}

/** The camera's row: keyframes of its moves (pan and push), edited like a piece's. */
function CameraRow({ keys, selected, frame }: { keys: { frame: number; easing: Easing }[]; selected: boolean; frame: number }) {
  return (
    <KeyRow
      name={t('camera.row')}
      kind="tl-camera-row"
      keys={keys}
      selected={selected}
      frame={frame}
      select={() => engine.anim.selectCamera()}
      move={(from, to) => engine.anim.moveCameraKey(from, to)}
      remove={(f) => engine.anim.removeCameraKey(f)}
      setEasing={(f, easing) => engine.anim.setCameraKey(f, { easing })}
    />
  );
}

/** A shape's row under its layer: the keyframes of its trim. */
function ShapeRow({ shape, name, frame }: { shape: ShapeKeysInfo; name: string; frame: number }) {
  return (
    <KeyRow
      name={name}
      kind="tl-shape-row"
      keys={shape.keys}
      selected={false}
      frame={frame}
      select={() => engine.selectShape(shape.layerId, shape.id)}
      move={(from, to) => engine.moveShapeTrimKey(shape.layerId, shape.id, from, to)}
      remove={(f) => engine.removeShapeTrimKey(shape.layerId, shape.id, f)}
      setEasing={(f, easing) => engine.setShapeTrimKeyEasing(shape.layerId, shape.id, f, easing)}
    />
  );
}

/** Make a layer the active one (picking its row). */
function selectLayer(id: string): void {
  if (useUi.getState().layers.activeId !== id) engine.layers.setActive(id);
}

/** Pick a piece's drawings row: the piece, painted on, so the drawing commands and painting act on its drawings. */
function selectPieceDrawings(id: string): void {
  engine.anim.select(id);
  engine.anim.setPaintOnPiece(true);
}

/** A spinning piece's row under its own: the keys of its spin's speeds (not its keyframes). */
function SpinRow({ piece, name, selected, frame }: { piece: PieceInfo; name: string; selected: boolean; frame: number }) {
  return (
    <KeyRow
      name={name}
      kind="tl-spin-row"
      keys={piece.spinKeys}
      selected={selected}
      frame={frame}
      select={() => engine.anim.select(piece.id)}
      move={(from, to) => engine.anim.moveSpinKey(piece.id, from, to)}
      remove={(f) => engine.anim.removeSpinKey(piece.id, f)}
      setEasing={(f, easing) => engine.anim.setSpin(piece.id, f, { easing })}
    />
  );
}

/** A shape layer's row: just a still bar (its shapes' keyed trims have rows of their own beneath it). */
function ShapeLayerRow({ layer, length, active }: { layer: LayerNode; length: number; active: boolean }) {
  return (
    <div
      className={`tl-row tl-layer-row ${active ? 'selected' : ''}`}
      role="group"
      aria-label={layer.name}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (useUi.getState().layers.activeId !== layer.id) engine.layers.setActive(layer.id);
        const row = e.currentTarget.getBoundingClientRect();
        engine.anim.setFrame(Math.max(0, Math.min(length - 1, Math.floor((e.clientX - row.left) / CELL))));
      }}
    >
      <span className="tl-still" style={{ width: length * CELL }} />
    </div>
  );
}

/** Each layer's pieces, top first, with the pieces linked under one indented beneath it (a group, then its faces). */
function treeRows(pieces: readonly PieceInfo[], layerId: string): { piece: PieceInfo; level: number }[] {
  const on = pieces.filter((p) => p.layerId === layerId);
  const here = new Set(on.map((p) => p.id));
  const under = new Map<string, PieceInfo[]>();
  for (const p of on) if (p.parent && here.has(p.parent)) under.set(p.parent, [...(under.get(p.parent) ?? []), p]);
  const out: { piece: PieceInfo; level: number }[] = [];
  const seen = new Set<string>();
  const visit = (p: PieceInfo, level: number) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push({ piece: p, level });
    for (const c of [...(under.get(p.id) ?? [])].reverse()) visit(c, level + 1);
  };
  for (const p of [...on].reverse()) if (!p.parent || !here.has(p.parent)) visit(p, 0);
  // Anything left (links that don't hold) at the top level.
  for (const p of [...on].reverse()) visit(p, 0);
  return out;
}

/**
 * Paint on piece from the piece's row: selects it and has painting tools paint its own pixels
 * (picking the Brush if the tool in use can't paint a piece). Pressed while that's happening.
 */
function PaintToggle({ piece, name, selected }: { piece: PieceInfo; name: string; selected: boolean }) {
  const on = useUi((s) => s.animation.paintOnPiece) && selected;
  const label = t('piece.paintOn', { piece: name });
  return (
    <button
      type="button"
      className="icon-btn tl-piece-paint"
      aria-pressed={on}
      aria-label={label}
      data-tip={label}
      onClick={() => {
        if (on) {
          engine.anim.setPaintOnPiece(false);
          return;
        }
        engine.anim.select(piece.id);
        engine.anim.setPaintOnPiece(true);
        if (!toolRegistry.get(useUi.getState().tool)?.paintsPieces) engine.setTool('brush');
      }}
    >
      <Icon name="brush" size={14} />
    </button>
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
        {piece.kind === 'group' ? <Icon name="box" size={13} /> : null}
        <span className="tl-name-text">{name}</span>
      </button>
      {piece.kind === 'group' ? null : <PaintToggle piece={piece} name={name} selected={selected} />}
      {menu ? (
        <Menu anchor={anchor} open onClose={() => setMenu(false)} label={t('timeline.pieceMenu')}>
          <MenuItem label={t('timeline.rename')} icon="text" close={() => setMenu(false)} onSelect={() => setRenaming(true)} />
          <MenuItem label={t('timeline.duplicatePiece')} icon="copy" close={() => setMenu(false)} onSelect={() => engine.anim.duplicate(piece.id)} />
          {piece.parent ? <MenuItem label={t(piece.hinged ? 'piece.unhinge' : 'timeline.detach')} close={() => setMenu(false)} onSelect={() => engine.anim.detach(piece.id)} /> : null}
          {piece.kind === 'group' ? <MenuItem label={t('piece.centrePivot')} close={() => setMenu(false)} onSelect={() => engine.anim.centrePivot(piece.id)} /> : null}
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

/** Pixel layers, and shape layers with keyed shapes, top to bottom like the Layers panel. */
function pixelLayers(tree: LayerNode[], keyed: ReadonlySet<string> = new Set()): LayerNode[] {
  const out: LayerNode[] = [];
  const walk = (nodes: LayerNode[]) => {
    for (const n of [...nodes].reverse()) {
      if (n.kind === 'raster' || (n.kind === 'vector' && keyed.has(n.id))) out.push(n);
      else if (n.kind === 'group') walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** The frame commands for one layer's (or piece's) drawings at the frame shown. */
function DrawingMenu({ layerId, anchor, onClose }: { layerId: string; anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const cels = useUi((s) => ownerDrawings(s, layerId).starts);
  const loop = useUi((s) => ownerDrawings(s, layerId).loop?.mode ?? null);
  return (
    <Menu anchor={anchor} open onClose={onClose} label={t('timeline.celMenu')}>
      <MenuItem label={t('action.newDrawing')} icon="new" close={onClose} onSelect={() => void addDrawing(layerId, false)} />
      <MenuItem label={t('action.copyDrawing')} icon="copy" close={onClose} onSelect={() => void addDrawing(layerId, true)} />
      <MenuSeparator />
      <MenuItem label={t('action.clearDrawing')} icon="eraser" close={onClose} onSelect={() => engine.anim.clearDrawing(layerId)} />
      <MenuItem label={t('action.deleteDrawing')} icon="delete" disabled={!cels} close={onClose} onSelect={() => engine.anim.deleteDrawing(layerId)} />
      <MenuSeparator />
      <SubMenu label={t('loop.drawings')}>
        {(close) =>
          ([null, 'cycle', 'pingpong'] as const).map((m) => (
            <MenuItem key={m ?? 'off'} label={t(m === 'cycle' ? 'loop.cycle' : m === 'pingpong' ? 'loop.backAndForth' : 'loop.off')} checked={loop === m} disabled={m !== null && !cels} close={close} onSelect={() => engine.anim.setDrawingLoop(layerId, m)} />
          ))
        }
      </SubMenu>
    </Menu>
  );
}

/**
 * A pixel layer's row: one bar for a still layer, a block per drawing for a frame-by-frame one.
 * A piece drawn frame by frame has one too, under it (`kind` adds its class; `select` picks it).
 */
function LayerRow({ layer, select, kind = '', starts, loop, length, frame, active }: { layer: { id: string; name: string }; select(): void; kind?: string; starts: number[] | undefined; loop: CelLoop | undefined; length: number; frame: number; active: boolean }) {
  const [drag, setDrag] = useState<{ index: number; to: number } | null>(null);
  const [endDrag, setEndDrag] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const row = useRef<HTMLDivElement | null>(null);
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    const f = refocus.current;
    if (f === null) return;
    refocus.current = null;
    row.current?.querySelector<HTMLElement>(`.tl-cel-start[data-frame="${f}"]`)?.focus();
  }, [starts]);
  const pick = (f: number) => {
    select();
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
  // A loop: the cycle ends where its end handle is (dragged or not), and repeats follow.
  const cycle = loop && shown ? { ...loop, end: endDrag ?? loop.end } : null;
  const repeats = cycle && shown ? celRepeats(shown.map((start) => ({ start })), cycle, length) : [];
  const startEndDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !loop) return;
    e.stopPropagation();
    const el = e.currentTarget;
    let to = loop.end;
    const move = (ev: PointerEvent) => {
      to = Math.max(1, frameAt(ev.clientX, el) + 1);
      setEndDrag(to);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setEndDrag(null);
      if (to !== loop.end) engine.anim.setLoopEnd(layer.id, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
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
      ref={row}
      className={`tl-row tl-layer-row ${kind} ${active ? 'selected' : ''}`}
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
        const end = i + 1 < shown.length ? shown[i + 1] - 1 : cycle ? cycle.end - 1 : length - 1;
        const label = t('timeline.celLabel', { n: s + 1, layer: layer.name, end: end + 1 });
        return (
          <span key={`cel-${starts![i]}`} className={`tl-cel ${frame >= s && frame <= end ? 'current' : ''}`} style={{ left: s * CELL, width: Math.max(1, end - s + 1) * CELL }}>
            <button
              type="button"
              className="tl-cel-start"
              data-frame={s}
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
                  refocus.current = to;
                  if (engine.anim.moveDrawing(layer.id, i, to)) engine.anim.setFrame(to);
                  else refocus.current = null;
                }
              }}
            />
          </span>
        );
      })}
      {repeats.map((r) => (
        <span key={`rep-${r.from}`} className={`tl-cel repeat ${frame >= r.from && frame <= r.to ? 'current' : ''}`} data-tip={t('timeline.repeat', { n: r.index + 1 })} style={{ left: r.from * CELL, width: (r.to - r.from + 1) * CELL }} />
      ))}
      {cycle ? (
        <button
          type="button"
          className="tl-loop-end"
          data-frame={cycle.end}
          aria-label={t('timeline.loopEndAt', { n: cycle.end })}
          data-tip={t('timeline.loopEndAt', { n: cycle.end })}
          style={{ left: cycle.end * CELL }}
          onPointerDown={startEndDrag}
          onKeyDown={(e) => {
            if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && loop) {
              e.preventDefault();
              engine.anim.setLoopEnd(layer.id, loop.end + (e.key === 'ArrowLeft' ? -1 : 1));
            }
          }}
        >
          <Icon name="loop" size={11} />
        </button>
      ) : null}
      {menu ? <DrawingMenu layerId={layer.id} anchor={anchor} onClose={() => setMenu(false)} /> : null}
    </div>
  );
}

export function Timeline() {
  const anim = useUi((s) => s.animation);
  const settings = useUi((s) => s.settings.anim);
  const tree = useUi((s) => s.layers.tree);
  const activeId = useUi((s) => s.layers.activeId);
  const layers = pixelLayers(tree, new Set(anim.shapes.map((sh) => sh.layerId)));
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

  // The camera, then each layer and the pieces on it (top first, as the Layers panel stacks them),
  // the pieces linked under one indented beneath it.
  const pieceIndex = new Map(anim.pieces.map((p, i) => [p.id, i]));
  const rows: ({ kind: 'camera' } | { kind: 'layer'; layer: LayerNode } | { kind: 'piece' | 'spin' | 'drawings'; piece: PieceInfo; index: number; level: number } | { kind: 'shape'; shape: ShapeKeysInfo; name: string })[] = [];
  // A spinning piece's speeds get a row of their own beneath it.
  const pushPiece = (piece: PieceInfo, level: number) => {
    const index = pieceIndex.get(piece.id)!;
    rows.push({ kind: 'piece', piece, index, level });
    if (piece.drawings) rows.push({ kind: 'drawings', piece, index, level });
    if (piece.spinKeys.length) rows.push({ kind: 'spin', piece, index, level });
  };
  if (anim.pieces.length) rows.push({ kind: 'camera' });
  for (const l of layers) {
    rows.push({ kind: 'layer', layer: l });
    // A shape layer's keyed shapes, top first.
    for (const sh of anim.shapes.filter((x) => x.layerId === l.id).reverse()) rows.push({ kind: 'shape', shape: sh, name: t('timeline.shapeRow', { layer: l.name, n: sh.n }) });
    for (const r of treeRows(anim.pieces, l.id)) pushPiece(r.piece, r.level);
  }
  const listed = new Set(layers.map((l) => l.id));
  for (const p of anim.pieces) if (!listed.has(p.layerId)) pushPiece(p, 0);

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
              r.kind === 'camera' ? (
                <div key="camera" role="listitem" className="tl-name-row">
                  <button
                    type="button"
                    className={`tl-name ${anim.cameraSelected ? 'selected' : ''}`}
                    aria-pressed={anim.cameraSelected}
                    data-tip={t('camera.rowTip')}
                    onClick={() => {
                      engine.anim.selectCamera();
                      const tool = useUi.getState().tool;
                      if (tool !== 'animate' && tool !== 'plane') engine.setTool('plane');
                    }}
                  >
                    <Icon name="camera" size={13} />
                    <span className="tl-name-text">{t('camera.row')}</span>
                  </button>
                </div>
              ) : r.kind === 'shape' ? (
                <div key={`shape-${r.shape.id}`} role="listitem" className="tl-name-row tl-piece-name" data-level={1} style={{ paddingInlineStart: 12 }}>
                  <button type="button" className="tl-name" data-tip={t('timeline.shapeRowTip')} onClick={() => engine.selectShape(r.shape.layerId, r.shape.id)}>
                    <Icon name="pen" size={13} />
                    <span className="tl-name-text">{r.name}</span>
                  </button>
                </div>
              ) : r.kind === 'drawings' ? (
                <div key={`drawings-${r.piece.id}`} role="listitem" className="tl-name-row tl-piece-name" data-level={r.level + 1} style={{ paddingInlineStart: (r.level + 1) * 12 }}>
                  <button type="button" className={`tl-name ${r.piece.id === anim.selectedId && anim.paintOnPiece ? 'selected' : ''}`} data-tip={t('timeline.pieceDrawingsTip')} onClick={() => selectPieceDrawings(r.piece.id)}>
                    <Icon name="layers" size={13} />
                    <span className="tl-name-text">{t('timeline.pieceDrawings', { piece: pieceLabel(r.piece, r.index) })}</span>
                  </button>
                </div>
              ) : r.kind === 'spin' ? (
                <div key={`spin-${r.piece.id}`} role="listitem" className="tl-name-row tl-piece-name" data-level={r.level + 1} style={{ paddingInlineStart: (r.level + 1) * 12 }}>
                  <button
                    type="button"
                    className={`tl-name ${r.piece.id === anim.selectedId ? 'selected' : ''}`}
                    data-tip={t('spin.rowTip')}
                    onClick={() => {
                      engine.anim.select(r.piece.id);
                      const tool = useUi.getState().tool;
                      if (tool !== 'animate' && tool !== 'plane') engine.setTool('animate');
                    }}
                  >
                    <Icon name="rotate-cw" size={13} />
                    <span className="tl-name-text">{t('spin.row', { piece: pieceLabel(r.piece, r.index) })}</span>
                  </button>
                </div>
              ) : r.kind === 'layer' ? (
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
                <div key={r.piece.id} role="listitem" className="tl-name-row tl-piece-name" data-level={r.level} style={r.level ? { paddingInlineStart: r.level * 12 } : undefined}>
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
              r.kind === 'camera' ? (
                <CameraRow key="camera" keys={anim.cameraKeys} selected={anim.cameraSelected} frame={anim.frame} />
              ) : r.kind === 'shape' ? (
                <ShapeRow key={`shape-${r.shape.id}`} shape={r.shape} name={r.name} frame={anim.frame} />
              ) : r.kind === 'layer' && r.layer.kind === 'vector' ? (
                <ShapeLayerRow key={r.layer.id} layer={r.layer} length={anim.length} active={r.layer.id === activeId} />
              ) : r.kind === 'layer' ? (
                <LayerRow key={r.layer.id} layer={r.layer} select={() => selectLayer(r.layer.id)} starts={anim.cels[r.layer.id]} loop={anim.celLoops[r.layer.id]} length={anim.length} frame={anim.frame} active={r.layer.id === activeId} />
              ) : r.kind === 'drawings' ? (
                <LayerRow
                  key={`drawings-${r.piece.id}`}
                  layer={{ id: r.piece.id, name: t('timeline.pieceDrawings', { piece: pieceLabel(r.piece, r.index) }) }}
                  select={() => selectPieceDrawings(r.piece.id)}
                  kind="tl-drawings-row"
                  starts={r.piece.drawings ?? undefined}
                  loop={r.piece.drawingLoop ?? undefined}
                  length={anim.length}
                  frame={anim.frame}
                  active={r.piece.id === anim.selectedId && anim.paintOnPiece}
                />
              ) : r.kind === 'spin' ? (
                <SpinRow key={`spin-${r.piece.id}`} piece={r.piece} name={t('spin.row', { piece: pieceLabel(r.piece, r.index) })} selected={r.piece.id === anim.selectedId} frame={anim.frame} />
              ) : (
                <PieceRow key={r.piece.id} piece={r.piece} index={r.index} selected={r.piece.id === anim.selectedId} frame={anim.frame} length={anim.length} />
              ),
            )}
            {anim.pieces.length === 0 && Object.keys(anim.cels).length === 0 && anim.shapes.length === 0 ? <p className="tl-empty">{t('timeline.empty')}</p> : null}
          </div>
          <div className="tl-playhead" aria-hidden="true" style={{ left: anim.frame * CELL + CELL / 2 }} />
        </div>
      </div>
    </section>
  );
}
