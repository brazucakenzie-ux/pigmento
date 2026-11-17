import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { contentSecurityPolicy } from './src/shared/csp';
import { listedPackages, NOTICES_FILE } from './scripts/notices.mjs';

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

/**
 * Fails the build if it bundles an npm package that THIRD-PARTY-NOTICES.md doesn't list at its
 * installed version, so the licence texts that ship with the app are always complete.
 */
function noticesPlugin(): Plugin {
  return {
    name: 'pigmento-notices',
    apply: 'build',
    generateBundle() {
      const listed = listedPackages(readFileSync(NOTICES_FILE, 'utf8'));
      const missing = new Set<string>();
      for (const id of this.getModuleIds()) {
        if (id.startsWith('\0')) continue;
        const file = id.split('?')[0].replace(/\\/g, '/');
        const at = file.lastIndexOf('/node_modules/');
        if (at < 0) continue;
        const parts = file.slice(at + '/node_modules/'.length).split('/');
        const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
        const pkg = JSON.parse(
          readFileSync(`${file.slice(0, at)}/node_modules/${name}/package.json`, 'utf8'),
        ) as { version: string };
        if (listed.get(name) !== pkg.version) missing.add(`${name} ${pkg.version}`);
      }
      if (missing.size > 0) {
        this.error(
          `THIRD-PARTY-NOTICES.md doesn't have ${[...missing].join(', ')}: list it in scripts/notices.mjs and run npm run notices`,
        );
      }
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
    plugins: [noticesPlugin()],
  },
  preload: {
    resolve: { alias },
    plugins: [noticesPlugin()],
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), cspPlugin(), noticesPlugin()],
    worker: { format: 'es', plugins: () => [noticesPlugin()] },
    build: { target: 'chrome140', chunkSizeWarningLimit: 2000, minify: true },
  },
});
