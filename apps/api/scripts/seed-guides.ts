/**
 * Publishes the joining guides into the guides board.
 *
 * ★ WHY A SCRIPT AND NOT A MIGRATION ★
 *
 * The content is prose that will be edited whenever Inara moves a button. A migration
 * is a one-way, run-once record of a schema change; guide text is neither. Putting it
 * in a migration would mean either never updating it or writing a new migration every
 * time a sentence changes.
 *
 * ★ IT GOES THROUGH THE REAL SANITISER ★
 *
 * `renderPostBody` — the same function every member post goes through (INV-035). A
 * seeded post carrying hand-written HTML would be the one piece of stored markup in
 * the database that nothing ever sanitised, and the guides are the most-read posts on
 * the site. They get no exemption.
 *
 * ★ AUTHORED BY THE WEBMASTER, BY ROLE ★
 *
 * Squadron owner, 2026-07-29: "only the webmaster can author the joining guide." So the
 * author is the holder of the WEBMASTER ROLE, with SITE_CONFIG only as a fallback for a
 * database where that role is unassigned — and the fallback announces itself.
 *
 * The first version looked only at SITE_CONFIG. That is indistinguishable from correct on a
 * dev database with one user, and wrong on production, where three accounts hold it. See the
 * note at the resolution site.
 *
 * Idempotent: re-running updates the existing posts in place, so fixing a typo is
 * `pnpm --filter @grims/api seed:guides` and not a hand-written UPDATE.
 *
 * Usage:
 *   pnpm --filter @grims/api seed:guides
 *   pnpm --filter @grims/api seed:guides -- --dry-run
 */
import { PrismaClient } from '@prisma/client';
import { renderPostBody, looksDangerous } from '../src/forum/sanitize.js';
import { GUIDE_THREADS } from '../src/forum/guides/joining-guide.js';

