import type { Client } from 'discord.js';
import type { PrismaClient } from '@grims/db';
import type pino from 'pino';

/**
 * Delivering announcements to the squadron's channels.
 *
 * ★ THE BOT'S FIRST CHANNEL MESSAGES — A DELIBERATE PROMOTION FROM SILENCE ★
 *
 * Phase 1 made the bot deliberately mute: it recorded activity, granted nothing, said nothing.
 * The owner has now approved it speaking — for EXACTLY the announcement kinds below, into
 * EXACTLY the channels named by environment, and nothing else. It still sends no ad-hoc
 * messages, answers no commands and posts nowhere a variable does not point.
 *
 * ★ POLLING, DELIBERATELY — THE SAME DOCTRINE AS ops-alerts.ts ★
 *
 * A producer writes a row into `announcements`; this polls for unposted rows once a minute.
 * The deploy announcement is WRITTEN during the exact window the bot is being restarted, so a
 * push from the producer would vanish into the restart it describes. A row waits in Postgres
 * for as long as the bot takes to come back, and a minute of latency on "the hub updated"
 * costs nothing.
 *
 * ★ NO CHANNEL ID IN CODE (INV-008) ★
 *
 * The destination comes from DISCORD_ANNOUNCE_CHANNEL_ID / DISCORD_PROMOTIONS_CHANNEL_ID at
 * delivery time. Unset means that kind is NOT posted — the rows wait, and the gap is logged
 * once rather than every minute. Default silent, widened deliberately: the same shape as the
 * DM allowlist, and for the same reason — a bot that posts to a guessed channel cannot be
 * un-posted.
 */

const POLL_MS = 60_000;

/** Discord's hard message length. Anything longer is rejected, not trimmed, by the API. */
export const DISCORD_MESSAGE_LIMIT = 2000;

/**
 * What replaces the cut when a message runs long. A deploy announcement links the changelog
 * anyway, so the honest recovery from "too much shipped to fit" is to say so and point there.
 */
const TRUNCATION_TAIL = '… (full changelog on the site)';

/**
 * Fits content inside Discord's limit, never by crashing.
 *
 * An oversized send is rejected by Discord with an error, the row would stay unposted, and the
 * poller would retry the same rejection every minute forever — an announcement pipeline wedged
 * by its own enthusiasm. Cut once, point at the site, deliver.
 */
export function truncateForDiscord(content: string): string {
  if (content.length <= DISCORD_MESSAGE_LIMIT) return content;
  const keep = DISCORD_MESSAGE_LIMIT - TRUNCATION_TAIL.length - 1;
  return `${content.slice(0, keep).trimEnd()}\n${TRUNCATION_TAIL}`;
}

/**
 * Which environment variable names the channel for a kind.
 *
 * Deploys and verifications share the general announcements channel; promotions have their
 * own. An unrecognised kind falls back to the general channel rather than being dropped — a
 * future producer's rows should wait on configuration, not vanish on a string mismatch.
 */
