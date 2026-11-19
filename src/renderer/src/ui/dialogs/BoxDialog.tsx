import { useState } from 'react';
import { MAX_BOX_SIDE } from '@engine/anim/box';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { NumberField } from '../components/Controls';
import { engine } from '../state/engine';
import { closeDialog, useUi } from '../state/store';

/**
 * Box maker: six blank faces of the size chosen, hinged and folded into a box in the middle of
 * the picture on the active layer, ready to paint (one undo step).
 */
export function BoxDialog() {
  const doc = useUi((s) => s.doc);
  // A third of the picture's shorter side, to start with.
  const side = Math.max(16, Math.min(1024, Math.round(Math.min(doc.width, doc.height) / 3)));
  const [w, setW] = useState(side);
  const [h, setH] = useState(side);
  const [d, setD] = useState(side);
  const field = (labelKey: I18nKey, value: number, set: (v: number) => void) => (
    <div className="field">
      <label>{t(labelKey)}</label>
      <div className="row">
        <NumberField value={value} min={1} max={MAX_BOX_SIDE} label={t(labelKey)} onChange={(v) => set(Math.round(v))} />
        <span className="unit">px</span>
      </div>
    </div>
  );
  const ok = () => {
    closeDialog();
    if (engine.anim.makeBox({ w, h, d })) engine.setTool('plane');
  };
  return (
    <Dialog title={t('dialog.box.title')} onCancel={closeDialog} onSubmit={ok} submitLabel={t('dialog.box.make')}>
      <p className="dialog-note">{t('dialog.box.note')}</p>
      {field('dialog.box.width', w, setW)}
      {field('dialog.box.height', h, setH)}
      {field('dialog.box.depth', d, setD)}
    </Dialog>
  );
}
