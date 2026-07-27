import { resolve } from 'node:path';
import { PrismaClient } from '@grims/db';
import { promotionsPermitted, EARLIEST_PROMOTION_AT } from '@grims/shared';
import { PromotionEngine, formatReport } from './jobs/promotion-run.js';
import { readLadderFromSsot, PrismaPromotionStore } from './jobs/promotion-run.wiring.js';
import { WebhookReporter } from './jobs/discord-reconcile.wiring.js';

/**
 * The monthly promotion run.
 *
 *   pnpm --filter @grims/worker promote          # DRY RUN — writes nothing, says nothing
 *   pnpm --filter @grims/worker promote --post   # dry run, and post the report to Discord
 *   pnpm --filter @grims/worker promote --live   # actually promotes
 *
 * THREE separate opt-ins, because they are three separate decisions: running,
 * writing, and telling anybody. A dry run touches nothing and announces
 * nothing.
 *
 * Scheduled for the 1st of each month at 00:00 UTC:
 *   0 0 1 * *
 *
 * --live is REQUIRED for anything to be written, and even then the floor guard
 * refuses before 1 August 2026. Two independent barriers, because the cost of
 * getting this wrong is 49 people publicly promoted on partial data.
 */
async function main(): Promise<number> {
  const live = process.argv.includes('--live');
  // Opt-IN. Silence is the default for both dry and live runs.
  const post = process.argv.includes('--post');
  const repoRoot = resolve(process.cwd(), '../..');

  if (live && !promotionsPermitted(new Date())) {
    // Caught early with a plain message. The engine would refuse anyway — this
    // just means the person who typed --live gets an explanation rather than a
    // stack trace.
    console.error(
      `Refusing: promotions are not permitted until ${EARLIEST_PROMOTION_AT.toISOString()}. ` +
        `Run without --live for a dry run.`,
    );
    return 2;
  }

  const prisma = new PrismaClient();
  try {
    const ladder = readLadderFromSsot(repoRoot);
    const engine = new PromotionEngine(new PrismaPromotionStore(prisma, ladder));

    // dryRun is TRUE unless --live was passed. Note the shape: the safe value
    // is the default, and going live takes a deliberate act.
    const report = await engine.run({ dryRun: !live });
    const text = formatReport(report);

    console.log(text);
    console.log(`\nSkipped (${report.skipped.length}):`);
    for (const s of report.skipped) console.log(`  ${s.handle} [${s.rank}] — ${s.reason}`);

    /*
     * NOTHING IS POSTED TO DISCORD UNLESS --post IS PASSED.
     *
     * A dry run is a rehearsal, and a rehearsal that announces itself to 108
     * people is not one. Posting "Grim would be promoted to Sergeant" into a
     * channel is indistinguishable from an actual promotion to everyone
     * reading it, and unsaying it is far harder than not saying it.
     *
     * So the report goes to the console, and reaches Discord only when someone
     * explicitly asks for it. A live run still does not post by default either
     * — the announcement is a separate decision from the promotion.
     */
    if (post) {
      await new WebhookReporter(process.env['DISCORD_ADMIN_WEBHOOK_URL'] ?? '').report(text, []);
      console.log('\n(Posted to the admin channel.)');
    } else {
      console.log('\n(Not posted to Discord. Pass --post to send this to the admin channel.)');
    }
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('promotion run failed', err);
    process.exitCode = 1;
  });
