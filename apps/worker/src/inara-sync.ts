import { PrismaClient } from '@grims/db';
import { InaraAdapter, INARA_APP_NAME, INARA_APP_VERSION } from '@grims/ed-clients';
import { expectedSquadronName, sameSquadron } from '@grims/shared';
import { TokenCipher, createKeyring } from '@grims/shared/server';
import { recheckSquadrons } from './jobs/squadron-recheck.js';
import {
  AdapterSquadronSource,
  PrismaSquadronRecheckStore,
} from './jobs/squadron-recheck.wiring.js';
import { syncInaraRanks } from './jobs/inara-rank-sync.js';
import { AdapterInaraSource, PrismaInaraRankStore } from './jobs/inara-rank-sync.wiring.js';

/**
 * The Inara sweep. One shot, every fifteen minutes.
 *
 *   *\/15 * * * *  docker compose run --rm worker pnpm inara:sync
 *
 * A one-shot process for the same reason reconciliation is one: a resident
 * timer has to survive restarts, deploys and clock changes and gets all three
 * subtly wrong, while cron already solves that and is observable from outside
 * the application.
 *
 * Overlap is not a correctness problem here — two concurrent sweeps write the
 * same rows from the same source — but it does double our rate-limit spend for
 * nothing, so the run is kept comfortably under its own interval by batching.
 */
async function main(): Promise<number> {
  const apiKey = process.env['INARA_API_KEY'] ?? '';
  const hasSquadronKey = apiKey !== '' && !apiKey.includes('CHANGE_ME');

  /*
   * ★ THE SQUADRON RE-CHECK RUNS WITHOUT THE SQUADRON KEY ★
   *
   * It reads each member's OWN Inara key, which they supplied when they
   * verified. So a deployment that has never been given a squadron-level key
   * still confirms squadron membership for everybody who linked one — only the
   * rank sweep, which reads PUBLIC profiles, needs the shared key.
   *
   * Attempted first for that reason: bailing out on a missing key would have
   * left members stuck partially verified for a credential their check does not
   * use.
   */
  const prismaForSquadron = new PrismaClient();
  try {
    const report = await recheckSquadrons(
      new PrismaSquadronRecheckStore(prismaForSquadron, new TokenCipher(createKeyring(process.env['TOKEN_ENCRYPTION_KEYRING'] ?? ''))),
      new AdapterSquadronSource(
        new InaraAdapter({
          appName: INARA_APP_NAME,
          appVersion: INARA_APP_VERSION,
          // Only used for the PUBLIC fallback, which is skipped when empty.
          apiKey,
        }),
      ),
      // The comparison rule lives in ONE place. Importing it rather than
      // restating it is what stops this job rejecting a real member over a
      // typographic apostrophe that the website accepts.
      (reported) => sameSquadron(reported, expectedSquadronName()),
    );
    console.error(JSON.stringify({ msg: 'squadron recheck complete', ...report }));
  } catch (err) {
    console.error('squadron recheck failed', err);
  } finally {
    await prismaForSquadron.$disconnect();
  }

  if (!hasSquadronKey) {
    /*
     * Not an error. Inara is optional: a deployment without a key simply has no
     * Inara-sourced ranks, and the roster falls back to the journal.
     *
     * Exits 0 deliberately. Alerting every twenty minutes about a feature
     * nobody has configured is how a monitoring channel gets muted, and a muted
     * channel is worse than no channel.
     */
    console.error(JSON.stringify({ msg: 'inara rank sweep skipped: no squadron API key' }));
    return 0;
  }

  const prisma = new PrismaClient();
  try {
    const report = await syncInaraRanks(
      new PrismaInaraRankStore(prisma),
      new AdapterInaraSource(
        new InaraAdapter({
          appName: INARA_APP_NAME,
          appVersion: INARA_APP_VERSION,
          apiKey,
        }),
      ),
    );

    console.error(JSON.stringify({ msg: 'inara sync complete', ...report }));

    /*
     * Members Inara never answered for are the one outcome worth a non-zero
     * exit. "Not found" is normal — most members have no Inara account — but
     * unanswered means requests are failing, and a sweep that quietly stops
     * refreshing anybody would otherwise look identical to a healthy one.
     */
    return report.unanswered > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('inara sync failed', err);
    process.exitCode = 1;
  });
