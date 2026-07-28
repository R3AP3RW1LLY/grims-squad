import { PrismaClient } from '@grims/db';
import { InaraAdapter, INARA_APP_NAME, INARA_APP_VERSION } from '@grims/ed-clients';
import { syncInaraRanks } from './jobs/inara-rank-sync.js';
import { AdapterInaraSource, PrismaInaraRankStore } from './jobs/inara-rank-sync.wiring.js';

/**
 * The Inara sweep. One shot, every twenty minutes.
 *
 *   *\/20 * * * *  docker compose run --rm worker pnpm inara:sync
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

  if (apiKey === '' || apiKey.includes('CHANGE_ME')) {
    /*
     * Not an error. Inara is optional: a deployment without a key simply has no
     * Inara-sourced ranks, and the roster falls back to the journal.
     *
     * Exits 0 deliberately. Alerting every twenty minutes about a feature
     * nobody has configured is how a monitoring channel gets muted, and a muted
     * channel is worse than no channel.
     */
    console.error(JSON.stringify({ msg: 'inara sync skipped: no API key configured' }));
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
