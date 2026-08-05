import {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
  type Collection,
  type Message,
  type GuildBasedChannel,
  type User,
} from 'discord.js';
import { PrismaClient } from '@grims/db';
import { composeNickname, overrideActionFor, LEADERSHIP_CEILING } from '@grims/shared';
import pino from 'pino';
import { ActivityRecorder, endsVoiceSession, monthKey } from './activity.recorder.js';
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
import { startOpsAlertDelivery } from './ops-alerts.js';
import { startAnnouncementDelivery } from './announcements.js';

/**
 * The squadron bot. It records activity, DMs ops alerts, and posts announcements.
 *
 * It grants no roles and promotes nobody. Phase 1 kept it entirely mute; the
 * owner has since approved exactly two ways of speaking, both delivery of rows
 * other processes wrote: ops-alert DMs to the webmaster, and announcement posts
 * into the channels named by environment (announcements.ts). It still answers
 * no commands and composes no copy of its own.
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

/**
 * How long to wait before trying the role list again.
 *
 * ★ IT RETRIES FOREVER, AND THAT IS THE POINT ★
 *
 * Everything below depends on this list. Without it the scope rule sees a channel with no viewers,
 * takes the conservative branch, and counts nothing — for as long as the process lives.
 */
const ROLE_RETRY_MS = 30_000;

/**
 * Where the admin console reads the bot's own place in the role hierarchy.
 *
 * A plain config key rather than a column: it is one integer about the BOT, not about any member,
 * and it changes only when somebody drags a role in Discord.
 */
const BOT_ROLE_POSITION_KEY = 'discord.bot_role_position';

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

  /*
   * ★ WHERE THE BOT SITS IN THE ROLE HIERARCHY ★
   *
   * Squadron owner, 2026-08-01, asked for kick, ban and timeout on the Squad Members roster.
   * Discord refuses ALL THREE against anybody whose highest role sits at or above the bot's own,
   * whatever permissions the bot holds. Measured on this guild: the bot's top role is `Assistant`
   * at position 41, so `Admin` (42) and `YAGPDB.xyz` (43) are out of reach.
   *
   * Published here so the roster can grey those rows out and SAY SO, rather than offering a button
   * that always returns 403. An officer who is told "this person outranks the bot" can fix it in
   * Server Settings; an officer shown a shrug tries three more members and reports the page broken.
   *
   * Written on every role load, so moving the bot's role in Discord is reflected on the next
   * reconnect rather than needing a deploy.
   */
  const position = guild.members.me?.roles.highest.position ?? 0;
  await prisma.siteConfig
    .upsert({
      where: { key: BOT_ROLE_POSITION_KEY },
      create: { key: BOT_ROLE_POSITION_KEY, value: position },
      update: { value: position },
    })
    .catch((err: unknown) => logger.warn({ err }, 'could not publish the bot role position'));

  logger.info(
    {
      roles: roleScope.length,
      privileged: roleScope.filter((r) => r.isPrivileged).length,
      botRolePosition: position,
    },
    'role scope loaded',
  );
}

/**
 * Loads the role list, and keeps trying until it has one.
 *
 * ★ THE FAILURE THIS EXISTS TO STOP HAD ALREADY HAPPENED ★
 *
 * `loadRoles` was called once, on ready, with a `.catch` that logged and moved on. The comment
 * beside it correctly said that classifying against an empty role list "marks every channel
 * admin-gated and records nothing at all" — and then left exactly that outcome reachable, because a
 * single transient failure to fetch roles produced an empty list that nothing ever refilled.
 *
 * Discord message recording stopped on 2026-07-29 and nobody could tell: no error after the first
 * line, no gap in the logs, the bot connected and responsive, and a member activity table that
 * simply stopped growing. Reported nearly three days later as "no Discord activity for August".
 *
 * A conservative default is right. A conservative default that can be entered by accident and never
 * left is not a safety measure, it is an outage with good manners.
 */
async function loadRolesUntilLoaded(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await loadRoles();
      if (roleScope.length > 0) return;
      logger.error({ attempt }, 'role scope came back EMPTY — nothing would be counted; retrying');
    } catch (err) {
      logger.error({ err, attempt }, 'could not load the role scope; retrying');
    }
    await new Promise((r) => setTimeout(r, ROLE_RETRY_MS));
  }
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

