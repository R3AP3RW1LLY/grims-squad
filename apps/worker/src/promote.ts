import { resolve, join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { announcePromotionOrders, monthYearLabel, notifyMembers, PrismaClient } from '@grims/db';
import { notificationNudge } from './lib/live-notify.js';
import { DiscordAdapter } from '@grims/ed-clients';
import { promotionsPermitted, EARLIEST_PROMOTION_AT } from '@grims/shared';
import { PromotionEngine, formatReport } from './jobs/promotion-run.js';
import { readLadderFromSsot, PrismaPromotionStore } from './jobs/promotion-run.wiring.js';
import { WebhookReporter } from './jobs/discord-reconcile.wiring.js';
import { DiscordRankApplier, ladderRoleIds } from './jobs/rank-applier.discord.js';

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
/**
 * Where `ssot/` actually is.
 *
 * ★ THIS WAS `resolve(process.cwd(), '../..')` AND IT BROKE IN THE CONTAINER ★
 *
 * That is correct when the job is started from `apps/worker`, which is what
 * `pnpm promote` does. The production image runs `node apps/worker/dist/promote.js`
 * from `/app`, so it resolved to `/` and the job died on
 * `ENOENT /ssot/02-domain/rank-progression.yaml`.
 *
 * It would have died at midnight on 1 August, on the one run that matters, and
 * the only sign would have been a line in cron's mail.
 *
 * Walking UP looking for the file itself works in both layouts and in any
 * future one — it asks the question that actually matters ("where is the
 * ladder") instead of assuming a directory depth.
 */
function findRepoRoot(): string {
  let dir = process.cwd();

  for (;;) {
    if (existsSync(join(dir, 'ssot', '02-domain', 'rank-progression.yaml'))) return dir;

    const parent = dirname(dir);
    // `dirname('/')` is `/`, so this is the filesystem root and there is
    // nothing above it to check.
    if (parent === dir) break;
    dir = parent;
  }

  /*
   * Fall back to the old behaviour rather than throwing here. The caller reads
   * the ladder and fails with its own message naming the file, which is more
   * use than "could not find the repo root" from a function nobody knew ran.
   */
  return resolve(process.cwd(), '../..');
}

async function main(): Promise<number> {
  const live = process.argv.includes('--live');
  // Opt-IN. Silence is the default for both dry and live runs.
  const post = process.argv.includes('--post');
  const repoRoot = findRepoRoot();

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

    /*
     * The Discord applier is built ONLY for a live run.
     *
     * A dry run must not construct something that can change roles at all —
     * not because it would be used, but because "the object exists and nothing
     * calls it" is a weaker guarantee than "the object does not exist". Before
     * August every run is a dry run, so this stays null.
     */
    const guildId = process.env['DISCORD_GUILD_ID'] ?? '';
    const applier = live
      ? new DiscordRankApplier(
          prisma,
          new DiscordAdapter({
            clientId: process.env['DISCORD_CLIENT_ID'] ?? '',
            clientSecret: process.env['DISCORD_CLIENT_SECRET'] ?? '',
            botToken: process.env['DISCORD_BOT_TOKEN'] ?? '',
            // EXACTLY the ten ladder ranks, derived from the mappings table.
            // The bot outranks every leadership role in the guild, so Discord's
            // own hierarchy check would not stop it handing out Galactic
            // Admiral — this ceiling is ours.
            grantableRoleIds: await ladderRoleIds(prisma),
          }),
          guildId,
        )
      : undefined;

    const engine = new PromotionEngine(new PrismaPromotionStore(prisma, ladder), applier);

    // dryRun is TRUE unless --live was passed. Note the shape: the safe value
    // is the default, and going live takes a deliberate act.
    const report = await engine.run({ dryRun: !live });
    const text = formatReport(report);

    /*
     * ★ promotion.rank — THE MEMBERS THEMSELVES, ON A LIVE RUN ONLY ★
     *
     * A dry run promoted nobody and must say nothing — the same reasoning as the --post gate
     * below, one layer more personal. Who was ACTUALLY promoted is the eligible list minus the
     * refusals: the engine moves anyone Discord refused into `failed`, and their rank did not
     * change. Same wording as the admin console's path (promotions.service.ts) on purpose — a
     * member must not be able to tell which door promoted them from the notice.
     *
     * `notifyMembers` swallows its own failures; the promotions are written by now, and a bell
     * must never turn a completed run into a non-zero exit.
     */
    if (live) {
      const refused = new Set(report.failed.map((f) => f.userId));
      for (const p of report.wouldPromote) {
        if (refused.has(p.userId)) continue;
        await notifyMembers(
          prisma,
          [p.userId],
          {
            kind: 'promotion.rank',
            title: `Promoted to ${p.to}`,
            body: `Your rank has advanced from ${p.from} to ${p.to}. Congratulations, Commander.`,
            link: '/roster',
          },
          notificationNudge,
        );
      }

      /*
       * ★ THE PROMOTION ORDERS — ONE ANNOUNCEMENT PER RUN, LIVE RUNS ONLY ★
       *
       * The same eligible-minus-refused list as the personal notices above, written once into
       * `announcements` for the bot to post in the promotions channel and the API to carbon-copy
       * into the forum. A dry run promoted nobody and announces nothing — identical reasoning to
       * the --post gate below, one audience wider. The wording is shared with the admin console's
       * path through @grims/db, so a member cannot tell which door ran the ceremony.
       *
       * `announcePromotionOrders` swallows its own failures: the ranks are granted by now, and an
       * announcement must never turn a completed run into a non-zero exit.
       */
      await announcePromotionOrders(
        prisma,
        report.wouldPromote
          .filter((p) => !refused.has(p.userId))
          .map((p) => ({ userId: p.userId, to: p.to })),
        monthYearLabel(new Date()),
      );
    }

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
