import { MAX_ZOOM, MIN_ZOOM } from '@engine/render/View';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { t } from '../../i18n';
import { Icon } from '../icons/Icon';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { runAction } from '../actions/actions';

const LOG_MIN = Math.log(MIN_ZOOM);
const LOG_MAX = Math.log(MAX_ZOOM);

function formatZoom(z: number): string {
  const pct = z * 100;
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

export function StatusBar() {
  const toolId = useUi((s) => s.tool);
  const hintOverride = useUi((s) => s.hint);
  const cursor = useUi((s) => s.cursor);
  const sel = useUi((s) => s.selection.bounds);
  const doc = useUi((s) => s.doc);
  const drag = useUi((s) => s.canvasDrag);
  const zoom = useUi((s) => s.view.zoom);
  const tool = toolRegistry.get(toolId);
  const hint = hintOverride ?? tool?.hintKey;
  const slider = ((Math.log(zoom) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000;
  const size = drag ?? { w: doc.width, h: doc.height };
  return (
    <footer className="statusbar" aria-label={t('a11y.statusBar')}>
      <span className="hint">{hint ? t(hint) : ''}</span>
      <span className="status-item" aria-label={t('status.cursor')} data-tip={t('status.cursor')}>
        <Icon name="plus" size={13} />
        {cursor ? t('status.pos', { x: cursor.x, y: cursor.y }) : ''}
      </span>
      <span className="status-item" aria-label={t('status.selection')} data-tip={t('status.selection')}>
        <Icon name="select" size={13} />
        {sel ? t('status.px', { w: Math.round(sel.w), h: Math.round(sel.h) }) : ''}
      </span>
      <span className="status-item" aria-label={t('status.canvas')} data-tip={t('status.canvas')}>
        <Icon name="canvas-size" size={13} />
        {t('status.px', { w: size.w, h: size.h })}
      </span>
      <span className="status-zoom">
        <button type="button" className="icon-btn" aria-label={t('action.zoomOut')} data-tip={t('action.zoomOut')} onClick={() => runAction('zoomOut')}>
          <Icon name="minus" size={14} />
        </button>
        <span className="slider">
          <input
            type="range"
            min={0}
            max={1000}
            value={slider}
            aria-label={t('status.zoomSlider')}
            aria-valuetext={formatZoom(zoom)}
            style={{ ['--fill' as string]: `${slider / 10}%` }}
            onChange={(e) => engine.zoomTo(Math.exp(LOG_MIN + (Number(e.target.value) / 1000) * (LOG_MAX - LOG_MIN)))}
          />
        </span>
        <button type="button" className="icon-btn" aria-label={t('action.zoomIn')} data-tip={t('action.zoomIn')} onClick={() => runAction('zoomIn')}>
          <Icon name="plus" size={14} />
        </button>
        <button type="button" className="pct" aria-label={t('status.zoom')} data-tip={t('action.zoom100')} data-kbd="Ctrl+1" onClick={() => runAction('zoom100')}>
          {formatZoom(zoom)}
        </button>
        <button type="button" className="icon-btn" aria-label={t('action.zoomFit')} data-tip={t('action.zoomFit')} data-kbd="Ctrl+0" onClick={() => runAction('zoomFit')}>
          <Icon name="fit" size={14} />
        </button>
      </span>
    </footer>
  );
}
