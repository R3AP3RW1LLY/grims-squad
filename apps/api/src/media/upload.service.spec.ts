import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { ErrorCode, Permission } from '@grims/shared';
import { UploadService, DAILY_UPLOAD_LIMIT } from './upload.service.js';
import { s3ConfigFrom } from './object-store.js';
import type { ObjectStore } from './object-store.js';
import type { PrismaClient } from '@grims/db';

/**
 * Who may upload, and what happens to the bytes on the way in.
 *
 * The hardening itself is covered by `image-hardening.spec.ts` against real payloads. This
 * file is about the decisions AROUND it: the permission gate, the quota, the order those
 * run in, and what is left behind when storage fails.
 */

const png = (w = 8, h = 8): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#c05000' } })
    .png()
    .toBuffer();

/** An object store that records what it was asked to do. */
function memoryStore(): ObjectStore & { readonly puts: Array<{ key: string; type: string }> } {
  const puts: Array<{ key: string; type: string }> = [];
  const files = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    puts,
    async put(key, body, contentType) {
      puts.push({ key, type: contentType });
      files.set(key, { body, contentType });
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
  };
}

interface DbStubOptions {
  readonly recentCount?: number;
  readonly onCreate?: () => void;
}

function dbStub(opts: DbStubOptions = {}) {
  const deleted: string[] = [];
  const updated: Array<{ id: string; storageKey: string }> = [];
  const rows = new Map<string, { storageKey: string; contentType: string }>();

  const db = {
    mediaUpload: {
      count: vi.fn(async () => opts.recentCount ?? 0),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        opts.onCreate?.();
        const id = '11111111-2222-4333-8444-555555555555';
        rows.set(id, {
          storageKey: args.data['storageKey'] as string,
          contentType: args.data['contentType'] as string,
        });
        return { id };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { storageKey: string } }) => {
        updated.push({ id: args.where.id, storageKey: args.data.storageKey });
        const row = rows.get(args.where.id);
        if (row !== undefined) rows.set(args.where.id, { ...row, storageKey: args.data.storageKey });
        return {};
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        deleted.push(args.where.id);
        rows.delete(args.where.id);
        return {};
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => rows.get(args.where.id) ?? null),
    },
  };

  return { db: db as unknown as PrismaClient, deleted, updated, rows, raw: db };
}

const MEMBER = Permission.FORUM_POST_MEMBER;
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


describe('who may upload', () => {
  it('MANDATORY: a mask without FORUM_POST_MEMBER is refused', async () => {
    const store = memoryStore();
    const { db } = dbStub();
    const svc = new UploadService(store, db);

    await expect(svc.upload('u1', 0n, await png())).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
  });

  it('MANDATORY: refuses BEFORE decoding anything', async () => {
    /*
     * ★ THE ORDERING THAT MATTERS ★
     *
     * The decode is by far the most expensive thing in this path, which makes it exactly
     * what an unauthorised caller would aim at. Cheapest check first: a refused caller must
     * never cost us an image decode, and must never reach the database either.
     */
    const store = memoryStore();
    const { db, raw } = dbStub();
    const svc = new UploadService(store, db);

    await expect(svc.upload('u1', 0n, await png())).rejects.toThrow();

    expect(raw.mediaUpload.count).not.toHaveBeenCalled();
    expect(raw.mediaUpload.create).not.toHaveBeenCalled();
    expect(store.puts).toHaveLength(0);
  });

  it('a member who can post can upload', async () => {
    const store = memoryStore();
    const { db } = dbStub();
    const svc = new UploadService(store, db);

    const out = await svc.upload('u1', MEMBER, await png(64, 32));

    expect(out.width).toBe(64);
    expect(out.height).toBe(32);
    expect(store.puts).toHaveLength(1);
  });
});

