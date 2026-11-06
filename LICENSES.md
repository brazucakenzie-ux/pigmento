# Third-party licences

Pigmento's own code, logo (`resources/logo.svg`), cursors, custom icons and palette are original work created for this project.

The components below are bundled into the app. Their full licence texts ship inside each package under `node_modules/<package>/LICENSE`, and Electron's bundled Chromium licences are in `LICENSES.chromium.html` next to the packaged executable.

| Component | Version | Licence | Copyright | Used for |
|---|---|---|---|---|
| Electron | 45.2.3 | MIT | Electron contributors (OpenJS Foundation) | Desktop shell (includes Chromium and Node.js, each under their own licences) |
| React, React DOM, scheduler | 19.3.1 | MIT | Meta Platforms, Inc. and affiliates | UI rendering |
| Zustand | 5.0.16 | MIT | Paul Henschel | UI state store |
| Zod | 4.6.7 | MIT | Colin McDonnell | Settings and data validation |
| Lucide (lucide-react) | 1.69.0 | ISC | Lucide contributors (parts © Cole Bemis, Feather, MIT) | Interface icons |
| Inter (via @fontsource-variable/inter) | 5.3.0 | SIL Open Font License 1.1 | The Inter Project Authors | Interface font |
| gifenc | 1.0.3 | MIT | Matt DesLauriers | GIF encoding |
| fflate | 0.8.3 | MIT | Arjun Barrett | ZIP container for `.pigm` projects |

## Theme palettes

The optional themes in View → Theme reproduce the colours of these projects. Only the colour values are used (no code, icons or other assets), and the names are trademarks of their owners, used here only to describe each palette.

| Theme | Colours taken from | Licence |
|---|---|---|
| GitHub Light/Dark | Primer primitives, `@primer/primitives` functional themes "light" and "dark" (GitHub, Inc.) | MIT |
| VS Code Light/Dark | Visual Studio Code `extensions/theme-defaults` "Light Modern" / "Dark Modern" (Microsoft Corporation) | MIT |
| Pierre Light/Dark | Pierre theme, `pierrecomputer/theme` (The Pierre Computer Company) | MIT |
| Claude Light/Dark | Anthropic's published brand colours (#141413, #faf9f5, #e8e6dc, #d97757, #6a9bcc, #788c5d) and the Claude app's surfaces | Colour values; Claude is a trademark of Anthropic |

Where a brand accent is too light or too dark to read as text, Pigmento derives a darker or lighter variant for text and picks black or white for text on accent buttons, so every theme meets WCAG AA. This is checked by `tests/unit/themes.test.ts`.

Build- and test-only tools (Vite, electron-vite, TypeScript, ESLint, Prettier, Vitest, Playwright, resvg-js) are not shipped in the app; see each package's licence in `node_modules`.

## Licence summaries

- **MIT** and **ISC**: permissive; the copyright notice and licence text must be kept with copies of the software.
- **SIL OFL 1.1** (Inter): the font may be bundled and redistributed with software; it may not be sold on its own, and modified versions must not use the reserved font name.
