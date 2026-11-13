import { useEffect, useState } from 'react';
import type { PerfStats } from '@engine/PerfMonitor';
import { t } from '../../i18n';
import { engine } from '../state/engine';
import { useUi } from '../state/store';

const ms = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} ms`);
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

interface Reading {
  stats: PerfStats;
  heap: number | null;
  memory: ReturnType<typeof engine.memoryUse>;
}

/** Chromium's heap figure (not a web standard, so read defensively). */
function heapBytes(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof m?.usedJSHeapSize === 'number' ? m.usedJSHeapSize : null;
}

/** Frame time, pointer-to-pixel latency and memory, over the canvas (Ctrl+Alt+Shift+P). */
export function PerfOverlay() {
  const shown = useUi((s) => s.perfOverlay);
  const [r, setR] = useState<Reading | null>(null);
  useEffect(() => {
    engine.perf.enabled = shown;
    if (!shown) return;
    const read = () => setR({ stats: engine.perf.stats(performance.now()), heap: heapBytes(), memory: engine.memoryUse() });
    read();
    const id = window.setInterval(read, 250);
    return () => {
      window.clearInterval(id);
      engine.perf.enabled = false;
    };
  }, [shown]);
  if (!shown || !r) return null;
  const { stats, heap, memory } = r;
  return (
    <div className="perf-overlay" role="status" aria-label={t('perf.title')}>
      <div>
        <span>{t('perf.frame')}</span>
        <b>
          {ms(stats.frame)} · p95 {ms(stats.frameP95)}
        </b>
      </div>
      <div>
        <span>{t('perf.latency')}</span>
        <b>
          {ms(stats.latency)} · p95 {ms(stats.latencyP95)}
        </b>
      </div>
      <div>
        <span>{t('perf.fps')}</span>
        <b>{stats.fps}</b>
      </div>
      <div>
        <span>{t('perf.heap')}</span>
        <b>{heap === null ? '—' : mb(heap)}</b>
      </div>
      <div>
        <span>{t('perf.image', { layers: memory.layers })}</span>
        <b>{mb(memory.image)}</b>
      </div>
      <div>
        <span>{t('perf.history')}</span>
        <b>{mb(memory.history)}</b>
      </div>
    </div>
  );
}
