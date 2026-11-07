/**
 * Files that aren't images: SVG drawings, shape packs and palettes. The main process opens and
 * saves them through its own dialogs (with these filters and size limits); the renderer only
 * ever sees the bytes of the file the user picked.
 */
export const ASSET_KINDS = {
  svg: { open: ['svg'], save: 'svg', maxBytes: 20 * 1024 * 1024, filterKey: 'filter.svg' },
  shapePack: { open: ['pigmshapes', 'json'], save: 'pigmshapes', maxBytes: 20 * 1024 * 1024, filterKey: 'filter.shapePack' },
  palette: { open: ['json', 'gpl', 'ase'], save: 'json', maxBytes: 4 * 1024 * 1024, filterKey: 'filter.palette' },
} as const;

export type AssetKind = keyof typeof ASSET_KINDS;

export function isAssetKind(k: unknown): k is AssetKind {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(ASSET_KINDS, k);
}

export interface OpenedAsset {
  name: string;
  bytes: Uint8Array;
}
