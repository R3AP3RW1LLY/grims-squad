import { Client, GatewayIntentBits, Events, type Message, TextChannel } from 'discord.js';
import { PrismaClient } from '@grims/db';
import pino from 'pino';
import { ActivityRecorder, monthKey } from './activity.recorder.js';
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
const ACTIVITY_CHANNEL = process.env['DISCORD_ACTIVITY_CHANNEL_ID'] ?? '';

for (const [name, value] of [
  ['DISCORD_BOT_TOKEN', TOKEN],
  ['DISCORD_GUILD_ID', GUILD_ID],
  ['DISCORD_ACTIVITY_CHANNEL_ID', ACTIVITY_CHANNEL],
] as const) {
  if (value === '') {
    // Refuse rather than idle. A bot that starts, connects and silently records
    // nothing looks healthy in `docker ps` while a month of data goes missing.
    console.error(`bot: ${name} is required`);
    process.exit(1);
  }
}

const CHECKPOINT_KEY = `activity:${ACTIVITY_CHANNEL}`;
/** Discord's epoch, for turning a timestamp into a snowflake. */
const DISCORD_EPOCH = 1420070400000n;

const prisma = new PrismaClient();
const activity = new PrismaActivityStore(prisma);
const checkpoints = new PrismaCheckpointStore(prisma);
const recorder = new ActivityRecorder(activity, { activityChannelId: ACTIVITY_CHANNEL });

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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

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
 * Reads everything posted since the watermark.
 *
 * Runs on every start, so a deploy or a crash does not lose the messages sent
 * while the process was down. Snowflakes are monotonic, so `after` is exact —
 * no message is counted twice and none is skipped.
 */
async function backfill(): Promise<void> {
  const channel = await client.channels.fetch(ACTIVITY_CHANNEL).catch(() => null);
  if (!(channel instanceof TextChannel)) {
    logger.error({ channel: ACTIVITY_CHANNEL }, 'activity channel is not a readable text channel');
    return;
  }

  let after = await checkpoints.get(CHECKPOINT_KEY);
  if (after === null) {
    // First ever run: start at the beginning of the current month rather than
    // the beginning of the channel. Earlier months can never qualify anyway —
    // a member must hold their rank for a WHOLE calendar month — so reading
    // years of history would cost a great many API calls for data that can
    // never change an outcome.
    const start = monthKey(new Date());
    after = String((BigInt(start.getTime()) - DISCORD_EPOCH) << 22n);
    logger.info({ from: start.toISOString() }, 'no checkpoint; backfilling from the start of month');
  }

  let counted = 0;
  let highest = after;

  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, after: highest });
    if (batch.size === 0) break;

    // Oldest first, so the watermark only ever moves forward.
    const ordered = [...batch.values()].sort((a, b) => Number(a.id) - Number(b.id));
    for (const m of ordered) {
      await handle(m);
      if (BigInt(m.id) > BigInt(highest)) highest = m.id;
      counted += 1;
    }
    // Checkpoint after each page. A crash mid-backfill then resumes from where
    // it stopped instead of starting the whole sweep again.
    await checkpoints.set(CHECKPOINT_KEY, highest);
    if (batch.size < 100) break;
  }

  logger.info({ counted, watermark: highest }, 'backfill complete');
}

client.once(Events.ClientReady, (c) => {
  logger.info({ tag: c.user.tag, guilds: c.guilds.cache.size }, 'bot connected');
  void backfill().catch((err: unknown) => logger.error({ err }, 'backfill failed'));
});

client.on(Events.MessageCreate, (msg) => {
  if (msg.guildId !== GUILD_ID) return;
  void handle(msg).then(async () => {
    // Keep the watermark current so a restart does not replay live traffic.
    if (msg.channelId === ACTIVITY_CHANNEL) {
      await checkpoints.set(CHECKPOINT_KEY, msg.id).catch(() => undefined);
    }
  });
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
