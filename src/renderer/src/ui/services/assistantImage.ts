import { SettingsSchema, type Settings } from '@shared/settings';
import { parseHex } from '@engine/core/color';
import { Selection } from '@engine/doc/Selection';
import type { Anchor } from '@engine/Engine';
import { filterRegistry } from '@engine/filters/FilterRegistry';
import { defaultParams, type FilterParams, type FilterValue } from '@engine/filters/types';
import type { Resample } from '@engine/raster/transform';
import { t } from '../../i18n';
import { actions } from '../actions/actions';
import { engine } from '../state/engine';
import { closeDialog, updateSettings, useUi } from '../state/store';
import { chooseLayer, int, num, pixelLayer, str, type Handler } from './assistantArgs';
import { hasMemoryFor } from './memory';

/**
 * The window's side of the image, effects, actions and settings (8.10). Whole-picture changes
 * let go of the selection first (with one, Pigmento would change just what's selected).
 */

const size = () => `${engine.doc.width} × ${engine.doc.height} pixels`;

/** Let go of the selection, within the assistant's step. */
function letGo(): void {
  if (engine.doc.selection) engine.changeSelection(null, 'history.deselect');
}

/** An effect's settings from what the assistant gave, checked against the effect's own. */
function effectParams(id: string, given: unknown): FilterParams {
  const def = filterRegistry.get(id)!;
  const out = defaultParams(def);
  if (given === undefined) return out;
  if (typeof given !== 'object' || given === null) throw new Error('settings should be an object of the effect’s settings by key.');
  for (const [key, v] of Object.entries(given)) {
    const p = def.params.find((q) => q.key === key);
    if (!p) throw new Error(`${t(def.labelKey)} has no setting ${key}. Its settings are ${def.params.map((q) => q.key).join(', ') || 'none'}.`);
    let value: FilterValue | undefined;
    if (p.type === 'slider' && typeof v === 'number' && Number.isFinite(v)) value = Math.min(p.max, Math.max(p.min, v));
    else if (p.type === 'toggle' && typeof v === 'boolean') value = v;
    else if (p.type === 'choice' && typeof v === 'string' && p.choices.some((c) => c.value === v)) value = v;
    else if (p.type === 'color' && typeof v === 'string') value = parseHex(v) ?? undefined;
    else if (p.type === 'curve' && Array.isArray(v) && v.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === 'number')))
      value = (v as [number, number][]).map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as const);
    if (value === undefined) {
      const want = p.type === 'slider' ? `a number from ${p.min} to ${p.max}` : p.type === 'toggle' ? 'true or false' : p.type === 'choice' ? `one of ${p.choices.map((c) => c.value).join(', ')}` : p.type === 'color' ? '#rrggbb' : 'points [[x, y], …] from 0 to 1';
      throw new Error(`${key} should be ${want}.`);
    }
    out[key] = value;
  }
  return out;
}

