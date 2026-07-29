import {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
  type Collection,
  type Message,
  type GuildBasedChannel,
} from 'discord.js';
import { PrismaClient } from '@grims/db';
import pino from 'pino';
import { ActivityRecorder, monthKey } from './activity.recorder.js';
import {
  countsTowardActivity,
  isForumChannel,
  type ScopeChannel,
  type ScopeRole,
} from './channel-scope.js';

/**
 * The parts of a channel this file touches.
 *
 * Structural rather than a discord.js union: the union of every channel type
 * that has `permissionsFor` and `parent` is enormous and changes between
 * library versions, and narrowing it correctly is not what this code is about.
 */
interface PermissionSurface {
  readonly type: number;
  permissionsFor(id: string): { has(flag: bigint): boolean } | null;
}

type GuildChannelish = Pick<GuildBasedChannel, 'id'> &
  PermissionSurface & {
    /*
     * The parent carries the same surface, because a THREAD delegates the whole
     * question to it: a thread has no overwrites of its own worth reading, and
     * who may see it is decided by the channel it lives in.
     */
    parent?: PermissionSurface | null;
    isThread?: () => boolean;
  };

/** A channel whose history can be paged. */
interface BackfillableChannel {
  readonly id: string;
  readonly messages: {
    fetch(opts: { limit: number; after: string }): Promise<Collection<string, Message>>;
  };
}
import { PrismaActivityStore, PrismaCheckpointStore } from './activity.store.prisma.js';

/**
 * The squadron bot. Phase 1: it records activity and does nothing else.
 *
 * It grants no roles, promotes nobody and sends no messages. Promotion lands
 * later, in dry-run first — a defect here would move 49 people at once,
 * publicly, and is tedious to unwind by hand.
 */

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: { paths: ['*.token', '*.secret'], censor: '[redacted]' },
});

const TOKEN = process.env['DISCORD_BOT_TOKEN'] ?? '';
const GUILD_ID = process.env['DISCORD_GUILD_ID'] ?? '';
/*
 * ★ NO CHANNEL LIST ANY MORE ★
 *
 * DISCORD_ACTIVITY_CHANNEL_ID and DISCORD_VOICE_CHANNEL_IDS are gone. They
 * scoped counting to ONE text channel and a hand-written set of voice channels,
 * so a member active all month across the server recorded zero — reported as
 * "why is it zeroes all across the board", and it looked like a broken bot
 * rather than a bot doing exactly what it was configured to do.
 *
 * The scope is now derived per channel: anything that is not admin-gated and
 * not an announcement channel counts, NSFW included (see channel-scope.ts).
 * Nothing here names a channel, so INV-008 is untouched.
 */

for (const [name, value] of [
  ['DISCORD_BOT_TOKEN', TOKEN],
  ['DISCORD_GUILD_ID', GUILD_ID],
] as const) {
  if (value === '') {
    // Refuse rather than idle. A bot that starts, connects and silently records
    // nothing looks healthy in `docker ps` while a month of data goes missing.
    console.error(`bot: ${name} is required`);
    process.exit(1);
  }
}

/**
 * One watermark per channel, so a slow channel never blocks a busy one.
 *
 * A single global watermark would be wrong the moment two channels are read at
 * different rates: the highest snowflake seen anywhere would skip everything
 * older in every other channel.
 */
const checkpointKey = (channelId: string) => `activity:${channelId}`;

/**
 * A SEPARATE watermark for the daily rebuild.
 *
 * The daily table arrived after a month of messages had already been counted
 * into the monthly totals. Re-reading that history under the normal watermark
 * would have added every message to the monthly counts a second time — silently
 * doubling the numbers that decide promotions. Its own key, and a write path
 * that touches only the daily table, makes that impossible rather than merely
 * unlikely.
 */
const dailyCheckpointKey = (channelId: string) => `activity-daily:${channelId}`;
/** Discord's epoch, for turning a timestamp into a snowflake. */
const DISCORD_EPOCH = 1420070400000n;

const prisma = new PrismaClient();
const activity = new PrismaActivityStore(prisma);
const checkpoints = new PrismaCheckpointStore(prisma);
const recorder = new ActivityRecorder(activity);

