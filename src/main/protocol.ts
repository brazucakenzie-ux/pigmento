import { protocol } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { contentSecurityPolicy } from '@shared/csp';

export const APP_SCHEME = 'app';
export const APP_HOST = 'pigmento';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

/** In-memory pages served under app://pigmento/__print/ for the print window. */
const printPages = new Map<string, { html: string; png: Uint8Array }>();

export function registerPrintPage(html: (imgUrl: string) => string, png: Uint8Array): string {
  const id = randomUUID();
  printPages.set(id, { html: html(`${APP_ORIGIN}/__print/${id}.png`), png });
  return `${APP_ORIGIN}/__print/${id}.html`;
}

export function releasePrintPage(url: string): void {
  const m = /__print\/([0-9a-f-]+)\.html$/.exec(url);
  if (m) printPages.delete(m[1]);
}

/** Must run before app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
}

/** Serves the built renderer from out/renderer with path-traversal protection. */
export function handleAppProtocol(rendererRoot: string): void {
  const root = path.resolve(rendererRoot);
  const csp = contentSecurityPolicy(false, 'header');
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });
    const pathname = decodeURIComponent(url.pathname);

    const print = /^\/__print\/([0-9a-f-]+)\.(html|png)$/.exec(pathname);
    if (print) {
      const page = printPages.get(print[1]);
      if (!page) return new Response('Not found', { status: 404 });
      if (print[2] === 'png') {
        return new Response(Buffer.from(page.png), { headers: { 'content-type': 'image/png' } });
      }
      return new Response(page.html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `default-src 'none'; img-src ${APP_ORIGIN}; style-src 'unsafe-inline'`,
        },
      });
    }

    const rel = pathname === '/' ? '/index.html' : pathname;
    const full = path.resolve(path.join(root, rel));
    if (full !== root && !full.startsWith(root + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const data = await fs.readFile(full);
      const type = MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream';
      const headers: Record<string, string> = { 'content-type': type };
      if (type.startsWith('text/html')) headers['content-security-policy'] = csp;
      return new Response(data, { headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
