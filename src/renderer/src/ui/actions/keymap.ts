import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { actions, runAction } from './actions';

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
 * letters, digits and named keys, so "+" works whether or not Shift is needed to type it.
 */
export function comboOf(e: KeyboardEvent): string {
  let key = e.key;
  const named = NAMED[key];
  const printableSymbol = key.length === 1 && !/[a-z0-9]/i.test(key);
  if (named) key = named;
  else if (key.length === 1) key = key.toUpperCase();
  // Digits typed with Shift on some layouts: use the physical key.
  if (/^Digit\d$/.test(e.code) && (e.ctrlKey || e.metaKey)) key = e.code.slice(5);
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && !printableSymbol) parts.push('Shift');
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

/** Shortcut → action ids. Tools of one family share a letter (S: rectangle/ellipse select). */
function map(): Map<string, string[]> {
  if (comboMap) return comboMap;
  comboMap = new Map();
  for (const a of actions().values()) {
    for (const s of a.shortcut ?? []) comboMap.set(s, [...(comboMap.get(s) ?? []), a.id]);
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
  return actions().get(actionId)?.shortcut?.[0];
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

/** Window-level shortcut handler. Dialogs and text fields keep their own keys. */
export function handleGlobalKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || (e.repeat && !NUDGE[e.key] && e.key !== '[' && e.key !== ']')) return;
  const state = useUi.getState();
  if (state.dialog) return;
  if (document.querySelector('.menu:popover-open')) return;
  if (isTypingTarget(e.target)) return;

  // The active tool gets first refusal on Enter/Escape/Backspace (commit, cancel, undo point).
  if (['Enter', 'Escape', 'Backspace'].includes(e.key) && engine.handleKey(e)) {
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
