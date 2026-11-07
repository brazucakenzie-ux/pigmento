import { customShapeDef, shapeRegistry, type ShapeCategory, type ShapeDef } from '@engine/shapes/ShapeRegistry';
import type { SubPath } from '@engine/vector/pathData';
import {
  CustomShapeSchema,
  MAX_CUSTOM_SHAPES,
  SHAPE_FORMAT,
  SHAPE_FORMAT_VERSION,
  SHAPE_PACK_FORMAT,
  ShapePackSchema,
  type CustomShapeFile,
  type ShapeFileCategory,
  type ShapePack,
} from '@shared/shapeFormat';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import { showToast, updateSettings, useUi } from '../state/store';

/** Personal shapes as they are on disk (kept to rename and duplicate them). */
const files = new Map<string, CustomShapeFile>();

function register(f: CustomShapeFile): void {
  files.set(f.id, f);
  shapeRegistry.set(customShapeDef({ id: f.id, name: f.name, category: f.category as ShapeCategory, unit: f.outline as SubPath[], fillRule: f.fillRule, aspect: f.aspect }));
}

/** The gallery re-reads the registry when this changes. */
function changed(): void {
  useUi.setState((s) => ({ shapeLibrary: s.shapeLibrary + 1 }));
}

export function customShapeFile(id: string): CustomShapeFile | undefined {
  return files.get(id);
}

/** Load the shapes saved in earlier sessions into the gallery. */
export async function loadCustomShapes(): Promise<void> {
  const list = await window.pigmento.shapes.list().catch(() => [] as CustomShapeFile[]);
  for (const f of list) {
    const ok = CustomShapeSchema.safeParse(f);
    if (ok.success) register(ok.data);
  }
  changed();
}

async function store(f: CustomShapeFile): Promise<boolean> {
  try {
    await window.pigmento.shapes.save(f);
  } catch {
    showToast({ kind: 'error', key: 'error.shapeSave' });
    return false;
  }
  register(f);
  changed();
  return true;
}

/** Save the selected shape (or the path being edited) to My shapes; returns its id. */
export async function saveAsMyShape(name: string, category: ShapeFileCategory): Promise<string | null> {
  const o = engine.libraryOutline();
  if (!o) {
    showToast({ kind: 'info', key: 'notice.shapeNeedsSelection' });
    return null;
  }
  const f: CustomShapeFile = {
    format: SHAPE_FORMAT,
    version: SHAPE_FORMAT_VERSION,
    id: `my-${crypto.randomUUID()}`,
    name: name.trim().slice(0, 80),
    category,
    aspect: Math.min(100, Math.max(0.01, o.aspect)),
    fillRule: o.fillRule,
    outline: o.unit.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ x: a.x, y: a.y, in: a.in ? { ...a.in } : null, out: a.out ? { ...a.out } : null, smooth: a.smooth })) })),
    createdAt: Date.now(),
  };
  if (!CustomShapeSchema.safeParse(f).success) {
    showToast({ kind: 'error', key: 'error.shapeSave' });
    return null;
  }
  if (!(await store(f))) return null;
  // The Shape tool draws it next.
  engine.setToolOption('shape', 'shapeId', f.id);
  showToast({ kind: 'info', key: 'notice.shapeSaved', params: { name: f.name } });
  return f.id;
}

export async function renameMyShape(id: string, name: string, category: ShapeFileCategory): Promise<boolean> {
  const f = files.get(id);
  if (!f) return false;
  return store({ ...f, name: name.trim().slice(0, 80), category });
}

export async function duplicateMyShape(id: string, copyName: string): Promise<string | null> {
  const f = files.get(id);
  if (!f) return null;
  const copy: CustomShapeFile = { ...f, id: `my-${crypto.randomUUID()}`, name: copyName.slice(0, 80), createdAt: Date.now() };
  if (!(await store(copy))) return null;
  engine.setToolOption('shape', 'shapeId', copy.id);
  return copy.id;
}

/** Remove from My shapes (drawings that use it keep their own copy of the outline). */
export async function deleteMyShape(id: string): Promise<void> {
  await window.pigmento.shapes.remove(id).catch(() => undefined);
  files.delete(id);
  shapeRegistry.remove(id);
  const s = useUi.getState().settings.shapes;
  if (s.favorites.includes(id)) updateSettings({ shapes: { ...s, favorites: s.favorites.filter((f) => f !== id) } });
  if (engine.options('shape').shapeId === id) engine.setToolOption('shape', 'shapeId', 'star-5');
  changed();
}

export function isCustom(def: ShapeDef | undefined): boolean {
  return def?.custom === true && files.has(def.id);
}

/** Save every personal shape to a shape pack file (to share or move to another PC). */
export async function exportShapePack(): Promise<boolean> {
  const list = [...files.values()].sort((a, b) => a.createdAt - b.createdAt);
  if (!list.length) {
    showToast({ kind: 'info', key: 'notice.shapePackEmpty' });
    return false;
  }
  const pack: ShapePack = {
    format: SHAPE_PACK_FORMAT,
    version: SHAPE_FORMAT_VERSION,
    name: t('shapes.packName'),
    shapes: list.map((f) => ({ name: f.name, category: f.category, aspect: f.aspect, fillRule: f.fillRule, outline: f.outline })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(pack, null, 1));
  let saved: string | null;
  try {
    saved = await window.pigmento.files.saveAsset('shapePack', `${t('shapes.packName')}.pigmshapes`, bytes);
  } catch {
    showToast({ kind: 'error', key: 'error.shapeSave' });
    return false;
  }
  if (!saved) return false;
  showToast({ kind: 'info', key: 'notice.shapePackExported', params: { count: list.length, name: saved.split(/[\\/]/).pop() ?? saved } });
  return true;
}

/** Add the shapes in a shape pack to My shapes (each gets a new id). */
export async function importShapePack(): Promise<number> {
  let file: { name: string; bytes: Uint8Array } | null;
  try {
    file = await window.pigmento.files.openAsset('shapePack');
  } catch {
    showToast({ kind: 'error', key: 'error.shapePackInvalid', params: { name: '' } });
    return 0;
  }
  if (!file) return 0;
  const pack = parseShapePack(file.bytes);
  if (!pack) {
    showToast({ kind: 'error', key: 'error.shapePackInvalid', params: { name: file.name } });
    return 0;
  }
  const room = Math.max(0, MAX_CUSTOM_SHAPES - files.size);
  let added = 0;
  for (const s of pack.shapes.slice(0, room)) {
    const f: CustomShapeFile = { format: SHAPE_FORMAT, version: SHAPE_FORMAT_VERSION, id: `my-${crypto.randomUUID()}`, createdAt: Date.now() + added, ...s };
    if (!(await store(f))) break;
    added++;
  }
  showToast({ kind: 'info', key: 'notice.shapePackImported', params: { count: added } });
  return added;
}

/** A validated shape pack from file bytes, or null. */
export function parseShapePack(bytes: Uint8Array): ShapePack | null {
  try {
    const r = ShapePackSchema.safeParse(JSON.parse(new TextDecoder('utf-8').decode(bytes)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function hasCustomShapes(): boolean {
  return files.size > 0;
}
