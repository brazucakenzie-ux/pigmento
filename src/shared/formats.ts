/** Image formats Pigmento can open and save. Shared by main (dialogs) and renderer (codecs). */
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'gif';

/** Everything that can be saved: images plus the layered Pigmento project. */
export type FileFormat = ImageFormat | 'pigm';

export interface FormatInfo {
  id: FileFormat;
  mime: string;
  extensions: string[];
  /** i18n key for the format name in dialogs. */
  labelKey: string;
  lossy: boolean;
  alpha: boolean;
  /** Keeps layers, groups and editable objects. */
  layered: boolean;
}

export const FORMATS: Record<ImageFormat, FormatInfo> = {
  png: {
    id: 'png',
    mime: 'image/png',
    extensions: ['png'],
    labelKey: 'format.png',
    lossy: false,
    alpha: true,
    layered: false,
  },
  jpeg: {
    id: 'jpeg',
    mime: 'image/jpeg',
    extensions: ['jpg', 'jpeg', 'jpe', 'jfif'],
    labelKey: 'format.jpeg',
    lossy: true,
    alpha: false,
    layered: false,
  },
  webp: {
    id: 'webp',
    mime: 'image/webp',
    extensions: ['webp'],
    labelKey: 'format.webp',
    lossy: true,
    alpha: true,
    layered: false,
  },
  bmp: {
    id: 'bmp',
    mime: 'image/bmp',
    extensions: ['bmp', 'dib'],
    labelKey: 'format.bmp',
    lossy: false,
    alpha: false,
    layered: false,
  },
  gif: {
    id: 'gif',
    mime: 'image/gif',
    extensions: ['gif'],
    labelKey: 'format.gif',
    lossy: false,
    alpha: true,
    layered: false,
  },
};

export const PROJECT_FORMAT: FormatInfo = {
  id: 'pigm',
  mime: 'application/x-pigmento-project',
  extensions: ['pigm'],
  labelKey: 'format.pigm',
  lossy: false,
  alpha: true,
  layered: true,
};

/** All saveable formats, project first. */
export const FILE_FORMATS: Record<FileFormat, FormatInfo> = { pigm: PROJECT_FORMAT, ...FORMATS };

export const OPENABLE_EXTENSIONS = Object.values(FILE_FORMATS).flatMap((f) => f.extensions);

export function formatFromPath(filePath: string): FileFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(filePath);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  for (const f of Object.values(FILE_FORMATS)) if (f.extensions.includes(ext)) return f.id;
  return null;
}

export function isImageFormat(f: FileFormat | null): f is ImageFormat {
  return f !== null && f !== 'pigm';
}

export function isOpenablePath(filePath: string): boolean {
  return formatFromPath(filePath) !== null;
}

/** Hard limit for any file read through IPC (bytes). */
export const MAX_OPEN_BYTES = 1536 * 1024 * 1024;
