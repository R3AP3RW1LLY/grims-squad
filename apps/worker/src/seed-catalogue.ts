import { prisma, seedBuildCatalogue, type BuildTypeSeed } from '@grims/db';
import seed from '@grims/db/colony-build-seed.json' with { type: 'json' };

/**
 * Loads the build catalogue.
 *
 * ★ RUN ON DEPLOY, AND SAFE TO RUN TWICE ★
 *
 * Community figures only ever fill in rows nothing of ours has confirmed. A build type our own
 * members have measured is skipped, so a release cannot quietly undo what the squadron has learned
 * by building — which is the whole reason this table records where each number came from.
 */
const report = await seedBuildCatalogue(prisma, seed as unknown as BuildTypeSeed[]);

console.log(
  JSON.stringify({
    msg: 'build catalogue seeded',
    types: report.types,
    costs: report.costs,
    preservedFromOurOwnBuilds: report.preserved,
  }),
);

await prisma.$disconnect();