const client = new Client({
  /*
   * Guilds + GuildMessages ONLY.
   *
   * MessageContent is a PRIVILEGED intent and is deliberately absent: without
   * it MESSAGE_CREATE still carries author, channel and timestamp, which is
   * everything this needs, and carries no message text at all. The privacy
   * policy's "we cannot read your messages" is therefore true by construction
   * rather than by promise, and cannot be broken by a future code change alone.
   */
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Voice STATE, not voice audio. Tells us who joined which channel and when.
    // Not a privileged intent, and it carries nothing anyone said.
    GatewayIntentBits.GuildVoiceStates,
    /*
     * PRIVILEGED, and needed only for NAMES — the nickname a member wears in
     * this guild, which by squadron convention is their commander name.
     *
     * Not for message content: that intent is separate, is deliberately absent,
     * and its absence is what makes "we cannot read your messages" true by
     * construction rather than by promise. This one carries no message text.
     *
     * If it is switched off in the developer portal the member fetch fails, the
     * bot logs a warning and carries on counting activity — names fall back to
     * snowflakes rather than anything breaking.
     */
    GatewayIntentBits.GuildMembers,
  ],
});

/**
 * Every role in the guild, reduced to "is this a staff role".
 *
 * Cached for the life of the process. Roles change rarely, the bot restarts
 * often, and re-resolving them per message would put a lookup in front of every
 * event on a busy server.
 */
let roleScope: ScopeRole[] = [];

async function loadRoles(): Promise<void> {
  const guild = await client.guilds.fetch(GUILD_ID);
  const roles = await guild.roles.fetch();

  roleScope = [...roles.values()].map((r) => ({
    id: r.id,
    /*
     * Administrator implies everything, but is NOT the only staff marker. A
     * moderator role with Manage Guild or Manage Channels is equally "admin
     * gated" for our purposes, and a channel visible only to them is a staff
     * channel whatever it happens to be called.
     */
    isPrivileged:
      r.permissions.has(PermissionFlagsBits.Administrator) ||
      r.permissions.has(PermissionFlagsBits.ManageGuild) ||
      r.permissions.has(PermissionFlagsBits.ManageChannels),
  }));

  logger.info(
    { roles: roleScope.length, privileged: roleScope.filter((r) => r.isPrivileged).length },
    'role scope loaded',
  );
}

/** Turns a discord.js channel into the shape the scope rule reads. */
function describe(channel: GuildChannelish): ScopeChannel {
  const parent = 'parent' in channel ? channel.parent : null;
  const target = channel.isThread?.() === true && parent !== null ? parent : channel;

  /*
   * Which roles can SEE it, after overwrites. Resolved by discord.js rather
   * than by us: Discord's overwrite precedence is exactly the sort of thing
   * that is subtly wrong for months if reimplemented by hand.
   */
  const viewerRoleIds = roleScope
    .filter((r) => target.permissionsFor(r.id)?.has(PermissionFlagsBits.ViewChannel) === true)
    .map((r) => r.id);

  return {
    id: channel.id,
    type: channel.type,
    viewerRoleIds,
    parentType: parent?.type,
  };
}

async function handle(msg: Message): Promise<void> {
  try {
    await recorder.onMessage({
      discordId: msg.author?.id ?? '',
      channelId: msg.channelId,
      at: new Date(msg.createdTimestamp),
      isBot: msg.author?.bot ?? false,
      messageId: msg.id,
    });
  } catch (err) {
    // One bad row must not kill the listener. Losing a single message is a
    // rounding error; losing the connection loses the rest of the month.
    logger.error({ err, messageId: msg.id }, 'failed to record message');
  }
}

/**
 * Reads one channel's history since its own watermark.
 *
 * Runs on every start, so a deploy or a crash does not lose what was posted
 * while the process was down. Snowflakes are monotonic, so `after` is exact:
 * nothing is counted twice and nothing is skipped.
 */
