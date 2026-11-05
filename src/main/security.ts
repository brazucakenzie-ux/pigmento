import { app, session } from 'electron';
import { APP_ORIGIN, APP_SCHEME } from './protocol';

const ALLOWED_PERMISSIONS = new Set(['local-fonts', 'clipboard-sanitized-write', 'fullscreen']);

function isAllowedUrl(url: string, devServer: string | undefined): boolean {
  if (url.startsWith(`${APP_SCHEME}:`)) return true;
  if (url.startsWith('devtools:') || url.startsWith('chrome-extension:')) return true;
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  if (devServer) {
    const dev = new URL(devServer);
    try {
      const u = new URL(url);
      if (u.hostname === dev.hostname && u.port === dev.port) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Locks the renderer down: no remote content, no navigation, no popups, minimal permissions. */
export function applySecurityPolicy(devServer: string | undefined): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = isAllowedUrl(details.url, devServer);
    if (!ok) console.warn('Blocked request to', details.url);
    callback({ cancel: !ok });
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const appPage = url.startsWith(APP_ORIGIN) || (devServer && url.startsWith(devServer));
      if (!appPage) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}
