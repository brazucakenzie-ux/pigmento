import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { actions, runAction } from './actions';
import { effectiveShortcuts, type ShortcutAction, type ShortcutOverrides } from './shortcuts';

const NAMED: Record<string, string> = {
  '+': 'Plus',
  '=': 'Plus',
  '-': 'Minus',
  _: 'Minus',
  '/': 'Slash',
  ',': 'Comma',
  '.': 'Period',
  '<': 'Comma',
  '>': 'Period',
  ' ': 'Space',
};

/**
 * Normalise a key event to a combo like "Ctrl+Shift+S". Shift is only part of the combo for
 * letters, digits and named keys, so "+" works whether or not Shift is needed to type it. The
 * comma and full-stop keys are the exception: they go by the key itself and keep Shift
 * (Shift+, and Shift+. step between keyframes, whatever those keys type with Shift).
 */
export function comboOf(e: KeyboardEvent): string {
  let key = e.key;
  const named = NAMED[key];
  const physical = e.code === 'Comma' || e.code === 'Period' ? e.code : null;
  const printableSymbol = key.length === 1 && !/[a-z0-9]/i.test(key);
  if (physical) key = physical;
  else if (named) key = named;
  else if (key.length === 1) key = key.toUpperCase();
  // Digits typed with Shift on some layouts: use the physical key.
  if (/^Digit\d$/.test(e.code) && (e.ctrlKey || e.metaKey)) key = e.code.slice(5);
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && (!printableSymbol || physical)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Human-readable form for tooltips and the cheat sheet. */
export function displayCombo(combo: string): string {
  return combo
    .replace('Plus', '+')
    .replace('Minus', '−')
    .replace('Slash', '/')
    .replace('Period', '.')
    .replace('Comma', ',')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace(/^Mouse(\d)$/, 'Mouse $1')
    .replace(/\+(?=.)/g, ' + ')
    .replace(' +  + ', ' + +');
}

let comboMap: Map<string, string[]> | null = null;
let mapFor: ShortcutOverrides | null = null;

/** Every action with its default shortcuts (for the shortcut rules and the editor). */
export function shortcutActions(): ShortcutAction[] {
  return [...actions().values()].map((a) => ({ id: a.id, tool: a.id.startsWith('tool.'), defaults: a.shortcut ?? [] }));
}

/** An action's shortcuts as they are now (its defaults, or the user's changes). */
export function shortcutsOf(id: string, overrides: ShortcutOverrides = useUi.getState().settings.shortcuts): readonly string[] {
  const a = actions().get(id);
  return a ? effectiveShortcuts({ id, tool: id.startsWith('tool.'), defaults: a.shortcut ?? [] }, overrides) : [];
}

/** The first shortcut of an action, kept current when shortcuts are changed (tooltips, menus). */
export function useShortcut(id: string): string | undefined {
  return useUi((s) => shortcutsOf(id, s.settings.shortcuts)[0]);
}

/** Shortcut → action ids. Tools of one family share a letter (S: rectangle/ellipse select). */
function map(): Map<string, string[]> {
  const overrides = useUi.getState().settings.shortcuts;
  if (comboMap && mapFor === overrides) return comboMap;
  comboMap = new Map();
  mapFor = overrides;
  for (const a of actions().values()) {
    for (const s of shortcutsOf(a.id, overrides)) comboMap.set(s, [...(comboMap.get(s) ?? []), a.id]);
  }
  return comboMap;
}

/** The action a shortcut runs: pressing a shared tool letter again moves to the next tool. */
export function actionForCombo(combo: string, currentTool: string): string | undefined {
  const ids = map().get(combo);
  if (!ids || ids.length === 0) return undefined;
  const i = ids.indexOf(`tool.${currentTool}`);
  return i < 0 ? ids[0] : ids[(i + 1) % ids.length];
}

export function shortcutFor(actionId: string): string | undefined {
  return shortcutsOf(actionId)[0];
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button'].includes(type);
  }
  return el.tagName === 'SELECT';
}

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The window's regions in F6 order, and what in each takes the focus. */
const REGIONS: readonly { region: string; focus: string | null }[] = [
  { region: '.ribbon', focus: '[role="tab"][aria-selected="true"]' },
  { region: '.optionsbar', focus: FOCUSABLE },
  { region: '.canvas-host', focus: null },
  { region: '.sidepanel', focus: FOCUSABLE },
  { region: '.timeline', focus: FOCUSABLE },
  { region: '.statusbar', focus: FOCUSABLE },
];

