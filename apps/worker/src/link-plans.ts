import { PrismaClient, linkProjectsToPlans } from '@grims/db';

/**
 * The one-off backfill that tells existing plans which of their sites are already under way.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "it should backfill existing build plans based on projects the commander has started in their own
 * build plan"
 *
 *   usage: node apps/worker/dist/link-plans.js          # DRY RUN, writes nothing
 *          node apps/worker/dist/link-plans.js --live   # applies it
 *
 * ★ IT IS THE SAME CODE THE LIVE PATH RUNS ★
 *
 * `linkProjectsToPlans` does not look for new projects, it looks for UNLINKED ones — so run after
 * every identification it is the automatic behaviour, and run once here it is the backfill. A
 * backfill written separately is how a plan ends up with two different notions of "already built",
 * and this one decides, once, what eighty-one rows in a fortnight-old plan mean.
 *
 * ★ WHY IT WILL LINK FEWER THAN YOU EXPECT ★
 *
 * A project can only be matched once it is IDENTIFIED, and identification fingerprints its bill of
 * materials — which exists only after a commander has docked there. A site nobody has visited has
 * no requirement, so it cannot be told apart from any other build, and it is listed as skipped
 * WITH THAT REASON rather than quietly omitted.
 *
 * That is the honest answer and not a shortfall to be worked around: the alternative is matching on
 * the free text somebody typed, which is how a Refinery Hub becomes an Ocellus Starport.
 */
async function main(): Promise<number> {
  const live = process.argv.includes('--live');
  const prisma = new PrismaClient();

  try {
    const report = await linkProjectsToPlans(prisma, { dryRun: !live });

    console.log(`**Plan linking${live ? '' : ' — DRY RUN'}** — ${new Date().toISOString()}\n`);

    if (report.linked.length === 0) {
      console.log('Nothing new to link.');
    } else {
      console.log(`LINKED (${report.linked.length}):`);
      for (const l of report.linked) {
        console.log(`  ✎ ${l.systemName} · ${l.buildType} → plan ${l.planId.slice(0, 8)} site ${l.siteId.slice(0, 8)}`);
      }
    }

    if (report.ambiguous.length > 0) {
      /*
       * The cases a human settles. GL-W c2-12 plans six Refinery Hubs and a project could be any of
       * them; picking the first would mark the wrong body built on the page a squadron steers by.
       */
      console.log(`\nNEEDS A HUMAN — several planned sites fit (${report.ambiguous.length}):`);
      for (const a of report.ambiguous) {
        console.log(
          `  ? ${a.systemName} · ${a.buildType} — ${a.siteIds.length} planned sites fit, so none was chosen.`,
        );
      }
    }

    /*
     * Grouped, because the same sentence repeated forty times is a wall nobody reads — and the
     * count per reason is the actual finding.
     */
    if (report.skipped.length > 0) {
      const byReason = new Map<string, number>();
      for (const s of report.skipped) byReason.set(s.why, (byReason.get(s.why) ?? 0) + 1);

      console.log(`\nNot linked (${report.skipped.length}):`);
      for (const [why, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(n).padStart(3)} × ${why}`);
      }
    }

    console.log(
      live
        ? '\nWritten. Every link is in the audit log as colony.plan_site.linked, so it can be undone.'
        : '\nNOTHING WAS WRITTEN — pass --live to apply.',
    );
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
    console.error(err);
    process.exitCode = 1;
  });