async function backfillChannel(channel: BackfillableChannel): Promise<number> {
  const key = checkpointKey(channel.id);
  let after = await checkpoints.get(key);

  if (after === null) {
    /*
     * First run for this channel: start at the beginning of THE CURRENT MONTH,
     * not the beginning of the channel.
     *
     * A member must hold their rank for a whole calendar month, so an earlier
     * month can never change an outcome. Reading years of history across every
     * channel in the guild would be tens of thousands of API calls for data
     * that is already settled.
     */
    const start = monthKey(new Date());
    after = String((BigInt(start.getTime()) - DISCORD_EPOCH) << 22n);
  }

  let counted = 0;
  let highest = after;

  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, after: highest }).catch(() => null);
    // A channel we cannot read is not worth stopping the sweep for. Permissions
    // change, and the other forty channels still need reading.
    if (batch === null || batch.size === 0) break;

    // Oldest first, so the watermark only ever moves forward.
    const ordered = [...batch.values()].sort((a, b) => Number(a.id) - Number(b.id));
    for (const m of ordered) {
      await handle(m);
      if (BigInt(m.id) > BigInt(highest)) highest = m.id;
      counted += 1;
    }
    await checkpoints.set(key, highest).catch(() => undefined);
    if (batch.size < 100) break;
  }

  return counted;
}

/**
 * Rebuilds one channel's DAILY rows for the current month.
 *
 * Writes through `recordDayOnly`, so it cannot touch the monthly totals however
 * many times it runs. That matters because this reads history the monthly
 * counters have already consumed.
 */
async function backfillChannelDaily(channel: BackfillableChannel): Promise<number> {
  const key = dailyCheckpointKey(channel.id);
  let after = await checkpoints.get(key);

  if (after === null) {
    const start = monthKey(new Date());
    after = String((BigInt(start.getTime()) - DISCORD_EPOCH) << 22n);
  }

  let counted = 0;
  let highest = after;

  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, after: highest }).catch(() => null);
    if (batch === null || batch.size === 0) break;

    const ordered = [...batch.values()].sort((a, b) => Number(a.id) - Number(b.id));
    for (const m of ordered) {
      // Bots excluded here too. The recorder does it on the normal path, and
      // this path bypasses the recorder entirely.
      if (m.author?.bot !== true && typeof m.author?.id === 'string') {
        await activity
          .recordDayOnly(m.author.id, new Date(m.createdTimestamp), 'message')
          .catch(() => undefined);
        counted += 1;
      }
      if (BigInt(m.id) > BigInt(highest)) highest = m.id;
    }

    await checkpoints.set(key, highest).catch(() => undefined);
    if (batch.size < 100) break;
  }

  return counted;
}

/**
 * Sweeps EVERY countable channel in the guild for the current month.
 *
 * ★ WHY THIS SWEEPS EVERYTHING AND NOT ONE CHANNEL ★
 *
 * It used to read a single nominated channel, so a member talking all month
 * everywhere else recorded zero. That is the reported bug, and it looked like a
 * broken bot rather than a bot doing precisely what it was configured to do.
 *
 * ★ WHAT CANNOT BE RECOVERED ★
 *
 * Voice. Discord keeps no history of who sat in a channel, so there is nothing
 * to read: voice counts start accumulating from the moment the bot is running
 * and no earlier. Messages and forum posts for the current month are fully
 * recoverable, and are recovered here.
 */
async function backfill(): Promise<void> {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();

  let counted = 0;
  let dailyCounted = 0;
  let swept = 0;
  let skipped = 0;

  for (const channel of channels.values()) {
    if (channel === null || !('messages' in channel)) continue;

    if (!countsTowardActivity(describe(channel), roleScope)) {
      skipped += 1;
      continue;
    }

    swept += 1;
    const readable = channel as unknown as BackfillableChannel;
    counted += await backfillChannel(readable);
    // Independent watermark, day-only writes. See dailyCheckpointKey.
    dailyCounted += await backfillChannelDaily(readable);
  }

  logger.info({ counted, dailyCounted, channels: swept, skipped }, 'backfill complete');
}

