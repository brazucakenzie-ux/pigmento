// Runs in a dedicated worker; `self` is typed as Window under the DOM lib, so posts are cast.
import { handleFilterRequest, type FilterRequest } from '../filters/protocol';

/** One band of an adjustment or filter per message; the result's buffer is transferred. */
self.onmessage = (ev: MessageEvent<FilterRequest>) => {
  const res = handleFilterRequest(ev.data);
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(res, res.ok ? [res.data.buffer] : []);
};
