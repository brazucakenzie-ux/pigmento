import { showToast } from '../state/store';

/** Pictures under this size are never checked (they always fit). */
const SMALL = 256 * 1024 * 1024;

/**
 * Memory a w×h picture needs while it is open: its pixels, the picture as shown, and the screen's
 * copy of the layer (undo adds to this as you work).
 */
export const bytesFor = (w: number, h: number): number => w * h * 4 * 3;

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/**
 * Is there room for a w×h picture? If not, say so plainly (instead of running out of memory
 * halfway) and resolve false.
 */
export async function hasMemoryFor(w: number, h: number): Promise<boolean> {
  const need = bytesFor(w, h);
  if (need < SMALL) return true;
  let free: number;
  try {
    free = (await window.pigmento.system.memory()).free;
  } catch {
    return true;
  }
  if (need <= free * 0.9) return true;
  showToast({ kind: 'error', key: 'error.notEnoughMemory', params: { w, h, need: gb(need), free: gb(free) } });
  return false;
}
