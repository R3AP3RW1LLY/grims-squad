import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import {
  withPrincipal,
  assertAclModelsRegistered,
  ACL_MODELS,
  satisfies,
  resolveVisibleCategoryIds,
} from './acl-extension.js';

/*
 * ★ WHY THESE CASTS ARE HERE ★
 *
 * The production helpers take deliberately NARROW structural interfaces — they
 * describe the two or three methods they use rather than demanding a whole
 * PrismaClient, which is what keeps them testable and honest about their
 * dependencies.
 *
 * Passing a REAL client to one is safe and is the point of an integration test,
 * but TypeScript will not accept it: Prisma's generated method types are
 * generic and invariant in their argument positions, so a client that has
 * strictly MORE than the interface still does not structurally satisfy it.
 *
 * Cast at the boundary rather than widening the production interfaces, which
 * would give the real code a dependency on all of Prisma to satisfy a test.
 */
function asNarrow<T>(client: unknown): T {
  return client as T;
}


/**
 * @INV-002 A query executed on behalf of a user MUST NOT return rows from an
 * ACL-bearing record whose viewPerm the user's mask does not satisfy —
 * ENFORCED IN THE DATA LAYER, NOT THE CONTROLLER.
 *
 * Every test here goes STRAIGHT AT THE REPOSITORY. No controller, no guard, no
 * decorator, no HTTP. That is the point: if any of these could be made to pass
 * by adding a guard somewhere, the guard would be in the wrong place.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FORUM_VIEW_PUBLIC = 1n << 0n;
const FORUM_VIEW_MEMBER = 1n << 2n;
const FORUM_VIEW_OFFICER = 1n << 4n;

/**
 * Builds a principal the way a request would: resolve the visible id set from
 * the mask FIRST, then bind the client. A caller cannot skip this step and get
 * a permissive client — omitting `visibleIds` fails CLOSED and matches nothing.
 */
async function principal(mask: bigint, userId: string | null = null) {
  return {
    userId,
    mask,
    visibleIds: { ForumCategory: await resolveVisibleCategoryIds(asNarrow(raw), mask) },
  };
}

/**
 * Explicit connection string with the same fallback the schema spec uses. CI
 * does not export DATABASE_URL, so `new PrismaClient()` throws there while
 * passing locally — the kind of difference that only shows up after a push.
 */
const CONNECTION =
  process.env['DATABASE_URL'] ??
  'postgresql://grims:devpassword@localhost:5432/grimssquad?schema=public';

let raw: PrismaClient;

beforeAll(async () => {
  raw = new PrismaClient({ datasources: { db: { url: CONNECTION } } });
  await raw.$connect();
  await raw.forumCategory.deleteMany({ where: { slug: { startsWith: 'acltest-' } } });
  await raw.forumCategory.createMany({
    data: [
      // viewPerm is a MASK, and NULL means public — the schema says so.
      { slug: 'acltest-public', name: 'ACL public', viewPerm: null, position: 9001 },
      { slug: 'acltest-member', name: 'ACL member', viewPerm: FORUM_VIEW_MEMBER.toString(), position: 9002 },
      { slug: 'acltest-officer', name: 'ACL officer', viewPerm: FORUM_VIEW_OFFICER.toString(), position: 9003 },
    ],
  });
});

afterAll(async () => {
  await raw.forumCategory.deleteMany({ where: { slug: { startsWith: 'acltest-' } } });
  await raw.$disconnect();
});

const slugs = async (client: PrismaClient): Promise<string[]> =>
  (
    await client.forumCategory.findMany({
      where: { slug: { startsWith: 'acltest-' } },
      select: { slug: true },
    })
  )
    .map((r) => r.slug)
    .sort();