/**
 * Discord ids whose name this process has already written.
 *
 * `rememberAuthor` runs on every message, live and backfilled. Without this it would be a database
 * write per message — 839 of them on the sweep that recovered July — to store the same hundred-odd
 * names over and over.
 */
const authorsWritten = new Set<string>();

/**
 * Records the name attached to a message, so the author is never just a number.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "we have users that appear looking like this: 820808610073280512 howcome?"
 *
 * Because names came from ONE place — the live guild member list, swept at startup — and activity
 * comes from another. Anybody who posted and then left the squadron had months of real activity and
 * no row to put a name on, so the table showed the snowflake. Six of them, and the officer reading
 * that page has no way to tell whether 820808610073280512 was a recruit worth chasing or a spammer.
 *
 * The comment on `syncMemberNames` says "a member who leaves keeps their row". True — but only for
 * somebody the sweep saw at least once. Leave before the bot's first run, or before it was ever
 * granted the members intent, and there was never a row to keep.
 *
 * ★ THE MESSAGE ALREADY CARRIES THE ANSWER ★
 *
 * Every message has its author's `username` and `globalName` on it, whether or not that person is
 * still in the guild. Taking the name from the same record that produced the count means the two can
 * no longer disagree — which is the only reason they ever did.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT WRITE ★
 *
 * `nick` and `roles`. Both are properties of guild MEMBERSHIP, not of a user, and a message does not
 * carry them for someone who has left. Writing null over a current member's nickname would trade one
 * missing name for a hundred.
 */
async function rememberAuthor(user: User | null | undefined): Promise<void> {
  if (user === null || user === undefined || authorsWritten.has(user.id)) return;
  authorsWritten.add(user.id);

  await prisma.discordGuildMember
    .upsert({
      where: { discordId: user.id },
      create: {
        discordId: user.id,
        username: user.username,
        globalName: user.globalName,
        isBot: user.bot,
      },
      update: { username: user.username, globalName: user.globalName, isBot: user.bot },
    })
    .catch((err: unknown) => {
      // Best effort, and it must stay that way: a name is worth less than the count beside it, and
      // the count is what a promotion decision is made on.
      authorsWritten.delete(user.id);
      logger.debug({ err, discordId: user.id }, 'could not record author name');
    });
}

