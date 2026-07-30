import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@grims/db';
import { SearchService, renderSnippet } from './search.service.js';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Forum search (INV-024) — against the REAL database.
 *
 * ★ WHY THIS ONE CANNOT BE A UNIT TEST ★
 *
 * The invariant is that the ACL is applied IN THE QUERY. A stubbed client proves nothing about a
 * SQL predicate: it would happily return whatever the stub was told to, and the WHERE clause — the
 * only thing under test — would never run.
 *
 * So this indexes a unique token in a Ring 2 post, searches as Ring 0, and asserts on what Postgres
 * actually returns. The invariant's own test says exactly that: "index a unique token in a Ring 2
 * post; search as Ring 0; assert zero hits, zero facet counts, and no pagination total revealing
 * existence."
 *
 * Run against the dev stack. Everything it creates is removed in `afterAll`, and every fixture is
 * namespaced so a failed run cannot poison a later one.
 */

const CONNECTION =
  process.env['DATABASE_URL'] ??
  'postgresql://grims:devpassword@localhost:5432/grimssquad?schema=public';

/** A token that appears NOWHERE else, so a hit can only have come from our fixture. */
const SECRET_TOKEN = 'zarquonflibbertigibbet';
const PUBLIC_TOKEN = 'wibblewobblepublic';

let prisma: PrismaClient;
let publicCategoryId: string;
let officerCategoryId: string;
let authorId: string;
let outsiderId: string;
let officerThreadId: string;
const created: { threads: string[]; categories: string[]; users: string[] } = {
  threads: [],
  categories: [],
  users: [],
};

const svc = new SearchService();
/*
 * The real client, cast to the brand.
 *
 * `AclBoundClient` is a phantom type — it exists to make the COMPILER refuse an unbound client at
 * call sites. Here the point is the opposite: prove the SQL filters even when the extension is not
 * in the way, because `$queryRaw` bypasses it. That is exactly the risk this file exists to cover.
 */
const db = (): AclBoundClient => prisma as unknown as AclBoundClient;

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: CONNECTION });

  const author = await prisma.user.create({
    data: { handle: `srch_author_${Date.now()}`, displayName: 'Search Author' },
    select: { id: true },
  });
  authorId = author.id;
  created.users.push(author.id);

  const outsider = await prisma.user.create({
    data: { handle: `srch_outsider_${Date.now()}`, displayName: 'Ring Zero' },
    select: { id: true },
  });
  outsiderId = outsider.id;
  created.users.push(outsider.id);

  // Ring 0: a public board (view_perm NULL).
  const pub = await prisma.forumCategory.create({
    data: { slug: `srch-public-${Date.now()}`, name: 'Search Public', viewPerm: null },
    select: { id: true },
  });
  publicCategoryId = pub.id;
  created.categories.push(pub.id);

  // Ring 2: officers only (FORUM_VIEW_OFFICER = 16).
  const off = await prisma.forumCategory.create({
    data: { slug: `srch-officers-${Date.now()}`, name: 'Search Officers', viewPerm: '16' },
    select: { id: true },
  });
  officerCategoryId = off.id;
  created.categories.push(off.id);

  const publicThread = await prisma.forumThread.create({
    data: {
      categoryId: publicCategoryId,
      authorId,
      slug: `srch-pub-${Date.now()}`,
      title: 'A public thread',
      isPublic: true,
      posts: {
        create: [{ authorId, bodyMd: `Nothing secret here, just ${PUBLIC_TOKEN}.`, bodyHtml: '<p>x</p>' }],
      },
    },
    select: { id: true },
  });
  created.threads.push(publicThread.id);

  const officerThread = await prisma.forumThread.create({
    data: {
      categoryId: officerCategoryId,
      authorId,
      slug: `srch-off-${Date.now()}`,
      title: 'Disciplinary matter',
      posts: {
        create: [{ authorId, bodyMd: `The codeword is ${SECRET_TOKEN} and it is sensitive.`, bodyHtml: '<p>x</p>' }],
      },
    },
    select: { id: true },
  });
  officerThreadId = officerThread.id;
  created.threads.push(officerThread.id);
});

