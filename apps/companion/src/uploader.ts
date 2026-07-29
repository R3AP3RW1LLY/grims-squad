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
  /**
   * Categories the hub refused for want of consent, and how many events each
   * cost.
   *
   * Surfaced rather than ignored: a member who has not opted into a category is
   * entitled to be told their events are being dropped, instead of watching an
   * app that looks like it is working and a website that never updates.
   */
  readonly refused: Record<string, number>;
  readonly error: string | null;
  /**
   * Bytes actually moved by this request.
   *
   * ★ WHAT THESE ARE, EXACTLY ★
   *
   * `txBytes` is the UTF-8 length of the JSON body we hand to fetch.
   * `rxBytes` is the length of the response body we read back.
   *
   * Both are measured, never estimated: the body is serialised once and its
   * byte length taken from the same string that is sent, so the number cannot
   * drift from the payload the way a re-serialised estimate would.
   *
   * ★ AND WHAT THEY ARE NOT ★
   *
   * They exclude HTTP headers, TLS record framing and TCP overhead, none of
   * which is observable from inside `fetch`. So this is the size of the journal
   * data itself — which is the honest thing to show under a label about journal
   * transfer, and it is stated plainly in the UI rather than passed off as a
   * total for the network interface.
   *
   * Counted on failures too: a request that times out still put its bytes on
   * the wire, and a meter that only counted successes would quietly under-report
   * exactly when a member is watching it to find out why nothing is working.
   */
  readonly txBytes: number;
  readonly rxBytes: number;
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

  async send(
    events: readonly ParsedEvent[],
    options: { gameRunning?: boolean } = {},
  ): Promise<UploadResult> {
    const gameRunning = options.gameRunning ?? false;

    /*
     * An empty batch is normally nothing to do. It is NOT nothing when the
     * journal is still growing: that is the heartbeat, and it is the only way
     * the hub learns somebody is mid-flight rather than gone.
     */
    if (events.length === 0 && !gameRunning) {
      return {
        ok: true,
        accepted: 0,
        duplicates: 0,
        unauthorised: false,
        refused: {},
        error: null,
        txBytes: 0,
        rxBytes: 0,
      };
    }

    const doFetch = this.opts.fetchImpl ?? fetch;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs ?? 15_000);

    /*
     * Serialised ONCE, and measured from the very string that is sent.
     * Re-stringifying to measure would be a second, possibly different, value —
     * and `Buffer.byteLength` rather than `.length` because a commander name
     * with an accent in it is more bytes than characters.
     */
    const payload = JSON.stringify({ events: events.slice(0, MAX_BATCH), gameRunning });
    const txBytes = Buffer.byteLength(payload, 'utf8');
    let rxBytes = 0;

    try {
      const res = await doFetch(`${this.opts.apiBaseUrl.replace(/\/+$/, '')}/v1/telemetry/journal`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Bearer, not a cookie. The app is not a browser and must not be
          // carrying a session — the device token is its whole identity.
          authorization: `Bearer ${this.opts.deviceToken}`,
        },
        body: payload,
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
          refused: {},
          error: 'This device is no longer paired. Pair it again from the website.',
          txBytes,
          rxBytes,
        };
      }

      if (!res.ok) {
        return {
          ok: false,
          accepted: 0,
          duplicates: 0,
          unauthorised: false,
          refused: {},
          error: `The hub answered ${res.status}.`,
          txBytes,
          rxBytes,
        };
      }

      /*
       * Read as TEXT first so the bytes can be counted, then parsed. `res.json()`
       * consumes the body and gives no way to ask how large it was — and a
       * response is a one-shot stream, so there is no second chance to measure.
       */
      const raw = await res.text().catch(() => '');
      rxBytes = Buffer.byteLength(raw, 'utf8');

      let body: {
        accepted?: number;
        duplicates?: number;
        refused?: Record<string, number>;
      } = {};
      try {
        body = raw === '' ? {} : (JSON.parse(raw) as typeof body);
      } catch {
        // A 200 carrying something that is not JSON. The bytes still counted.
      }
      return {
        ok: true,
        accepted: body.accepted ?? 0,
        duplicates: body.duplicates ?? 0,
        unauthorised: false,
        refused: body.refused ?? {},
        error: null,
        txBytes,
        rxBytes,
      };
    } catch {
      // Offline, asleep, or the hub is down. All the same to us: keep the
      // offset where it is and try again later.
      return {
        ok: false,
        accepted: 0,
        duplicates: 0,
        unauthorised: false,
        refused: {},
        error: ac.signal.aborted ? 'The hub took too long to answer.' : 'Could not reach the hub.',
        // Counted even though it failed: those bytes went out regardless, and a
        // meter that hid them would under-report exactly when somebody is
        // watching it to work out why nothing is arriving.
        txBytes,
        rxBytes,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