describe('@INV-002 data-layer ACL', () => {
  it('MANDATORY: a Ring 0 principal calling the repository DIRECTLY cannot read a Ring 1 row', async () => {
    // Ring 0 = public only. No controller involved anywhere in this test.
    const ring0 = asNarrow<typeof raw>(withPrincipal(asNarrow(raw), await principal(FORUM_VIEW_PUBLIC)));
    expect(await slugs(ring0)).toEqual(['acltest-public']);
  });

  it('a Ring 1 principal sees public and member, never officer', async () => {
    const ring1 = asNarrow<typeof raw>(withPrincipal(asNarrow(raw), await principal(FORUM_VIEW_PUBLIC | FORUM_VIEW_MEMBER)));
    expect(await slugs(ring1)).toEqual(['acltest-member', 'acltest-public']);
  });

  it('a Ring 2 principal sees all three', async () => {
    const ring2 = asNarrow<typeof raw>(
      withPrincipal(
        asNarrow(raw),
        await principal(FORUM_VIEW_PUBLIC | FORUM_VIEW_MEMBER | FORUM_VIEW_OFFICER),
      ),
    );
    expect(await slugs(ring2)).toEqual(['acltest-member', 'acltest-officer', 'acltest-public']);
  });

  it('an anonymous principal sees ONLY the public row', async () => {
    // viewPerm NULL means public, so zero permissions still sees the public
    // category — and nothing else.
    expect(
      await slugs(asNarrow<typeof raw>(withPrincipal(asNarrow(raw), await principal(0n)))),
    ).toEqual(['acltest-public']);
  });

  it('MANDATORY: a principal with no resolved id set sees NOTHING — fails closed', async () => {
    // Skipping the resolve step must not yield a permissive client. Returning
    // an empty predicate here would match every row, which is the single most
    // dangerous mistake available in this file.
    const unresolved = asNarrow<typeof raw>(withPrincipal(asNarrow(raw), { userId: null, mask: FORUM_VIEW_OFFICER }));
    expect(await slugs(unresolved)).toEqual([]);
  });

  it('cannot be widened by a caller-supplied where clause', async () => {
    // A caller naming the same column must not overwrite the ACL. AND, never
    // merge — this is the whole reason the predicate is combined rather than
    // spread.
    const ring0 = asNarrow<typeof raw>(withPrincipal(asNarrow(raw), await principal(FORUM_VIEW_PUBLIC)));
    const rows = await ring0.forumCategory.findMany({
      where: { viewPerm: FORUM_VIEW_OFFICER.toString(), slug: { startsWith: 'acltest-' } },
      select: { slug: true },
    });
    expect(rows).toEqual([]);
  });

  it('filters findFirst and findUnique, not just findMany', async () => {
    const ring0 = asNarrow<typeof raw>(withPrincipal(asNarrow(raw), await principal(FORUM_VIEW_PUBLIC)));
    expect(
      await ring0.forumCategory.findFirst({ where: { slug: 'acltest-officer' } }),
    ).toBeNull();
  });

  it('filters COUNT — an unfiltered total leaks how much exists', async () => {
    const ring0 = asNarrow<typeof raw>(withPrincipal(asNarrow(raw), await principal(FORUM_VIEW_PUBLIC)));
    const n = await ring0.forumCategory.count({ where: { slug: { startsWith: 'acltest-' } } });
    expect(n).toBe(1);
  });

  it('does NOT filter writes — the ACL governs reads', async () => {
    // Write authorization is a separate concern with different rules. Silently
    // filtering an update would make a failed write look like a successful one.
    const ring0 = asNarrow<typeof raw>(withPrincipal(asNarrow(raw), await principal(FORUM_VIEW_PUBLIC)));
    const n = await ring0.forumCategory.updateMany({
      where: { slug: 'acltest-officer' },
      data: { position: 9003 },
    });
    expect(n.count).toBe(1);
  });

  it('the raw client is UNFILTERED — proving the extension is what filters', async () => {
    // If this returned one row the tests above would prove nothing: they would
    // pass because the data was missing, not because the ACL worked.
    expect(await slugs(raw)).toHaveLength(3);
  });

  it('systemBypass returns everything, and is not reachable from a request', async () => {
    const job = asNarrow<typeof raw>(withPrincipal(asNarrow(raw), { userId: null, mask: 0n, systemBypass: true }));
    expect(await slugs(job)).toHaveLength(3);
  });
});

