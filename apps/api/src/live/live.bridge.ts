import { Redis } from 'ioredis';
import type { LiveEvent, LiveEventType, LiveService } from './live.service.js';

/**
 * Lets the scheduled jobs reach a browser.
 *
 * ★ THE PROBLEM THIS SOLVES ★
 *
 * `LiveService` keeps its subscribers in memory, in the API process. That is
 * correct and cheap, and it means the WORKER — a separate one-shot container
 * launched by cron — has no way to say anything to anybody.
 *
 * Which is precisely the case that matters most. A member ticks "I have applied
 * to join", Inara has not caught up, and the page tells them they can leave. The
 * squadron re-check confirms them four minutes later in a different process, and
 * the page they were told they could leave open sat there saying "partially
 * verified" until they gave up and reloaded.
 *
 * ★ WHY REDIS PUB/SUB AND NOT AN INTERNAL HTTP ROUTE ★
 *
 * An internal endpoint would need its own authentication, its own shared
 * secret, and would be a new route on a public listener that exists solely to
 * be called by something on the same private network. Redis is already that
 * private network channel, already deployed, and already trusted by both
 * processes for the permission cache.
 *
 * ★ NOTHING HERE CAN GRANT ANYTHING ★
 *
 * A message is `{type, userId}` — the same notification the SSE stream already
 * carries, with no payload. Anything that reached this channel could at worst
 * make a browser RE-READ data it is already allowed to read, through the normal
 * endpoints with the normal permission checks. That is the whole reason the
 * stream carries notifications instead of data, and it is what makes accepting
 * messages from another process safe.
 */

export const LIVE_CHANNEL = 'grims:live';

/**
 * Event types accepted off the wire.
 *
 * An allow-list, not a cast. `LiveEventType` is a compile-time thing and this
 * is a string arriving from another process — without the check, a typo in a
 * job would put an event on the stream that no page listens for, and the job
 * would look like it had worked.
 */
const ACCEPTED: ReadonlySet<string> = new Set<LiveEventType>([
  'telemetry',
  'presence',
  'roster',
  'activity',
  'verification',
  'notification',
  'support',
]);

/** Parses one message. Returns null for anything it does not recognise. */
export function parseLiveMessage(raw: string): LiveEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;

  const type = o['type'];
  if (typeof type !== 'string' || !ACCEPTED.has(type)) return null;

  /*
   * `userId` must be present and explicitly null for squadron-wide, never
   * missing. A message that simply forgot the field would otherwise broadcast
   * one member's business to every connected browser — the difference between
   * "everyone" and "we forgot to say who" is not one to infer.
   */
  const userId = o['userId'];
  if (userId !== null && typeof userId !== 'string') return null;

  return { type: type as LiveEventType, userId };
}

/**
 * Holds the subscriber connection for the life of the process.
 *
 * A DEDICATED client, because a connection in subscriber mode cannot issue
 * ordinary commands — sharing the permission cache's client would break every
 * cache read the moment this subscribed.
 */
export class LiveBridge {
  #redis: Redis | null = null;

  constructor(
    private readonly live: LiveService,
    private readonly url: string,
  ) {}

  start(): void {
    /*
     * ★ A FAILURE HERE MUST NOT STOP THE API BOOTING ★
     *
     * Live updates are a convenience. Redis being unreachable at start-up is a
     * reason for pages to update on navigation instead of by themselves — never
     * a reason for the website to be down. ioredis reconnects on its own, so a
     * Redis that comes back brings this with it.
     */
    const redis = new Redis(this.url, {
      lazyConnect: false,
      maxRetriesPerRequest: null,
      // Named so it is identifiable in `CLIENT LIST` when somebody is working
      // out what is holding a subscriber connection open.
      connectionName: 'grims-live-bridge',
    });

    redis.on('error', () => {
      /*
       * Swallowed deliberately, and this is the one place it is worth saying
       * why: ioredis emits `error` on every reconnection attempt. Logging each
       * one turns a Redis restart into thousands of identical lines, which is
       * how the log that would have shown the real fault gets rotated away.
       */
    });

    redis.subscribe(LIVE_CHANNEL).catch(() => undefined);

    redis.on('message', (channel: string, raw: string) => {
      if (channel !== LIVE_CHANNEL) return;
      const event = parseLiveMessage(raw);
      if (event === null) return;
      this.live.publish(event);
    });

    this.#redis = redis;
  }

  async stop(): Promise<void> {
    const redis = this.#redis;
    this.#redis = null;
    if (redis === null) return;
    // `disconnect`, not `quit`: a subscriber has an outstanding blocking read,
    // and waiting for a clean QUIT on shutdown delays the container's exit for
    // no benefit — there is nothing buffered to lose.
    redis.disconnect();
  }
}
