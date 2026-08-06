/**
 * One computation per key, however many callers ask for it at once.
 *
 * ★ WRITTEN AFTER THE OUTAGE OF 2026-08-06 ★
 *
 * The API log showed NINE requests for the same colonisation project within three hundred
 * milliseconds, sustained. Each ran that project's shopping list — sixty to ninety market queries.
 * The companion app was retrying because the endpoint was slow, and the retries were what kept it
 * slow. Response times climbed 667ms → 14,646ms and the whole connection pool went to one route.
 *
 * ★ A CACHE ALONE WOULD NOT HAVE HELPED ★
 *
 * Nine simultaneous misses are nine computations. A cache only rescues the caller who arrives
 * after the first one finishes, and in a stampede nobody does — everybody arrives during. The
 * property that actually matters is COALESCING: one caller computes, the rest wait on that same
 * promise.
 *
 * The TTL is the second half. Together they mean a hot key costs one computation per TTL window
 * no matter how hard it is hit.
 */

interface Entry<T> {
  /** Resolves to the value. Shared by every caller who arrives while it is in flight. */
  readonly promise: Promise<T>;
  /**
   * When this became a settled, cacheable answer — not when it started.
   *
   * Stamped on success only, so the TTL measures the age of an ANSWER rather than the age of an
   * attempt. A slow computation must not be born already stale.
   */
  settledAt: number | null;
}

export interface SingleFlightOptions {
  /**
   * How many keys to keep. The colonisation key includes origin coordinates and filters, so it is
   * effectively unbounded — dragging a radius slider mints a new key per pixel. Without a ceiling
   * this is a slow memory leak in the one process members talk to.
   */
  maxEntries?: number;
}

export class SingleFlight {
  readonly #entries = new Map<string, Entry<unknown>>();
  readonly #maxEntries: number;

  constructor(options: SingleFlightOptions = {}) {
    this.#maxEntries = options.maxEntries ?? 200;
  }

  /** How many keys are held. Exposed so the eviction bound can be asserted rather than assumed. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Return the fresh answer for `key`, joining an in-flight computation or starting one.
   *
   * @param key must distinguish everything that changes the answer. Sharing a key between two
   *   different questions returns one's answer to the other, which is worse than any slowness:
   *   wrong data, delivered quickly, to the wrong member.
   * @param ttlMs how long a settled answer stays fresh.
   */
  async run<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
    const existing = this.#entries.get(key) as Entry<T> | undefined;

    if (existing !== undefined) {
      // Still running: join it. This is the case that ends a stampede.
      if (existing.settledAt === null) return existing.promise;
      // Settled and still fresh.
      if (Date.now() - existing.settledAt < ttlMs) {
        /*
         * Re-inserted so the Map's insertion order tracks recency, which is what makes the
         * eviction below least-recently-USED rather than merely oldest-created. A key that is hit
         * constantly should be the last one evicted, not the first.
         */
        this.#entries.delete(key);
        this.#entries.set(key, existing as Entry<unknown>);
        return existing.promise;
      }
      // Settled but stale: fall through and recompute.
      this.#entries.delete(key);
    }

    const entry: Entry<T> = { promise: undefined as unknown as Promise<T>, settledAt: null };

    /*
     * ★ A FAILURE IS NEVER CACHED ★
     *
     * Caching a rejection turns a five-second database blip into an outage lasting the whole TTL.
     * The entry is removed on the way out so the next caller may try again — while every caller
     * already waiting still receives the rejection rather than hanging.
     */
    const promise = work().then(
      (value) => {
        entry.settledAt = Date.now();
        return value;
      },
      (error: unknown) => {
        if (this.#entries.get(key) === (entry as Entry<unknown>)) this.#entries.delete(key);
        throw error;
      },
    );

    (entry as { promise: Promise<T> }).promise = promise;
    this.#entries.set(key, entry as Entry<unknown>);
    this.#evict();

    return promise;
  }

  /** Drop a key, so a write can make its own read fresh again. */
  forget(key: string): void {
    this.#entries.delete(key);
  }

  #evict(): void {
    // Map iterates in insertion order, and `run` re-inserts on a hit, so the first key is the
    // least recently used.
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) return;
      this.#entries.delete(oldest.value);
    }
  }
}