afterAll(async () => {
  if (prisma === undefined) return;
  await prisma.forumThreadGrant.deleteMany({ where: { threadId: { in: created.threads } } });
  await prisma.forumPost.deleteMany({ where: { threadId: { in: created.threads } } });
  await prisma.forumThread.deleteMany({ where: { id: { in: created.threads } } });
  await prisma.forumCategory.deleteMany({ where: { id: { in: created.categories } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.$disconnect();
});

describe('INV-024 — the invariant’s own scenario', () => {
  it('MANDATORY @INV-024: a Ring 0 search for a Ring 2 term returns ZERO hits', async () => {
    /*
     * The Ring 0 caller sees only the public board, so `visibleCategoryIds` holds that one id. The
     * token exists ONLY in the officers' post, so any hit at all is a leak.
     */
    const result = await svc.search(db(), SECRET_TOKEN, [publicCategoryId], outsiderId);

    expect(result.hits).toEqual([]);
  });

  it('MANDATORY @INV-024: and ZERO total — no count revealing existence', async () => {
    /*
     * ★ THE DOOR THAT STAYS OPEN IN A POST-FILTERED SEARCH ★
     *
     * Filtering rows after retrieval gives the right LIST and still answers "does this exist" with
     * the total. "0 results" and "showing 0 of 1" are different sentences, and the second one is
     * the disclosure.
     */
    const result = await svc.search(db(), SECRET_TOKEN, [publicCategoryId], outsiderId);

    expect(result.total).toBe(0);
  });

  it('MANDATORY @INV-024: no page beyond the visible set exists either', async () => {
    // Page 2 existing when page 1 held everything visible says the same thing the total would.
    const page2 = await svc.search(db(), SECRET_TOKEN, [publicCategoryId], outsiderId, 20);

    expect(page2.hits).toEqual([]);
    expect(page2.total).toBe(0);
  });

  it('MANDATORY: an OFFICER finds the same term, so the test is not vacuous', async () => {
    /*
     * The other half. A search that returned nothing to everybody would pass every assertion above
     * and be worthless.
     */
    const result = await svc.search(
      db(),
      SECRET_TOKEN,
      [publicCategoryId, officerCategoryId],
      authorId,
    );

    expect(result.hits).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.hits[0]?.threadTitle).toBe('Disciplinary matter');
  });
});

describe('the ACL is in the query, not applied afterwards', () => {
  it('MANDATORY: an empty visible set returns nothing, without querying', async () => {
    /*
     * A caller with no visible boards. The SQL would be correct anyway — `= ANY('{}')` matches no
     * row — but returning early makes the intent unmistakable, and means a forgotten filter fails
     * closed rather than open.
     */
    const result = await svc.search(db(), PUBLIC_TOKEN, [], outsiderId);
    expect(result).toMatchObject({ hits: [], total: 0 });
  });

  it('MANDATORY: a per-thread GRANT makes one officer thread findable and nothing else', async () => {
    /*
     * The widening path, in search. A member granted one thread must find THAT thread and still
     * find nothing else on the board — which is the case a post-filter usually gets wrong, because
     * it tends to be written as "is the category visible" and then patched.
     */
    await prisma.forumThreadGrant.create({
      data: { threadId: officerThreadId, userId: outsiderId, grantedBy: authorId },
    });

    const granted = await svc.search(db(), SECRET_TOKEN, [publicCategoryId], outsiderId);
    expect(granted.hits).toHaveLength(1);
    expect(granted.total).toBe(1);

    // And a DIFFERENT member on the same board still finds nothing.
    const other = await prisma.user.create({
      data: { handle: `srch_other_${Date.now()}`, displayName: 'Other' },
      select: { id: true },
    });
    created.users.push(other.id);

    const notGranted = await svc.search(db(), SECRET_TOKEN, [publicCategoryId], other.id);
    expect(notGranted.hits).toEqual([]);
    expect(notGranted.total).toBe(0);

    await prisma.forumThreadGrant.deleteMany({ where: { threadId: officerThreadId } });
  });

  it('MANDATORY: an ANONYMOUS caller needs the thread published, not just the board public', async () => {
    // The narrowing half. Without it, a public board's unpublished drafts would be searchable.
    const draft = await prisma.forumThread.create({
      data: {
        categoryId: publicCategoryId,
        authorId,
        slug: `srch-draft-${Date.now()}`,
        title: 'Unpublished draft',
        isPublic: false,
        posts: { create: [{ authorId, bodyMd: `draft ${PUBLIC_TOKEN} content`, bodyHtml: '<p>x</p>' }] },
      },
      select: { id: true },
    });
    created.threads.push(draft.id);

    const anon = await svc.search(db(), PUBLIC_TOKEN, [publicCategoryId], null);
    expect(anon.hits.map((h) => h.threadTitle)).not.toContain('Unpublished draft');

    // A signed-in member who can see the board DOES find it — drafts are not secret from members.
    const member = await svc.search(db(), PUBLIC_TOKEN, [publicCategoryId], outsiderId);
    expect(member.hits.map((h) => h.threadTitle)).toContain('Unpublished draft');
  });

  it('MANDATORY: a soft-deleted post is not searchable', async () => {
    /*
     * INV-022 says a deleted post stays recoverable. If it turned up in search the deletion would be
     * cosmetic — the words would still be readable to anyone who guessed a term.
     */
    const thread = await prisma.forumThread.create({
      data: {
        categoryId: publicCategoryId,
        authorId,
        slug: `srch-del-${Date.now()}`,
        title: 'Deleted content',
        isPublic: true,
        posts: {
          create: [{ authorId, bodyMd: `deleted ${SECRET_TOKEN} words`, bodyHtml: '<p>x</p>', deletedAt: new Date() }],
        },
      },
      select: { id: true },
    });
    created.threads.push(thread.id);

    const result = await svc.search(db(), SECRET_TOKEN, [publicCategoryId], outsiderId);
    expect(result.hits.map((h) => h.threadTitle)).not.toContain('Deleted content');
  });
});

describe('the query itself', () => {
  it('refuses a query shorter than three characters', async () => {
    // Two characters against a full-text index returns most of the forum — useless to the person
    // who typed it and expensive for everybody else.
    for (const q of ['', 'a', 'ab', '  b  ']) {
      const r = await svc.search(db(), q, [publicCategoryId], outsiderId);
      expect(r.hits, q).toEqual([]);
      expect(r.total, q).toBe(0);
    }
  });

  it('MANDATORY: does not throw on punctuation a member might type', async () => {
    /*
     * `to_tsquery` demands operator syntax and THROWS on ordinary input — `bounty hunting` is a
     * syntax error and `!` is a 500. `websearch_to_tsquery` accepts what people actually type.
     */
    for (const q of ['bounty hunting', 'what is this?', 'a & b', '!!!', '"quoted phrase"', 'a -b']) {
      await expect(svc.search(db(), q, [publicCategoryId], outsiderId), q).resolves.toBeDefined();
    }
  });

  it('finds a public post by an ordinary word', async () => {
    const r = await svc.search(db(), PUBLIC_TOKEN, [publicCategoryId], outsiderId);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0]?.categorySlug).toContain('srch-public');
  });

  it('returns a snippet with the match marked', async () => {
    const r = await svc.search(db(), PUBLIC_TOKEN, [publicCategoryId], outsiderId);
    expect(r.hits[0]?.snippet).toContain('«');
  });
});