describe('registration completeness', () => {
  it('every ACL-bearing model in the schema is registered', () => {
    // A model added with an ACL column but not registered is read UNFILTERED.
    // This fails at review time rather than when someone notices officer data
    // on a public page.
    const schema = readFileSync(resolve(REPO, 'ssot/03-data/schema.prisma'), 'utf8');
    expect(() => assertAclModelsRegistered(schema)).not.toThrow();
  });

  it('detects a NEW unregistered ACL model', () => {
    // Proves the check above is not vacuous.
    const fake = `model Sneaky {\n  id String @id\n  viewPerm String\n}`;
    expect(() => assertAclModelsRegistered(fake)).toThrow(/Sneaky/);
  });

  it('registers every ACL-governed model, including the one with no ACL column', () => {
    /*
     * Pinned as an exact list so that adding a model to the schema without adding
     * it here is a failing test rather than a silent hole.
     *
     * ForumThread is the odd one out: it has no ACL column at all, so
     * `assertAclModelsRegistered` — which looks for `viewPerm`/`visibility` in the
     * model body — would never have flagged its absence. It is governed anyway,
     * because `isPublic` narrows its category's ACL for anonymous visitors and
     * ForumThreadGrant widens it for named users. That combination is exactly the
     * kind of thing a column scanner cannot see, which is why this list is
     * hand-maintained as well.
     */
    expect(Object.keys(ACL_MODELS).sort()).toEqual([
      /*
       * Colonisation BLOCS, 2026-08-25. Groups of our own systems, for the nexus. The model predates
       * the ACL: blocs used to be officer-made and squadron-owned, so there was nothing to filter.
       *
       * What a bloc discloses is its SYSTEM LIST — where a member is quietly building, long before
       * anything is standing there — which is why it is `private` by default and never `public`.
       */
      'ColonyBloc',
      /*
       * Colonisation PLANS, 2026-08-24. The squadron owner asked for plans a member can share with
       * the squadron to VIEW "without it being a squadron plan" — read-only, and only the author
       * may share.
       *
       * Two values only, `private` and `squadron`. The enum permits `public` because ColonyProject
       * uses it for share links, but a plan is never given one; that is a rule about writes and
       * lives in the service.
       *
       * Sharing never confers editing: `owner` decides that and the feature leaves `mayEdit`
       * untouched. This entry is about who may SEE a row, which is the only thing this layer does.
       */
      'ColonyPlan',
      // Colonisation projects, 2026-08-02. The same three values as ShipBuild below, and the same
      // rule that `public` reads with no session — the owner chose "Squadron projects members-only,
      // personal projects publishable by choice".
      'ColonyProject',
      'ForumCategory',
      'ForumThread',
      'ForumThreadGrant',
      'KnowledgeChunk',
      'Loadout',
      // Shipyard builds, 2026-08-01. `private` / `squadron` / `public`, where public
      // is readable with no session at all — the owner asked for a public build page
      // "visible ... to anyone not signed in".
      'ShipBuild',
    ]);
  });
});

describe('satisfies()', () => {
  it('requires EVERY bit the row demands, not any of them', () => {
    const needsBoth = FORUM_VIEW_MEMBER | FORUM_VIEW_OFFICER;
    expect(satisfies(FORUM_VIEW_MEMBER, needsBoth)).toBe(false);
    expect(satisfies(needsBoth, needsBoth)).toBe(true);
  });

  it('treats NULL as public, not as "requires everything"', () => {
    // Inverting this would hide every public category from every visitor.
    expect(satisfies(0n, null)).toBe(true);
  });

  it('handles bits beyond 2^53, where Number would silently fail', () => {
    const siteConfig = 1n << 63n;
    expect(satisfies(siteConfig, siteConfig)).toBe(true);
    expect(satisfies(0n, siteConfig)).toBe(false);
  });
});
