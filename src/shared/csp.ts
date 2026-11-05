/**
 * Content-Security-Policy for the renderer. Production is strict (no inline code, no remote
 * origins); dev additionally allows what Vite HMR and React Fast Refresh need.
 * `frame-ancestors` is only valid in a header, so the meta-tag variant omits it.
 */
export function contentSecurityPolicy(dev: boolean, delivery: 'meta' | 'header' = 'meta'): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", 'blob:', 'data:'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  };
  if (delivery === 'header') directives['frame-ancestors'] = ["'none'"];
  if (dev) {
    directives['script-src'].push("'unsafe-inline'");
    directives['style-src'].push("'unsafe-inline'");
    directives['connect-src'].push('ws://localhost:*', 'http://localhost:*');
  }
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}
