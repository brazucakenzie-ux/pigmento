import type { AssistantActivity, AssistantsState } from '@shared/ipc';

/**
 * What Pigmento knows about AI assistants right now: who's connected (by the name its client
 * gives), whether you've stopped them, and what they've done lately (newest last, the last
 * MAX_ACTIVITY kept). Every window shows it (the badge and the Assistant activity panel).
 */

export const MAX_ACTIVITY = 200;

export class AssistantsBook {
  private readonly connected = new Map<number, string>();
  private readonly activity: AssistantActivity[] = [];
  private nextSession = 1;
  private nextEntry = 1;
  paused = false;

  constructor(
    /** Told each time something changes, with the state to show. */
    private readonly onChange: (s: AssistantsState) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** A new conversation (its client's name comes once it says hello). Returns its id. */
  open(): number {
    const id = this.nextSession++;
    this.connected.set(id, '');
    return id;
  }

  /** The client said who it is: it shows from now on. */
  named(id: number, name: string): void {
    if (!this.connected.has(id)) return;
    this.connected.set(id, name.slice(0, 80) || 'An AI assistant');
    this.changed();
  }

  close(id: number): void {
    if (this.connected.delete(id)) this.changed();
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.changed();
  }

  /** Note one call: what it was, by whom, and how it went. */
  record(client: string, title: string, ok: boolean, message?: string): void {
    this.activity.push({ id: this.nextEntry++, time: this.now(), client, title, ok, ...(message ? { message } : {}) });
    if (this.activity.length > MAX_ACTIVITY) this.activity.splice(0, this.activity.length - MAX_ACTIVITY);
    this.changed();
  }

  state(): AssistantsState {
    return {
      // Only those that have said who they are (a connection that never does isn't an assistant yet).
      connected: [...this.connected].filter(([, name]) => name).map(([id, name]) => ({ id, name })),
      paused: this.paused,
      activity: [...this.activity],
    };
  }

  private changed(): void {
    this.onChange(this.state());
  }
}
