import { PrismaClient, fixDivergedSites } from '@grims/db';

/**
 * Corrects planned rows that describe a structure nobody built.
 *
 * ★ SQUADRON OWNER, 2026-08-12 ★
 *
 *   usage: node apps/worker/dist/fix-diverged.js <siteId>=<projectId> [...]          # DRY RUN
 *          node apps/worker/dist/fix-diverged.js <siteId>=<projectId> [...] --live   # applies it
 *
 * At A 1 f the plan asked for an Extraction Settlement — Medium and a Military Settlement — Small.
 * What stands there is an Extraction Settlement — Small and a Military Settlement — Medium: the
 * sizes are swapped, and those are four different catalogue rows with four different bills of
 * materials. So both builds finished months ago and the plan showed neither, because nothing in it
 * intended either structure.
 *
 * ★ WHY THE PAIRS ARE GIVEN EXPLICITLY ★
 *
 * This decides that a plan was wrong and edits it. Working the pairing out automatically is
 * exactly the fuzzy matching the linker refuses to do — Military-Small and Military-Medium are not
 * "close enough", and treating them so would have the plan claim 2,842 t was hauled when it was
 * 5,684.
 *
 * So a human names the pairs, this prints what would change, and nothing is written until --live.
 * The same operation sits behind the "built differently than planned" prompt, which is where the
 * pairs come from once somebody has tapped a button instead of typing an id.
 */
async function main(): Promise<number> {
  const live = process.argv.includes('--live');

  const fixes = process.argv
    .slice(2)
    .filter((a) => a.includes('='))
    .map((a) => {
      const [siteId, projectId] = a.split('=');
      return { siteId: siteId ?? '', projectId: projectId ?? '' };
    })
    .filter((f) => f.siteId !== '' && f.projectId !== '');

  if (fixes.length === 0) {
    console.error('usage: fix-diverged.js <siteId>=<projectId> [...] [--live]');
    return 2;
  }

  const prisma = new PrismaClient();
  try {
    const results = await fixDivergedSites(prisma, fixes, { dryRun: !live });

    console.log(`**Plan row correction${live ? '' : ' — DRY RUN'}**\n`);

    if (results.length === 0) {
      console.log('Nothing to correct — no matching site, or the project is not identified.');
      return 0;
    }

    let delta = 0;
    for (const r of results) {
      const from = r.from.tonnes ?? 0;
      const to = r.to.tonnes ?? 0;
      delta += to - from;
      console.log(
        `  ✎ site ${r.siteId.slice(0, 8)}  ${r.from.buildTypeId ?? 'nothing'} (${from.toLocaleString()} t)` +
          `  →  ${r.to.buildTypeId ?? '?'} (${to.toLocaleString()} t)   linked to ${r.projectId.slice(0, 8)}`,
      );
    }

    // The headline the owner asked to see move. Stated plainly rather than left to be worked out.
    console.log(
      `\nPlanned tonnage changes by ${delta >= 0 ? '+' : ''}${delta.toLocaleString()} t across ${results.length} row(s).`,
    );
    console.log(
      live
        ? 'Written. Every change is in the audit log as colony.plan_site.build_type_corrected, with the previous value.'
        : 'NOTHING WAS WRITTEN — pass --live to apply.',
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