export function channelEnvFor(
  kind: string,
):
  | 'DISCORD_ANNOUNCE_CHANNEL_ID'
  | 'DISCORD_PROMOTIONS_CHANNEL_ID'
  | 'DISCORD_COLONY_CHANNEL_ID'
  | 'DISCORD_RELEASE_CHANNEL_ID' {
  if (kind === 'promotion') return 'DISCORD_PROMOTIONS_CHANNEL_ID';
  /*
   * ★ RELEASES HAVE THEIR OWN CHANNEL — SQUADRON OWNER, 2026-08-05 ★
   *
   * "we also did not make the app update notification in the channel ... like were supposed to do
   * when we drop a new version of the website or app!"
   *
   * A deploy announcement is a release note: what changed on the website and in the app, with a
   * link to the changelog. That is a different audience from "a commander joined" — people who
   * want to know what moved, rather than everyone. It carries the COMPANION section too, so an app
   * release is announced by the same row.
   *
   * ★ AND WHY THESE NEVER FIRED AT ALL ★
   *
   * Not this routing — the row was never written. `deploy.sh` generates the changelog and the
   * announcement with `node`, and production had no node installed, so every deploy took the
   * "record the changelog by hand" branch and skipped both. Silently, and with a tick beside it.
   * Installed 2026-08-05; from here the deploy writes them itself.
   */
  if (kind === 'deploy') return 'DISCORD_RELEASE_CHANNEL_ID';
  /*
   * ★ COLONISATION HAS ITS OWN CHANNEL — SQUADRON OWNER, 2026-08-05 ★
   *
   * "when a new squadron colonization project is created, can we send a notification to this
   * discord channel please" — a specific channel, not the general announcements one, because a
   * call to haul is aimed at people who want to be told about hauling.
   *
   * The ID stays out of source (INV-008) exactly as the other two do: unset means these rows
   * WAIT rather than being posted somewhere guessed at, and a bot that posts to the wrong
   * channel cannot be un-posted.
   */
  if (kind === 'colony-project') return 'DISCORD_COLONY_CHANNEL_ID';
  return 'DISCORD_ANNOUNCE_CHANNEL_ID';
}

/** The one method this file needs from a channel, structurally — see main.ts on why not the union. */
interface Sendable {
  send(content: string): Promise<unknown>;
}

function isSendable(channel: unknown): channel is Sendable {
  return (
    channel !== null &&
    typeof channel === 'object' &&
    typeof (channel as { send?: unknown }).send === 'function'
  );
}

export function startAnnouncementDelivery(
  client: Client,
  db: PrismaClient,
  logger: pino.Logger,
): void {
  /*
   * Environment variables already complained about. An unset channel is a standing state, not
   * an event — one line says everything, and a line a minute would be the log.
   */
  const complained = new Set<string>();

  const deliver = async (): Promise<void> => {
    const pending = await db.$queryRawUnsafe<
      Array<{ id: bigint; kind: string; content: string }>
    >(
      `SELECT id, kind, content FROM announcements
        WHERE posted_at IS NULL
        ORDER BY created_at
        LIMIT 10`,
    );
    if (pending.length === 0) return;

    for (const row of pending) {
      const envName = channelEnvFor(row.kind);
      const channelId = process.env[envName] ?? '';

      if (channelId === '') {
        // Not configured = not posted. The row waits for the variable, however long that takes.
        if (!complained.has(envName)) {
          complained.add(envName);
          logger.warn(
            { kind: row.kind, env: envName },
            'announcement channel not configured — rows of this kind wait until it is',
          );
        }
        continue;
      }

      try {
        const channel = await client.channels.fetch(channelId);
        if (!isSendable(channel)) {
          // A voice channel, a category, or an id from another guild. Configuration, not weather —
          // but still retried, because the fix is somebody editing the environment.
          logger.error({ kind: row.kind, channelId }, 'announcement channel cannot be sent to');
          continue;
        }
        await channel.send(truncateForDiscord(row.content));
      } catch (err) {
        /*
         * Left unposted ON PURPOSE, unlike an ops-alert DM. A closed DM is one member's inbox;
         * this is the squadron's announcement channel, and a send that failed because Discord
         * was briefly down should land on the next poll rather than never.
         */
        logger.error({ err, kind: row.kind }, 'announcement post failed — will retry');
        continue;
      }

      await db.$executeRawUnsafe(
        `UPDATE announcements SET posted_at = now() WHERE id = $1::bigint`,
        String(row.id),
      );
      logger.info({ kind: row.kind, id: String(row.id) }, 'announcement posted');
    }
  };

  const tick = (): void => {
    void deliver().catch((err: unknown) => {
      // The poller must outlive any single failure — see ops-alerts.ts, whose shape this is.
      logger.error({ err }, 'announcement delivery failed');
    });
  };

  tick();
  setInterval(tick, POLL_MS);
}
