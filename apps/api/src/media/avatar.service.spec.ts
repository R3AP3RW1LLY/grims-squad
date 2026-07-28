import { describe, it, expect, beforeEach } from 'vitest';
import { AvatarService, avatarKey, type AvatarStore } from './avatar.service.js';
import { s3ConfigFrom, type ObjectStore, type StoredObject } from './object-store.js';
import { FileObjectStore } from './object-store.drivers.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Copying a member's Discord avatar onto our own storage.
 *
 * ★ THE PROPERTY THAT MATTERS MOST ★
 *
 * This runs on the SIGN-IN path. An avatar is decoration, and a member being
 * unable to sign in because Discord's CDN was slow would be an absurd trade —
 * so nothing in here may throw, whatever goes wrong.
 */

class MemoryStore implements ObjectStore {
  objects = new Map<string, StoredObject>();
  putCalls = 0;

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.putCalls += 1;
    this.objects.set(key, { body, contentType });
  }
  async get(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

class FakeAvatarStore implements AvatarStore {
  discordId: string | null = '111222333';
  avatarHash: string | null = 'abc123';
  stored: string | null = null;

  async readIdentity() {
    return this.discordId === null
      ? null
      : { discordId: this.discordId, avatarHash: this.avatarHash };
  }
  async recordStoredHash(_userId: string, hash: string | null): Promise<void> {
    this.stored = hash;
  }
  async storedHash(): Promise<string | null> {
    return this.stored;
  }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function okFetch(body = PNG, contentType = 'image/png'): typeof fetch {
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': contentType } })) as typeof fetch;
}

let objects: MemoryStore;
let store: FakeAvatarStore;

beforeEach(() => {
  objects = new MemoryStore();
  store = new FakeAvatarStore();
});

describe('copying the avatar', () => {
  it('fetches it and puts it in storage', async () => {
    const svc = new AvatarService(objects, store, okFetch());
    const r = await svc.syncFromDiscord('u1');

    expect(r.updated).toBe(true);
    expect(objects.objects.has(avatarKey('u1', 'abc123'))).toBe(true);
    expect(store.stored).toBe('abc123');
  });

  it('MANDATORY: does not re-fetch when the hash has not changed', async () => {
    /*
     * Discord's hash changes only when the picture does, so it doubles as a
     * cache key. Without this check, every sign-in would be a request to
     * Discord for an image that changes twice a year.
     */
    store.stored = 'abc123';
    const svc = new AvatarService(objects, store, okFetch());

    expect((await svc.syncFromDiscord('u1')).updated).toBe(false);
    expect(objects.putCalls).toBe(0);
  });

  it('fetches again when they change their picture', async () => {
    store.stored = 'oldhash';
    const svc = new AvatarService(objects, store, okFetch());

    expect((await svc.syncFromDiscord('u1')).updated).toBe(true);
    expect(store.stored).toBe('abc123');
  });

  it('stores nothing for a member on the default Discord avatar', async () => {
    // A generated shape, not a picture they chose. The UI draws initials.
    store.avatarHash = null;
    const svc = new AvatarService(objects, store, okFetch());

    await svc.syncFromDiscord('u1');
    expect(objects.putCalls).toBe(0);
    expect(store.stored).toBeNull();
  });

  it('MANDATORY: records the hash only AFTER the write lands', async () => {
    /*
     * The other order marks it stored, fails to write, and never tries again —
     * a permanently missing avatar that looks to us like it worked.
     */
    const failing: ObjectStore = {
      put: async () => {
        throw new Error('storage down');
      },
      get: async () => null,
      delete: async () => undefined,
    };
    const svc = new AvatarService(failing, store, okFetch());

    await svc.syncFromDiscord('u1');
    expect(store.stored).toBeNull();
  });
});

describe('nothing here may break a sign-in', () => {
  it('MANDATORY: survives the CDN being unreachable', async () => {
    const svc = new AvatarService(objects, store, (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch);

    await expect(svc.syncFromDiscord('u1')).resolves.toEqual({ updated: false });
  });

  it('MANDATORY: survives storage being down', async () => {
    const failing: ObjectStore = {
      put: async () => {
        throw new Error('nope');
      },
      get: async () => null,
      delete: async () => undefined,
    };
    await expect(
      new AvatarService(failing, store, okFetch()).syncFromDiscord('u1'),
    ).resolves.toEqual({ updated: false });
  });

  it('survives a 404 from the CDN', async () => {
    const svc = new AvatarService(objects, store, (async () =>
      new Response('', { status: 404 })) as typeof fetch);

    await expect(svc.syncFromDiscord('u1')).resolves.toEqual({ updated: false });
    expect(objects.putCalls).toBe(0);
  });

  it('survives a member with no Discord identity at all', async () => {
    store.discordId = null;
    const svc = new AvatarService(objects, store, okFetch());
    await expect(svc.syncFromDiscord('u1')).resolves.toEqual({ updated: false });
  });
});

describe('what we refuse to store', () => {
  it('MANDATORY: refuses anything that is not an image', async () => {
    /*
     * Checked even though the source is Discord's own CDN. These bytes get
     * served back under OUR origin, and serving a non-image from our own domain
     * is how a stored XSS gets in — an SVG in particular executes script when
     * a browser renders it.
     */
    for (const type of ['image/svg+xml', 'text/html', 'application/javascript', '']) {
      objects = new MemoryStore();
      const svc = new AvatarService(objects, store, okFetch(PNG, type));

      await svc.syncFromDiscord('u1');
      expect(objects.putCalls, type).toBe(0);
    }
  });

  it('accepts the formats Discord actually serves', async () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      objects = new MemoryStore();
      store.stored = null;
      const svc = new AvatarService(objects, store, okFetch(PNG, type));

      await svc.syncFromDiscord('u1');
      expect(objects.putCalls, type).toBe(1);
    }
  });

  it('MANDATORY: refuses something implausibly large', async () => {
    // A 256px avatar is a few kilobytes. Anything near the cap is not one, and
    // storing it would be somebody else deciding how much disk we use.
    const huge = new Uint8Array(3 * 1024 * 1024);
    const svc = new AvatarService(objects, store, okFetch(huge));

    await svc.syncFromDiscord('u1');
    expect(objects.putCalls).toBe(0);
  });

  it('refuses an empty body', async () => {
    const svc = new AvatarService(objects, store, okFetch(new Uint8Array(0)));
    await svc.syncFromDiscord('u1');
    expect(objects.putCalls).toBe(0);
  });

  it('honours the content type it was given, ignoring the URL', async () => {
    const svc = new AvatarService(objects, store, okFetch(PNG, 'image/gif; charset=binary'));
    await svc.syncFromDiscord('u1');
    expect(objects.objects.get(avatarKey('u1', 'abc123'))?.contentType).toBe('image/gif');
  });
});

describe('reading it back', () => {
  it('returns null for a member with no stored avatar', async () => {
    expect(await new AvatarService(objects, store, okFetch()).read('u1')).toBeNull();
  });

  it('returns the bytes once stored', async () => {
    const svc = new AvatarService(objects, store, okFetch());
    await svc.syncFromDiscord('u1');

    const read = await svc.read('u1');
    expect(read?.body).toEqual(PNG);
  });
});

describe('the local disk driver', () => {
  it('round-trips content and type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gs-store-'));
    const fs = new FileObjectStore(dir);

    await fs.put('avatars/u1/abc.img', PNG, 'image/png');
    const read = await fs.get('avatars/u1/abc.img');

    expect(read?.body).toEqual(Buffer.from(PNG));
    expect(read?.contentType).toBe('image/png');
  });

  it('MANDATORY: refuses a key that escapes the root', async () => {
    /*
     * Keys are ours today, and this class takes a string and writes a file with
     * it. The equivalent slip in the S3 driver is harmless; here it is
     * arbitrary file write, so the check is worth its one comparison.
     */
    const dir = await mkdtemp(join(tmpdir(), 'gs-store-'));
    const fs = new FileObjectStore(dir);

    await expect(fs.put('../../escaped.txt', PNG, 'image/png')).rejects.toThrow(/escapes/i);
  });

  it('returns null for something that is not there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gs-store-'));
    expect(await new FileObjectStore(dir).get('nothing/here.img')).toBeNull();
  });
});

