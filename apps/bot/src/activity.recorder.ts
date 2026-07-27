/**
 * Records that a member posted, and when. Nothing more.
 *
 * Phase 1 of rank progression (ssot/02-domain/rank-progression.yaml). It does
 * not promote anyone — it accumulates a month of real data so the first
 * promotion run can be checked against activity we can verify by eye.
 *
 * WHAT IT DELIBERATELY CANNOT DO: read a message. The bot does not hold the
 * privileged Message Content intent, so MESSAGE_CREATE arrives with author,
 * channel and timestamp and no text at all. The privacy policy's "we cannot
 * read your messages" stays literally true, and this file could not break that
 * promise even if someone asked it to.
 */

export interface IncomingMessage {
  readonly discordId: string;
  readonly channelId: string;
  readonly at: Date;
  readonly isBot: boolean;
  /** Used to dedupe when backfilling after downtime. */
  readonly messageId?: string;
}

export interface ActivityRow {
  discordId: string;
  /** First of the month, midnight UTC. */
  month: Date;
  messageCount: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
}

export interface IActivityStore {
  /**
   * Adds one message to the member's month, creating the row if needed.
   * Returns false if `messageId` was already counted.
   */
  record(discordId: string, month: Date, at: Date, messageId?: string): Promise<boolean>;
}

export interface RecorderConfig {
  readonly activityChannelId: string;
}

/**
 * Pins an instant to the first of its month, midnight UTC.
 *
 * UTC throughout, never local time. 23:30 on 31 July UTC is already 1 August in
 * Sydney — with local time the month a message counted toward would depend on
 * where the server happened to be running, and would change if we moved it.
 */
export function monthKey(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0));
}

export class ActivityRecorder {
  constructor(
    private readonly store: IActivityStore,
    private readonly config: RecorderConfig,
  ) {}

  async onMessage(msg: IncomingMessage): Promise<void> {
    // Bots are ignored, including our own. Otherwise the bot's own
    // notifications would register as squadron activity and everyone would
    // look permanently active.
    if (msg.isBot) return;
    if (msg.discordId === '') return;
    if (msg.channelId !== this.config.activityChannelId) return;

    await this.store.record(msg.discordId, monthKey(msg.at), msg.at, msg.messageId);
  }
}
