import { describe, expect, it } from 'vitest';
import { assignShortcut, canShare, effectiveShortcuts, isAssignable, removeShortcut, resetShortcut, shortcutOwners, type ShortcutAction } from '@ui/actions/shortcuts';
import { SettingsSchema } from '@shared/settings';

const ACTIONS: ShortcutAction[] = [
  { id: 'save', tool: false, defaults: ['Ctrl+S'] },
  { id: 'undo', tool: false, defaults: ['Ctrl+Z'] },
  { id: 'tool.select', tool: true, defaults: ['S'] },
  { id: 'tool.ellipseSelect', tool: true, defaults: ['S'] },
  { id: 'tool.brush', tool: true, defaults: ['B'] },
];
const of = (id: string) => ACTIONS.find((a) => a.id === id)!;

describe('customised shortcuts', () => {
  it('uses the defaults until an action is changed, and an empty list means none', () => {
    expect(effectiveShortcuts(of('save'), {})).toEqual(['Ctrl+S']);
    expect(effectiveShortcuts(of('save'), { save: [] })).toEqual([]);
    expect(effectiveShortcuts(of('save'), { save: ['F2'] })).toEqual(['F2']);
  });

  it('adds a key, and takes it from whoever had it when replacing', () => {
    let o = assignShortcut(ACTIONS, {}, 'tool.brush', 'M', 'replace');
    expect(o).toEqual({ 'tool.brush': ['B', 'M'] });
    o = assignShortcut(ACTIONS, o, 'save', 'M', 'replace');
    expect(effectiveShortcuts(of('tool.brush'), o)).toEqual(['B']);
    expect(effectiveShortcuts(of('save'), o)).toEqual(['Ctrl+S', 'M']);
    // Back to its defaults, the brush has no override left.
    expect(o['tool.brush']).toBeUndefined();
    expect(shortcutOwners(ACTIONS, o, 'M').map((a) => a.id)).toEqual(['save']);
  });

  it('lets tools share a letter, but not commands', () => {
    expect(canShare(ACTIONS, {}, 'tool.brush', 'S')).toBe(true);
    expect(canShare(ACTIONS, {}, 'tool.brush', 'Ctrl+S')).toBe(false);
    expect(canShare(ACTIONS, {}, 'save', 'S')).toBe(false);
    const o = assignShortcut(ACTIONS, {}, 'tool.brush', 'S', 'share');
    expect(shortcutOwners(ACTIONS, o, 'S').map((a) => a.id)).toEqual(['tool.select', 'tool.ellipseSelect', 'tool.brush']);
  });

  it('removes and resets', () => {
    let o = removeShortcut(ACTIONS, {}, 'undo', 'Ctrl+Z');
    expect(o).toEqual({ undo: [] });
    o = resetShortcut(o, 'undo');
    expect(o).toEqual({});
  });

  it('refuses keys that must keep their meaning, and malformed ones', () => {
    for (const k of ['Tab', 'Escape', 'Enter', 'F6', 'Space', 'Ctrl+', 'Ctrl+Shift+Alt+S', 'Win+S']) expect(isAssignable(k), k).toBe(false);
    for (const k of ['M', 'Ctrl+Alt+Shift+P', 'F12', 'Mouse5', '[', 'Ctrl+Comma', 'Ctrl+ArrowLeft']) expect(isAssignable(k), k).toBe(true);
    expect(assignShortcut(ACTIONS, {}, 'save', 'Tab', 'replace')).toEqual({});
  });

  it('keeps settings with odd shortcuts out', () => {
    expect(SettingsSchema.safeParse({ shortcuts: { save: ['Ctrl+S', 'F2'] } }).success).toBe(true);
    expect(SettingsSchema.safeParse({ shortcuts: { save: ['rm -rf'] } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ui: { scale: 3 } }).success).toBe(false);
  });
});
