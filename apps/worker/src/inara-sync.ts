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
import { loadMemberKeys } from './jobs/member-key-pool.js';

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
  /*
   * ★ THERE IS NO SQUADRON KEY — squadron owner, 2026-07-29 ★
   *
   * Inara issues API keys to PEOPLE. This job was written around a single
   * `INARA_API_KEY` belonging to the squadron, and no such thing exists — so it
   * was never going to be set, and the sweep has been skipping cleanly every
   * fifteen minutes ever since. That is why every pilot rank on the roster is
   * blank for anybody not running the companion app.
   *
   * It now borrows from the members who have linked their own key. The variable
   * is still read, because a deployment MAY have a key in hand for testing and
   * honouring it costs one line — but nothing depends on it.
   */
  const apiKey = process.env['INARA_API_KEY'] ?? '';
  const hasStaticKey = apiKey !== '' && !apiKey.includes('CHANGE_ME');

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

  const prisma = new PrismaClient();
  try {
    const pool = await loadMemberKeys(
      prisma,
      new TokenCipher(createKeyring(process.env['TOKEN_ENCRYPTION_KEYRING'] ?? '')),
    );

    if (pool.size === 0 && !hasStaticKey) {
      /*
       * Not an error. Nobody has linked an Inara key yet, so there is nothing to
       * call with and the roster falls back to journal ranks.
       *
       * Exits 0 deliberately. Alerting every fifteen minutes about a feature
       * nobody has configured is how a monitoring channel gets muted, and a
       * muted channel is worse than no channel.
       */
      console.error(
        JSON.stringify({ msg: 'inara rank sweep skipped: no member has linked an Inara key' }),
      );
      return 0;
    }

    console.error(JSON.stringify({ msg: 'inara rank sweep starting', keys: pool.size }));

    const report = await syncInaraRanks(
      new PrismaInaraRankStore(prisma),
      new AdapterInaraSource(
        new InaraAdapter({
          appName: INARA_APP_NAME,
          appVersion: INARA_APP_VERSION,
          /*
           * The static key is the FALLBACK, and only when the pool is empty.
           * Preferring it would put the squadron's whole rate spend on one key
           * even when a dozen members had offered theirs.
           */
          apiKey,
          ...(pool.size > 0 ? { apiKeyPool: pool } : {}),
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