describe('the quota', () => {
  it('MANDATORY: refuses past the daily limit', async () => {
    const store = memoryStore();
    const { db } = dbStub({ recentCount: DAILY_UPLOAD_LIMIT });
    const svc = new UploadService(store, db);

    await expect(svc.upload('u1', MEMBER, await png())).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMITED,
    });
    // And nothing was stored.
    expect(store.puts).toHaveLength(0);
  });

  it('MANDATORY: is checked before the decode, not after', async () => {
    // Same reasoning as the permission gate: a member over quota should not be able to
    // spend our CPU by looping.
    const store = memoryStore();
    const { db, raw } = dbStub({ recentCount: DAILY_UPLOAD_LIMIT });
    const svc = new UploadService(store, db);

    await expect(svc.upload('u1', MEMBER, await png())).rejects.toThrow();
    expect(raw.mediaUpload.create).not.toHaveBeenCalled();
  });

  it('MANDATORY: counts a ROLLING 24 hours, not "today"', async () => {
    /*
     * A calendar-day limit is doubled by uploading either side of midnight, which is the
     * kind of bound that looks enforced and is not.
     */
    const store = memoryStore();
    const { db, raw } = dbStub();
    const svc = new UploadService(store, db);

    const before = Date.now();
    await svc.upload('u1', MEMBER, await png());

    const where = firstArg<{ where: { createdAt: { gte: Date } } }>(
      raw.mediaUpload.count,
      'the quota count',
    );
    const gte = where.where.createdAt.gte;

    expect(gte).toBeInstanceOf(Date);
    // ~24h before now, not midnight.
    const ageMs = before - (gte as Date).getTime();
    expect(ageMs).toBeGreaterThan(23.9 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(24.1 * 60 * 60 * 1000);
  });

  it('lets the limit through at one below it', async () => {
    const store = memoryStore();
    const { db } = dbStub({ recentCount: DAILY_UPLOAD_LIMIT - 1 });
    const svc = new UploadService(store, db);

    await expect(svc.upload('u1', MEMBER, await png())).resolves.toMatchObject({
      width: 8,
    });
  });
});

describe('the storage key', () => {
  it('MANDATORY: is derived from our own row id, never from the client', async () => {
    /*
     * The client sends bytes and nothing else — no filename anywhere in this path. So there
     * is no caller-influenced component of the key, and therefore no traversal to defend
     * against. Cheaper than sanitising a filename, and it cannot be got wrong later.
     */
    const store = memoryStore();
    const { db, updated } = dbStub();
    const svc = new UploadService(store, db);

    const out = await svc.upload('u1', MEMBER, await png());

    expect(store.puts[0]?.key).toBe(`uploads/${out.id}.png`);
    // And the row is corrected from its provisional key to the real one.
    expect(updated[0]?.storageKey).toBe(`uploads/${out.id}.png`);
  });

  it('MANDATORY: the returned path is RELATIVE, which is what the sanitiser accepts', async () => {
    /*
     * `isOwnMediaSrc` accepts only relative paths — an absolute URL is refused even for our
     * own domain, because host comparison has too many wrong answers. Returning an absolute
     * URL here would hand the client something the sanitiser then rejects, and the member
     * would see their image turn into text with no explanation.
     */
    const store = memoryStore();
    const { db } = dbStub();
    const svc = new UploadService(store, db);

    const out = await svc.upload('u1', MEMBER, await png());

    expect(out.path).toBe(`/v1/media/uploads/${out.id}`);
    expect(out.path.startsWith('/')).toBe(true);
    expect(out.path).not.toMatch(/^https?:/);
  });

  it('names the extension from what WE encoded, not what arrived', async () => {
    const store = memoryStore();
    const { db } = dbStub();
    const svc = new UploadService(store, db);

    // A JPEG in, so jpg out — decided by the decoder, not by a declared type.
    const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
      .jpeg()
      .toBuffer();
    const out = await svc.upload('u1', MEMBER, jpg);

    expect(store.puts[0]?.key).toBe(`uploads/${out.id}.jpg`);
    expect(store.puts[0]?.type).toBe('image/jpeg');
  });
});

describe('when storage fails', () => {
  it('MANDATORY: deletes the row rather than leaving a permanent broken image', async () => {
    /*
     * ★ WHICH WAY TO LEAK ★
     *
     * An orphaned ROW points at an object that does not exist and renders as a broken image
     * forever. An orphaned OBJECT is dead bytes nobody references. Given the choice, leak
     * the bytes — so the row goes.
     */
    const store = memoryStore();
    store.put = async () => {
      throw new Error('bucket unreachable');
    };
    const { db, deleted } = dbStub();
    const svc = new UploadService(store, db);

    await expect(svc.upload('u1', MEMBER, await png())).rejects.toThrow(/bucket unreachable/);

    expect(deleted).toHaveLength(1);
  });

  it('still reports the original failure if the cleanup also fails', async () => {
    // The member needs to know the upload failed. A cleanup error swallowing that would
    // report a database problem for what was actually a storage problem.
    const store = memoryStore();
    store.put = async () => {
      throw new Error('bucket unreachable');
    };
    const { db, raw } = dbStub();
    raw.mediaUpload.delete = vi.fn(async () => {
      throw new Error('and the delete failed too');
    });
    const svc = new UploadService(store, db);

    await expect(svc.upload('u1', MEMBER, await png())).rejects.toThrow(/bucket unreachable/);
  });
});

