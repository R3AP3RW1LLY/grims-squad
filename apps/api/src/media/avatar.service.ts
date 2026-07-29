import type { ObjectStore, StoredObject } from './object-store.js';

/**
 * Bringing a member's Discord avatar onto our own storage.
 *
 * ★ WHY COPY IT AT ALL ★
 *
 * Discord's CDN URLs are public, stable and free, so linking straight to them
 * is the obvious thing. Three reasons not to:
 *
 *  - It keeps working when they leave. A member who deletes their Discord
 *    account, or simply changes their avatar, otherwise turns into a broken
 *    image on every roster and every forum post they ever made.
 *  - It stops every page view being a request to Discord. Rendering the roster
 *    would tell Discord which of our members were being looked at, by whom,
 *    and how often — from the VIEWER's browser, so we could not see it happen
 *    and they could not opt out of it.
 *  - It survives their rate limits and outages, which we do not control.
 *
 * ★ FETCHED ONCE PER HASH ★
 *
 * Discord's avatar hash changes only when the picture does, so it doubles as a
 * cache key. Re-fetching on every sign-in would be a request per login for an
 * image that changes twice a year.
 */

/** Discord's CDN. Not configurable — there is exactly one, and a settable host here would be an SSRF hole. */
const DISCORD_CDN = 'https://cdn.discordapp.com';

/**
 * The size we ask for.
 *
 * 256 covers the largest place we render one (a profile header) with room for a
 * 2x display, and is small enough that storing one per member is nothing. Asking
 * for 1024 would quadruple storage to serve an image nobody sees at that size.
 */
const AVATAR_SIZE = 256;

/** What we are willing to accept from the CDN. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface AvatarStore {
  /** The Discord id and avatar hash we last saw, and what we have stored. */
  readIdentity(userId: string): Promise<{ discordId: string; avatarHash: string | null } | null>;
  /** Records which hash is now in object storage, so we do not fetch it again. */
  recordStoredHash(userId: string, hash: string | null): Promise<void>;
  storedHash(userId: string): Promise<string | null>;
}

export function avatarKey(userId: string, hash: string): string {
  return `avatars/${userId}/${hash}.img`;
}

export class AvatarService {
  constructor(
    private readonly objects: ObjectStore,
    private readonly store: AvatarStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Copies the member's current Discord avatar into our storage, if it changed.
   *
   * ★ NEVER THROWS ★
   *
   * Called from the sign-in path. An avatar is decoration, and a member being
   * unable to sign in because Discord's CDN was slow would be an absurd trade —
   * so every failure here is swallowed and the old picture (or none) is kept.
   */
  async syncFromDiscord(userId: string, opts: { force?: boolean } = {}): Promise<{ updated: boolean }> {
    try {
      const identity = await this.store.readIdentity(userId);
      if (identity === null) return { updated: false };

      const { discordId, avatarHash } = identity;

      if (avatarHash === null) {
        // Default Discord avatar — a generated shape, not a picture they chose.
        // Nothing worth copying; the UI draws its own initials instead.
        await this.store.recordStoredHash(userId, null);
        return { updated: false };
      }

      /*
       * ★ THE SHORT-CIRCUIT THAT MADE HEALING A NO-OP ★
       *
       * On the sign-in path this is right: an unchanged hash means the bytes we
       * hold are the bytes Discord has, and re-downloading a hundred avatars on
       * every login would be pointless traffic.
       *
       * But it compares the DATABASE against DISCORD and never looks at the
       * store — so in the one case that matters, where the row says stored and
       * the object is missing, it concludes "nothing changed" and writes
       * nothing. Every avatar on the site 404'd while this returned
       * `updated: false` and reported success.
       *
       * `force` is passed by `read()`, which has already established that the
       * object is gone. Nothing else sets it, so the login path keeps its
       * short-circuit.
       */
      if (opts.force !== true && (await this.store.storedHash(userId)) === avatarHash) {
        return { updated: false };
      }

      const url = `${DISCORD_CDN}/avatars/${discordId}/${avatarHash}.png?size=${AVATAR_SIZE}`;
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return { updated: false };

      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
      /*
       * Checked even though the source is Discord's own CDN. We are about to
       * store bytes and serve them back under our origin, and serving something
       * that is not an image from our own domain is how a stored-XSS gets in —
       * an SVG in particular executes script when rendered.
       */
      if (!ALLOWED_TYPES.has(contentType)) return { updated: false };

      const body = new Uint8Array(await res.arrayBuffer());
      if (body.byteLength === 0 || body.byteLength > MAX_AVATAR_BYTES) return { updated: false };

      await this.objects.put(avatarKey(userId, avatarHash), body, contentType);

      // Recorded only AFTER the write lands. The other order would mark it
      // stored, fail to write, and never try again — a permanently missing
      // avatar that looks like it worked.
      await this.store.recordStoredHash(userId, avatarHash);
      return { updated: true };
    } catch {
      // Offline, timed out, storage down. The member signs in regardless.
      return { updated: false };
    }
  }

  /** Reads a member's avatar back, or null when they have none. */
  /**
   * Reads a member's stored avatar, refetching it if the object has gone.
   *
   * ★ THE DATABASE AND THE STORE CAN DISAGREE, AND THEY DID ★
   *
   * `avatarStoredHash` records that we stored a picture. The object itself
   * lives in the object store. Nothing keeps those two in step, so any of these
   * leaves the row saying "stored" while the store has nothing:
   *
   *   - the storage backend changed. Avatars written to local disk during
   *     development are invisible the moment a bucket is configured, which is
   *     exactly what happened here: every avatar on the site 404'd while the
   *     database insisted they were all fine.
   *   - the object was deleted, expired, or lost.
   *   - a write half-succeeded.
   *
   * A plain miss returned null forever, and the UI drew initials for a member
   * who plainly has a picture. So a miss now RE-SYNCS from Discord and tries
   * once more. That makes the store self-healing across exactly the transitions
   * that broke it, and costs one Discord fetch per member per breakage rather
   * than a manual backfill.
   *
   * ★ ONE RETRY, NEVER A LOOP ★
   *
   * If the second read misses too, it returns null and the caller draws
   * initials. A member whose Discord avatar has genuinely gone must not send us
   * round again on every page view — and `syncFromDiscord` never throws, so a
   * CDN outage degrades to initials rather than to an error.
   */
  async read(userId: string): Promise<StoredObject | null> {
    const hash = await this.store.storedHash(userId);
    if (hash === null) return null;

    const found = await this.objects.get(avatarKey(userId, hash)).catch(() => null);
    if (found !== null) return found;

    /*
     * The row says stored and the store disagrees. Believe the store — and
     * FORCE, because the ordinary path compares the row against Discord, would
     * find them equal, and would decline to write the very object we have just
     * discovered is missing.
     */
    await this.syncFromDiscord(userId, { force: true });

    // Re-read the hash: the re-sync may have written a DIFFERENT one, because
    // the member could have changed their picture since the row was written.
    const fresh = await this.store.storedHash(userId);
    if (fresh === null) return null;

    return this.objects.get(avatarKey(userId, fresh)).catch(() => null);
  }
}
