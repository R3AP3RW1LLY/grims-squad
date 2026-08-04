import type { Client } from 'discord.js';
import type { PrismaClient } from '@grims/db';
import type pino from 'pino';

/**
 * Delivering operational alerts as Discord DMs.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * Asked how a dead collector or a failed dump should announce itself: "Discord DM + site banner".
 * The banner half already lives on the logistics pages; this is the DM half.
 *
 * ★ POLLING, DELIBERATELY ★
 *
 * The worker writes a row into `ops_alerts`; this polls for undelivered rows once a minute. Not a
 * LISTEN/NOTIFY, and not an HTTP call from the worker — an alert about infrastructure being down
 * has to survive infrastructure being down. A row waits in Postgres for as long as the bot takes
 * to come back; a notification sent while the bot was down would have vanished into the exact
 * outage it was reporting. A minute of latency on a "your feed died" message costs nothing.
 *
 * ★ WHO GETS IT ★
 *
 * Holders of the WEBMASTER role, resolved at delivery time from the same tables that gate the
 * admin console — never a hard-coded id (INV-008). The owner's standing rule is "DM ME only", and
 * the owner is the webmaster; expressed as the ROLE so it keeps being true if that ever changes.
 */

const POLL_MS = 60_000;

export function startOpsAlertDelivery(
  client: Client,
  db: PrismaClient,
  logger: pino.Logger,
): void {
  const deliver = async (): Promise<void> => {
    const pending = await db.$queryRawUnsafe<
      Array<{ id: string; kind: string; message: string; created_at: Date }>
    >(
      `SELECT id, kind, message, created_at FROM ops_alerts
        WHERE delivered_at IS NULL
        ORDER BY created_at
        LIMIT 10`,
    );
    if (pending.length === 0) return;

    const recipients = await db.$queryRawUnsafe<Array<{ discord_id: string }>>(
      `SELECT di.discord_id
         FROM discord_identities di
         JOIN user_roles ur ON ur.user_id = di.user_id
         JOIN roles r ON r.id = ur.role_id
        WHERE r.key = 'webmaster'`,
    );

    for (const alert of pending) {
      let sent = 0;
      for (const r of recipients) {
        try {
          const user = await client.users.fetch(r.discord_id);
          await user.send(
            `**Grim's Squad — ${alert.kind}**\n${alert.message}\n-# ${alert.created_at.toISOString()}`,
          );
          sent += 1;
        } catch (err) {
          // A member with DMs closed is not a delivery failure of the SYSTEM. Logged and carried on.
          logger.warn({ err, alert: alert.kind, to: r.discord_id }, 'ops alert DM refused');
        }
      }

      /*
       * Marked delivered even when zero DMs landed — after the attempts, the row has had its
       * chance. Retrying a closed DM every minute for ever would be a different bug, and the log
       * above records what happened. A NULL recipients list (no webmaster yet) is the one shape
       * left undelivered on purpose: the role appearing later should still get the backlog.
       */
      if (recipients.length > 0) {
        await db.$executeRawUnsafe(
          `UPDATE ops_alerts SET delivered_at = now() WHERE id = $1::uuid`,
          alert.id,
        );
        logger.info({ alert: alert.kind, sent }, 'ops alert delivered');
      }
    }
  };

  const tick = (): void => {
    void deliver().catch((err: unknown) => {
      // The poller must outlive any single failure — it is the last line of announcement.
      logger.error({ err }, 'ops alert delivery failed');
    });
  };

  tick();
  setInterval(tick, POLL_MS);
}