/** SITE_CONFIG, bit 63. Spelled out so this script needs no app imports. */
const SITE_CONFIG = 1n << 63n;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();

  try {
    const category = await prisma.forumCategory.findUnique({ where: { slug: 'guides' } });
    if (category === null) {
      throw new Error('No "guides" category. Run the migrations first.');
    }

    /*
     * The author must genuinely hold SITE_CONFIG. Resolved by ORing every held role's
     * mask, the same way `computeEffectiveMask` does — a user holding webmaster plus
     * two rank roles has their permissions spread across three rows.
     *
     * `toFixed(0)` and not `toString()`: perm_mask is NUMERIC(40,0), and Prisma's
     * Decimal switches to exponential notation at 1e21 — which ALL_PERMISSIONS exceeds
     * — so BigInt() would throw on the very roles most likely to hold this bit.
     */
    const candidates = await prisma.user.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        handle: true,
        userRoles: { select: { role: { select: { key: true, permMask: true } } } },
      },
    });

    /*
     * ★ THE WEBMASTER BY NAME, NOT "WHOEVER HOLDS SITE_CONFIG FIRST" ★
     *
     * Owner: "only the webmaster can author the joining guide."
     *
     * The first version of this took the first active account holding SITE_CONFIG. On a
     * dev database with one user that is the webmaster and the distinction never appears.
     * On PRODUCTION three accounts hold it — the webmaster plus two admiral ranks — and
     * the script picked a prime_legate, so the joining guide would have been published
     * under the wrong name.
     *
     * Caught by dry-running against production before writing, which is the only reason
     * this was ever visible.
     *
     * So the ROLE is looked for first and SITE_CONFIG is only a fallback, for a database
     * where the webmaster role is unassigned. The fallback still says whose name it used.
     */
    const holdsWebmaster = (u: (typeof candidates)[number]): boolean =>
      u.userRoles.some((ur) => ur.role.key === 'webmaster');

    const effectiveMask = (u: (typeof candidates)[number]): bigint =>
      u.userRoles.reduce((acc, ur) => acc | BigInt(ur.role.permMask.toFixed(0)), 0n);

    const author =
      candidates.find(holdsWebmaster) ??
      candidates.find((u) => (effectiveMask(u) & SITE_CONFIG) === SITE_CONFIG);

    if (author !== undefined && !holdsWebmaster(author)) {
      console.warn(
        `No account holds the webmaster role; falling back to ${author.handle}, who holds SITE_CONFIG.`,
      );
    }

    if (author === undefined) {
      throw new Error(
        'No active account holds SITE_CONFIG, so nobody may author the guides board.\n' +
          'Grant the webmaster role to somebody first — attributing squadron documentation ' +
          'to an arbitrary account is not a reasonable fallback.',
      );
    }

    console.log(`Authoring as ${author.handle} (${holdsWebmaster(author) ? 'webmaster' : 'SITE_CONFIG fallback'}).`);
    if (dryRun) console.log('DRY RUN — nothing will be written.\n');

    for (const thread of GUIDE_THREADS) {
      /*
       * Every body is rendered and CHECKED before anything is written. `looksDangerous`
       * is the check on the sanitiser rather than a second sanitiser — if it ever fires
       * on our own guide text, that is a sanitiser bug and the seed must stop rather
       * than store the result.
       */
      const rendered = thread.posts.map((p) => {
        const out = renderPostBody(p.bodyMd);
        if (looksDangerous(out.bodyHtml)) {
          throw new Error(
            `Sanitised output for "${thread.slug}" still looks dangerous. ` +
              'This is a sanitiser bug, not a content problem — refusing to store it.',
          );
        }
        return out;
      });

      console.log(
        `  ${thread.slug}: ${rendered.length} post(s), ` +
          `${rendered.reduce((n, r) => n + r.bodyHtml.length, 0)} bytes of HTML`,
      );

      if (dryRun) continue;

      const existing = await prisma.forumThread.findUnique({
        where: { categoryId_slug: { categoryId: category.id, slug: thread.slug } },
        select: { id: true },
      });

      const threadId = existing?.id ?? undefined;

      if (threadId === undefined) {
        const created = await prisma.forumThread.create({
          data: {
            categoryId: category.id,
            authorId: author.id,
            slug: thread.slug,
            title: thread.title,
            isPublic: thread.isPublic,
            // Pinned: a joining guide that scrolls off the board is a joining guide
            // nobody reads.
            isPinned: true,
            /*
             * LOCKED. The guides board is documentation, and a reply on step 4 saying
             * "this didn't work for me" belongs in the help board where somebody will
             * see it — not appended to the instructions everybody else is reading.
             */
            isLocked: true,
            postCount: thread.posts.length,
            lastPostAt: new Date(),
            lastPostBy: author.id,
            posts: {
              create: rendered.map((r) => ({
                authorId: author.id,
                bodyMd: r.bodyMd,
                bodyHtml: r.bodyHtml,
              })),
            },
          },
          select: { id: true },
        });
        console.log(`    created thread ${created.id}`);
        continue;
      }

      /*
       * Update in place. The posts are replaced wholesale rather than diffed: they are
       * generated from source, so there is no member content to preserve, and matching
       * them up by position would silently reorder the guide if a step were inserted.
       *
       * In a transaction so the guide is never briefly empty for a reader mid-run.
       */
      await prisma.$transaction([
        prisma.forumPost.deleteMany({ where: { threadId } }),
        prisma.forumThread.update({
          where: { id: threadId },
          data: {
            title: thread.title,
            isPublic: thread.isPublic,
            postCount: thread.posts.length,
            lastPostAt: new Date(),
            lastPostBy: author.id,
            posts: {
              create: rendered.map((r) => ({
                authorId: author.id,
                bodyMd: r.bodyMd,
                bodyHtml: r.bodyHtml,
              })),
            },
          },
        }),
      ]);
      console.log(`    updated thread ${threadId}`);
    }

    console.log('\nDone.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
