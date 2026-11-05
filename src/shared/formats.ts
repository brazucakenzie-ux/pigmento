/** Image formats Pigmento can open and save. Shared by main (dialogs) and renderer (codecs). */
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'gif';

export interface FormatInfo {
  id: ImageFormat;
  mime: string;
  extensions: string[];
  /** i18n key for the format name in dialogs. */
  labelKey: string;
  lossy: boolean;
  alpha: boolean;
}

export const FORMATS: Record<ImageFormat, FormatInfo> = {
  png: {
    id: 'png',
    mime: 'image/png',
    extensions: ['png'],
    labelKey: 'format.png',
    lossy: false,
    alpha: true,
  },
  jpeg: {
    id: 'jpeg',
    mime: 'image/jpeg',
    extensions: ['jpg', 'jpeg', 'jpe', 'jfif'],
    labelKey: 'format.jpeg',
    lossy: true,
    alpha: false,
  },
  webp: {
    id: 'webp',
    mime: 'image/webp',
    extensions: ['webp'],
    labelKey: 'format.webp',
    lossy: true,
    alpha: true,
  },
  bmp: {
    id: 'bmp',
    mime: 'image/bmp',
    extensions: ['bmp', 'dib'],
    labelKey: 'format.bmp',
    lossy: false,
    alpha: false,
  },
  gif: {
    id: 'gif',
    mime: 'image/gif',
    extensions: ['gif'],
    labelKey: 'format.gif',
    lossy: false,
    alpha: true,
  },
};

export const OPENABLE_EXTENSIONS = Object.values(FORMATS).flatMap((f) => f.extensions);

export function formatFromPath(filePath: string): ImageFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(filePath);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  for (const f of Object.values(FORMATS)) if (f.extensions.includes(ext)) return f.id;
  return null;
}

export function isOpenablePath(filePath: string): boolean {
  return formatFromPath(filePath) !== null;
}

/** Hard limit for any file read through IPC (bytes). */
export const MAX_OPEN_BYTES = 1536 * 1024 * 1024;