/** Settings sections an assistant can't see or change. */
const PRIVATE = new Set(['assistants', 'window', 'chrome', 'version']);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An action an assistant may run, or why not. */
function actionFor(id: unknown) {
  const a = typeof id === 'string' ? actions().get(id) : undefined;
  if (!a || a.hidden) throw new Error(`There’s no action ${String(id)}. list_available with what: actions lists them.`);
  if (a.group === 'file') throw new Error(`${t(a.labelKey)} is a file action: use new_picture, open_file, save_file, export_image or close_window instead.`);
  if (a.id === 'stopAssistants') throw new Error('Only the user can stop AI assistants or let them go on.');
  return a;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const IMAGE_HANDLERS: Record<string, Handler> = {
  resize_image: async (args) => {
    const { width: W, height: H } = engine.doc;
    const scale = num(args.scale);
    let [w, h] = [int(args.width), int(args.height)];
    if (scale !== undefined) [w, h] = [Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale))];
    else if (w !== undefined && h === undefined) h = Math.max(1, Math.round((H * w) / W));
    else if (h !== undefined && w === undefined) w = Math.max(1, Math.round((W * h) / H));
    if (w === undefined || h === undefined) throw new Error('Give a width, a height or a scale.');
    if (!(await hasMemoryFor(w, h))) throw new Error(`There isn’t enough free memory for a ${w} × ${h} picture.`);
    const [tw, th] = [w, h];
    return {
      label: 'assistant.step.resize_image',
      apply: () => {
        letGo();
        engine.resize(tw, th, (str(args.method) ?? 'bicubic') as Resample);
        return { text: `The picture is now ${size()}.`, data: { width: engine.doc.width, height: engine.doc.height } };
      },
    };
  },

  crop: (args) => {
    const { width: W, height: H } = engine.doc;
    const [x, y, w, h] = [int(args.x), int(args.y), int(args.width), int(args.height)];
    const given = [x, y, w, h].filter((v) => v !== undefined).length;
    if (given > 0 && given < 4) throw new Error('A rectangle to crop to needs x, y, width and height.');
    const rect = given === 4 ? Selection.fromRect({ x: x!, y: y!, w: w!, h: h! }, W, H) : null;
    if (given === 4 && !rect) throw new Error(`That rectangle is outside the picture, which is ${size()}.`);
    if (!rect && !engine.doc.selection) throw new Error('Give a rectangle to crop to, or select something first.');
    return {
      label: 'assistant.step.crop',
      apply: () => {
        if (rect) engine.changeSelection(rect, 'history.selectRect');
        engine.crop();
        return { text: `Cropped: the picture is now ${size()}.`, data: { width: engine.doc.width, height: engine.doc.height } };
      },
    };
  },

  canvas_size: async (args) => {
    const w = int(args.width) ?? engine.doc.width;
    const h = int(args.height) ?? engine.doc.height;
    if (!(await hasMemoryFor(w, h))) throw new Error(`There isn’t enough free memory for a ${w} × ${h} picture.`);
    return {
      label: 'assistant.step.canvas_size',
      apply: () => {
        engine.canvasSize(w, h, (str(args.anchor) ?? 'nw') as Anchor);
        return { text: `The canvas is now ${size()}.`, data: { width: engine.doc.width, height: engine.doc.height } };
      },
    };
  },

  rotate_flip: (args) => {
    const deg = num(args.rotate) ?? 0;
    const flip = str(args.flip);
    if (!deg && !flip) throw new Error('Say how to rotate (degrees) or flip (horizontal or vertical).');
    return {
      label: 'assistant.step.rotate_flip',
      apply: () => {
        letGo();
        if (deg % 90 === 0) {
          const q = (((deg / 90) % 4) + 4) % 4;
          if (q) engine.rotate(q);
        } else engine.rotateFree(deg);
        if (flip) engine.flip(flip === 'horizontal' ? 'h' : 'v');
        return { text: `${deg ? `Rotated ${deg}°` : ''}${deg && flip ? ' and ' : ''}${flip ? `flipped ${flip}ly` : ''}: the picture is ${size()}.` };
      },
    };
  },

  apply_effect: (args) => {
    const id = str(args.effect) ?? '';
    const def = filterRegistry.get(id);
    if (!def) throw new Error(`There’s no effect ${id}. list_available with what: effects lists them.`);
    chooseLayer(args.layer);
    const layer = pixelLayer();
    const params = effectParams(id, args.settings);
    return {
      label: 'assistant.step.apply_effect',
      apply: async () => {
        const session = engine.startFilter(id);
        if (!session) throw new Error(`${t(def.labelKey)} can’t be applied to “${layer.name}”.`);
        try {
          if (!(await session.apply(params))) throw new Error(`${t(def.labelKey)} was stopped.`);
        } finally {
          session.end();
        }
        return { text: `Applied ${t(def.labelKey)} to ${engine.doc.selection ? 'the selection on ' : ''}“${layer.name}”.` };
      },
    };
  },

  /** What main needs to know about an action before running it. */
  'pigmento.action': (args) => {
    const a = actionFor(args.action);
    // Showing things (the grid, rulers, panels) and the theme are settings.
    return { data: { name: t(a.labelKey), settings: a.group === 'view' } };
  },

  run_action: (args) => {
    const a = actionFor(args.action);
    const name = t(a.labelKey);
    if (a.enabled && !a.enabled(useUi.getState())) throw new Error(`${name} can’t be used right now (it’s greyed out in Pigmento).`);
    return {
      label: 'assistant.step.run_action',
      apply: async () => {
        const before = useUi.getState().dialog;
        const done = Promise.resolve(a.run());
        const finished = await Promise.race([done.then(() => true), wait(80).then(() => false)]);
        // A dialog is for a person: it's closed again, and the assistant is told what to use instead.
        const d = useUi.getState().dialog;
        if (d && d !== before) {
          closeDialog();
          throw new Error(`${name} opens a dialog, which is for the user. One of the other tools may do it (list_available with what: actions, or the tools list).`);
        }
        if (!finished) await Promise.race([done, wait(30_000)]);
        return { text: `Did “${name}”.` };
      },
    };
  },

  get_settings: () => {
    const all = useUi.getState().settings as Record<string, unknown>;
    const data = Object.fromEntries(Object.entries(all).filter(([k]) => !PRIVATE.has(k)));
    return { text: 'Pigmento’s settings, by section (the AI assistants settings aren’t included).', data };
  },

  change_settings: (args) => {
    const changes = isObject(args.changes) ? args.changes : {};
    const current = useUi.getState().settings as Record<string, unknown>;
    const shape = SettingsSchema.shape as Record<string, { safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }>;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (key === 'assistants') throw new Error('The AI assistants settings can only be changed by the user, in Settings → AI assistants.');
      if (PRIVATE.has(key) || !(key in shape)) throw new Error(`There’s no settings section ${key}. get_settings lists them.`);
      const cur = current[key];
      const next = isObject(cur) && isObject(value) ? { ...cur, ...value } : value;
      const r = shape[key].safeParse(next);
      if (!r.success) throw new Error(`${key}: ${r.error.issues.map((i) => `${[key, ...i.path.map(String)].join('.')} ${i.message}`).join('; ')}`);
      patch[key] = r.data;
    }
    if (!Object.keys(patch).length) throw new Error('Say what to change: changes, by section.');
    updateSettings(patch as Partial<Settings>);
    return { text: `Changed ${Object.keys(patch).join(', ')}.`, data: patch };
  },
};
