import { brushRegistry, customBrushDef, type BrushDef } from '@engine/brush/BrushRegistry';
import { makeTip, textureStore, tipStore, type Mask } from '@engine/brush/tips';
import type { BrushSettings } from '@engine/brush/types';
import { flatOptions } from '@engine/tools/Tool';
import { brushOptionsFor } from '@engine/tools/brushTool';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import {
  BRUSH_FORMAT,
  BRUSH_FORMAT_VERSION,
  CustomBrushSchema,
  MAX_CUSTOM_BRUSHES,
  decodeMaskData,
  encodeMaskData,
  OWN_MASK,
  type BrushFileCategory,
  type CustomBrushFile,
  type MaskFile,
} from '@shared/brushFormat';
import { readBrushPack, writeBrushPack } from '@engine/io/brushPack';
import { t } from '../../i18n';
import { pngCodec } from './files';
import { runAction } from '../actions/actions';
import { engine } from '../state/engine';
import { showToast, updateSettings, useUi, type UiState } from '../state/store';

/** Personal brushes as they are on disk (kept to edit, duplicate and export them). */
const files = new Map<string, CustomBrushFile>();

/**
 * A brush as the Brush Designer edits it: its settings, where tip and texture id `own` stand
 * for the masks kept with it.
 */
export interface BrushDraft {
  name: string;
  category: BrushFileCategory;
  settings: BrushSettings;
  tip: Mask | null;
  texture: Mask | null;
}

export const maskFromFile = (m: MaskFile): Mask => ({ w: m.w, h: m.h, data: decodeMaskData(m.data) });
const maskToFile = (m: Mask): MaskFile => ({ w: m.w, h: m.h, data: encodeMaskData(m.data) });

const usesOwnTip = (s: BrushSettings) => s.tip.kind === 'image' && s.tip.id === OWN_MASK;
const usesOwnTexture = (s: BrushSettings) => s.texture?.id === OWN_MASK;

/**
 * Settings ready to paint with: `own` becomes the ids the brush's masks are stored under, and
 * a tip or texture that isn't there (a built-in one from a newer version) falls back.
 */
export function resolveMasks(s: BrushSettings, tipId: string, textureId: string): BrushSettings {
  let tip = s.tip;
  if (tip.kind === 'image') {
    const id = tip.id === OWN_MASK ? tipId : tip.id;
    tip = tipStore.has(id) ? { kind: 'image', id } : { kind: 'round' };
  }
  let texture = s.texture;
  if (texture) {
    const id = texture.id === OWN_MASK ? textureId : texture.id;
    texture = textureStore.has(id) ? { ...texture, id } : null;
  }
  return { ...s, tip, texture };
}

function register(f: CustomBrushFile): void {
  files.set(f.id, f);
  if (f.tip) tipStore.set(f.id, makeTip(maskFromFile(f.tip)));
  else tipStore.remove(f.id);
  if (f.texture) textureStore.set(f.id, maskFromFile(f.texture));
  else textureStore.remove(f.id);
  brushRegistry.set(customBrushDef({ id: f.id, name: f.name, category: f.category, settings: resolveMasks(f.settings, f.id, f.id) }));
}

/** Pickers re-read the library when this changes. */
function changed(): void {
  useUi.setState((s) => ({ brushLibrary: s.brushLibrary + 1 }));
}

export function customBrushFile(id: string): CustomBrushFile | undefined {
  return files.get(id);
}

export function isCustomBrush(id: string | undefined): boolean {
  return id !== undefined && files.has(id);
}

/** Load the brushes saved in earlier sessions into the library. */
export async function loadCustomBrushes(): Promise<void> {
  const list = await window.pigmento.brushes.list().catch(() => [] as CustomBrushFile[]);
  for (const f of list) {
    const ok = CustomBrushSchema.safeParse(f);
    if (ok.success) register(ok.data);
  }
  changed();
}

/** The tool a brush command acts on: the active tool if it paints with brushes, else the Brush. */
export function brushTarget(s: Pick<UiState, 'tool' | 'toolOptions'> = useUi.getState()): { toolId: string; brushId: string } {
  const tool = toolRegistry.get(s.tool);
  const spec = tool ? flatOptions(tool.options).find((o) => o.type === 'brush') : undefined;
  const toolId = tool && spec ? tool.id : 'brush';
  const fallback = spec?.type === 'brush' ? spec.default : 'round';
  const id = String((s.toolOptions[toolId] ?? engine.options(toolId)).brushId ?? fallback);
  return { toolId, brushId: brushRegistry.get(id) ? id : fallback };
}

/**
 * Use a brush with a tool: its size, opacity, flow and hardness go into the tool's sliders.
 * An eraser brush picked for the Brush switches to the Eraser.
 */
export function pickBrush(toolId: string, id: string): void {
  const def = brushRegistry.get(id);
  if (!def) return;
  const target = def.eraser && toolId === 'brush' ? 'eraser' : toolId;
  if (!loadBrush(target, def)) return;
  runAction(`tool.${target}`);
}

/** Put a brush's values into the sliders this tool has. */
function loadBrush(toolId: string, def: BrushDef): boolean {
  const tool = toolRegistry.get(toolId);
  if (!tool) return false;
  const keys = new Set(flatOptions(tool.options).map((o) => o.key));
  engine.setToolOptions(toolId, Object.fromEntries(Object.entries(brushOptionsFor(def)).filter(([k]) => keys.has(k))));
  return true;
}

export function brushName(def: BrushDef): string {
  return def.name ?? t(def.labelKey);
}