/** The region F6 last moved the focus to. */
let lastRegion: string | null = null;

/** F6 / Shift+F6: move the focus to the next (or previous) region that has something to focus. */
export function cycleRegion(dir: 1 | -1): boolean {
  const regions = REGIONS.map((r) => ({ ...r, el: document.querySelector<HTMLElement>(r.region) })).filter((r) => r.el);
  if (!regions.length) return false;
  const active = document.activeElement;
  let i = regions.findIndex((r) => r.el!.contains(active));
  // If the focus fell back to the page (the focused control went away), carry on from the region
  // F6 last went to rather than starting over.
  if (i < 0 && (active === document.body || active === null)) i = regions.findIndex((r) => r.region === lastRegion);
  if (i < 0) i = dir > 0 ? -1 : regions.length;
  for (let k = 1; k <= regions.length; k++) {
    const r = regions[(((i + dir * k) % regions.length) + regions.length) % regions.length];
    const target = r.focus ? r.el!.querySelector<HTMLElement>(r.focus) : r.el;
    if (target && target.getClientRects().length > 0) {
      target.focus();
      lastRegion = r.region;
      return true;
    }
  }
  return false;
}

/** How far the arrow keys move the view while the canvas has the focus (Shift: further). */
const PAN_STEP = 40;

/** Window-level shortcut handler. Dialogs and text fields keep their own keys. */
export function handleGlobalKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || (e.repeat && !NUDGE[e.key] && e.key !== '[' && e.key !== ']')) return;
  const state = useUi.getState();
  if (state.dialog) return;
  if (document.querySelector('.menu:popover-open')) return;
  // F6 works everywhere, even from a text field.
  if (e.key === 'F6' && !e.ctrlKey && !e.altKey) {
    if (cycleRegion(e.shiftKey ? -1 : 1)) e.preventDefault();
    return;
  }
  if (isTypingTarget(e.target)) return;

  // The active tool gets first refusal on Enter/Escape/Backspace (commit, cancel, undo point).
  if (['Enter', 'Escape', 'Backspace'].includes(e.key) && engine.handleKey(e)) {
    e.preventDefault();
    return;
  }

  // The Animate tool nudges and deletes the selected piece itself.
  if (state.tool === 'animate' && (NUDGE[e.key] || e.key === 'Delete') && engine.handleKey(e)) {
    e.preventDefault();
    return;
  }

  const n = NUDGE[e.key];
  if (n && !e.ctrlKey && !e.altKey && (state.selection.bounds || state.vectorSelection.count > 0)) {
    const k = e.shiftKey ? 10 : 1;
    if (engine.nudgeSelection(n[0] * k, n[1] * k)) {
      e.preventDefault();
      return;
    }
  }
  // With the canvas focused and nothing to nudge, the arrows move around the picture.
  if (n && !e.ctrlKey && !e.altKey && e.target instanceof HTMLElement && e.target.classList.contains('canvas-host')) {
    const k = PAN_STEP * (e.shiftKey ? 5 : 1);
    engine.panBy(-n[0] * k, -n[1] * k);
    e.preventDefault();
    return;
  }

  if (e.key === 'Escape') {
    if (state.live || state.selection.bounds) {
      engine.deselect();
      e.preventDefault();
    }
    return;
  }

  const id = actionForCombo(comboOf(e), state.tool);
  if (!id) return;
  // Brush-size keys repeat; everything else fires once per press.
  e.preventDefault();
  runAction(id);
}

/** The mouse's side buttons as shortcuts: back is "Mouse4", forward "Mouse5". */
const SIDE_BUTTONS: Record<number, { combo: string; bit: number }> = { 3: { combo: 'Mouse4', bit: 8 }, 4: { combo: 'Mouse5', bit: 16 } };

/**
 * Window-level handler for the side buttons (pointerdown, pointermove and pointerup). They run
 * their shortcut even mid-stroke, where pressing one arrives as a pointermove, and never
 * navigate back or forward.
 */
export function handleGlobalPointer(e: PointerEvent): void {
  const side = SIDE_BUTTONS[e.button];
  if (!side) return;
  e.preventDefault();
  // Only presses count (a move reports the button on release too).
  if (e.type === 'pointerup' || !(e.buttons & side.bit)) return;
  const state = useUi.getState();
  if (state.dialog) return;
  const id = actionForCombo(side.combo, state.tool);
  if (id) runAction(id);
}
