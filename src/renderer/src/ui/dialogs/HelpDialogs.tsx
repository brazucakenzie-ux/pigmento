import { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '@resources/logo.svg?url';
import type { AppInfo } from '@shared/ipc';
import guide from '../../../../../docs/user-guide.md?raw';
import licences from '../../../../../LICENSES.md?raw';
import { t } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { headingsOf, Markdown } from '../components/Markdown';
import { closeDialog } from '../state/store';

/** The user guide (docs/user-guide.md, bundled), with its contents beside it. */
export function UserGuideDialog() {
  const body = useRef<HTMLDivElement>(null);
  const contents = useMemo(() => headingsOf(guide), []);
  const [current, setCurrent] = useState(contents[0]?.id ?? '');
  const go = (id: string) => {
    setCurrent(id);
    body.current?.querySelector(`#md-${CSS.escape(id)}`)?.scrollIntoView({ block: 'start' });
  };
  return (
    <Dialog
      title={t('help.guide')}
      onCancel={closeDialog}
      className="guide-dialog"
      footer={
        <button type="button" className="btn primary" onClick={closeDialog}>
          {t('dialog.close')}
        </button>
      }
    >
      <div className="guide">
        <nav className="guide-contents" aria-label={t('help.contents')}>
          {contents.map((c) => (
            <button key={c.id} type="button" className="guide-link" aria-current={c.id === current ? 'true' : undefined} onClick={() => go(c.id)}>
              {c.text}
            </button>
          ))}
        </nav>
        <div ref={body} className="guide-body" tabIndex={0} role="document" aria-label={t('help.guide')}>
          <Markdown source={guide} skipTitle />
        </div>
      </div>
    </Dialog>
  );
}

/** About: version, what it's built on, and every third-party licence (LICENSES.md, bundled). */
export function AboutDialog() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void window.pigmento.system.appInfo().then(setInfo);
  }, []);
  return (
    <Dialog
      title={t('dialog.about.title')}
      onCancel={closeDialog}
      className="about-dialog"
      footer={
        <button type="button" className="btn primary" onClick={closeDialog}>
          {t('dialog.close')}
        </button>
      }
    >
      <div className="about">
        <img src={logoUrl} alt="" />
        <h3>{t('app.name')}</h3>
        <div className="tagline">{t('app.tagline')}</div>
        {info ? (
          <>
            <p>{t('dialog.about.version', { version: info.version })}</p>
            <p>{t('dialog.about.built', { electron: info.electron, chrome: info.chrome, node: info.node })}</p>
          </>
        ) : null}
      </div>
      <section className="about-licences" tabIndex={0} aria-label={t('dialog.about.licences')}>
        <Markdown source={licences} />
      </section>
    </Dialog>
  );
}
