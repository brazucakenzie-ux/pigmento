import { useRef, useState } from 'react';
import { t } from '../../i18n';
import { Popover } from '../components/Popover';
import { Icon } from '../icons/Icon';
import { useShortcut } from '../actions/keymap';
import { updateSettings, useUi } from '../state/store';

/** Stop every assistant, or let them go on. */
export function toggleAssistants(): void {
  window.pigmento.assistant.pause(!useUi.getState().assistants.paused);
}

/** Open the side panel at Assistant activity. */
function showActivity(): void {
  const p = useUi.getState().settings.panels;
  const { assistants: _shown, ...collapsed } = p.collapsed;
  updateSettings({ panels: { ...p, open: true, collapsed } });
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.panel-section-assistants button')?.focus());
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The title bar's badge while an assistant is connected (or they're stopped): who, and a way to stop them. */
export function AssistantBadge() {
  const a = useUi((s) => s.assistants);
  const kbd = useShortcut('stopAssistants');
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!a.connected.length && !a.paused) return null;
  const names = [...new Set(a.connected.map((c) => c.name))];
  const label = a.paused ? t('assistants.badge.paused') : names.length === 1 ? names[0] : t('assistants.badge.many', { n: names.length });
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`assistant-badge ${a.paused ? 'paused' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('assistants.badge.tip', { who: label })}
        data-tip={t('assistants.badge.tip', { who: label })}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={a.paused ? 'pause' : 'bot'} size={14} />
        <span>{label}</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={t('assistants.badge.title')} className="assistant-popover">
        <p className="assistant-popover-head">{a.paused ? t('assistants.badge.pausedNote') : t('assistants.badge.connected')}</p>
        {names.length ? (
          <ul className="assistant-names">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        <div className="row">
          <button type="button" className={`btn small ${a.paused ? 'primary' : ''}`} data-kbd={kbd} onClick={toggleAssistants}>
            <Icon name={a.paused ? 'play' : 'pause'} size={14} />
            {a.paused ? t('assistants.goOn') : t('assistants.stop')}
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setOpen(false);
              showActivity();
            }}
          >
            {t('assistants.showActivity')}
          </button>
        </div>
      </Popover>
    </>
  );
}

/** The side panel's Assistant activity: what assistants have done, newest first. */
export function AssistantActivity() {
  const a = useUi((s) => s.assistants);
  const entries = [...a.activity].reverse();
  return (
    <div className="assistant-activity">
      <div className="row">
        <button type="button" className={`btn small ${a.paused ? 'primary' : ''}`} onClick={toggleAssistants}>
          <Icon name={a.paused ? 'play' : 'pause'} size={14} />
          {a.paused ? t('assistants.goOn') : t('assistants.stop')}
        </button>
        <span className="assistant-status">{a.paused ? t('assistants.badge.paused') : a.connected.length ? t('assistants.connectedN', { n: a.connected.length }) : t('assistants.noneConnected')}</span>
      </div>
      {entries.length ? (
        <ol className="assistant-log" aria-label={t('panel.assistants')}>
          {entries.map((e) => (
            <li key={e.id} className={e.ok ? '' : 'failed'}>
              <Icon name={e.ok ? 'check' : 'alert'} size={13} />
              <span className="assistant-log-what">
                <strong>{e.title}</strong> <span className="assistant-log-who">{t('assistants.by', { client: e.client, time: clock(e.time) })}</span>
                {e.message ? <span className="assistant-log-why">{e.message}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="history-empty">{t('assistants.nothingYet')}</div>
      )}
    </div>
  );
}
