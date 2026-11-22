import { describe, expect, it } from 'vitest';
import { History, type Command } from '@engine/history/History';
import { carryOutChange, isChange } from '../../src/renderer/src/ui/services/assistantChange';

/** A command that adds `n` to a counter (and takes it off on undo). */
function adder(box: { v: number }, n: number): Command {
  box.v += n;
  return { label: 'history.initial.new', bytes: 8, undo: () => (box.v -= n), redo: () => (box.v += n) };
}

describe('an AI assistant’s change', () => {
  it('is one named undo step however many things it does, after playing out when you watch', async () => {
    const history = new History();
    const box = { v: 0 };
    const played: string[] = [];
    const result = await carryOutChange(
      history,
      {
        label: 'panel.assistants',
        watch: async () => void played.push('watched'),
        apply: () => {
          history.push(adder(box, 1));
          history.push(adder(box, 10));
          return { text: 'Done twice.' };
        },
      },
      'watch',
    );
    expect(result).toEqual({ text: 'Done twice.' });
    expect(played).toEqual(['watched']);
    expect(box.v).toBe(11);
    expect(history.entries()).toEqual([{ label: 'panel.assistants' }]);
    history.undo();
    expect(box.v).toBe(0);
  });

  it('is made straight away when drawing is instant', async () => {
    const history = new History();
    let watched = false;
    await carryOutChange(history, { label: 'panel.assistants', watch: async () => void (watched = true), apply: () => ({}) }, 'instant');
    expect(watched).toBe(false);
  });

  it('is told apart from a plain answer', () => {
    expect(isChange({ label: 'panel.assistants', apply: () => ({}) })).toBe(true);
    expect(isChange({ text: 'hello' })).toBe(false);
  });
});
