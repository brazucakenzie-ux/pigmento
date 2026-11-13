import { filterRegistry } from './FilterRegistry';
import type { FilterInput, FilterParams } from './types';

/** Messages to and from filter workers: one band in, its filtered pixels out (buffers move). */
export interface FilterRequest {
  id: number;
  filterId: string;
  params: FilterParams;
  input: FilterInput;
}

export type FilterResponse = { id: number; ok: true; data: Uint8ClampedArray } | { id: number; ok: false; error: string };

/** What a worker does with a request (kept here, free of worker globals, so it can be tested). */
export function handleFilterRequest(req: FilterRequest): FilterResponse {
  try {
    const def = filterRegistry.get(req.filterId);
    if (!def) return { id: req.id, ok: false, error: `Unknown filter "${req.filterId}"` };
    const { input } = req;
    if (!(input.data instanceof Uint8ClampedArray) || input.data.length !== input.w * input.h * 4) return { id: req.id, ok: false, error: 'Bad image' };
    const data = def.run(input, req.params);
    if (data.length !== input.data.length) return { id: req.id, ok: false, error: 'Filter returned the wrong size' };
    return { id: req.id, ok: true, data };
  } catch (err) {
    return { id: req.id, ok: false, error: err instanceof Error ? err.message : 'Filter failed' };
  }
}
