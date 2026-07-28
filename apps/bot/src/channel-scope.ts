/**
 * Which channels count toward activity.
 *
 * ★ THE RULE, FROM THE SQUADRON OWNER (2026-07-28) ★
 *
 * "Any channel that is not admin gated, and not an announcement channel. All
 * other channels work, including NSFW channels."
 *
 * This replaces a single nominated text channel and a hand-written list of
 * voice channel ids. That design counted a member's messages in ONE channel out
 * of dozens, so somebody active all month across the server showed as zero —
 * which is exactly what was reported, and it looked like the bot was broken
 * rather than like it was doing what it was told.
 *
 * ★ WHY THIS IS DERIVED AND NOT A LIST ★
 *
 * The earlier note argued for an explicit list because deriving from permissions
 * "silently opts in every future channel". That is now the POINT: a squadron
 * that adds a channel expects talking in it to count, and nobody will remember
 * to update an environment variable. The failure mode of the list — silently
 * counting nothing — is far worse than the failure mode of the rule.
 *
 * Channel ids are still configuration, never source (INV-008). Nothing here
 * names a channel; it reads shapes and permissions.
 */

/** Discord channel types this needs to distinguish. Numbers are Discord's own. */
export const CHANNEL_TYPE = {
  GuildText: 0,
  GuildVoice: 2,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  GuildStageVoice: 13,
  GuildForum: 15,
  GuildMedia: 16,
} as const;

/** What a role may do, reduced to the two bits that decide this. */
export interface ScopeRole {
  readonly id: string;
  /** Holds Administrator, Manage Guild, or Manage Channels. */
  readonly isPrivileged: boolean;
}

/** One channel, reduced to what the rule reads. */
export interface ScopeChannel {
  readonly id: string;
  readonly type: number;
  /**
   * Role ids that can VIEW this channel, after overwrites are applied.
   *
   * The caller resolves this, because computing effective permissions is
   * discord.js's job and doing it here would mean reimplementing Discord's
   * overwrite precedence — which is the kind of thing that is subtly wrong for
   * months.
   */
  readonly viewerRoleIds: readonly string[];
  /** True when the channel is a thread; its parent decides forum-ness. */
  readonly parentType?: number | undefined;
}

/**
 * Channel types where taking part is participation.
 *
 * Announcement channels are excluded BY TYPE rather than by permission. They
 * are readable by everyone and postable only by staff, so counting them would
 * award activity for the handful of people who write announcements and nothing
 * to anyone else — the opposite of measuring participation.
 *
 * Stage channels are excluded for the same reason: an audience of two hundred
 * with three speakers is not two hundred people taking part in a conversation.
 */
const COUNTABLE_TYPES = new Set<number>([
  CHANNEL_TYPE.GuildText,
  CHANNEL_TYPE.GuildVoice,
  CHANNEL_TYPE.PublicThread,
  CHANNEL_TYPE.PrivateThread,
  CHANNEL_TYPE.GuildForum,
  CHANNEL_TYPE.GuildMedia,
]);

/**
 * Is this channel one where activity counts?
 *
 * ★ "ADMIN GATED" MEANS ONLY ADMINS CAN SEE IT ★
 *
 * Not "restricted at all". A squadron gates channels behind interest roles —
 * Miners, Explorers, Anti-Xeno — and those are ordinary members talking. A rule
 * of "@everyone must be able to view it" would have thrown away most of the
 * server's real conversation while looking perfectly reasonable.
 *
 * So a channel is admin-gated only when EVERY role that can view it is
 * privileged. One ordinary role with access makes it a members' channel.
 *
 * NSFW is not consulted at all, on explicit instruction. It is a content
 * warning, not a permission, and members talking there are members talking.
 */
export function countsTowardActivity(channel: ScopeChannel, roles: readonly ScopeRole[]): boolean {
  if (!COUNTABLE_TYPES.has(channel.type)) return false;

  // A thread under an announcement channel inherits its nature: the parent
  // decides who may start a conversation there.
  if (channel.parentType === CHANNEL_TYPE.GuildAnnouncement) return false;

  /*
   * No viewers at all is treated as NOT counting.
   *
   * This is the conservative direction. An empty list means either a genuinely
   * locked channel or a resolution that failed, and counting on a failed
   * permission read would quietly inflate everybody's activity — which is
   * unfalsifiable once it has happened, because nothing records why a message
   * was counted.
   */
  if (channel.viewerRoleIds.length === 0) return false;

  const privileged = new Set(roles.filter((r) => r.isPrivileged).map((r) => r.id));
  return channel.viewerRoleIds.some((id) => !privileged.has(id));
}

/** Is this message a forum post rather than an ordinary message? */
export function isForumChannel(channel: ScopeChannel): boolean {
  return (
    channel.type === CHANNEL_TYPE.GuildForum ||
    channel.type === CHANNEL_TYPE.GuildMedia ||
    channel.parentType === CHANNEL_TYPE.GuildForum ||
    channel.parentType === CHANNEL_TYPE.GuildMedia
  );
}
