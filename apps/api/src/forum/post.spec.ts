import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ErrorCode, Permission } from '@grims/shared';
import { PostService } from './post.service.js';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import type { ReindexQueue, ReindexRequest } from './reindex.port.js';

/**
 * Posts — INV-035 (sanitised before storage) and INV-022 (soft delete, tombstone,
 * recoverable).
 *
 * ★ TWO OF THESE TESTS READ THE SOURCE, AND THAT IS NOT LAZINESS ★
 *
 * Both invariants are partly ABSENCES: no path writes an unsanitised body, and no path
 * hard-deletes. A behavioural test cannot demonstrate an absence — it can only show that
 * the cases somebody thought to try behave correctly, which is precisely the gap that let
 * INV-002 be reported as covered while nothing enforced it.
 *
 * So the behaviour is tested behaviourally and the absences structurally, and the two are
 * labelled so nobody mistakes one for the other.
 */

function recordingQueue(): ReindexQueue & { readonly seen: ReindexRequest[] } {
  const seen: ReindexRequest[] = [];
  return {
    seen,
    async enqueue(r) {
      seen.push(r);
    },
  };
}

const stub = (over: Record<string, unknown>): AclBoundClient => over as unknown as AclBoundClient;

const MODERATOR = Permission.FORUM_MODERATE;
const MEMBER_POST = Permission.FORUM_POST_MEMBER;
/**
 * The first argument the mock was called with, typed.
 *
 * WHY THIS EXISTS
 *
 * Indexing mock.calls at zero and casting fails the STRICT typecheck: a vi.fn with no declared
 * parameters infers an empty tuple, so index 0 does not exist on it (TS2493).
 *
 * It was invisible locally because tsc -p tsconfig.json EXCLUDES specs. CI runs the package
 * typecheck script, which includes tsconfig.spec.json. The lesson is the command, not the cast:
 * run pnpm --filter @grims/api typecheck.
 *
 * This also fails BETTER: the old form silently produced undefined when a mock had not been
 * called, so the assertion failed on a missing property rather than saying the call never
 * happened.
 */
function firstArg<T>(fn: { mock: { calls: unknown[][] } }, what = 'the mock'): T {
  const call = fn.mock.calls[0];
  if (call === undefined) throw new Error(`expected ${what} to have been called, but it was not`);
  return call[0] as T;
}


/** A live thread in a members' board. */
const openThread = {
  id: 't1',
  isLocked: false,
  category: { postPerm: { toFixed: () => '8' }, isLocked: false },
};

function createDb(over: Record<string, unknown> = {}) {
  return stub({
    forumThread: {
      findFirst: async () => openThread,
      update: vi.fn(async () => ({})),
    },
    forumPost: {
      create: vi.fn(async () => ({ id: 'p1', bodyHtml: '<p>hi</p>', editCount: 0 })),
    },
    ...over,
  });
}

