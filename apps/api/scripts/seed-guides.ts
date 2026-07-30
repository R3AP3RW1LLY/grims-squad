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
 * ★ AUTHORED BY THE WEBMASTER ★
 *
 * Squadron owner, 2026-07-29: "only the webmaster can author the joining guide." So
 * the author is resolved by looking for an account that actually holds SITE_CONFIG —
 * the permission the guides board now demands to post — rather than by taking the
 * first user in the table. If nobody holds it, this refuses rather than attributing
 * squadron documentation to an arbitrary account.
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
        userRoles: { select: { role: { select: { permMask: true } } } },
      },
    });

    const author = candidates.find((u) => {
      const mask = u.userRoles.reduce(
        (acc, ur) => acc | BigInt(ur.role.permMask.toFixed(0)),
        0n,
      );
      return (mask & SITE_CONFIG) === SITE_CONFIG;
    });

    if (author === undefined) {
      throw new Error(
        'No active account holds SITE_CONFIG, so nobody may author the guides board.\n' +
          'Grant the webmaster role to somebody first — attributing squadron documentation ' +
          'to an arbitrary account is not a reasonable fallback.',
      );
    }

    console.log(`Authoring as ${author.handle} (holds SITE_CONFIG).`);
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
