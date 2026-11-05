/** Original SVG cursors (24×24) with a white halo so they read on any colour. */

function svgCursor(body: string, hx: number, hy: number, fallback: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
}

function haloed(path: string): string {
  return `<g stroke="#fff" stroke-width="4">${path}</g><g stroke="#1d1b2b" stroke-width="1.6">${path}</g>`;
}

export const CURSOR_PENCIL = svgCursor(
  haloed('<path d="M2.5 21.5 L4 16 L16.5 3.5 L20.5 7.5 L8 20 Z"/><path d="M14 6 L18 10"/>'),
  2,
  21,
  'crosshair',
);

export const CURSOR_FILL = svgCursor(
  haloed('<path d="M10 3 L18 11 L11 18 L3 10 Z"/><path d="M7 7 L2.5 2.5"/><path d="M20 14 C21.5 16.5 21.5 18 20 19 C18.5 18 18.5 16.5 20 14 Z"/>'),
  20,
  20,
  'crosshair',
);

export const CURSOR_PICKER = svgCursor(
  haloed('<path d="M2.5 21.5 L3.5 17.5 L13 8 L16 11 L6.5 20.5 Z"/><path d="M14.5 6.5 L17.5 3.5 C18.6 2.4 20.4 2.4 21 3 C21.6 3.6 21.6 5.4 20.5 6.5 L17.5 9.5"/><path d="M12 7 L17 12"/>'),
  2,
  21,
  'crosshair',
);

export const CURSOR_ZOOM_IN = svgCursor(
  haloed('<circle cx="10" cy="10" r="6.5"/><path d="M15 15 L21 21"/><path d="M7 10 H13 M10 7 V13"/>'),
  10,
  10,
  'zoom-in',
);

export const CURSOR_ZOOM_OUT = svgCursor(
  haloed('<circle cx="10" cy="10" r="6.5"/><path d="M15 15 L21 21"/><path d="M7 10 H13"/>'),
  10,
  10,
  'zoom-out',
);
