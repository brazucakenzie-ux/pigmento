import { SHORTCUT_COMBO } from '@shared/settings';

/**
 * Customised keyboard shortcuts. Each action has its default combinations; the user's changes
 * are stored per action (an empty list means "no shortcut"). Pure functions, so the rules are
 * unit-tested without the app.
 */
export type ShortcutOverrides = Readonly<Record<string, readonly string[]>>;

export interface ShortcutAction {
  id: string;
  /** Tools may share a letter: pressing it again moves to the next one. */
  tool: boolean;
  defaults: readonly string[];
}

/** Keys that keep their meaning everywhere (moving focus, cancelling, confirming, menus). */
const RESERVED = new Set(['Tab', 'Shift+Tab', 'Escape', 'Enter', 'Space', 'F6', 'Shift+F6', 'F10', 'Alt+F4', 'Ctrl+F4']);

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'OS']);

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

/** Can this combination be given to an action? */
export function isAssignable(combo: string): boolean {
  return SHORTCUT_COMBO.test(combo) && !RESERVED.has(combo);
}

export function effectiveShortcuts(a: ShortcutAction, overrides: ShortcutOverrides): readonly string[] {
  return Object.prototype.hasOwnProperty.call(overrides, a.id) ? overrides[a.id] : a.defaults;
}

/** The other actions that already answer to `combo`. */
export function shortcutOwners(actions: readonly ShortcutAction[], overrides: ShortcutOverrides, combo: string, except?: string): ShortcutAction[] {
  return actions.filter((a) => a.id !== except && effectiveShortcuts(a, overrides).includes(combo));
}

/** Store `list` for action `a`, dropping the override when it is the default again. */
function setFor(overrides: ShortcutOverrides, a: ShortcutAction, list: readonly string[]): Record<string, readonly string[]> {
  const next: Record<string, readonly string[]> = { ...overrides };
  const same = list.length === a.defaults.length && list.every((c, i) => c === a.defaults[i]);
  if (same) delete next[a.id];
  else next[a.id] = [...list];
  return next;
}

/**
 * Give `combo` to action `id`. `replace` takes it from every other action that has it;
 * `share` leaves them (only offered when they are all tools, which cycle on a shared letter).
 */
export function assignShortcut(actions: readonly ShortcutAction[], overrides: ShortcutOverrides, id: string, combo: string, how: 'replace' | 'share'): ShortcutOverrides {
  const target = actions.find((a) => a.id === id);
  if (!target || !isAssignable(combo)) return overrides;
  let next: ShortcutOverrides = overrides;
  if (how === 'replace') {
    for (const other of shortcutOwners(actions, overrides, combo, id)) next = setFor(next, other, effectiveShortcuts(other, next).filter((c) => c !== combo));
  }
  const mine = effectiveShortcuts(target, next);
  if (mine.includes(combo)) return next;
  // Up to four per action; the newest replaces the oldest beyond that.
  return setFor(next, target, [...mine, combo].slice(-4));
}

export function removeShortcut(actions: readonly ShortcutAction[], overrides: ShortcutOverrides, id: string, combo: string): ShortcutOverrides {
  const a = actions.find((x) => x.id === id);
  return a ? setFor(overrides, a, effectiveShortcuts(a, overrides).filter((c) => c !== combo)) : overrides;
}

export function resetShortcut(overrides: ShortcutOverrides, id: string): ShortcutOverrides {
  const next: Record<string, readonly string[]> = { ...overrides };
  delete next[id];
  return next;
}

/** Can `combo` be shared rather than taken: the action and every current owner are tools. */
export function canShare(actions: readonly ShortcutAction[], overrides: ShortcutOverrides, id: string, combo: string): boolean {
  const target = actions.find((a) => a.id === id);
  const owners = shortcutOwners(actions, overrides, combo, id);
  return !!target?.tool && owners.length > 0 && owners.every((o) => o.tool);
}

/** Overrides as stored in settings (plain arrays). */
export function plainOverrides(o: ShortcutOverrides): Record<string, string[]> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v]]));
}
