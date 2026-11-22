import { describe, expect, it } from 'vitest';
import type { AssistantsState } from '../../src/shared/ipc';
import { AssistantsBook, MAX_ACTIVITY } from '../../src/main/mcp/book';

describe('the book of AI assistants', () => {
  it('shows a connection once its client says who it is, and drops it when it goes', () => {
    const seen: AssistantsState[] = [];
    const book = new AssistantsBook((s) => seen.push(s));
    const a = book.open();
    const b = book.open();
    expect(book.state().connected).toEqual([]);
    book.named(a, 'Claude Desktop');
    book.named(b, '');
    expect(book.state().connected).toEqual([
      { id: a, name: 'Claude Desktop' },
      { id: b, name: 'An AI assistant' },
    ]);
    book.close(a);
    expect(book.state().connected.map((c) => c.id)).toEqual([b]);
    // Every change was told.
    expect(seen).toHaveLength(3);
    book.close(a);
    expect(seen).toHaveLength(3);
  });

  it('stops and lets go on, telling only when it changes', () => {
    const seen: AssistantsState[] = [];
    const book = new AssistantsBook((s) => seen.push(s));
    book.setPaused(true);
    book.setPaused(true);
    expect(book.paused).toBe(true);
    expect(seen.map((s) => s.paused)).toEqual([true]);
    book.setPaused(false);
    expect(seen.map((s) => s.paused)).toEqual([true, false]);
  });

  it('notes what assistants did, keeping the latest', () => {
    let now = 1000;
    const book = new AssistantsBook(() => undefined, () => now++);
    book.record('Claude', 'Picture info', true);
    book.record('Claude', 'Picture info', false, 'Not allowed');
    expect(book.state().activity).toEqual([
      { id: 1, time: 1000, client: 'Claude', title: 'Picture info', ok: true },
      { id: 2, time: 1001, client: 'Claude', title: 'Picture info', ok: false, message: 'Not allowed' },
    ]);
    for (let i = 0; i < MAX_ACTIVITY + 10; i++) book.record('C', `step ${i}`, true);
    const log = book.state().activity;
    expect(log).toHaveLength(MAX_ACTIVITY);
    expect(log.at(-1)!.title).toBe(`step ${MAX_ACTIVITY + 9}`);
  });
});
