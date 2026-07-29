/**
 * The global Inara rate limiter (INV-033).
 *
 * ★ "GLOBALLY" IS THE LOAD-BEARING WORD ★
 *
 * A per-caller limiter is easy to write and useless. Two jobs each politely
 * spacing their own calls thirty seconds apart still hit Inara four times a
 * minute between them — and Inara's limit applies to us as a consumer, not to
 * our internal structure.
 *
 * So there is ONE limiter, exported as a singleton, and every caller queues
 * behind it. Exceeding the limit gets the API key revoked, and there is no
 * partial failure: verification stops working for everybody at once.
 *
 * Never called from a request path. Inara is polled by the worker; a member
 * waiting on an HTTP response must never be waiting on this queue, which can
 * legitimately be minutes long.
 */

/** Two per minute. */
export const INARA_MIN_SPACING_MS = 30_000;

/**
 * The queue was too deep to serve a request-path caller in time.
 *
 * A distinct class so callers can tell it apart from Inara refusing: one means
 * "try again shortly", the other means "your key is wrong". Conflating them
 * would tell a member with a perfectly good key that it was invalid.
 */
export class LimiterBusyError extends Error {
  constructor(waitedMs: number) {
    super(`No Inara rate-limit slot within ${waitedMs}ms.`);
    this.name = 'LimiterBusyError';
  }
}

type Task = () => void;

export class InaraLimiter {
  #queue: Task[] = [];
  #lastDispatch = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  /** How many tasks are waiting. Exposed for tests and for a health endpoint. */
  pending(): number {
    return this.#queue.length;
  }

  /**
   * Queues a call and resolves with its result.
   *
   * The task's own failure is delivered to ITS caller and to nobody else, and
   * it does not stop the queue. A limiter that stops dispatching after one
   * upstream error turns a transient Inara blip into a permanent outage of
   * every verification — and the symptom is silence, which nobody investigates.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#queue.push(() => {
        task().then(resolve, reject);
      });
      this.#schedule();
    });
  }

  /**
   * Queues a call, but GIVES UP if the slot does not arrive in time.
   *
   * ★ WHY THIS EXISTS ★
   *
   * The limiter is deliberately global and 30 seconds wide, so a busy queue is
   * legitimately minutes deep. That is fine for a worker and unacceptable on a
   * request path: a member linking their Inara key while nine others are queued
   * would wait four and a half minutes inside an HTTP request, and the
   * connection would time out long before Inara answered.
   *
   * So a request-path caller waits a SHORT bounded time. In practice the queue
   * is empty — 108 members add a key once, over weeks — and the slot is
   * immediate. Under contention it degrades to "we will verify this shortly"
   * instead of hanging, and the worker finishes the job.
   *
   * Rejects with a distinguishable error rather than resolving null, so a
   * caller cannot mistake "no slot" for "Inara said no".
   */
  async runWithin<T>(timeoutMs: number, task: () => Promise<T>): Promise<T> {
    let dispatched = false;
    const wrapped = async (): Promise<T> => {
      dispatched = true;
      return task();
    };

    return Promise.race([
      this.run(wrapped),
      new Promise<never>((_resolve, reject) => {
        const t = setTimeout(() => {
          // Only give up if the task has NOT started. Once Inara is actually
          // being called, abandoning it would waste the rate-limit slot we just
          // spent — the scarcest thing here.
          if (!dispatched) reject(new LimiterBusyError(timeoutMs));
        }, timeoutMs);
        t.unref?.();
      }),
    ]);
  }

  #schedule(): void {
    if (this.#timer !== null || this.#queue.length === 0) return;

    const since = Date.now() - this.#lastDispatch;
    // An idle limiter has no reason to make the first caller wait: rate
    // limiting should not add latency that is not actually needed.
    const wait = this.#lastDispatch === 0 ? 0 : Math.max(0, INARA_MIN_SPACING_MS - since);

    this.#timer = setTimeout(() => {
      this.#timer = null;
      const next = this.#queue.shift();
      if (next !== undefined) {
        this.#lastDispatch = Date.now();
        next();
      }
      // Re-schedule AFTER dispatching, so the queue keeps draining at the
      // correct spacing rather than only when a new call arrives.
      this.#schedule();
    }, wait);

    /*
     * ★ NOT unref'd — AND THAT REVERSES THE PREVIOUS REASONING ★
     *
     * It used to be, on the grounds that "a worker that has finished its work
     * should exit, not linger for a 30-second timer". But this timer only
     * exists when the queue is NOT empty, so unref'ing it says the opposite of
     * what was intended: a process with Inara calls still queued would exit
     * before dispatching them.
     *
     * That is not hypothetical. The worker is a one-shot cron process, and its
     * twenty-minute sweep would have exited silently having called Inara zero
     * times — reporting success, with nothing in any log. It showed up here as
     * Node's "Detected unsettled top-level await" in a probe script.
     *
     * The timer clears itself once the queue drains, so nothing lingers. The
     * only unref'd timer is the give-up timer in `runWithin`, which is correct:
     * that one exists to STOP waiting.
     */
  }
}

let singleton: InaraLimiter | null = null;

/**
 * THE limiter. Always the same object.
 *
 * A module-level singleton rather than DI: the invariant is that there is
 * exactly one across the whole process, and a container that can be configured
 * to provide two would make that a matter of configuration rather than of fact.
 */
export function inaraLimiter(): InaraLimiter {
  singleton ??= new InaraLimiter();
  return singleton;
}

/**
 * Discards the singleton. TESTS ONLY.
 *
 * Necessary because the limiter is deliberately not injectable — making it a
 * constructor argument would let a caller supply their own and quietly hold two
 * limiters, which is the exact failure INV-033 exists to prevent. So the only
 * way for one test not to inherit the previous test's 30-second spacing is to
 * discard the instance.
 *
 * REFUSES to run in production. A reset there would mean an in-flight queue is
 * abandoned and the next caller dispatches immediately — briefly doubling the
 * rate, which is the thing that gets the API key revoked.
 */
export function resetInaraLimiterForTests(): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('resetInaraLimiterForTests() must never be called in production (INV-033).');
  }
  singleton = null;
}
