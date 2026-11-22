import { FORMATS, type FileFormat, type ImageFormat } from '@shared/formats';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { colorArg, int, layerArg, num, str, bool, errorText, type Handler } from './assistantArgs';
import { exportTo, hasSavedSelections, isLayered, openPath, replaceWithNew, saveTo } from './files';
import { hasMemoryFor } from './memory';

/**
 * The window's side of pictures and files (8.7). Main has checked and allowed the paths, and
 * settled any unsaved changes as the assistant said, so nothing here asks the user.
 */

const nameOf = () => useUi.getState().file.name ?? 'Untitled';

export const PICTURE_HANDLERS: Record<string, Handler> = {
  /** What main needs to know about this window's picture. */
  'pigmento.picture': () => {
    const s = useUi.getState();
    return { data: { name: nameOf(), path: s.file.path, dirty: s.history.dirty } };
  },

  new_picture: async (args) => {
    const w = int(args.width) ?? 0;
    const h = int(args.height) ?? 0;
    const paper = args.paper === 'none' ? null : (colorArg(args.paper ?? '#ffffff', 'paper') ?? null);
    engine.commitLive(true);
    if (!(await hasMemoryFor(w, h))) throw new Error(`There isn’t enough free memory for a ${w} × ${h} picture.`);
    try {
      replaceWithNew(w, h, paper, int(args.dpi) ?? 96);
    } catch (err) {
      throw new Error(errorText(err), { cause: err });
    }
    return { text: `New picture: ${w} × ${h} pixels${paper ? '' : ', see-through'}.`, data: { width: w, height: h } };
  },

  open_file: async (args) => {
    const path = str(args.path) ?? '';
    engine.commitLive(true);
    if (!(await openPath(path, true))) throw new Error(`Pigmento couldn’t open ${path}.`);
    return { text: `Opened ${nameOf()}: ${engine.doc.width} × ${engine.doc.height} pixels.`, data: { width: engine.doc.width, height: engine.doc.height, path } };
  },

  save_file: async (args) => {
    const path = str(args.path) ?? '';
    const format = str(args.format) as FileFormat;
    if (!(await saveTo(path, format, int(args.quality)))) throw new Error(`Pigmento couldn’t save ${path}.`);
    // A flat file holds the picture as it looks: not its layers, saved selections or animation.
    const kept = format === 'pigm' || !(isLayered() || hasSavedSelections() || engine.anim.animated);
    const lost = kept ? '' : ` ${format.toUpperCase()} keeps the picture as it looks${isLayered() ? ', not its layers' : ''}${engine.anim.animated ? ` (frame ${engine.anim.frame + 1} of the animation)` : ''}; save a .pigm to keep everything.`;
    return { text: `Saved ${path}.${lost}`, data: { path, format, keptEverything: kept, unsavedChanges: useUi.getState().history.dirty } };
  },

  export_image: async (args) => {
    const path = str(args.path) ?? '';
    const format = str(args.format) as ImageFormat;
    const layer = layerArg(args.layer);
    const scale = num(args.scale) ?? 1;
    const settings = useUi.getState().settings.export;
    const quality = int(args.quality) ?? (format === 'jpeg' ? settings.jpegQuality : settings.webpQuality);
    const transparent = (bool(args.transparent) ?? false) && FORMATS[format].alpha;
    const ok = await exportTo(path, { format, quality, scale, transparent, layerId: layer?.id ?? null, method: 'bicubic' });
    if (!ok) throw new Error(`Pigmento couldn’t export ${path}.`);
    const { w, h } = engine.exportSize(scale);
    return { text: `Exported ${path} (${w} × ${h} pixels).`, data: { path, format, width: w, height: h } };
  },
};