/**
 * Caches every guild member's NAMES, so activity has somebody's name against it.
 *
 * ★ THE PROBLEM THIS SOLVES ★
 *
 * `discord_identities` is keyed on a website user id and only exists once
 * somebody has signed in. One member of fifty-one has. So the admin activity
 * table could name exactly one person and showed raw snowflakes for everyone
 * else — which is unreadable, and makes the table useless for the decision it
 * exists to support.
 *
 * The bot already has the guild in its gateway cache, so this costs no API
 * calls at all.
 *
 * ★ ROWS ARE UPDATED, NEVER DELETED ★
 *
 * A member who leaves keeps their row. Their activity for the month is still
 * real and an officer reviewing it should see a name, not a number that used
 * to be somebody.
 */
async function syncMemberNames(): Promise<void> {
  const guild = await client.guilds.fetch(GUILD_ID);
  const members = await guild.members.fetch().catch(() => null);

  if (members === null) {
    /*
     * Almost always the SERVER MEMBERS privileged intent being switched off in
     * the developer portal. Logged loudly rather than swallowed: without it the
     * activity table silently falls back to snowflakes, which looks like a
     * display bug and is really a missing permission.
     */
    logger.warn('could not fetch guild members — is the SERVER MEMBERS intent enabled?');
    return;
  }

  let synced = 0;
  for (const m of members.values()) {
    await prisma.discordGuildMember
      .upsert({
        where: { discordId: m.id },
        create: {
          discordId: m.id,
          nick: m.nickname,
          username: m.user.username,
          globalName: m.user.globalName,
          roles: [...m.roles.cache.keys()],
          isBot: m.user.bot,
        },
        update: {
          nick: m.nickname,
          username: m.user.username,
          globalName: m.user.globalName,
          roles: [...m.roles.cache.keys()],
          isBot: m.user.bot,
          syncedAt: new Date(),
        },
      })
      .then(() => {
        synced += 1;
      })
      .catch(() => undefined);
  }

  logger.info({ synced, total: members.size }, 'guild member names cached');
}

/**
 * Counts everybody already sitting in voice when the bot starts.
 *
 * ★ WHY THIS IS NEEDED AT ALL ★
 *
 * Discord keeps NO history of who was in a voice channel. Nothing can be
 * backfilled, so voice counts can only ever start from the moment the bot is
 * running — and without this, a restart during an operation loses everyone who
 * simply stayed where they were. They never fire a join event again, so an
 * evening in voice records nothing.
 *
 * ★ GUARDED ONCE PER DAY, BECAUSE record() DOES NOT DEDUPLICATE ★
 *
 * The store ignores its eventId parameter; the message path is idempotent only
 * because of its snowflake watermark, and there is no equivalent here. So a
 * checkpoint keyed on the UTC date makes this run at most once a day however
 * often the process restarts — which under `tsx watch` is otherwise every time
 * a file is saved.
 */
/**
 * Records that somebody IS in a voice channel, from this moment.
 *
 * ★ PRESENCE, WHICH IS NOT THE SAME AS THE JOIN COUNT ★
 *
 * `member_activity_months.voice_join_count` answers "how often did they join
 * voice this month". The admin console's Last Seen column needs the other
 * question — "are they in voice RIGHT NOW" — so that somebody sitting in a
 * channel reads as present instead of as however many days since their last
 * message.
 *
 * Never overwrites an existing timestamp: moving between channels is not
 * arriving, and resetting the clock would make a member who has been in voice
 * for three hours look like they just walked in.
 */
async function markInVoice(discordId: string, isBot: boolean): Promise<void> {
  const existing = await prisma.discordGuildMember.findUnique({
    where: { discordId },
    select: { inVoiceSince: true },
  });
  if (existing?.inVoiceSince != null) return;

  await prisma.discordGuildMember.upsert({
    where: { discordId },
    // The row may genuinely not exist yet: a member can join voice between the
    // bot connecting and the member-name sweep reaching them.
    create: { discordId, isBot, inVoiceSince: new Date() },
    update: { inVoiceSince: new Date() },
  });
}

/** Records that somebody has left voice. */
async function markLeftVoice(discordId: string): Promise<void> {
  /*
   * `updateMany`, not `update`. Prisma's `update` throws when the row is
   * missing, and a member who left voice but was never cached is an ordinary
   * situation rather than an error worth a log line.
   */
  await prisma.discordGuildMember.updateMany({
    where: { discordId },
    data: { inVoiceSince: null },
  });
}

