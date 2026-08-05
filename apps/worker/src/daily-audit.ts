import { PrismaClient } from '@grims/db';
import { DiscordAdapter, InaraAdapter, INARA_APP_NAME, INARA_APP_VERSION } from '@grims/ed-clients';
import { composeNickname, expectedSquadronName, sameSquadron } from '@grims/shared';
import { TokenCipher, createKeyring } from '@grims/shared/server';
import { auditCommanders } from './jobs/daily-commander-audit.js';
import { takeJobLock, COMMANDER_AUDIT_JOB } from './lib/job-lock.js';
import {
  AdapterAuditSource,
  AdapterNicknameSetter,
  PrismaAuditStore,
} from './jobs/daily-commander-audit.wiring.js';

/**
 * The nightly commander audit. One shot, 00:15 UTC.
 *
 *   15 0 * * *  docker compose run --rm worker pnpm audit:daily
 *
 * ★ WHY 00:15 AND NOT MIDNIGHT ★
 *
 * Promotions run at 00:00 on the first of the month. Starting this at the same
 * instant would have two jobs writing rank state while each reads it, and the
 * loser would sweep with a half-applied ladder — writing nicknames for ranks
 * that were mid-change. Fifteen minutes is not a lock; it is enough separation
 * that the two never overlap in practice, and the audit is idempotent besides.
 *
 * ★ IT AUDITS. IT DOES NOT PUNISH ★
 *
 * A member Inara no longer shows in the squadron is recorded and written to the
 * audit log for an officer to see. Nothing is revoked. Inara membership is
 * self-managed on a third-party site we do not run, and stripping somebody's
 * access at quarter past midnight with nobody watching is not a decision a
 * cron job gets to make.
 */
async function main(): Promise<number> {
  /*
   * ★ ONE AUDIT AT A TIME, WHOEVER STARTED IT — SQUADRON OWNER, 2026-08-02 ★
   *
   * "pressing this should not interupt the daily job."
   *
   * This entrypoint now has two callers: cron at 00:15, and an officer pressing the button on the
   * Squad members page. Without a shared lock the second would start a whole second audit on top of
   * the first — two processes asking Inara about the same members, renaming them, and writing the
   * same audit rows, while spending a request budget that allows two a minute.
   *
   * Declined rather than queued. Exiting 0 is deliberate: nothing failed, and a cron job that
   * emails an operator because somebody pressed a button is a worse outcome than a duplicate run.
   */
  const lock = await takeJobLock(COMMANDER_AUDIT_JOB);
  if (lock === null) {
    console.error(
      JSON.stringify({ msg: 'daily commander audit already running; this request was declined' }),
    );
    return 0;
  }

  try {
    return await audit();
  } finally {
    await lock.release();
  }
}

async function audit(): Promise<number> {
  const guildId = process.env['DISCORD_GUILD_ID'] ?? '';
  const botToken = process.env['DISCORD_BOT_TOKEN'] ?? '';
  const keyring = process.env['TOKEN_ENCRYPTION_KEYRING'] ?? '';

  if (keyring === '') {
    // Without the keyring no member's own Inara key can be decrypted, so the
    // sweep would silently fall back to public lookups for everybody and report
    // a healthy-looking run. Refuse instead.
    console.error('daily audit not configured: TOKEN_ENCRYPTION_KEYRING required.');
    return 2;
  }

  const prisma = new PrismaClient();
  try {
    const report = await auditCommanders(
      new PrismaAuditStore(prisma, new TokenCipher(createKeyring(keyring))),
      new AdapterAuditSource(
        new InaraAdapter({
          appName: INARA_APP_NAME,
          appVersion: INARA_APP_VERSION,
          // Used only for the PUBLIC batch lookup. Members with their own key
          // are read with theirs, so an unset squadron key degrades this job
          // rather than disabling it.
          apiKey: process.env['INARA_API_KEY'] ?? '',
        }),
      ),
      new AdapterNicknameSetter(
        new DiscordAdapter({
          clientId: process.env['DISCORD_CLIENT_ID'] ?? '',
          clientSecret: process.env['DISCORD_CLIENT_SECRET'] ?? '',
          botToken,
          // EMPTY. This job renames people and must never grant a role; an
          // empty ceiling makes that structural rather than a promise.
          grantableRoleIds: [],
        }),
        guildId,
      ),
      (reported) => sameSquadron(reported, expectedSquadronName()),
      composeNickname,
    );

    console.error(JSON.stringify({ msg: 'daily commander audit complete', ...report }));

    /*
     * `unreachable` is the one outcome worth waking somebody for. Departures
     * are real findings for an officer, and refused renames are ordinary facts
     * about a guild (the owner cannot be renamed by a bot) — neither is a
     * malfunction. Requests failing IS.
     */
    return report.unreachable > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('daily commander audit failed', err);
    process.exitCode = 1;
  });