describe('reading the S3 settings', () => {
  it('reports absence rather than throwing', () => {
    // A developer with no bucket is a legitimate state, not a misconfiguration.
    expect(s3ConfigFrom({})).toBeNull();
  });

  it('treats the placeholder values as absent', () => {
    // .env.example ships CHANGE_ME. Copying it and forgetting must read as
    // "not configured", not as a bucket literally named CHANGE_ME.
    expect(
      s3ConfigFrom({
        S3_ENDPOINT: 'https://CHANGE_ME.vultrobjects.com',
        S3_REGION: 'CHANGE_ME',
        S3_BUCKET: 'CHANGE_ME',
        S3_ACCESS_KEY_ID: 'CHANGE_ME',
        S3_SECRET_ACCESS_KEY: 'CHANGE_ME',
      }),
    ).toBeNull();
  });

  it('MANDATORY: refuses a HALF-configured bucket', () => {
    /*
     * The dangerous middle. Silently falling back to local disk would mean a
     * production deploy quietly storing avatars on a container filesystem and
     * losing them on every restart — with nothing in the logs to say why.
     */
    expect(() =>
      s3ConfigFrom({
        S3_ENDPOINT: 'https://ewr1.vultrobjects.com',
        S3_BUCKET: 'grims-squad-uploads',
      }),
    ).toThrow(/partly configured/i);
  });

  it('reads a complete configuration', () => {
    const config = s3ConfigFrom({
      S3_ENDPOINT: 'https://ewr1.vultrobjects.com',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'grims-squad-uploads',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(config?.bucket).toBe('grims-squad-uploads');
  });
});
