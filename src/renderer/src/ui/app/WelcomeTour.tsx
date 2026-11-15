import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t, type I18nKey } from '../../i18n';
import { Segmented } from '../components/Controls';
import { updateSettings, useUi } from '../state/store';

/** The tour's stops: what each points at (a `data-tour` mark), or nothing for the welcome. */
const STEPS: readonly { id: string; target: string | null }[] = [
  { id: 'welcome', target: null },
  { id: 'tools', target: 'tools' },
  { id: 'colors', target: 'colors' },
  { id: 'canvas', target: 'canvas' },
  { id: 'panels', target: 'panels' },
  { id: 'mode', target: 'mode' },
  { id: 'help', target: 'help' },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 6;
const CARD_W = 340;

function targetBox(target: string | null): Box | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

/** Where the card goes: below the highlight if it fits, else above, else beside or centred. */
function cardPlace(box: Box | null, cardH: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!box) return { left: (vw - CARD_W) / 2, top: Math.max(16, (vh - cardH) / 2) };
  const left = Math.min(vw - CARD_W - 16, Math.max(16, box.x + box.w / 2 - CARD_W / 2));
  if (box.y + box.h + 12 + cardH < vh - 16) return { left, top: box.y + box.h + 12 };
  if (box.y - 12 - cardH > 16) return { left, top: box.y - 12 - cardH };
  // A tall target (the canvas, the side panel): inside it, near its top.
  return { left: Math.min(vw - CARD_W - 16, Math.max(16, box.x + 24)), top: Math.max(16, box.y + 24) };
}

/**
 * First-run welcome tour over the real interface: one region at a time, Back/Next, arrow keys,
 * Esc to skip. Shown once (remembered in settings) and replayable from Help.
 */
export function WelcomeTour() {
  const ref = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [place, setPlace] = useState({ left: 0, top: 0 });
  const mode = useUi((s) => s.settings.ui.mode);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  const finish = () => {
    const ui = useUi.getState().settings.ui;
    updateSettings({ ui: { ...ui, tour: true } });
    useUi.setState({ tour: false });
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // The tour points at the Home tab's groups.
    useUi.setState({ tab: 'home' });
    d.showModal();
    return () => {
      if (d.open) d.close();
    };
  }, []);

  // Measure the highlight after the step renders, and again when the window resizes.
  useLayoutEffect(() => {
    const measure = () => {
      const b = targetBox(s.target);
      setBox(b);
      setPlace(cardPlace(b, cardRef.current?.offsetHeight ?? 200));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [s.target, step]);

  useEffect(() => nextRef.current?.focus(), [step]);

  const go = (d: 1 | -1) => {
    if (d > 0 && last) return finish();
    setStep((i) => Math.min(STEPS.length - 1, Math.max(0, i + d)));
  };
  const title = t(`tour.${s.id}.title` as I18nKey);

  return (
    <dialog
      ref={ref}
      className="tour"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      onCancel={(e) => {
        e.preventDefault();
        finish();
      }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLButtonElement && e.target.getAttribute('role') === 'radio') return;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          go(1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          go(-1);
        }
      }}
    >
      {/* Separate elements (keyed), so the highlight never slides in from the dimmed backdrop. */}
      {box ? (
        <div key="hole" className="tour-hole" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} aria-hidden="true" />
      ) : (
        <div key="dim" className="tour-dim" aria-hidden="true" />
      )}
      <div ref={cardRef} className="tour-card" style={{ left: place.left, top: place.top, width: CARD_W }}>
        <div className="tour-count">{t('tour.count', { n: step + 1, total: STEPS.length })}</div>
        <h2 id="tour-title">{title}</h2>
        <p id="tour-body">{t(`tour.${s.id}.body` as I18nKey)}</p>
        {s.id === 'welcome' ? (
          <div className="tour-mode">
            <span>{t('tour.welcome.mode')}</span>
            <Segmented
              label={t('settings.mode')}
              value={mode}
              choices={[
                { value: 'simple', label: t('mode.simple') },
                { value: 'full', label: t('mode.full') },
              ]}
              onChange={(v) => updateSettings({ ui: { ...useUi.getState().settings.ui, mode: v === 'simple' ? 'simple' : 'full' } })}
            />
          </div>
        ) : null}
        <div className="tour-buttons">
          <button type="button" className="btn small" onClick={finish}>
            {t('tour.skip')}
          </button>
          <span className="spacer" />
          {step > 0 ? (
            <button type="button" className="btn small" onClick={() => go(-1)}>
              {t('tour.back')}
            </button>
          ) : null}
          <button ref={nextRef} type="button" className="btn small primary" onClick={() => go(1)}>
            {t(last ? 'tour.done' : 'tour.next')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