async function seedVoiceOccupancy(): Promise<void> {
  const guild = await client.guilds.fetch(GUILD_ID);
  const states = guild.voiceStates.cache;

  /*
   * ★ EVERY PRESENCE ROW IS CLEARED FIRST, BEFORE ANYTHING IS SEEDED ★
   *
   * Discord keeps no history of voice occupancy, and a bot that was killed
   * mid-session left rows claiming people were still in a channel they left
   * hours ago. Nothing would ever correct them: the leave event fired while the
   * process was dead and will not be replayed.
   *
   * So the live voice states are treated as the ONLY truth about who is in
   * voice, and everything else is wiped. Showing an officer "in voice channel"
   * for somebody who went to bed is worse than showing nothing.
   *
   * Runs on EVERY start, deliberately outside the once-a-day checkpoint below —
   * the checkpoint exists to stop the join COUNT being inflated by restarts,
   * and presence has no such problem because it is a state, not a tally.
   */
  await prisma.discordGuildMember
    .updateMany({ where: { inVoiceSince: { not: null } }, data: { inVoiceSince: null } })
    .catch((err: unknown) => logger.error({ err }, 'failed to clear stale voice presence'));

  let present = 0;
  for (const state of states.values()) {
    const channel = state.channel;
    if (channel === null) continue;
    if (!countsTowardActivity(describe(channel), roleScope)) continue;

    await markInVoice(state.id, state.member?.user.bot ?? false).catch(() => undefined);
    present += 1;
  }
  logger.info({ present }, 'voice presence seeded');

  /*
   * The join COUNT is separate, and guarded once a day.
   *
   * `record()` does not deduplicate — the message path is idempotent only
   * because of its snowflake watermark, and there is no equivalent here. So a
   * checkpoint keyed on the UTC date makes this run at most once a day however
   * often the process restarts, which under `tsx watch` is otherwise every time
   * a file is saved.
   */
  const today = new Date().toISOString().slice(0, 10);
  const key = `voice-seed:${today}`;
  if ((await checkpoints.get(key)) !== null) return;

  let seeded = 0;
  for (const state of states.values()) {
    const channel = state.channel;
    if (channel === null) continue;
    if (!countsTowardActivity(describe(channel), roleScope)) continue;

    await recorder
      .record({
        discordId: state.id,
        kind: 'voice',
        at: new Date(),
        isBot: state.member?.user.bot ?? false,
        channelId: channel.id,
      })
      .catch(() => undefined);
    seeded += 1;
  }

  await checkpoints.set(key, today).catch(() => undefined);
  logger.info({ seeded }, 'voice occupancy seeded');
}

client.once(Events.ClientReady, (c) => {
  logger.info({ tag: c.user.tag, guilds: c.guilds.cache.size }, 'bot connected');

  // Roles FIRST. The scope rule cannot classify a channel without them, and
  // classifying against an empty role list marks every channel admin-gated and
  // records nothing at all, which is the failure this change exists to fix.
  void loadRoles()
    .then(() => syncMemberNames())
    .then(() => seedVoiceOccupancy())
    .then(() => backfill())
    .catch((err: unknown) => logger.error({ err }, 'startup sweep failed'));
});

