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
  /** Minutes in voice, banked when sessions END. Beside the join count, never instead of it. */
  voiceMinutes: number;
  firstActivityAt: Date | null;
  lastActivityAt: Date | null;
}

/**
 * A voice session ending — the member left, or moved somewhere the roster does not report on.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "for voice joins can we track how long they are in voice chat per month? keep an aggregate
 * total etc and include that in YTD aswell."
 */
export interface VoiceSessionEnd {
  readonly discordId: string;
  readonly isBot: boolean;
  /**
   * When the session began — `inVoiceSince`, as read BEFORE presence was cleared.
   *
   * Null when the bot never saw the join: a restart wipes presence and re-seeds from the live
   * voice states, so a session that spanned the restart has no honest start time. Null banks
   * NOTHING — a guessed duration would be invented minutes on the table promotions are read
   * beside, which is precisely the fiction the old profile `voiceMinutes` was removed for.
   */
  readonly since: Date | null;
  /** When it ended. */
  readonly at: Date;
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
  /**
   * Adds minutes to a member's month. Additive, so two sessions in one month accumulate; the
   * caller has already split a session at month boundaries, so `month` is always the month the
   * minutes were actually spent in.
   */
  bankVoiceMinutes(discordId: string, month: Date, minutes: number): Promise<void>;
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

/**
 * Whether a voice-state transition ENDS the member's counted session.
 *
 * `to` is the destination channel id IF IT COUNTS toward activity, else null — the caller has
 * already applied the channel-scope rule, the same split as `record`: the recorder is
 * arithmetic, and "is this a members' channel" is a question about a guild.
 *
 * ★ A MOVE IS NOT A LEAVE ★
 *
 * Both ids non-null means the member walked from one counted room to another: the session
 * CONTINUES, and `inVoiceSince` keeps its original timestamp — the same rule that stops the
 * roster's "in voice since" resetting when somebody changes channel. Only leaving voice, or
 * moving somewhere the roster does not report on, ends the clock.
 */
export function endsVoiceSession(from: string | null, to: string | null): boolean {
  return from !== null && to === null;
}

/**
 * A session's minutes, split at UTC month boundaries.
 *
 * ★ WHY THE SPLIT EXISTS ★
 *
 * A session from 23:00 on 31 July to 01:00 on 1 August is an hour of July and an hour of
 * August. Credited whole to either month, the monthly figures stop summing to the truth — and
 * YTD is defined as the sum of the months, so it would inherit the error.
 *
 * Each part rounds to the nearest whole minute independently; a part that rounds to zero is
 * dropped rather than written as a zero-minute row.
 */
export function splitVoiceMinutes(
  since: Date,
  at: Date,
): Array<{ month: Date; minutes: number }> {
  if (at <= since) return [];

  const parts: Array<{ month: Date; minutes: number }> = [];
  let cursor = since;

  while (cursor < at) {
    const month = monthKey(cursor);
    const nextMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
    const end = at < nextMonth ? at : nextMonth;

    const minutes = Math.round((end.getTime() - cursor.getTime()) / 60_000);
    if (minutes > 0) parts.push({ month, minutes });

    cursor = end;
  }

  return parts;
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

  /**
   * A voice session ended: bank its minutes, each month credited its own.
   *
   * The caller decides WHEN a session ends (`endsVoiceSession` — a move between counted rooms
   * is not an end); this decides how much it was worth and where it lands. `since: null` banks
   * nothing: the bot restarted mid-session and the true start time is gone, and no minutes is
   * a smaller lie than invented ones.
   */
  async onVoiceLeave(e: VoiceSessionEnd): Promise<void> {
    // Bots hold presence — the roster shows them in channels — but bank no activity, the same
    // rule as record().
    if (e.isBot) return;
    if (e.discordId === '') return;
    if (e.since === null) return;

    for (const part of splitVoiceMinutes(e.since, e.at)) {
      await this.store.bankVoiceMinutes(e.discordId, part.month, part.minutes);
    }
  }
}
