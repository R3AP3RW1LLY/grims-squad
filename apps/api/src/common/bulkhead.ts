/**
 * A ceiling on how much of the process one expensive route may consume.
 *
 * ★ WRITTEN AFTER THE OUTAGE OF 2026-08-06 ★
 *
 * `pg_stat_activity` showed twenty-five concurrent queries from the API container, and twenty-five
 * is the whole connection pool. Every one of them was the colonisation shopping list. Sign-in, the
 * roster, and the health check the deploy gates on were all queued behind one page's market
 * lookups, and the squadron owner's report was that the companion app could not connect at all.
 *
 * Two other fixes address that specific cause: coalescing removes the duplicate work, and the
 * composite GiST index made the remaining work roughly three hundred times cheaper. This addresses
 * the SHAPE of the failure instead — whatever the next expensive query turns out to be, it must not
 * be able to take the whole process down with it.
 *
 * ★ REFUSING IS THE FEATURE ★
 *
 * An unbounded queue is not a bulkhead; it is the same collapse with a longer fuse, and it is
 * exactly what a fourteen-second response was. A request refused in a millisecond is a better
 * outcome than one that waits and then times out at the proxy: the member gets an answer they can
 * act on, and every other request still works.
 */

/** Thrown when the route is at capacity. Carries a 503 so the exception filter maps it correctly. */
export class BulkheadFullError extends Error {
  readonly statusCode = 503;

  constructor(name: string) {
    super(
      `The ${name} service is busy right now — too many requests at once. Try again in a moment.`,
    );
    this.name = 'BulkheadFullError';
  }
}

export interface BulkheadOptions {
  /** How many may run at once. */
  limit: number;
  /**
   * How many may WAIT. Bounded deliberately: an unbounded queue converts a refusal into a timeout,
   * which is the failure this exists to prevent.
   */
  queue: number;
  /** Used in the refusal message, so a member is told which thing is busy. */
  name?: string;
}

export class Bulkhead {
  #active = 0;
  readonly #waiting: Array<() => void> = [];
  readonly #limit: number;
  readonly #queue: number;
  readonly #name: string;

  constructor(options: BulkheadOptions) {
    this.#limit = Math.max(1, options.limit);
    this.#queue = Math.max(0, options.queue);
    this.#name = options.name ?? 'requested';
  }

  /**
   * Occupancy, for the health endpoint and the uptime probe.
   *
   * The incident was invisible until members complained. A number that can be read BEFORE the
   * queue overflows is the difference between an alert and a bug report.
   */
  stats(): { active: number; waiting: number; limit: number; queue: number } {
    return { active: this.#active, waiting: this.#waiting.length, limit: this.#limit, queue: this.#queue };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#limit) {
      if (this.#waiting.length >= this.#queue) throw new BulkheadFullError(this.#name);
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }

    this.#active += 1;
    try {
      return await work();
    } finally {
      /*
       * ★ RELEASED IN `finally`, AND THAT IS THE WHOLE POINT ★
       *
       * A permit leaked on the error path turns this from a safeguard into a deadlock: after
       * `limit` failures the route is closed permanently and only a restart reopens it, which is
       * strictly worse than having no bulkhead at all.
       */
      this.#active -= 1;
      const next = this.#waiting.shift();
      if (next !== undefined) next();
    }
  }
}
