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

/**
 * The kinds of taking part that count (human decision, 2026-07-27).
 *
 * Any ONE of them satisfies the Discord half of the monthly test. They are
 * recorded separately so the dashboard can show HOW a member participates —
 * one member is mute and takes part in voice through text-to-speech, which a
 * message count alone would render as silence.
 */
export type ActivityKind = 'message' | 'forum' | 'voice';

export interface ActivityEvent {
  readonly discordId: string;
  readonly kind: ActivityKind;
  readonly at: Date;
  readonly isBot: boolean;
  /** Text channel id for `message`; thread/forum id or voice channel id otherwise. */
  readonly channelId: string;
  /** Deduplicates replayed messages during backfill. Absent for voice. */
  readonly eventId?: string | undefined;
}

/** Kept for the message path, which is the only one that backfills. */
export interface IncomingMessage {
  readonly discordId: string;
  readonly channelId: string;
  readonly at: Date;
  readonly isBot: boolean;
  readonly messageId?: string;
}

export interface ActivityRow {
  discordId: string;
  /** First of the month, midnight UTC. */
  month: Date;
  messageCount: number;
  forumPostCount: number;
  voiceJoinCount: number;
  firstActivityAt: Date | null;
  lastActivityAt: Date | null;
}

export interface IActivityStore {
  /**
   * Adds one event of `kind` to the member's month, creating the row if needed.
   * Returns false if `eventId` was already counted.
   */
  record(
    discordId: string,
    month: Date,
    at: Date,
    kind: ActivityKind,
    eventId?: string,
  ): Promise<boolean>;
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

  /** A message in the designated activity channel. */
  async onMessage(msg: IncomingMessage): Promise<void> {
    if (msg.channelId !== this.config.activityChannelId) return;
    await this.record({
      discordId: msg.discordId,
      kind: 'message',
      at: msg.at,
      isBot: msg.isBot,
      channelId: msg.channelId,
      eventId: msg.messageId,
    });
  }

  /**
   * Any activity event. Forum posts and voice joins arrive here directly —
   * unlike messages they are not restricted to one configured channel, because
   * taking part in a forum thread or sitting in voice is participation wherever
   * it happens.
   */
  async record(e: ActivityEvent): Promise<void> {
    // Bots are ignored, including our own. Otherwise the bot's own
    // notifications would register as squadron activity and everyone would
    // look permanently active.
    if (e.isBot) return;
    if (e.discordId === '') return;

    await this.store.record(e.discordId, monthKey(e.at), e.at, e.kind, e.eventId);
  }
}
