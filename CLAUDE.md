# Pigmento: notes for Claude

Pigmento is a paint-style raster editor (Electron + React + a framework-free TS engine) for **Windows 11 only**. Scope, milestones and the resumable checklist live in `PLAN.md`; read it first. Tick each checklist item the moment its sub-step runs and passes its tests, in the same commit as the work. Never tick items in a batch at the end of a milestone.

## Commands (PowerShell-safe, no bash syntax in scripts)
| Command | What it does |
|---|---|
| `npm run dev` | Start the app with HMR (electron-vite dev) |
| `npm run build` | Production build into `out/` |
| `npm start` | Run the production build (electron-vite preview) |
| `npm run lint` / `npm run format` | ESLint (flat config) / Prettier write |
| `npm run typecheck` | `tsc --noEmit` for node (main/preload) and web (renderer) projects |
| `npm test` | Vitest unit tests (`tests/unit`) |
| `npm run e2e` | Build, then Playwright Electron tests (`tests/e2e`) |
| `npm run check` | lint + typecheck + unit + e2e: must be green before a milestone is done |
| `npm run icons` | Regenerate `build/icon.ico` + PNGs from `resources/logo.svg` |

E2E runs with `PIGMENTO_USER_DATA` pointed at a temp folder, so tests never touch the real `%APPDATA%\Pigmento`. `PIGMENTO_E2E=1` exposes `window.__pigmentoTest` (`src/renderer/src/ui/app/testHook.ts`) for assertions. Native dialogs are stubbed from the test with `app.evaluate(({ dialog }) => …)`.
Opt-in e2e switches: `PIGMENTO_E2E_CLIPBOARD=1` (overwrites the real clipboard), `PIGMENTO_SCREENSHOT=1` with `PIGMENTO_SCREENSHOT_DIR=<folder>` (captures UI states for visual review), `PIGMENTO_UPDATE_GOLDEN=1` (rewrites `tests/golden/shapes.png` + `.json` after an intended change to a built-in shape; review the sheet before committing).
`npm run e2e` always rebuilds first; when running `npx playwright test` directly, run `npm run build` after changing source.

## Architecture (summary, details in PLAN.md section 3)
- `src/main`: Electron main process. Windows, IPC handlers, atomic file writes, settings, recent files/jump list, clipboard, print, wallpaper, `app://` protocol.
- `src/preload`: the only bridge (`window.pigmento`), typed by `src/shared/ipc.ts`.
- `src/renderer/src/engine`: **never imports React or anything from `ui/`**. Pixel data is in tiled `Surface`s (256 px tiles, copy-on-write, so undo stores tile deltas). Each layer has a GPU mirror canvas written only with `putImageData`. The compositor updates dirty rects of a doc-sized composite; the view draws it with zoom/pan; the overlay canvas holds handles, ants and previews.
- Tools implement `Tool` (`engine/tools/Tool.ts`) and self-register from `engine/tools/builtin/*.ts` (auto-loaded with `import.meta.glob`). Their ribbon group/order and options-bar schema are data on the tool.
- Live objects (shape being edited, text box, floating selection) live in the engine, render above the active layer, and commit as one history command.
- `src/renderer/src/ui`: React chrome. Zustand stores mirror engine events. Every user action is an entry in `ui/actions` (label, icon, default shortcut, run, enabled); menus, ribbon buttons, shortcuts and the cheat sheet all read from it.

## Conventions
- TypeScript strict, no `any` (use `unknown` + narrowing). Prefer `type` imports.
- All user-visible strings go through `t('key')` (`ui/i18n/en.ts`). The engine stores i18n keys (e.g. history labels), never English text.
- No placeholder UI: if a feature is not built, it is not in the ribbon, menus or panels.
- Every destructive operation is undoable (push a `Command`). Every dialog has Cancel, Esc and Enter (use `components/Dialog`).
- Colours: engine uses `RGBA = { r, g, b, a }` with 0–255 channels; straight (non-premultiplied) alpha everywhere in surfaces.
- Paths: use `path.join` in main; never build Windows paths by string concatenation.
- Writes from main go through `atomicWrite()` (`src/main/files.ts`).
- Styling: plain CSS reading colour tokens (`var(--bg-panel)` etc.); no inline `<style>` (strict CSP). Respect `prefers-reduced-motion` and `forced-colors`.
- Themes are data in `ui/theme/themes.ts`: a family has a light and a dark `Palette`, derived tokens are applied as CSS custom properties on `:root`, and `tokens.css` only holds the pre-JS fallback plus the Windows contrast override. To add a theme, add a family there plus its i18n name; `tests/unit/themes.test.ts` enforces WCAG contrast. Use `--accent-fg` (not `--accent`) for accent-coloured text.
- Tests: engine logic gets Vitest unit tests next to its feature (`tests/unit/*.test.ts`); user flows get Playwright e2e (`tests/e2e`).
- Commit after each PLAN.md sub-step once it runs and its tests pass. That commit also ticks the sub-step's box in PLAN.md.