describe('creating a post', () => {
  it('MANDATORY @INV-035: the body is sanitised before it is stored', async () => {
    /*
     * Asserted on what would be WRITTEN, not on what is returned — the invariant is about
     * the stored value, because "we escape on output" holds only while every output path
     * remembers to.
     */
    const create = vi.fn(async () => ({ id: 'p1', bodyHtml: '', editCount: 0 }));
    const db = createDb({ forumPost: { create } });
    const svc = new PostService(recordingQueue());

    await svc.create(db, 't1', '<script>alert(1)</script> hello', 'u1', MEMBER_POST);

    const written = firstArg<{ data: { bodyHtml: string; bodyMd: string } }>(create, 'create');
    expect(written.data.bodyHtml).not.toMatch(/<\s*script/i);
    // And the member's original text is kept verbatim, so an edit starts from what they wrote.
    expect(written.data.bodyMd).toContain('<script>');
  });

  it('MANDATORY: the author is the session user, never a request field', async () => {
    const create = vi.fn(async () => ({ id: 'p1', bodyHtml: '<p>x</p>', editCount: 0 }));
    const db = createDb({ forumPost: { create } });
    const svc = new PostService(recordingQueue());

    await svc.create(db, 't1', 'hello', 'session-user', MEMBER_POST);

    const written = firstArg<{ data: { authorId: string } }>(create, 'create');
    expect(written.data.authorId).toBe('session-user');
  });

  it('MANDATORY: posting permission comes from the CATEGORY', async () => {
    const svc = new PostService(recordingQueue());
    // Mask 0 does not satisfy the board's postPerm of 8.
    await expect(svc.create(createDb(), 't1', 'hi', 'u1', 0n)).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
  });

  it('MANDATORY: an invisible thread is a 404, cloaked', async () => {
    // `findFirst` returning null IS the ACL predicate having filtered the row.
    const db = createDb({ forumThread: { findFirst: async () => null } });
    const svc = new PostService(recordingQueue());

    await expect(svc.create(db, 't1', 'hi', 'u1', MEMBER_POST)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });
  });

  it('MANDATORY: a locked thread refuses a MODERATOR too', async () => {
    /*
     * ★ NO MODERATOR BYPASS, DELIBERATELY ★
     *
     * The joining guides are locked so "this didn't work for me" lands in the help board
     * where somebody will see it, rather than being appended to the instructions everybody
     * else is reading. A moderator bypass makes the lock advisory — and a moderator is the
     * person most likely to reply out of habit.
     */
    const db = createDb({
      forumThread: {
        findFirst: async () => ({ ...openThread, isLocked: true }),
        update: vi.fn(),
      },
    });
    const svc = new PostService(recordingQueue());

    await expect(
      svc.create(db, 't1', 'hi', 'u1', MODERATOR | MEMBER_POST),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('refuses an empty body', async () => {
    const svc = new PostService(recordingQueue());

    /*
     * Escape sequences, not literal whitespace. Written through a shell heredoc this became
     * a real newline and tab inside the string literal, which does not parse — the fourth
     * time on this branch that a heredoc has eaten an escape. Edited directly instead.
     */
    for (const body of ['', '   ', '\n\n\t', '\r\n']) {
      await expect(
        svc.create(createDb(), 't1', body, 'u1', MEMBER_POST),
        JSON.stringify(body),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
  });

  it('keeps a body of nothing but a disallowed tag, as inert TEXT', async () => {
    /*
     * ★ MY ASSERTION WAS WRONG HERE, AND THE HONEST OUTCOME IS BETTER ★
     *
     * This first asserted that `<iframe src=x></iframe>` would be REFUSED as "sanitises to
     * nothing". It is not: markdown-it with `html: false` ESCAPES raw HTML rather than
     * removing it, so the body becomes visible text reading `<iframe src=x></iframe>`. That
     * is correct on both counts — it cannot execute, and it is what somebody who typed those
     * characters should see.
     *
     * Which means the "sanitised to nothing" branch in `#render` is very nearly UNREACHABLE:
     * almost anything a member can type survives as text. It is kept as a defensive guard
     * against a future sanitiser change that starts discarding instead of escaping, and it is
     * recorded here as defensive rather than pretended to be covered.
     */
    const create = vi.fn(async () => ({ id: 'p1', bodyHtml: '', editCount: 0 }));
    const db = createDb({ forumPost: { create } });

    await new PostService(recordingQueue()).create(
      db,
      't1',
      '<iframe src=x></iframe>',
      'u1',
      MEMBER_POST,
    );

    const written = firstArg<{ data: { bodyHtml: string } }>(create, 'create');
    expect(written.data.bodyHtml).not.toMatch(/<\s*iframe/i);
    expect(written.data.bodyHtml).toContain('&lt;iframe');
  });

  it('enqueues a reindex as a POST, not a thread', async () => {
    // Re-indexing a whole thread because somebody added one reply is wasteful at P8 scale,
    // and a consumer handling only `thread` would silently discard every reply.
    const q = recordingQueue();
    await new PostService(q).create(createDb(), 't1', 'hi', 'u1', MEMBER_POST);

    expect(q.seen).toEqual([{ kind: 'post', id: 'p1', reason: 'created' }]);
  });
});

describe('editing a post', () => {
  const existing = {
    id: 'p1',
    authorId: 'author',
    bodyMd: 'original text',
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    thread: { isLocked: false },
  };

  function editDb(over: Record<string, unknown> = {}) {
    return stub({
      forumPost: {
        findFirst: async () => existing,
        findUniqueOrThrow: async () => ({ id: 'p1', bodyHtml: '<p>original text</p>', editCount: 0 }),
        // Called to BUILD the transaction array, so it must exist even though
        // `$transaction` is what resolves.
        update: (a: unknown) => a,
      },
      postRevision: { create: (a: unknown) => a },
      $transaction: vi.fn(async () => [
        {},
        { id: 'p1', bodyHtml: '<p>new</p>', editCount: 1 },
      ]),
      ...over,
    });
  }

  it('MANDATORY @INV-022: a revision records the body as it WAS', async () => {
    /*
     * ★ THE BUG THIS PREVENTS ★
     *
     * Writing the revision AFTER the update records the NEW text, producing a history where
     * every entry matches the current post — which looks like a working audit trail and
     * contains no information whatsoever.
     */
    const revisionCreate = vi.fn((a: unknown) => a);
    const db = editDb({ postRevision: { create: revisionCreate } });
    const svc = new PostService(recordingQueue());

    await svc.edit(db, 'p1', 'completely new text', 'author', MEMBER_POST);

    const args = firstArg<{ data: { bodyMd: string; editedBy: string } }>(revisionCreate, 'revisionCreate');
    expect(args.data.bodyMd).toBe('original text');
    expect(args.data.editedBy).toBe('author');
  });

  it('MANDATORY @INV-022: the revision and the update are ONE transaction', async () => {
    /*
     * An edit landing without its revision loses the previous text irrecoverably, and
     * INV-022's promise is about recoverability.
     */
    const transaction = vi.fn(async () => [{}, { id: 'p1', bodyHtml: '<p>n</p>', editCount: 1 }]);
    const db = editDb({ $transaction: transaction });
    const svc = new PostService(recordingQueue());

    await svc.edit(db, 'p1', 'new text', 'author', MEMBER_POST);

    expect(transaction).toHaveBeenCalledOnce();
    expect(firstArg<unknown[]>(transaction, 'transaction')).toHaveLength(2);
  });

  it('MANDATORY: a stranger cannot edit somebody else’s post', async () => {
    const svc = new PostService(recordingQueue());
    await expect(svc.edit(editDb(), 'p1', 'x', 'someone-else', MEMBER_POST)).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
  });

  it('a moderator can edit anybody’s post', async () => {
    const svc = new PostService(recordingQueue());
    await expect(
      svc.edit(editDb(), 'p1', 'moderated', 'a-moderator', MODERATOR),
    ).resolves.toMatchObject({ editCount: 1 });
  });

  it('a locked thread stops the AUTHOR but not a moderator', async () => {
    /*
     * Asymmetric with posting, deliberately: locking ends the conversation, and letting an
     * author keep rewriting a locked post reopens it silently. A moderator editing a locked
     * post is usually removing something that should not be there.
     */
    const locked = editDb({
      forumPost: {
        findFirst: async () => ({ ...existing, thread: { isLocked: true } }),
        findUniqueOrThrow: async () => ({ id: 'p1', bodyHtml: '', editCount: 0 }),
        update: (a: unknown) => a,
      },
    });
    const svc = new PostService(recordingQueue());

    await expect(svc.edit(locked, 'p1', 'x', 'author', MEMBER_POST)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(svc.edit(locked, 'p1', 'x', 'a-mod', MODERATOR)).resolves.toBeDefined();
  });

  it('writes NO revision when the text is unchanged', async () => {
    /*
     * A history full of no-op entries is a history nobody reads, and an "edited" marker on a
     * post identical to before is a lie.
     */
    const revisionCreate = vi.fn((a: unknown) => a);
    const transaction = vi.fn();
    const db = editDb({ postRevision: { create: revisionCreate }, $transaction: transaction });
    const svc = new PostService(recordingQueue());

    await svc.edit(db, 'p1', 'original text', 'author', MEMBER_POST);

    expect(revisionCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not flag an "edited" marker inside the grace window', async () => {
    /*
     * The revision is written either way — only the visible marker is suppressed. A forum
     * that flags a typo fixed ten seconds later teaches members to post twice instead.
     */
    const transaction = vi.fn(async () => [{}, { id: 'p1', bodyHtml: '', editCount: 1 }]);
    const fresh = editDb({
      forumPost: {
        findFirst: async () => ({ ...existing, createdAt: new Date() }),
        findUniqueOrThrow: async () => ({ id: 'p1', bodyHtml: '', editCount: 0 }),
        update: (a: unknown) => a,
      },
      $transaction: transaction,
    });

    await new PostService(recordingQueue()).edit(fresh, 'p1', 'quick fix', 'author', MEMBER_POST);

    const ops = firstArg<unknown[]>(transaction, 'transaction');
    // Two operations either way: the revision is NOT skipped.
    expect(ops).toHaveLength(2);
  });
});

describe('deleting a post', () => {
  const live = { id: 'p1', authorId: 'author', threadId: 't1' };

  function deleteDb(over: Record<string, unknown> = {}) {
    return stub({
      forumPost: { findFirst: async () => live, update: (a: unknown) => a },
      forumThread: { update: (a: unknown) => a },
      postRevision: { create: (a: unknown) => a },
      $transaction: vi.fn(async () => []),
      ...over,
    });
  }

  it('MANDATORY @INV-022: sets deletedAt rather than removing the row', async () => {
    const transaction = vi.fn(async () => []);
    const update = vi.fn((a: unknown) => a);
    const db = deleteDb({
      forumPost: { findFirst: async () => live, update },
      $transaction: transaction,
    });

    const out = await new PostService(recordingQueue()).softDelete(db, 'p1', 'author', MEMBER_POST);

    expect(out.deletedAt).toBeTruthy();
    const args = firstArg<{ data: { deletedAt: Date } }>(update, 'update');
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('MANDATORY @INV-022: decrements the thread counter, or a thread claims replies nobody can find', async () => {
    const transaction = vi.fn(async () => []);
    const threadUpdate = vi.fn((a: unknown) => a);
    const db = deleteDb({
      forumThread: { update: threadUpdate },
      $transaction: transaction,
    });

    await new PostService(recordingQueue()).softDelete(db, 'p1', 'author', MEMBER_POST);

    const args = firstArg<{ data: { postCount: { decrement: number } } }>(threadUpdate, 'threadUpdate');
    expect(args.data.postCount.decrement).toBe(1);
  });

  it('MANDATORY: an already-deleted post answers the same as a missing one', async () => {
    /*
     * A distinct "already deleted" would confirm a post once existed — the same disclosure a
     * step removed, and on the officers' board the existence of a post is part of what is
     * protected.
     */
    const db = deleteDb({ forumPost: { findFirst: async () => null } });
    await expect(
      new PostService(recordingQueue()).softDelete(db, 'p1', 'author', MEMBER_POST),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_VISIBLE });
  });

  it('MANDATORY: a stranger cannot delete somebody else’s post', async () => {
    await expect(
      new PostService(recordingQueue()).softDelete(deleteDb(), 'p1', 'stranger', MEMBER_POST),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it('a moderator can', async () => {
    await expect(
      new PostService(recordingQueue()).softDelete(deleteDb(), 'p1', 'a-mod', MODERATOR),
    ).resolves.toMatchObject({ id: 'p1' });
  });
});

describe('restoring — the other half of "remains recoverable"', () => {
  function restoreDb(over: Record<string, unknown> = {}) {
    return stub({
      forumPost: { findFirst: async () => ({ id: 'p1', threadId: 't1' }), update: (a: unknown) => a },
      forumThread: { update: (a: unknown) => a },
      $transaction: vi.fn(async () => []),
      ...over,
    });
  }

  it('MANDATORY @INV-022: a moderator can restore', async () => {
    await expect(
      new PostService(recordingQueue()).restore(restoreDb(), 'p1', MODERATOR),
    ).resolves.toMatchObject({ id: 'p1' });
  });

  it('MANDATORY: an author cannot', async () => {
    await expect(
      new PostService(recordingQueue()).restore(restoreDb(), 'p1', MEMBER_POST),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it('MANDATORY: looks for a DELETED post specifically', async () => {
    /*
     * Restoring a live post is a no-op that would silently succeed, leaving somebody
     * wondering whether it worked. Asserted on the WHERE clause, because the difference is
     * invisible in the result.
     */
    const findFirst = vi.fn(async () => ({ id: 'p1', threadId: 't1' }));
    await new PostService(recordingQueue()).restore(restoreDb({ forumPost: { findFirst, update: (a: unknown) => a } }), 'p1', MODERATOR);

    const args = firstArg<{ where: { deletedAt: unknown } }>(findFirst, 'findFirst');
    expect(args.where.deletedAt).toEqual({ not: null });
  });

  it('enqueues a reindex, or restored content is invisible to search forever', async () => {
    const q = recordingQueue();
    await new PostService(q).restore(restoreDb(), 'p1', MODERATOR);
    expect(q.seen).toEqual([{ kind: 'post', id: 'p1', reason: 'restored' }]);
  });
});

describe('edit history', () => {
  const historyDb = stub({
    forumPost: { findFirst: async () => ({ id: 'p1' }) },
    postRevision: {
      findMany: async () => [
        { editedAt: new Date('2026-07-29T10:00:00Z'), editor: { handle: 'grim' } },
      ],
    },
  });

  it('MANDATORY: moderators only', async () => {
    await expect(
      new PostService(recordingQueue()).history(historyDb, 'p1', MEMBER_POST),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it('MANDATORY: returns WHEN and BY WHOM, never the old bodies', async () => {
    /*
     * A moderator deciding whether a post was quietly rewritten needs to know that it was.
     * Serving every previous version through an API turns the revision table into a way to
     * read text an author has removed, which is not what it is for — recovery is a
     * deliberate act with its own path.
     */
    const rows = await new PostService(recordingQueue()).history(historyDb, 'p1', MODERATOR);

    expect(rows).toEqual([{ editedAt: '2026-07-29T10:00:00.000Z', editedByHandle: 'grim' }]);
    expect(JSON.stringify(rows)).not.toContain('bodyMd');
  });
});

describe('the two ABSENCES the invariants rest on', () => {
  /*
   * ★ WHY THESE READ THE SOURCE ★
   *
   * Both are properties of what the service does NOT do, and a behavioural test can only
   * show that the paths somebody thought to try behave correctly. That is exactly how
   * INV-002 came to be reported as covered while nothing enforced it — so these are
   * structural, and labelled as such.
   */
  const source = (): string => {
    const raw = readFileSync(new URL('./post.service.ts', import.meta.url), 'utf8');
    // Comments stripped, so the file's own documentation cannot satisfy the assertion.
    return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  };

  it('MANDATORY @INV-022: there is NO hard delete anywhere in the service', () => {
    /*
     * The invariant says forum content "never disappears from the database on a user
     * action". The way to be sure is for the service to contain no destructive call at all,
     * rather than for every path to remember the soft one.
     */
    const code = source();

    expect(code).not.toMatch(/\.delete\s*\(/);
    expect(code).not.toMatch(/\.deleteMany\s*\(/);
    // And it does what it does instead.
    expect(code).toContain('deletedAt');
  });

  it('MANDATORY @INV-035: renderPostBody is the ONLY way a body is produced', () => {
    /*
     * If any path assigned bodyHtml from something else, that path would store unsanitised
     * markup — and it would be one line in a file whose header promises otherwise.
     */
    const code = source();

    const renderCalls = code.match(/renderPostBody\(/g) ?? [];
    expect(renderCalls.length).toBeGreaterThan(0);

    /*
     * Only ASSIGNMENTS, not type declarations or Prisma `select` clauses.
     *
     * The first version matched every line containing `bodyHtml:` and failed on
     * `readonly bodyHtml: string;` inside an interface. A declaration is not a write, and a
     * check that cannot tell them apart has to be loosened until it stops meaning anything —
     * so it discriminates instead.
     */
    const assignments = code
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('bodyHtml:'))
      // Not an interface field: `readonly bodyHtml: string;`
      .filter((l) => !l.startsWith('readonly'))
      /*
       * Not a Prisma projection: `select: { id: true, bodyHtml: true, editCount: true }`.
       *
       * My previous filter anchored on end-of-line, which missed this because `bodyHtml: true`
       * sits in the MIDDLE of the select. Matching `bodyHtml: true` anywhere is the right rule:
       * `true` is never a body, so a line asserting it is asking to READ the column, not
       * writing to it.
       */
      .filter((l) => !/bodyHtml:\s*(true|string|boolean)\b/.test(l));

    expect(assignments.length, 'expected at least one bodyHtml WRITE').toBeGreaterThan(0);
    for (const line of assignments) {
      // Every stored bodyHtml comes from a rendered result and nowhere else.
      expect(line, line).toMatch(/rendered\.bodyHtml/);
    }
  });
});
