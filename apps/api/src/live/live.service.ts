/**
 * Server-sent events: telling a page something changed.
 *
 * ★ WHY SSE AND NOT WEBSOCKETS ★
 *
 * Everything here travels one way — the server says "your telemetry updated",
 * the page re-reads. Nothing is sent upward, so a duplex protocol would buy a
 * second connection type, its own auth story, and a reconnect loop we would
 * have to write ourselves.
 *
 * SSE is a GET that never ends. It carries the session cookie like any other
 * request, reconnects on its own, and dies quietly when the tab closes.
 *
 * ★ WHAT IS SENT, AND WHAT IS NOT ★
 *
 * A NOTIFICATION, never a payload. `{"type":"telemetry"}` tells a page its data
 * is stale; the page then fetches through the normal endpoint, with the normal
 * permission checks.
 *
 * Pushing the data itself would mean every future field had to be re-checked
 * against every privacy rule on a second code path — and the first thing to slip
 * through would be something a member had switched off. One authority for what
 * a member may see, and it is not this file.
 */

/** What changed. Deliberately coarse: a page re-reads whatever it needs. */
export type LiveEventType =
  | 'telemetry'
  | 'presence'
  | 'roster'
  | 'activity'
  | 'verification'
  /*
   * The bell. Per-member for personal rows, userId null for a squadron entry — either way the
   * client re-reads its counts through the normal endpoint; the event carries nothing.
   */
  | 'notification';

export interface LiveEvent {
  readonly type: LiveEventType;
  /** Who it concerns. Null for something squadron-wide. */
  readonly userId: string | null;
}

/** One connected browser tab. */
interface Subscriber {
  readonly userId: string;
  readonly send: (event: LiveEvent) => void;
}

/**
 * How many tabs one member may hold open.
 *
 * Somebody with the dashboard, the roster and the admin console open is three,
 * and a laptop plus a phone is six. Twenty is far above any honest use and far
 * below the point where a member could exhaust the server's sockets by
 * refreshing in a loop.
 */
const MAX_PER_USER = 20;

export class LiveService {
  readonly #subscribers = new Map<symbol, Subscriber>();

  /**
   * Registers a tab. Returns the function that unregisters it.
   *
   * ★ THE CALLER MUST CALL THE RETURNED FUNCTION ★
   *
   * A subscriber that is never removed is a closure holding a socket that is
   * already gone, and the map grows for the life of the process. The controller
   * wires it to the request's close event.
   */
  subscribe(userId: string, send: (event: LiveEvent) => void): () => void {
    const held = [...this.#subscribers.values()].filter((s) => s.userId === userId).length;
    if (held >= MAX_PER_USER) {
      /*
       * Refused rather than evicting the oldest. Evicting would make a member's
       * first tab go quiet when they opened their twenty-first, which looks
       * like a bug in the tab that was working.
       */
      return () => undefined;
    }

    const key = Symbol('subscriber');
    this.#subscribers.set(key, { userId, send });
    return () => {
      this.#subscribers.delete(key);
    };
  }

  /**
   * Tells the interested tabs that something changed.
   *
   * ★ ONLY THE MEMBER IT CONCERNS ★
   *
   * An event carrying a userId goes to that member's tabs and nobody else's.
   * The alternative — broadcasting and letting each page decide — would tell a
   * hundred browsers that a particular member just docked, which is a
   * disclosure even when no payload rides along with it.
   *
   * A null userId is squadron-wide and goes to everybody.
   */
  publish(event: LiveEvent): void {
    for (const sub of this.#subscribers.values()) {
      if (event.userId !== null && sub.userId !== event.userId) continue;
      try {
        sub.send(event);
      } catch {
        /*
         * A dead socket. Swallowed, because publish is called from an ingest
         * path and a browser that closed mid-write must not fail somebody's
         * upload. The close handler removes it.
         */
      }
    }
  }

  /** How many tabs are listening. For the health endpoint. */
  get connections(): number {
    return this.#subscribers.size;
  }
}
