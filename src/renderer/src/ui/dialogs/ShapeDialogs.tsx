import { useMemo, useState } from 'react';
import { shapeRegistry } from '@engine/shapes/ShapeRegistry';
import { toSvgPath } from '@engine/shapes/path';
import { unitCmds, type SubPaths } from '@engine/vector/pathData';
import { SHAPE_FILE_CATEGORIES, type ShapeFileCategory } from '@shared/shapeFormat';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { engine } from '../state/engine';
import { closeDialog } from '../state/store';
import { customShapeFile, deleteMyShape, renameMyShape, saveAsMyShape } from '../services/shapes';

/** A large preview of an outline (unit box), kept in its proportions. */
function OutlinePreview({ unit, aspect, fillRule }: { unit: SubPaths; aspect: number; fillRule: 'evenodd' | 'nonzero' }) {
  const box = 96;
  const w = aspect >= 1 ? box : box * aspect;
  const h = aspect >= 1 ? box / aspect : box;
  const d = toSvgPath(unitCmds(unit, w, h));
  const open = unit.every((s) => !s.closed);
  return (
    <svg className={`shape-thumb shape-preview${open ? ' stroke-only' : ''}`} width={box} height={box} viewBox={`${-(box - w) / 2 - 3} ${-(box - h) / 2 - 3} ${box + 6} ${box + 6}`} aria-hidden="true">
      <path d={d} fillRule={fillRule} />
    </svg>
  );
}

/** Save the selected shape to My shapes, or rename (and recategorise) one of them. */
export function SaveShapeDialog({ id }: { id?: string }) {
  const existing = id ? customShapeFile(id) : undefined;
  const outline = useMemo(() => (existing ? { unit: existing.outline as SubPaths, aspect: existing.aspect, fillRule: existing.fillRule } : engine.libraryOutline()), [existing]);
  const count = shapeRegistry.all().filter((d) => d.custom).length + 1;
  const [name, setName] = useState(() => existing?.name ?? t('dialog.saveShape.default', { n: count }));
  const [category, setCategory] = useState<ShapeFileCategory>(existing?.category ?? 'custom');
  const submit = () => {
    const v = name.trim();
    if (!v || !outline) return;
    closeDialog();
    void (existing ? renameMyShape(existing.id, v, category) : saveAsMyShape(v, category));
  };
  return (
    <Dialog
      title={t(existing ? 'dialog.renameShape.title' : 'dialog.saveShape.title')}
      onCancel={closeDialog}
      onSubmit={submit}
      submitLabel={t('dialog.save')}
      submitDisabled={!name.trim() || !outline}
      className="shape-dialog"
    >
      <div className="shape-dialog-body">
        {outline ? <OutlinePreview unit={outline.unit} aspect={outline.aspect} fillRule={outline.fillRule} /> : <p className="dialog-note">{t('notice.shapeNeedsSelection')}</p>}
        <div className="shape-dialog-fields">
          <div className="field">
            <label htmlFor="shape-name">{t('dialog.saveShape.name')}</label>
            <input id="shape-name" className="text-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="shape-category">{t('shapes.category')}</label>
            <select id="shape-category" className="select" value={category} onChange={(e) => setCategory(e.target.value as ShapeFileCategory)}>
              {SHAPE_FILE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`shapecat.${c}` as I18nKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {existing ? null : <p className="dialog-note">{t('dialog.saveShape.hint')}</p>}
    </Dialog>
  );
}

/** Remove a shape from My shapes (drawings that use it are not changed). */
export function DeleteShapeDialog({ id }: { id: string }) {
  const f = customShapeFile(id);
  const submit = () => {
    closeDialog();
    void deleteMyShape(id);
  };
  return (
    <Dialog title={t('dialog.deleteShape.title')} onCancel={closeDialog} onSubmit={submit} submitLabel={t('dialog.deleteShape.confirm')}>
      <p>{t('dialog.deleteShape.body', { name: f?.name ?? '' })}</p>
    </Dialog>
  );
}