describe('serving', () => {
  it('MANDATORY: a malformed id returns null rather than throwing', async () => {
    /*
     * `findUnique` on a non-uuid throws a Prisma error, which would surface as a 500. The
     * honest answer to "is there an image at /uploads/bogus" is no.
     */
    const store = memoryStore();
    const { db, raw } = dbStub();
    const svc = new UploadService(store, db);

    for (const id of ['bogus', '', '../../etc/passwd', '11111111', 'not-a-uuid-at-all']) {
      expect(await svc.serve(id), id).toBeNull();
    }
    // Never even asked the database.
    expect(raw.mediaUpload.findUnique).not.toHaveBeenCalled();
  });

  it('returns the content type from OUR row, not from the store', async () => {
    /*
     * The row records what we encoded. The store echoes back whatever it was told, which is
     * one indirection further from the thing we actually know.
     */
    const store = memoryStore();
    const { db } = dbStub();
    const svc = new UploadService(store, db);

    const out = await svc.upload('u1', MEMBER, await png());
    const served = await svc.serve(out.id);

    expect(served?.contentType).toBe('image/png');
    expect(served?.body.byteLength).toBeGreaterThan(0);
  });

  it('a known id whose object has vanished returns null, not a partial response', async () => {
    const store = memoryStore();
    const { db } = dbStub();
    const svc = new UploadService(store, db);

    const out = await svc.upload('u1', MEMBER, await png());
    await store.delete(`uploads/${out.id}.png`);

    expect(await svc.serve(out.id)).toBeNull();
  });
});

describe('media must not share a bucket with database backups', () => {
  /*
   * ★ THE OWNER'S CONSTRAINT, ENFORCED RATHER THAN DOCUMENTED ★
   *
   * "WE WANT A NEW Storage i do not want this to be saved with backups!"
   *
   * `backup-db.sh` already reads its own BACKUP_S3_BUCKET. Until now that separation was a
   * CONVENTION — two variables that happen to differ, with nothing objecting if somebody
   * set them the same. That is the kind of constraint that survives right up until a
   * hurried .env edit.
   */
  const base = {
    S3_ENDPOINT: 'https://ewr1.vultrobjects.com',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'ak',
    S3_SECRET_ACCESS_KEY: 'sk',
  };

  it('MANDATORY: refuses to start when the two buckets are the same', () => {
    expect(() =>
      s3ConfigFrom({ ...base, S3_BUCKET: 'grims-data', BACKUP_S3_BUCKET: 'grims-data' } as NodeJS.ProcessEnv),
    ).toThrow(/must not share storage/i);
  });

  it('accepts distinct buckets', () => {
    const cfg = s3ConfigFrom({
      ...base,
      S3_BUCKET: 'grims-media',
      BACKUP_S3_BUCKET: 'grims-backups',
    } as NodeJS.ProcessEnv);

    expect(cfg?.bucket).toBe('grims-media');
  });

  it('does not fire when the backup bucket is unset or a placeholder', () => {
    /*
     * A developer with no backup configuration must not be blocked. The guard is about two
     * REAL values colliding, not about requiring backups to exist.
     */
    expect(s3ConfigFrom({ ...base, S3_BUCKET: 'grims-media' } as NodeJS.ProcessEnv)?.bucket).toBe(
      'grims-media',
    );
    expect(
      s3ConfigFrom({
        ...base,
        S3_BUCKET: 'grims-media',
        BACKUP_S3_BUCKET: 'https://CHANGE_ME.vultrobjects.com',
      } as NodeJS.ProcessEnv)?.bucket,
    ).toBe('grims-media');
  });

  it('names both variables in the message, so the fix is obvious', () => {
    // An error that says "misconfigured" sends somebody reading source at 2am.
    try {
      s3ConfigFrom({ ...base, S3_BUCKET: 'same', BACKUP_S3_BUCKET: 'same' } as NodeJS.ProcessEnv);
      expect.unreachable('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('S3_BUCKET');
      expect(msg).toContain('BACKUP_S3_BUCKET');
      expect(msg).toContain('same');
    }
  });
});
