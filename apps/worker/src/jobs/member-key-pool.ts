import type { PrismaClient } from '@grims/db';
import type { TokenCipher } from '@grims/shared/server';
import type { InaraKeyPool } from '@grims/ed-clients';

/**
 * The keys the rank sweep calls Inara with.
 *
 * ★ THERE IS NO SQUADRON KEY — squadron owner, 2026-07-29 ★
 *
 * Inara issues API keys to PEOPLE. The sweep was written around a single
 * `INARA_API_KEY` that would belong to the squadron, and no such thing exists;
 * it was never going to be set, which is why every rank on the roster has been
 * blank for anyone not running the companion app.
 *
 * So it borrows from the members who have linked their own key — the same keys
 * that already prove their commander name, decrypted the same way.
 *
 * ★ ROTATION IS THE POINT, NOT AN OPTIMISATION ★
 *
 * Inara's envelope carries ONE key and any number of events, so a thirty-name
 * chunk is authenticated by one member. Always picking the same one would put
 * the squadron's entire rate spend on a single person's key and make the sweep
 * die the day they revoke it. Round-robin spreads it, and a rejected key is
 * retired for the rest of the run rather than retried on every chunk.
 *
 * ★ WHAT THIS DOES NOT DO ★
 *
 * It does not read anybody's private Inara data. The sweep asks for PUBLIC
 * commander profiles by name — the same pages anyone can open in a browser —
 * and the key only identifies the caller to Inara's rate limiter. A member's
 * key is never used to fetch something they could not already see.
 */
export class RotatingKeyPool implements InaraKeyPool {
  readonly #keys: string[];
  readonly #rejected = new Set<string>();
  #cursor = 0;

  constructor(keys: readonly string[]) {
    // De-duplicated: two members pasting the same key would otherwise make the
    // rotation lopsided and double the cost of retiring it.
    this.#keys = [...new Set(keys.filter((k) => k.trim() !== ''))];
  }

  get size(): number {
    return this.#keys.length - this.#rejected.size;
  }

  next(): string | null {
    /*
     * Bounded by the pool size. A `while (true)` here would spin forever once
     * every key had been rejected, against a third party we are rate-limited
     * on — the worst possible place to busy-loop.
     */
    for (let tried = 0; tried < this.#keys.length; tried += 1) {
      const key = this.#keys[this.#cursor % this.#keys.length];
      this.#cursor += 1;
      if (key !== undefined && !this.#rejected.has(key)) return key;
    }
    return null;
  }

  reject(key: string): void {
    this.#rejected.add(key);
  }
}

/**
 * Every member key we hold, decrypted.
 *
 * ★ VERIFIED KEYS ONLY ★
 *
 * `verifiedAt` is set when Inara last confirmed the key works and returned a
 * name. An unverified row is a key somebody pasted that has never been shown to
 * work — using it would spend a chunk's worth of rate budget to be told it is
 * invalid, on a sweep that has two requests a minute to spend (INV-033).
 */
export async function loadMemberKeys(
  db: PrismaClient,
  cipher: TokenCipher,
): Promise<RotatingKeyPool> {
  const links = await db.inaraLink.findMany({
    where: { verifiedAt: { not: null } },
    select: { userId: true, apiKeyEnc: true },
  });

  const keys: string[] = [];
  for (const link of links) {
    try {
      /*
       * The SAME associated data the squadron re-check uses. It is bound to the
       * member's id (INV-012), so a row lifted from this table cannot be
       * decrypted as somebody else's — and getting the string even slightly
       * wrong here would fail every decrypt and look exactly like "no member
       * has a key".
       *
       * Buffer.from(...), not .toString('utf8') on the raw value: Prisma 6 maps
       * Bytes to Uint8Array, whose toString takes no encoding argument and
       * would silently yield a comma-separated list of byte values.
       */
      keys.push(
        cipher.decrypt(Buffer.from(link.apiKeyEnc).toString('utf8'), `inara-key:${link.userId}`),
      );
    } catch {
      /*
       * A key that will not decrypt is a key we cannot use — almost always a
       * keyring rotation that left old ciphertext behind. Skipped rather than
       * thrown, because one member's undecryptable row must not stop the sweep
       * for everybody else.
       */
    }
  }

  return new RotatingKeyPool(keys);
}
