import { t } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { closeDialog, type DialogState } from '../state/store';

/** "Ask each time": an AI assistant wants to do something of a kind the settings say to ask about. */
export function AssistantAskDialog({ d }: { d: Extract<DialogState, { kind: 'assistantAsk' }> }) {
  const done = (allowed: boolean) => {
    closeDialog();
    d.resolve(allowed);
  };
  return (
    <Dialog
      title={t('assistants.ask.title', { client: d.client })}
      onCancel={() => done(false)}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => done(false)}>
            {t('assistants.ask.deny')}
          </button>
          <button type="button" className="btn primary" data-autofocus onClick={() => done(true)}>
            {t('assistants.ask.allow')}
          </button>
        </>
      }
    >
      <p>{t('assistants.ask.body', { client: d.client, what: d.what, title: d.title })}</p>
      <p className="dialog-note">{t('assistants.ask.note')}</p>
    </Dialog>
  );
}
