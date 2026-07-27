import type { IActivityStore, ActivityRow } from './activity.recorder.js';

/** In-memory store for the recorder's unit tests. */
export class InMemoryActivityStore implements IActivityStore {
  readonly rows: ActivityRow[] = [];
  readonly #seen = new Set<string>();

  find(discordId: string, monthIso: string): ActivityRow | undefined {
    return this.rows.find(
      (r) => r.discordId === discordId && r.month.toISOString().startsWith(monthIso),
    );
  }

  async record(discordId: string, month: Date, at: Date, messageId?: string): Promise<boolean> {
    // Mirrors the real unique constraint on processed message ids. A fake that
    // skipped this would let the double-count bug pass its own test.
    if (messageId !== undefined) {
      if (this.#seen.has(messageId)) return false;
      this.#seen.add(messageId);
    }

    let row = this.rows.find(
      (r) => r.discordId === discordId && r.month.getTime() === month.getTime(),
    );
    if (row === undefined) {
      row = { discordId, month, messageCount: 0, firstMessageAt: null, lastMessageAt: null };
      this.rows.push(row);
    }
    row.messageCount += 1;
    // firstMessageAt never moves forward: it is the evidence of when they first
    // appeared that month.
    if (row.firstMessageAt === null || at < row.firstMessageAt) row.firstMessageAt = at;
    if (row.lastMessageAt === null || at > row.lastMessageAt) row.lastMessageAt = at;
    return true;
  }
}
