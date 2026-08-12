import { PrismaClient } from '@grims/db';

/**
 * Moves a project's link to the planned site it is REALLY standing on.
 *
 * ★ SQUADRON OWNER, 2026-08-12 ★
 *
 * "the build order is showing the completed stations Irens Vision, and the 2 refinery builds as
 * being on B 7 a, but they are all built on B 8 a, we need this to be fixed and 100% accurate!
 * because this is all wrong!"
 *
 *   usage: node apps/worker/dist/relink-sites.js <siteId>=<projectId> [...]          # DRY RUN
 *          node apps/worker/dist/relink-sites.js <siteId>=<projectId> [...] --live
 *
 * ★ WHY THE AUTOMATIC GUESS WAS WRONG, AND WHAT THAT MEANS ★
 *
 * The linker inferred the body from the site's arrival distance, matching it to the nearest planned
 * body. In the B cluster that reasoning collapses: B 6 sits at 151,819 Ls, B 8 a at 151,335 and
 * B 7 a at 152,227 — under 1% apart across a distance of 151,000 light seconds, and a construction
 * site orbits its body by an unknown margin anyway. Three of five assignments were wrong.
 *
 * A heuristic that is right about the A cluster and wrong about the B cluster is not a heuristic
 * worth trusting with what a squadron plans a fortnight around. The commander standing on the pad
 * knows; nothing we can compute does. This tool exists so their answer wins, and the picker that
 * replaces the guess is the real fix.
 *
 * ★ IT DOES NOT TOUCH BUILD TYPES ★
 *
 * Deliberately different from fix-diverged.js, which corrects a plan row whose STRUCTURE was wrong.
 * Here the plan is right and only the WHICH-ROW was wrong, so the site keeps the build type the
 * plan chose. That matters for Irens Vision: the plan intends a Satellite Installation at B 8 a and
 * the fingerprint called the project a Comms Installation — both are 6,721 t T1 orbital
 * installations, and if their bills of materials are identical the fingerprint is a coin toss
 * between them. The owner says Satellite Installation, and the owner has been there.
 *
 * ★ IT CLEARS THE OLD LINK FIRST ★
 *
 * Otherwise a project would be attached to two sites at once and the plan would report the same
 * build twice — once where it is and once where it never was.
 */
async function main(): Promise<number> {
  const live = process.argv.includes('--live');

  const moves = process.argv
    .slice(2)
    .filter((a) => a.includes('='))
    .map((a) => {
      const [siteId, projectId] = a.split('=');
      return { siteId: siteId ?? '', projectId: projectId ?? '' };
    })
    .filter((m) => m.siteId !== '' && m.projectId !== '');

  if (moves.length === 0) {
    console.error('usage: relink-sites.js <siteId>=<projectId> [...] [--live]');
    return 2;
  }

  const prisma = new PrismaClient();
  try {
    console.log(`**Relink planned sites${live ? '' : ' — DRY RUN'}**\n`);

    for (const move of moves) {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          title: string;
          from_site: string | null;
          from_body: string | null;
          to_body: string | null;
          to_build: string | null;
          to_taken: string | null;
        }>
      >(
        `SELECT p.title,
                old.id::text            AS from_site,
                oldb.name               AS from_body,
                newb.name               AS to_body,
                newbt.display_name      AS to_build,
                taken.title             AS to_taken
           FROM colony_projects p
           LEFT JOIN colony_plan_sites old ON old.project_id = p.id
           LEFT JOIN colony_bodies oldb ON oldb.system_id64 = old.system_id64 AND oldb.body_id = old.body_id
           LEFT JOIN colony_plan_sites tgt ON tgt.id = $1::uuid
           LEFT JOIN colony_bodies newb ON newb.system_id64 = tgt.system_id64 AND newb.body_id = tgt.body_id
           LEFT JOIN colony_build_types newbt ON newbt.id = tgt.build_type_id
           LEFT JOIN colony_projects taken ON taken.id = tgt.project_id AND taken.id <> p.id
          WHERE p.id = $2::uuid`,
        move.siteId,
        move.projectId,
      );

      const r = rows[0];
      if (r === undefined) {
        console.log(`  ✖ ${move.projectId.slice(0, 8)} — no such project, or no such site.`);
        continue;
      }

      /*
       * Refused rather than silently stealing the row. If the target already belongs to a different
       * project, moving this one there would leave that build with no home and no explanation.
       */
      if (r.to_taken !== null) {
        console.log(
          `  ✖ ${r.title} — target site already holds "${r.to_taken}". Move that one first.`,
        );
        continue;
      }

      console.log(
        `  ✎ ${r.title.padEnd(22)} ${r.from_body ?? 'unlinked'}  →  ${r.to_body ?? '?'} (${r.to_build ?? '?'})`,
      );

      if (!live) continue;

      await prisma.$transaction([
        // Clear the old link, or the project ends up on two sites and the plan counts it twice.
        prisma.$executeRawUnsafe(
          `UPDATE colony_plan_sites SET project_id = NULL WHERE project_id = $1::uuid`,
          move.projectId,
        ),
        prisma.$executeRawUnsafe(
          `UPDATE colony_plan_sites SET project_id = $1::uuid WHERE id = $2::uuid`,
          move.projectId,
          move.siteId,
        ),
        prisma.auditLog.create({
          data: {
            actorId: null,
            actorType: 'system',
            action: 'colony.plan_site.relinked',
            targetType: 'colony_plan_site',
            targetId: move.siteId,
            before: { siteId: r.from_site, body: r.from_body } as never,
            after: {
              projectId: move.projectId,
              body: r.to_body,
              reason:
                'Corrected to the body the commander reported. The arrival-distance guess put it on ' +
                'a neighbouring body — in the B cluster the candidates are under 1% apart across ' +
                '151,000 Ls, which is not a distinguishable difference.',
            } as never,
          },
        }),
      ]);
    }

    console.log(
      live
        ? '\nWritten. Every move is in the audit log as colony.plan_site.relinked, with where it came from.'
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