/** A brush to start the Designer from: a personal one as saved, or a copy of a built-in one. */
export function draftOf(id: string): BrushDraft {
  const f = files.get(id);
  if (f) return { name: f.name, category: f.category, settings: structuredClone(f.settings), tip: f.tip ? maskFromFile(f.tip) : null, texture: f.texture ? maskFromFile(f.texture) : null };
  const def = brushRegistry.get(id) ?? brushRegistry.get('round')!;
  return { name: brushName(def), category: def.category, settings: structuredClone(def.settings), tip: null, texture: null };
}

/** The draft as a file (its own masks kept only if it uses them). */
function fileOf(d: BrushDraft, id: string, createdAt: number): CustomBrushFile {
  return {
    format: BRUSH_FORMAT,
    version: BRUSH_FORMAT_VERSION,
    id,
    name: d.name.trim().slice(0, 80),
    category: d.category,
    settings: d.settings,
    tip: d.tip && usesOwnTip(d.settings) ? maskToFile(d.tip) : null,
    texture: d.texture && usesOwnTexture(d.settings) ? maskToFile(d.texture) : null,
    createdAt,
  };
}

async function store(f: CustomBrushFile): Promise<boolean> {
  const ok = CustomBrushSchema.safeParse(f);
  if (!ok.success) {
    showToast({ kind: 'error', key: 'error.brushSave' });
    return false;
  }
  try {
    await window.pigmento.brushes.save(ok.data);
  } catch {
    showToast({ kind: 'error', key: 'error.brushSave' });
    return false;
  }
  register(ok.data);
  changed();
  return true;
}

/**
 * Save a draft to My brushes: as a new brush, or over personal brush `replace`. The brush is
 * then picked for `toolId`. Resolves the brush's id, or null if it couldn't be saved.
 */
export async function saveBrushDraft(d: BrushDraft, toolId: string, replace?: string): Promise<string | null> {
  const old = replace ? files.get(replace) : undefined;
  const id = old?.id ?? `my-${crypto.randomUUID()}`;
  if (!(await store(fileOf(d, id, old?.createdAt ?? Date.now())))) return null;
  pickBrush(toolId, id);
  showToast({ kind: 'info', key: old ? 'notice.brushUpdated' : 'notice.brushSaved', params: { name: d.name.trim() } });
  return id;
}

export async function duplicateBrush(id: string, toolId: string): Promise<string | null> {
  const f = files.get(id);
  if (!f) return null;
  const copy: CustomBrushFile = { ...f, id: `my-${crypto.randomUUID()}`, name: t('brushes.copyName', { name: f.name }).slice(0, 80), createdAt: Date.now() };
  if (!(await store(copy))) return null;
  pickBrush(toolId, copy.id);
  return copy.id;
}

/** Remove from My brushes; tools using it go back to their usual brush. */
export async function deleteBrush(id: string): Promise<void> {
  await window.pigmento.brushes.remove(id).catch(() => undefined);
  files.delete(id);
  brushRegistry.remove(id);
  tipStore.remove(id);
  textureStore.remove(id);
  const s = useUi.getState().settings.brushes;
  if (s.favorites.includes(id)) updateSettings({ brushes: { ...s, favorites: s.favorites.filter((f) => f !== id) } });
  for (const tool of toolRegistry.all()) {
    const spec = flatOptions(tool.options).find((o) => o.type === 'brush');
    if (spec?.type !== 'brush' || engine.options(tool.id).brushId !== id) continue;
    const def = brushRegistry.get(spec.default);
    if (def) loadBrush(tool.id, def);
  }
  changed();
}

export function customBrushCount(): number {
  return files.size;
}

/** Save every personal brush to a brush pack (to share, or to move to another PC). */
export async function exportBrushPack(): Promise<boolean> {
  const list = [...files.values()].sort((a, b) => a.createdAt - b.createdAt);
  if (!list.length) {
    showToast({ kind: 'info', key: 'notice.brushPackEmpty' });
    return false;
  }
  let bytes: Uint8Array;
  try {
    bytes = await writeBrushPack(t('brushes.packName'), list.map((f) => draftOf(f.id)), pngCodec);
  } catch {
    showToast({ kind: 'error', key: 'error.brushSave' });
    return false;
  }
  let saved: string | null;
  try {
    saved = await window.pigmento.files.saveAsset('brushPack', `${t('brushes.packName')}.pigmbrush`, bytes);
  } catch {
    showToast({ kind: 'error', key: 'error.brushSave' });
    return false;
  }
  if (!saved) return false;
  showToast({ kind: 'info', key: 'notice.brushPackExported', params: { count: list.length, name: saved.split(/[\\/]/).pop() ?? saved } });
  return true;
}

/** Add the brushes in a brush pack to My brushes (each gets a new id). */
export async function importBrushPack(): Promise<number> {
  let file: { name: string; bytes: Uint8Array } | null;
  try {
    file = await window.pigmento.files.openAsset('brushPack');
  } catch {
    showToast({ kind: 'error', key: 'error.brushPackRefused' });
    return 0;
  }
  if (!file) return 0;
  let pack: { brushes: BrushDraft[] };
  try {
    pack = await readBrushPack(file.bytes, pngCodec);
  } catch {
    showToast({ kind: 'error', key: 'error.brushPackInvalid', params: { name: file.name } });
    return 0;
  }
  const room = Math.max(0, MAX_CUSTOM_BRUSHES - files.size);
  let added = 0;
  let first: string | null = null;
  for (const b of pack.brushes.slice(0, room)) {
    const id = `my-${crypto.randomUUID()}`;
    if (!(await store(fileOf(b, id, Date.now() + added)))) break;
    first ??= id;
    added++;
  }
  if (first) pickBrush(brushTarget().toolId, first);
  showToast({ kind: 'info', key: 'notice.brushPackImported', params: { count: added } });
  return added;
}

export function hasCustomBrushes(): boolean {
  return files.size > 0;
}
