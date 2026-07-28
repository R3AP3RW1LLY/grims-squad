import type { ParsedEvent } from './journal-reader.js';

/**
 * Sending events to the hub.
 *
 * ★ BATCHED, AND FAILURE IS NEVER LOSS ★
 *
 * Events are sent in batches on a timer rather than one per line. A busy hour
 * of play produces a lot of lines, and a request each would be rude to our own
 * server and pointless besides — nothing here is urgent.
 *
 * A failed send does NOT advance the saved offset. The events are simply read
 * again next pass and sent again; the server dedupes on the event key. That is
 * why the key includes the payload, and why "retry" is a safe default rather
 * than a risk of double-counting.
 */

export interface UploadResult {
  readonly ok: boolean;
  readonly accepted: number;
  readonly duplicates: number;
  /** Set when the token is no longer valid — the member must re-pair. */
  readonly unauthorised: boolean;
  readonly error: string | null;
}

/** Batches are capped so one long session cannot post a ten-megabyte body. */
export const MAX_BATCH = 200;

export interface UploaderOptions {
  readonly apiBaseUrl: string;
  readonly deviceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class Uploader {
  constructor(private readonly opts: UploaderOptions) {}

  async send(events: readonly ParsedEvent[]): Promise<UploadResult> {
    if (events.length === 0) {
      return { ok: true, accepted: 0, duplicates: 0, unauthorised: false, error: null };
    }

    const doFetch = this.opts.fetchImpl ?? fetch;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs ?? 15_000);

    try {
      const res = await doFetch(`${this.opts.apiBaseUrl.replace(/\/+$/, '')}/v1/telemetry/journal`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Bearer, not a cookie. The app is not a browser and must not be
          // carrying a session — the device token is its whole identity.
          authorization: `Bearer ${this.opts.deviceToken}`,
        },
        body: JSON.stringify({ events: events.slice(0, MAX_BATCH) }),
        signal: ac.signal,
      });

      if (res.status === 401 || res.status === 403) {
        /*
         * The token has been revoked, or the account is gone. Distinguished
         * from an outage because the responses differ: an outage clears by
         * itself and this never will. Retrying forever would hammer the server
         * to no purpose and leave the member wondering why nothing updates.
         */
        return {
          ok: false,
          accepted: 0,
          duplicates: 0,
          unauthorised: true,
          error: 'This device is no longer paired. Pair it again from the website.',
        };
      }

      if (!res.ok) {
        return {
          ok: false,
          accepted: 0,
          duplicates: 0,
          unauthorised: false,
          error: `The hub answered ${res.status}.`,
        };
      }

      const body = (await res.json().catch(() => ({}))) as {
        accepted?: number;
        duplicates?: number;
      };
      return {
        ok: true,
        accepted: body.accepted ?? 0,
        duplicates: body.duplicates ?? 0,
        unauthorised: false,
        error: null,
      };
    } catch {
      // Offline, asleep, or the hub is down. All the same to us: keep the
      // offset where it is and try again later.
      return {
        ok: false,
        accepted: 0,
        duplicates: 0,
        unauthorised: false,
        error: ac.signal.aborted ? 'The hub took too long to answer.' : 'Could not reach the hub.',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