async function handle(msg: Message): Promise<void> {
  try {
    await rememberAuthor(msg.author);
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
        await rememberAuthor(m.author);
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
          joinedAt: m.joinedAt,
          timeoutUntil: m.communicationDisabledUntil,
        },
        update: {
          nick: m.nickname,
          username: m.user.username,
          globalName: m.user.globalName,
          roles: [...m.roles.cache.keys()],
          isBot: m.user.bot,
          /*
           * ★ HOW LONG THEY HAVE BEEN IN THE SQUADRON ★
           *
           * Squadron owner, 2026-08-01, asked whether it could come from the Inara roster. It
           * cannot: Inara's only commander endpoint returns a squadron NAME and RANK and no dates,
           * and there is no roster endpoint. The game does not record it either. Discord does, to
           * the second, and it arrives on the member objects this sweep already has — so it costs
           * nothing on top of what this loop was already doing.
           *
           * Rewritten every sweep rather than written once. Discord discards this when somebody
           * leaves, so a member who left and came back has a genuinely new date, and pinning the
           * old one would claim a continuous membership that did not happen.
           */
          joinedAt: m.joinedAt,
          /*
           * ★ MIRRORED, NOT DECIDED ★
           *
           * Discord owns the timeout and expires it silently. Writing it here means the Squad
           * Members roster is one database read instead of a rate-limited call to Discord on every
           * page load — and null is written back when a timeout is lifted, which is what makes the
           * roster correct rather than merely fast.
           */
          timeoutUntil: m.communicationDisabledUntil,
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

/** Never ask Discord for more than this many names in one start. */
const MAX_NAME_LOOKUPS = 200;

/**
 * Puts a name on activity that already has none.
 *
 * ★ WHY `rememberAuthor` IS NOT ENOUGH ON ITS OWN ★
 *
 * It only names people as they post. The six unnamed ids the owner found had posted in JULY, and the
 * backfill reads the current month only — their messages are behind a watermark that has long since
 * moved past. Nothing will ever re-read them, so nothing will ever name them.
 *
 * ★ A USER IS NOT A MEMBER ★
 *
 * `guild.members.fetch` cannot help: these people are not in the guild, which is the whole reason
 * they have no row. `client.users.fetch` reads the USER, which Discord still serves after somebody
 * leaves — and that is exactly the record needed here.
 *
 * ★ IT RUNS EVERY START, AND COSTS NOTHING WHEN THERE IS NOTHING TO DO ★
 *
 * One indexed query returning zero rows. It is written as a reconciliation rather than a one-off
 * repair because the same gap opens again for any historical month imported later, and a repair that
 * has to be remembered is a repair that will not be run.
 */
async function nameUnknownAuthors(): Promise<void> {
  const unknown = await prisma
    .$queryRaw<{ discord_id: string }[]>`
      SELECT DISTINCT a.discord_id
        FROM (SELECT discord_id FROM member_activity_months
              UNION SELECT discord_id FROM member_activity_days) a
        LEFT JOIN discord_guild_members m ON m.discord_id = a.discord_id
       WHERE m.discord_id IS NULL
          OR (m.nick IS NULL AND m.username IS NULL AND m.global_name IS NULL)
       LIMIT ${MAX_NAME_LOOKUPS}`
    .catch((err: unknown) => {
      logger.error({ err }, 'could not look for unnamed activity');
      return [];
    });

  if (unknown.length === 0) return;

  let named = 0;
  let gone = 0;

  for (const row of unknown) {
    const user = await client.users.fetch(row.discord_id).catch(() => null);
    if (user === null) {
      // A deleted account. Discord has nothing left to give, and the activity stays under its id —
      // which is honest: there is no name, rather than a name we made up.
      gone += 1;
      continue;
    }

    await rememberAuthor(user).then(() => {
      named += 1;
    });
  }

  logger.info({ named, unresolved: gone }, 'named activity that had no name');
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

/**
 * Records that somebody has left voice, and returns WHEN they had joined.
 *
 * The read comes first because the update erases it, and the caller needs it: `inVoiceSince`
 * is the start of the session whose minutes are about to be banked. Null when the bot never
 * saw the join — a restart wipes presence — in which case the recorder banks nothing rather
 * than guessing.
 */
async function markLeftVoice(discordId: string): Promise<Date | null> {
  const existing = await prisma.discordGuildMember.findUnique({
    where: { discordId },
    select: { inVoiceSince: true },
  });

  /*
   * `updateMany`, not `update`. Prisma's `update` throws when the row is
   * missing, and a member who left voice but was never cached is an ordinary
   * situation rather than an error worth a log line.
   */
  await prisma.discordGuildMember.updateMany({
    where: { discordId },
    data: { inVoiceSince: null },
  });

  return existing?.inVoiceSince ?? null;
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

/*
 * ★ `on`, NOT `once` ★
 *
 * discord.js emits this again after a full reconnect. With `once`, a bot that dropped its gateway
 * and came back had whatever role scope it happened to be holding — including an empty one — and no
 * further chance to fix it.
 *
 * Everything in the chain below is idempotent, so running it again on a reconnect costs a few
 * queries and removes a class of silent failure.
 */
client.on(Events.ClientReady, (c) => {
  logger.info({ tag: c.user.tag, guilds: c.guilds.cache.size }, 'bot connected');

  // The ops-alert DM poller. Independent of the role/backfill sweep below on purpose: a delivery
  // path for "the pipeline is down" must not wait behind, or die with, anything else.
  startOpsAlertDelivery(c, prisma, logger);

  // The announcement poller — deploys, promotion orders and verified-member welcomes, from the
  // `announcements` table into the channels named by environment. Same independence, same reason:
  // the deploy announcement is written during the exact window this process is being restarted.
  startAnnouncementDelivery(c, prisma, logger);

  // Roles FIRST, and until they load. The scope rule cannot classify a channel without them, and
  // classifying against an empty role list marks every channel admin-gated and records nothing at
  // all — see loadRolesUntilLoaded for the outage that caused.
  void loadRolesUntilLoaded()
    .then(() => syncMemberNames())
    .then(() => nameUnknownAuthors())
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
    /*
     * The destination, ONLY when it counts toward activity. The scope decision is made once,
     * here, so presence, the session clock and the ends-the-session rule all agree about what
     * "in voice" means — a member sitting in an admin-only channel is not somewhere the roster
     * reports on, and leaking "in voice channel" from a private room would disclose that a
     * closed meeting is happening.
     */
    const countedTo =
      after.channelId !== null &&
      after.channel !== null &&
      countsTowardActivity(describe(after.channel), roleScope)
        ? after.channelId
        : null;

    if (countedTo !== null) {
      /*
       * A join, or a MOVE between counted rooms. `markInVoice` keeps the original timestamp on
       * a move, so the session continues — walking from comms to ops is not leaving, and the
       * minutes keep counting against the one session.
       */
      void markInVoice(after.id, after.member?.user.bot ?? false).catch((err: unknown) =>
        logger.error({ err }, 'failed to record voice presence'),
      );
    } else {
      /*
       * They are no longer somewhere the roster reports on — left voice, or moved into a room
       * that does not count. Either way the old presence must not linger, and when a counted
       * session was actually running (`endsVoiceSession`: they CAME from a channel, not from
       * nowhere), its minutes are settled into the month bank first. The read-then-clear order
       * lives in `markLeftVoice`, which hands back the session start the clear erases.
       */
      const ends = endsVoiceSession(before.channelId, countedTo);
      void markLeftVoice(after.id)
        .then((since) =>
          ends
            ? recorder.onVoiceLeave({
                discordId: after.id,
                isBot: after.member?.user.bot ?? false,
                since,
                at: new Date(),
              })
            : undefined,
        )
        .catch((err: unknown) => logger.error({ err }, 'failed to settle a voice session'));
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

/**
 * How often to complain that nothing can be counted. Once a minute is enough to be findable in a
 * log and infrequent enough not to become the log.
 */
const SCOPE_COMPLAINT_MS = 60_000;
let lastScopeComplaint = 0;

client.on(Events.MessageCreate, (msg) => {
  if (msg.guildId !== GUILD_ID) return;

  /*
   * ★ AN EMPTY ROLE SCOPE IS AN INCIDENT, NOT A QUIET SKIP ★
   *
   * Without roles every channel resolves to "no viewers", the scope rule takes its conservative
   * branch, and every message is dropped. That is the correct decision on bad data and a disaster
   * to make silently — it is precisely how three days of squadron activity went unrecorded with
   * nothing anywhere saying so.
   *
   * `loadRolesUntilLoaded` should make this unreachable. This is here because "should be
   * unreachable" is the description of every outage nobody had a log line for.
   */
  if (roleScope.length === 0) {
    const now = Date.now();
    if (now - lastScopeComplaint > SCOPE_COMPLAINT_MS) {
      lastScopeComplaint = now;
      logger.error('role scope is EMPTY — no activity is being recorded for anybody');
    }
    return;
  }

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
 * ★ SOMEBODY JOINING IS THE ONLY MOMENT THIS IS FREE ★
 *
 * Without this, a new member gets no row until the next restart's sweep. `rememberAuthor` would
 * create one on their first message, but a message carries a USER, and a user has no join date — so
 * the row would exist with a null tenure and look like an ex-member until somebody redeployed.
 *
 * The event carries the member. One write, no fetch, and the roster is right from the minute they
 * arrive, which is exactly when an officer is most likely to go looking for them.
 */
client.on(Events.GuildMemberAdd, (member) => {
  if (member.guild.id !== GUILD_ID) return;

  void prisma.discordGuildMember
    .upsert({
      where: { discordId: member.id },
      create: {
        discordId: member.id,
        nick: member.nickname,
        username: member.user.username,
        globalName: member.user.globalName,
        roles: [...member.roles.cache.keys()],
        isBot: member.user.bot,
        joinedAt: member.joinedAt,
        timeoutUntil: member.communicationDisabledUntil,
      },
      update: {
        nick: member.nickname,
        username: member.user.username,
        globalName: member.user.globalName,
        roles: [...member.roles.cache.keys()],
        // A REJOIN overwrites the old date, which is the honest answer: Discord has discarded the
        // first spell and there is no way to recover it. See the schema note on this column.
        joinedAt: member.joinedAt,
        timeoutUntil: member.communicationDisabledUntil,
        syncedAt: new Date(),
      },
    })
    .catch((err: unknown) => logger.error({ err }, 'failed to record a joining member'));
});

/*
 * A nickname change is the one thing that would otherwise go stale between
 * restarts, and in this squadron the nickname IS the commander name — the thing
 * officers recognise each other by. Cheap to keep current: the event carries
 * the new value, so this is one write and no fetch.
 */
/**
 * Records a nickname an officer set for themselves.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "if they update it in discord, it should also update here and not change back!"
 *
 * ★ WHY THIS COMPARES AGAINST THE CONVENTION ★
 *
 * Our OWN renames fire this same event. Recording every change would mean the first time the
 * nightly sweep corrected somebody, they acquired an override and were never corrected again — the
 * convention disabling itself one member at a time. `overrideActionFor` decides; the reasoning
 * lives with it in @grims/shared, next to its tests.
 *
 * Everything here is best-effort. A member renaming themselves must never fail because we could
 * not write a row about it.
 */
async function captureNicknameChoice(discordId: string, newNick: string | null): Promise<void> {
  const identity = await prisma.discordIdentity.findUnique({
    where: { discordId },
    select: { userId: true },
  });

  // No website account, so nothing to record against. Most of the guild is in this state.
  if (identity === null) return;

  const [user, verification, member, mappings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: identity.userId },
      select: { nicknameOverride: true, nicknameOverrideAllowed: true },
    }),
    prisma.cmdrVerification.findFirst({
      where: { userId: identity.userId, isVerified: true, revokedAt: null },
      select: { cmdrName: true },
    }),
    prisma.discordGuildMember.findUnique({ where: { discordId }, select: { roles: true } }),
    prisma.roleMapping.findMany({
      where: { role: { isHierarchical: true } },
      select: { discordRoleId: true, role: { select: { rankOrder: true } } },
    }),
  ]);

  if (user === null) return;

  /*
   * ★ WHO MAY OVERRIDE ★
   *
   * An OFFICER by rank — below LEADERSHIP_CEILING, which is Squadron Leader up to Galactic Admiral
   * — or anybody an officer has granted the right to. Read from the roles they WEAR rather than
   * granted internal roles, for the same reason the rank prefix always was: grants only exist for
   * an account that has been reconciled, and the guild is the authority on who is an officer.
   */
  const rankByRoleId = new Map(mappings.map((m) => [m.discordRoleId, m.role.rankOrder]));
  const isOfficer = (member?.roles ?? []).some((id) => {
    const order = rankByRoleId.get(id);
    return order !== undefined && order !== null && order < LEADERSHIP_CEILING;
  });

  const action = overrideActionFor({
    newNick,
    conventionNick:
      verification === null ? null : composeNickname(null, verification.cmdrName),
    mayOverride: isOfficer || user.nicknameOverrideAllowed,
  });

  if (action === 'ignore') return;

  // Nothing to do, and writing anyway would put a fresh timestamp on an unchanged decision.
  if (action === 'clear' && user.nicknameOverride === null) return;
  if (action === 'set' && user.nicknameOverride === newNick) return;

  await prisma.user.update({
    where: { id: identity.userId },
    data:
      action === 'clear'
        ? { nicknameOverride: null, nicknameOverrideAt: null, nicknameOverrideSource: null }
        : {
            nicknameOverride: newNick,
            nicknameOverrideAt: new Date(),
            // `discord` rather than `web`: somebody who renamed themselves in the guild may not
            // realise they have opted out of the convention at all, and an officer reading the
            // audit later should be able to tell the two apart.
            nicknameOverrideSource: 'discord',
          },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: identity.userId,
        action: action === 'clear' ? 'discord.nickname.override.cleared' : 'discord.nickname.override.set',
        targetType: 'user',
        targetId: identity.userId,
        before: { nickname: user.nicknameOverride } as never,
        after: { nickname: newNick, source: 'discord' } as never,
      },
    })
    .catch(() => undefined);
}

client.on(Events.GuildMemberUpdate, (before, after) => {
  if (after.guild.id !== GUILD_ID) return;

  /*
   * Only when the NICKNAME moved. This event also fires for roles, timeouts and avatar changes, and
   * re-deciding on each of those would put a fresh timestamp on a decision nobody made.
   */
  if (before.nickname !== after.nickname) {
    void captureNicknameChoice(after.id, after.nickname).catch((err: unknown) =>
      logger.error({ err }, 'failed to record a self-chosen nickname'),
    );
  }

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
        joinedAt: after.joinedAt,
        timeoutUntil: after.communicationDisabledUntil,
      },
      update: {
        nick: after.nickname,
        username: after.user.username,
        globalName: after.user.globalName,
        roles: [...after.roles.cache.keys()],
        joinedAt: after.joinedAt,
        // The event that carries a timeout being APPLIED or LIFTED. Without this the roster would
        // only learn about either on the next restart.
        timeoutUntil: after.communicationDisabledUntil,
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
