import { PrismaClient } from '@grims/db';
import { RoleSyncService } from './jobs/role-sync.service.js';
import { PrismaRoleSyncStore, membersToSync } from './jobs/role-sync.wiring.js';

/**
 * Discord roles onto platform roles. Every minute.
 *
 * ★ THIS HAD NEVER RUN ★
 *
 * `RoleSyncService` was written, documented and unit-tested months ago. It was
 * never instantiated anywhere, and the only implementation of its store was an
 * in-memory fake for its own tests. So nothing in the platform granted a role
 * from Discord except the nightly reconciliation — a member promoted in Discord
 * at 09:00 held nothing until 03:00 the following morning.
 *
 * Squadron owner's instruction, 2026-07-29: every minute.
 *
 * ★ WHY THAT IS AFFORDABLE ★
 *
 * It touches Discord not at all. `discord_guild_members` is kept current by the
 * bot from gateway events, so this reads roles that are already fresh. Asking
 * Discord for 109 members every minute would be 157,000 requests a day and
 * would be rate-limited into uselessness within the hour.
 *
 * What it costs is a handful of indexed queries, and it writes only when
 * something actually differs.
 */
async function main(): Promise<number> {
  const prisma = new PrismaClient();

  try {
    const svc = new RoleSyncService(new PrismaRoleSyncStore(prisma));
    const members = await membersToSync(prisma);

    let granted = 0;
    let revoked = 0;
    let failed = 0;

    for (const member of members) {
      try {
        const result = await svc.sync(member.userId, member.discordRoleIds);
        granted += result.granted.length;
        revoked += result.revoked.length;
      } catch {
        /*
         * One member's failure must not abandon the rest.
         *
         * This runs every minute, so a transient error costs that member sixty
         * seconds — whereas aborting the sweep would leave everybody after them
         * unsynced for the same minute, and the next run would hit the same row
         * first and do it again.
         */
        failed += 1;
      }
    }

    /*
     * Logged ONLY when something happened, or something failed.
     *
     * At once a minute a line per run is 1,440 a day saying nothing changed,
     * which is how a log stops being read — and this job's whole value is that
     * somebody notices when it stops.
     */
    if (granted > 0 || revoked > 0 || failed > 0) {
      console.error(
        JSON.stringify({
          msg: 'role sync complete',
          members: members.length,
          granted,
          revoked,
          failed,
        }),
      );
    }

    // A member we could not sync is not a success. Non-zero puts it in cron's
    // mail rather than leaving a job that has been failing silently for weeks.
    return failed > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('role sync failed', err);
    process.exitCode = 1;
  });
