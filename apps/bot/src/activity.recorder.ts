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
   * Writes ONLY the per-day row, never the monthly totals.
   *
   * Used to rebuild history the monthly counters have already consumed, where
   * going through the normal path would double every count.
   */
  recordDayOnly?(discordId: string, at: Date, kind: ActivityKind): Promise<void>;
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

/*
 * ★ NO CHANNEL CONFIG ANY MORE ★
 *
 * `RecorderConfig.activityChannelId` scoped message counting to ONE channel, so
 * a member talking all month everywhere else recorded zero. Which channels
 * count is now decided per channel from Discord's own permissions, at the call
 * site (channel-scope.ts) — the recorder counts whatever it is given.
 *
 * That is the right split: the recorder is about arithmetic and idempotency,
 * and "is this a members' channel" is a question about a guild.
 */

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
  constructor(private readonly store: IActivityStore) {}

  /**
   * A message in a channel that counts.
   *
   * The caller has already decided that it counts. This used to re-check
   * against one configured id and drop everything else, which is what made the
   * counts zero.
   */
  async onMessage(msg: IncomingMessage): Promise<void> {
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
   * Any activity event. Messages, forum posts and voice joins all arrive here,
   * from any channel the scope rule accepted — taking part is participation
   * wherever it happens.
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
