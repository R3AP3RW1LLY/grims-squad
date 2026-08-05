import type { IActivityStore, ActivityRow, ActivityKind } from './activity.recorder.js';

/** In-memory store for the recorder's unit tests. */
export class InMemoryActivityStore implements IActivityStore {
  readonly rows: ActivityRow[] = [];
  readonly #seen = new Set<string>();

  find(discordId: string, monthIso: string): ActivityRow | undefined {
    return this.rows.find(
      (r) => r.discordId === discordId && r.month.toISOString().startsWith(monthIso),
    );
  }

  async record(
    discordId: string,
    month: Date,
    at: Date,
    kind: ActivityKind = 'message',
    messageId?: string,
  ): Promise<boolean> {
    // Mirrors the real unique constraint on processed message ids. A fake that
    // skipped this would let the double-count bug pass its own test.
    if (messageId !== undefined) {
      if (this.#seen.has(messageId)) return false;
      this.#seen.add(messageId);
    }

    const row = this.#row(discordId, month);
    if (kind === 'message') row.messageCount += 1;
    else if (kind === 'forum') row.forumPostCount += 1;
    else row.voiceJoinCount += 1;
    // firstMessageAt never moves forward: it is the evidence of when they first
    // appeared that month.
    if (row.firstActivityAt === null || at < row.firstActivityAt) row.firstActivityAt = at;
    if (row.lastActivityAt === null || at > row.lastActivityAt) row.lastActivityAt = at;
    return true;
  }

  /**
   * Additive, mirroring the real store's `voice_minutes = voice_minutes + n` upsert — a fake
   * that replaced would let a double-banking bug pass its own test.
   */
  async bankVoiceMinutes(discordId: string, month: Date, minutes: number): Promise<void> {
    this.#row(discordId, month).voiceMinutes += minutes;
  }

  #row(discordId: string, month: Date): ActivityRow {
    let row = this.rows.find(
      (r) => r.discordId === discordId && r.month.getTime() === month.getTime(),
    );
    if (row === undefined) {
      row = {
        discordId,
        month,
        messageCount: 0,
        forumPostCount: 0,
        voiceJoinCount: 0,
        voiceMinutes: 0,
        firstActivityAt: null,
        lastActivityAt: null,
      };
      this.rows.push(row);
    }
    return row;
  }
}
