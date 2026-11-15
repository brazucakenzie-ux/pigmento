import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { BLEND_MODES, type BlendMode } from '@engine/doc/Document';
import type { LayerNode } from '@engine/doc/LayerController';
import { t, type I18nKey } from '../../i18n';
import { Icon } from '../icons/Icon';
import { Slider } from '../components/Controls';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { runAction } from '../actions/actions';

const THUMB_W = 40;
const THUMB_H = 30;

/** Rows in display order: top layer first, children under their group unless collapsed. */
function flatten(nodes: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  for (const n of [...nodes].reverse()) {
    out.push(n);
    if (n.kind === 'group' && !n.collapsed) out.push(...flatten(n.children));
  }
  return out;
}

function findNode(nodes: LayerNode[], id: string): LayerNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = findNode(n.children, id);
    if (c) return c;
  }
  return null;
}

/** Parent id (null = top level) and bottom-up index of a node. */
function locate(nodes: LayerNode[], id: string, parent: string | null = null): { parent: string | null; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { parent, index: i };
    const r = locate(nodes[i].children, id, nodes[i].id);
    if (r) return r;
  }
  return null;
}

export function displayName(n: LayerNode): string {
  return n.name || t(n.kind === 'group' ? 'layer.group' : n.kind === 'vector' ? 'layer.shapes' : 'layer.default', { n: 1 });
}

function Thumbnail({ id, kind }: { id: string; kind: LayerNode['kind'] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const doc = useUi((s) => s.doc);
  const [tick, setTick] = useState(0);
  useEffect(() => engine.on('pixels', () => setTick((n) => n + 1)), []);
  const scale = Math.min(THUMB_W / doc.width, THUMB_H / doc.height);
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));
  useLayoutEffect(() => {
    const c = ref.current;
    const layer = engine.doc.layerById(id);
    if (!c || !layer) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (g) engine.renderer.drawLayerThumbnail(layer, g, c.width, c.height);
  }, [id, w, h, tick, doc]);
  return (
    <span className="layer-thumb" aria-hidden="true">
      <canvas ref={ref} style={{ width: w, height: h }} />
      {kind === 'group' ? <Icon name="folder" size={14} className="layer-thumb-badge" /> : null}
      {kind === 'vector' ? <Icon name="shapes" size={14} className="layer-thumb-badge" /> : null}
    </span>
  );
}

type DropPos = 'above' | 'below' | 'into';

function LayerRow({
  node,
  active,
  onDragStart,
  onDrop,
}: {
  node: LayerNode;
  active: boolean;
  onDragStart: (id: string) => void;
  onDrop: (target: LayerNode, pos: DropPos) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [drop, setDrop] = useState<DropPos | null>(null);
  const name = displayName(node);
  const posFor = (e: DragEvent<HTMLElement>): DropPos => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    if (node.kind === 'group' && f > 0.3 && f < 0.7) return 'into';
    return f < 0.5 ? 'above' : 'below';
  };
  return (
    <li
      className={`layer-row ${active ? 'active' : ''} ${drop ? `drop-${drop}` : ''} ${node.visible ? '' : 'hidden-layer'}`}
      style={{ paddingLeft: 6 + node.depth * 16 }}
      draggable={!editing}
      id={`layer-row-${node.id}`}
      onClick={() => engine.layers.setActive(node.id)}
      onDoubleClick={() => setEditing(true)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-pigmento-layer', node.id);
        onDragStart(node.id);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-pigmento-layer')) return;
        e.preventDefault();
        setDrop(posFor(e));
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        e.preventDefault();
        const pos = posFor(e);
        setDrop(null);
        onDrop(node, pos);
      }}
    >
      {node.kind === 'group' ? (
        <button
          type="button"
          className="icon-btn layer-twist"
          aria-label={t(node.collapsed ? 'panel.expand' : 'panel.collapse', { name })}
          aria-expanded={!node.collapsed}
          onClick={(e) => {
            e.stopPropagation();
            engine.layers.setCollapsed(node.id, !node.collapsed);
          }}
        >
          <Icon name={node.collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
        </button>
      ) : (
        <span className="layer-twist" />
      )}
      <button
        type="button"
        className="icon-btn layer-toggle"
        aria-pressed={node.visible}
        aria-label={t(node.visible ? 'layers.hide' : 'layers.show', { name })}
        data-tip={t(node.visible ? 'layers.hide' : 'layers.show', { name })}
        onClick={(e) => {
          e.stopPropagation();
          engine.layers.setProps(node.id, { visible: !node.visible });
        }}
      >
        <Icon name={node.visible ? 'eye' : 'eye-off'} size={15} />
      </button>
      <Thumbnail id={node.id} kind={node.kind} />
      {editing ? (
        <input
          className="text-input layer-name-input"
          aria-label={t('layers.rename')}
          defaultValue={name}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = name;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== name) engine.layers.setProps(node.id, { name: v.slice(0, 120) });
            setEditing(false);
          }}
        />
      ) : (
        <button type="button" className="layer-name" aria-current={active ? 'true' : undefined} onClick={() => engine.layers.setActive(node.id)}>
          {name}
          {node.blend !== 'normal' || node.opacity < 1 ? (
            <span className="layer-meta">
              {node.blend !== 'normal' ? t(`blend.${node.blend}` as I18nKey) : ''}
              {node.opacity < 1 ? ` ${Math.round(node.opacity * 100)}%` : ''}
            </span>
          ) : null}
        </button>
      )}
      <button
        type="button"
        className="icon-btn layer-toggle"
        aria-pressed={node.locked}
        aria-label={t(node.locked ? 'layers.unlock' : 'layers.lock', { name })}
        data-tip={t(node.locked ? 'layers.unlock' : 'layers.lock', { name })}
        onClick={(e) => {
          e.stopPropagation();
          engine.layers.setProps(node.id, { locked: !node.locked });
        }}
      >
        <Icon name={node.locked ? 'lock' : 'unlock'} size={14} />
      </button>
    </li>
  );
}

