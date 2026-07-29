import { PrismaClient } from '@grims/db';
import { DiscordAdapter } from '@grims/ed-clients';
import { ReconcileService } from './jobs/discord-reconcile.js';
import { syncGuildRoles } from './jobs/discord-role-sync.js';
import { classifyGuildRoles } from './jobs/discord-role-classify.js';
import {
  AdapterGuildSource,
  PrismaReconcileStore,
  PrismaRoleCacheStore,
  PrismaClassifyStore,
  WebhookReporter,
} from './jobs/discord-reconcile.wiring.js';

/**
 * The worker's one job today: nightly Discord reconciliation.
 *
 * Runs as a ONE-SHOT process rather than a resident scheduler. A long-lived
 * timer in a container has to survive restarts, deploys and clock changes, and
 * gets all three subtly wrong; the host's cron already solves that and is
 * observable from outside the application. So this starts, reconciles, reports,
 * and exits with a status that cron can act on.
 *
 *   0 3 * * *  docker compose run --rm worker
 */
async function main(): Promise<number> {
  const guildId = process.env['DISCORD_GUILD_ID'] ?? '';
  const botToken = process.env['DISCORD_BOT_TOKEN'] ?? '';

  if (guildId === '' || botToken === '') {
    // Refuse rather than run half-configured. Without a bot token the member
    // list comes back empty, which the service then correctly refuses to act
    // on — but arriving there via a missing variable wastes a night and
    // produces an alarming report about a problem that is really a typo.
    console.error('Reconciliation not configured: DISCORD_GUILD_ID and DISCORD_BOT_TOKEN required.');
    return 2;
  }

  const prisma = new PrismaClient();
  try {
    const source = new AdapterGuildSource(
      new DiscordAdapter({
        clientId: process.env['DISCORD_CLIENT_ID'] ?? '',
        clientSecret: process.env['DISCORD_CLIENT_SECRET'] ?? '',
        botToken,
        // No grantable roles. This job never touches Discord roles — it reads
        // them and changes OUR side. An empty ceiling makes that structural
        // rather than a promise.
        grantableRoleIds: [],
      }),
    );

    /*
     * ★ THE ROLE CACHE HAD NO WRITER AT ALL ★
     *
     * `syncGuildRoles` existed, `PrismaRoleCacheStore` existed, and NOTHING
     * called either of them. So `discord_roles` stayed empty in production and
     * every surface that turns a snowflake into a name came up blank — the
     * roster's role chips, the membership fallback, and the mapping tab, which
     * reported all eighteen mappings as pointing at "a role Discord no longer
     * has".
     *
     * That message was wrong twice over: nothing had changed in Discord, and
     * the cache had simply never been filled by anything.
     *
     * It runs BEFORE reconciliation, which reads roles to decide grants. It is
     * allowed to fail without taking the run down — `syncGuildRoles` never
     * throws — because refreshing names and colours matters far less than
     * getting grants right.
     */
    const roleSync = await syncGuildRoles(source, new PrismaRoleCacheStore(prisma), guildId);
    console.error(JSON.stringify({ msg: 'guild role cache synced', ...roleSync }));

    /*
     * ★ AND THEN DECIDE WHAT EACH ROLE MEANS ★
     *
     * Caching the NAME is only half of it. Every surface that shows roles
     * filters to `rank`, `membership` and `award`, and a freshly synced role
     * defaults to `other` — so without this the roster stays blank even with a
     * full cache. That is exactly what production looked like: 44 roles
     * cached, 0 categorised, nothing on any card.
     *
     * It never overwrites a category already set, so a correction made by hand
     * in the database survives every future run.
     */
    const classified = await classifyGuildRoles(new PrismaClassifyStore(prisma));
    console.error(JSON.stringify({ msg: 'guild roles classified', ...classified }));

    const svc = new ReconcileService(
      source,
      new PrismaReconcileStore(prisma),
      new WebhookReporter(process.env['DISCORD_ADMIN_WEBHOOK_URL'] ?? ''),
      { guildId },
    );

    const report = await svc.run();
    console.error(
      JSON.stringify({
        msg: 'reconciliation complete',
        scanned: report.scanned,
        repaired: report.repaired,
        anomalies: report.anomalies.length,
        aborted: report.aborted,
      }),
    );

    // A refusal is NOT a success. Exiting 0 here would let a job that has been
    // declining to run for a month look healthy in every dashboard.
    return report.aborted ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('reconciliation failed', err);
    process.exitCode = 1;
  });
