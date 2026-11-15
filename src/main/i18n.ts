/** Strings used by the main process (dialogs, jump list). English only for now. */
const en = {
  'jump.recent': 'Recent images',
  'jump.new': 'New image',
  'jump.newDesc': 'Open a new Pigmento window',
  'dialog.open.title': 'Open image',
  'dialog.save.title': 'Save image as',
  'dialog.export.title': 'Export image',
  'dialog.filter.images': 'Images and projects',
  'dialog.filter.all': 'All files',
  'dialog.import.title': 'Import',
  'dialog.saveFile.title': 'Save as',
  'filter.svg': 'SVG drawing',
  'filter.shapePack': 'Pigmento shape pack',
  'filter.palette': 'Palette (JSON, GIMP .gpl, Adobe .ase)',
  'filter.brushImage': 'PNG image',
  'filter.brushPack': 'Pigmento brush pack',
  'filter.referenceImage': 'Images',
  'error.title': 'Pigmento',
  'error.internal': 'Something went wrong inside Pigmento. Your picture is safe; if anything looks wrong, save a copy and restart.',
  'error.windowGone': 'This Pigmento window stopped working.',
  'error.windowGoneDetail': 'Reload it to carry on: your recent work was autosaved and will be offered back.',
  'error.unresponsive': 'Pigmento isn’t responding.',
  'error.unresponsiveDetail': 'It may be busy with a very large picture. You can wait, or reload the window (your recent work was autosaved).',
  'error.reload': 'Reload',
  'error.closeWindow': 'Close window',
  'error.wait': 'Wait',
  'dialog.unsaved.message': 'Do you want to save changes to {name}?',
  'dialog.unsaved.detail': 'Your changes will be lost if you don’t save them.',
  'dialog.unsaved.save': 'Save',
  'dialog.unsaved.discard': 'Don’t save',
  'dialog.unsaved.cancel': 'Cancel',
  'dialog.ok': 'OK',
  'format.pigm': 'Pigmento project (keeps layers)',
  'format.png': 'PNG image',
  'format.jpeg': 'JPEG image',
  'format.webp': 'WebP image',
  'format.bmp': 'Bitmap image',
  'format.gif': 'GIF image',
} as const;

export type MainStringKey = keyof typeof en;

export function tm(key: MainStringKey, params?: Record<string, string>): string {
  let s: string = en[key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