describe('renderSnippet', () => {
  it('MANDATORY: escapes member text BEFORE adding the highlight markup', () => {
    /*
     * ★ THE ORDERING IS THE WHOLE POINT ★
     *
     * The snippet is built from `body_md` — a member's text. If `ts_headline` emitted `<b>` tags,
     * the only way to render them would be to trust a string built from user content, and escaping
     * afterwards would destroy the tags we added.
     *
     * So Postgres marks matches with characters that cannot appear in HTML syntax, the whole string
     * is escaped, and only then are the markers replaced. There is no ordering in which member text
     * becomes an element.
     */
    const out = renderSnippet('a «match» and <script>alert(1)</script>');

    expect(out).toContain('<mark>match</mark>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('&lt;script&gt;');
  });

  it('MANDATORY: a member typing the marker characters cannot forge a highlight', () => {
    /*
     * A member CAN type « and » — they are ordinary characters. So they can produce a spurious
     * <mark> in their own snippet. That is the deliberate trade: the alternative markers are all
     * either HTML-significant or guessable too, and a fake highlight is a cosmetic oddity in a
     * search result rather than a script. What matters is that nothing they type becomes anything
     * but <mark>, which the escape above guarantees.
     */
    const out = renderSnippet('«<img src=x onerror=alert(1)>»');

    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('&lt;img');
  });
});