client.on(Events.VoiceStateUpdate, (before, after) => {
  if (after.guild.id !== GUILD_ID) return;

  /*
   * ★ PRESENCE IS UPDATED BEFORE THE JOIN COUNT, AND ON DIFFERENT RULES ★
   *
   * The join count deliberately ignores leaves — you cannot join by leaving.
   * Presence is the opposite: a leave is the ONLY thing that ends it, and the
   * early `return` below used to discard exactly that event.
   *
   * Without this, "in voice channel" would appear next to a member's name and
   * stay there for good. A status that can be entered and never left is worse
   * than not showing one.
   */
  if (before.channelId !== after.channelId) {
    if (after.channelId === null) {
      void markLeftVoice(after.id).catch((err: unknown) =>
        logger.error({ err }, 'failed to clear voice presence'),
      );
    } else if (
      after.channel !== null &&
      countsTowardActivity(describe(after.channel), roleScope)
    ) {
      /*
       * Scoped the same way as the count. A member sitting in an admin-only
       * channel is not somewhere the roster should be reporting on, and leaking
       * "in voice channel" from a private room would disclose that a closed
       * meeting is happening.
       */
      void markInVoice(after.id, after.member?.user.bot ?? false).catch((err: unknown) =>
        logger.error({ err }, 'failed to record voice presence'),
      );
    } else {
      // Moved INTO a channel that does not count. They are no longer visibly in
      // voice, so the old presence must not linger.
      void markLeftVoice(after.id).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------- the join count
  // Only a JOIN counts. Without this a member toggling mute, deafen or camera
  // would fire repeatedly and inflate the count for sitting still.
  if (after.channelId === null) return;
  if (before.channelId === after.channelId) return;

  // The same rule as text: any voice channel that is not admin-gated. The
  // hardcoded id list this replaces meant joining anything not on it recorded
  // nothing, which is most of the server.
  const voiceChannel = after.channel;
  if (voiceChannel === null || !countsTowardActivity(describe(voiceChannel), roleScope)) return;

  void recorder
    .record({
      discordId: after.id,
      kind: 'voice',
      at: new Date(),
      isBot: after.member?.user.bot ?? false,
      channelId: after.channelId,
    })
    .catch((err: unknown) => logger.error({ err }, 'failed to record voice join'));
});

client.on(Events.MessageCreate, (msg) => {
  if (msg.guildId !== GUILD_ID) return;

  /*
   * The scope rule decides, per channel, every time. Not a configured id.
   *
   * Evaluated on the LIVE channel rather than cached, because a channel can be
   * locked down mid-month and activity recorded after that point would be
   * activity in a channel we were told not to count.
   */
  const scope = describe(msg.channel as unknown as GuildChannelish);
  if (!countsTowardActivity(scope, roleScope)) return;

  /*
   * Forum activity. A forum post and its replies are messages inside a THREAD
   * whose parent is a forum channel, so both are caught by the same check —
   * there is no separate event for "commented on a forum post".
   */
  if (isForumChannel(scope)) {
    void recorder
      .record({
        discordId: msg.author?.id ?? '',
        kind: 'forum',
        at: new Date(msg.createdTimestamp),
        isBot: msg.author?.bot ?? false,
        channelId: msg.channelId,
        eventId: msg.id,
      })
      .catch((err: unknown) => logger.error({ err }, 'failed to record forum post'));
    return;
  }
  void handle(msg).then(async () => {
    // Keep this channel's watermark current, so a restart resumes after this
    // message instead of replaying traffic the listener already counted.
    await checkpoints.set(checkpointKey(msg.channelId), msg.id).catch(() => undefined);
  });
});

/*
 * A nickname change is the one thing that would otherwise go stale between
 * restarts, and in this squadron the nickname IS the commander name — the thing
 * officers recognise each other by. Cheap to keep current: the event carries
 * the new value, so this is one write and no fetch.
 */
client.on(Events.GuildMemberUpdate, (_before, after) => {
  if (after.guild.id !== GUILD_ID) return;

  void prisma.discordGuildMember
    .upsert({
      where: { discordId: after.id },
      create: {
        discordId: after.id,
        nick: after.nickname,
        username: after.user.username,
        globalName: after.user.globalName,
        roles: [...after.roles.cache.keys()],
        isBot: after.user.bot,
      },
      update: {
        nick: after.nickname,
        username: after.user.username,
        globalName: after.user.globalName,
        roles: [...after.roles.cache.keys()],
        syncedAt: new Date(),
      },
    })
    .catch((err: unknown) => logger.error({ err }, 'failed to cache member name'));
});

client.on(Events.Error, (err) => logger.error({ err }, 'gateway error'));
client.on(Events.ShardDisconnect, (_e, id) => logger.warn({ shard: id }, 'shard disconnected'));
client.on(Events.ShardReconnecting, (id) => logger.warn({ shard: id }, 'shard reconnecting'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

client.login(TOKEN).catch((err: unknown) => {
  // console.error as well as the logger: pino's transport is a worker thread
  // and process.exit tears it down before it flushes, so a startup failure
  // logged only through pino is a silent exit code 1.
  console.error('bot failed to log in:', err);
  process.exit(1);
});
