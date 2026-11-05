import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { contentSecurityPolicy } from './src/shared/csp';

/** Injects the Content-Security-Policy meta tag; dev needs inline scripts/styles for HMR. */
function cspPlugin(): Plugin {
  let isDev = false;
  return {
    name: 'pigmento-csp',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    transformIndexHtml(html) {
      const csp = contentSecurityPolicy(isDev);
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

const alias = {
  '@shared': resolve('src/shared'),
  '@engine': resolve('src/renderer/src/engine'),
  '@ui': resolve('src/renderer/src/ui'),
  '@resources': resolve('resources'),
};

export default defineConfig({
  main: {
    resolve: { alias },
  },
  preload: {
    resolve: { alias },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), cspPlugin()],
    worker: { format: 'es' },
    build: { target: 'chrome140', chunkSizeWarningLimit: 2000, minify: true },
  },
});
