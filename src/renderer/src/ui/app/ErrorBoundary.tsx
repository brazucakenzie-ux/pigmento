import { Component, type ErrorInfo, type ReactNode } from 'react';
import logoUrl from '@resources/logo.svg?url';
import { t } from '../../i18n';
import { autosaveNow } from '../services/autosave';
import * as files from '../services/files';

interface State {
  error: Error | null;
}

/**
 * If the interface itself breaks, say so plainly and offer the way out: the picture (in the
 * engine) is untouched, so it can be saved, then the window reloaded (with a recovery copy).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    window.pigmento.system.logError('interface', `${error.stack ?? error.message}\n${info.componentStack ?? ''}`);
  }

  private reload = async () => {
    // A recovery copy first, so the reloaded window can offer the work back.
    await autosaveNow().catch(() => false);
    window.location.reload();
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alertdialog" aria-labelledby="crash-title" aria-describedby="crash-body">
        <div className="crash-card">
          <img src={logoUrl} alt="" width={48} height={48} />
          <h1 id="crash-title">{t('crash.title')}</h1>
          <p id="crash-body">{t('crash.body')}</p>
          <div className="crash-buttons">
            <button type="button" className="btn" onClick={() => void files.saveAs('pigm')}>
              {t('crash.save')}
            </button>
            <button type="button" className="btn primary" autoFocus onClick={() => void this.reload()}>
              {t('crash.reload')}
            </button>
          </div>
          <details>
            <summary>{t('crash.details')}</summary>
            <pre>{error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