function ToolbarButton({ action, icon, label }: { action: string; icon: string; label: I18nKey }) {
  const enabled = useUi((s) => layerActionEnabled(action, s.layers.activeId));
  return (
    <button type="button" className="icon-btn" aria-label={t(label)} data-tip={t(label)} disabled={!enabled} onClick={() => runAction(action)}>
      <Icon name={icon} size={16} />
    </button>
  );
}

export function layerActionEnabled(action: string, activeId: string): boolean {
  void activeId;
  if (action === 'layerMergeDown') return engine.layers.canMergeDown();
  if (action === 'layerDelete') return engine.layers.canRemove();
  if (action === 'layerUngroup') return engine.doc.activeLayer.kind === 'group';
  return true;
}

/** The Layers panel: one row per layer (top first), with the active layer's blend and opacity. */
export function LayersPanel() {
  const info = useUi((s) => s.layers);
  const rows = flatten(info.tree);
  const active = findNode(info.tree, info.activeId);
  const dragging = useRef<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  // Keep the active row visible by scrolling the list only (scrollIntoView would also scroll
  // the panel around it).
  useEffect(() => {
    const el = list.current;
    const row = document.getElementById(`layer-row-${info.activeId}`);
    if (!el || !row) return;
    const top = row.offsetTop;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + row.offsetHeight - el.clientHeight;
  }, [info.activeId]);

  const onDrop = (target: LayerNode, pos: DropPos) => {
    const id = dragging.current;
    dragging.current = null;
    if (!id || id === target.id) return;
    if (pos === 'into') {
      engine.layers.move(id, target.id, target.children.length);
      return;
    }
    const loc = locate(info.tree, target.id);
    if (!loc) return;
    // The list is shown top-first, so "above" means a higher index in the document.
    engine.layers.move(id, loc.parent, pos === 'above' ? loc.index + 1 : loc.index);
  };

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const i = rows.findIndex((r) => r.id === info.activeId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        engine.layers.setActive(next.id);
        // Keep the keyboard on the selected layer's row.
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`#layer-row-${CSS.escape(next.id)} .layer-name`)?.focus());
      }
      e.preventDefault();
    } else if (e.key === 'F2') {
      document.getElementById(`layer-row-${info.activeId}`)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      e.preventDefault();
    }
  };

  return (
    <div className="layers-panel">
      {active ? (
        <div className="layer-props">
          <select
            className="select"
            aria-label={t('layers.blend')}
            data-tip={t('layers.blend')}
            value={active.blend}
            onChange={(e) => engine.layers.setProps(active.id, { blend: e.target.value as BlendMode })}
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`blend.${m}` as I18nKey)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {active ? (
        <div className="layer-props">
          <span className="layer-props-label">{t('opt.opacity')}</span>
          <Slider
            value={Math.round(active.opacity * 100)}
            onChange={(v) => engine.layers.setProps(active.id, { opacity: v / 100 })}
            min={0}
            max={100}
            unit="%"
            label={t('layers.opacity')}
          />
        </div>
      ) : null}
      <ul className="layer-list" aria-label={t('panel.layers')} ref={list} onKeyDown={onKey}>
        {rows.map((n) => (
          <LayerRow
            key={n.id}
            node={n}
            active={n.id === info.activeId}
            onDragStart={(id) => {
              dragging.current = id;
            }}
            onDrop={onDrop}
          />
        ))}
      </ul>
      <div className="layer-toolbar" role="toolbar" aria-label={t('panel.layers')}>
        <ToolbarButton action="layerNew" icon="layer-add" label="action.layerNew" />
        <ToolbarButton action="newShapeLayer" icon="shapes" label="action.newShapeLayer" />
        <ToolbarButton action="layerGroup" icon="folder" label="action.layerGroup" />
        <ToolbarButton action="layerDuplicate" icon="copy" label="action.layerDuplicate" />
        <ToolbarButton action="layerMergeDown" icon="merge" label="action.layerMergeDown" />
        <ToolbarButton action="layerDelete" icon="delete" label="action.layerDelete" />
      </div>
    </div>
  );
}
