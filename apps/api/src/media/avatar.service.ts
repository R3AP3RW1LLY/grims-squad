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
  async syncFromDiscord(userId: string): Promise<{ updated: boolean }> {
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

      if ((await this.store.storedHash(userId)) === avatarHash) return { updated: false };

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
  async read(userId: string): Promise<StoredObject | null> {
    const hash = await this.store.storedHash(userId);
    if (hash === null) return null;
    return this.objects.get(avatarKey(userId, hash));
  }
}
