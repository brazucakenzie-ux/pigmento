import { frameSequence } from '@engine/anim/exportFrames';
import type { LoopMode } from '@engine/anim/timeline';
import { AnimExportError, encodeAnimation, type AnimFormat, type VideoQuality } from '@engine/io/animExport';
import { engine } from '../state/engine';
import { showToast } from '../state/store';
import { baseName } from './files';

/** Everything the Export animation dialog decides. Frames are 0-based and inclusive. */
export interface AnimExportChoice {
  format: AnimFormat;
  from: number;
  to: number;
  scale: number;
  playback: LoopMode;
  transparent: boolean;
  quality: VideoQuality;
}

export function animExportName(c: AnimExportChoice): string {
  const n = baseName() + (c.scale !== 1 ? `@${c.scale}x` : '');
  return `${n}.${c.format}`;
}

/**
 * Render and encode the animation, then ask where to save it. Resolves true when saved; false
 * when cancelled (by the signal or in the Save dialog) or when it failed (a message says why).
 */
export async function exportAnimation(c: AnimExportChoice, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<boolean> {
  engine.commitLive();
  const frames = frameSequence(c.from, c.to, c.playback);
  const transparent = c.format === 'gif' && c.transparent;
  let bytes: Uint8Array;
  try {
    bytes = await encodeAnimation(
      (f) => engine.animationFrameCanvas(f, { scale: c.scale, transparent }),
      { format: c.format, frames, fps: engine.anim.timeline.fps, repeat: c.playback === 'once' ? -1 : 0, transparent, quality: c.quality },
      onProgress,
      signal,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    if (err instanceof AnimExportError) showToast({ kind: 'error', key: err.key, params: { message: err.message } });
    else showToast({ kind: 'error', key: 'error.animExport', params: { message: err instanceof Error ? err.message : String(err) } });
    return false;
  }
  let saved: string | null;
  try {
    saved = await window.pigmento.files.saveAsset(c.format === 'gif' ? 'animationGif' : 'animationMp4', animExportName(c), bytes);
  } catch {
    showToast({ kind: 'error', key: 'error.export', params: { name: animExportName(c) } });
    return false;
  }
  if (!saved) return false;
  showToast({ kind: 'info', key: 'notice.animExported', params: { name: saved.split(/[\\/]/).pop() ?? saved, frames: frames.length } });
  return true;
}
