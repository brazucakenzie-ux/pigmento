import type { ImageFormat } from '@shared/formats';
import type { Rect } from '../core/geometry';

/** Largest image (in pixels) Pigmento will open; Chromium canvases cap out near 268 MP. */
export const MAX_PIXELS = 250_000_000;
export const MAX_DIMENSION = 30_000;

export type WorkerRequest =
  | { id: number; type: 'decode'; bytes: Uint8Array }
  | {
      id: number;
      type: 'encode';
      format: ImageFormat;
      w: number;
      h: number;
      data: Uint8ClampedArray;
      quality: number;
      dpi: number;
    }
  | {
      id: number;
      type: 'fill';
      w: number;
      h: number;
      data: Uint8ClampedArray;
      x: number;
      y: number;
      tolerance: number;
      contiguous: boolean;
      clip: Uint8Array | null;
    };

export type WorkerResponse =
  | { id: number; ok: true; type: 'decode'; w: number; h: number; data: Uint8ClampedArray; dpi: number | null }
  | { id: number; ok: true; type: 'encode'; bytes: Uint8Array }
  | { id: number; ok: true; type: 'fill'; mask: Uint8Array; bounds: Rect | null }
  | { id: number; ok: false; error: string; code?: 'too-large' | 'decode' };
