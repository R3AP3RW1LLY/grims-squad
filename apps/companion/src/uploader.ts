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

/** Events per request, so one long session cannot post an enormous body. */
export const MAX_BATCH = 200;

/**
 * Bytes per request.
 *
 * ★ WHY A COUNT WAS NOT ENOUGH ★
 *
 * Two hundred events is a small body for most of the journal and a very large
 * one for `Market`, which carries a station's entire commodity list — around
 * twenty-five kilobytes each. Two hundred of those is five megabytes against a
 * server that accepts one, and the response would be a 413 that failed the
 * whole batch including the ordinary events travelling with it.
 *
 * Sized well under the hub's limit rather than at it: the flags and the JSON
 * envelope ride along too, and a budget that only just fits is one that stops
 * fitting the first time anything is added.
 */
export const MAX_BATCH_BYTES = 700 * 1024;

/**
 * Splits events into requests that respect BOTH limits.
 *
 * ★ THE LOSS THIS ENDS ★
 *
 * This used to be `events.slice(0, MAX_BATCH)` — one request, and the rest
 * silently discarded. The watcher advances its file offset on a successful
 * send, so event two hundred and one was not retried later; it was gone, and
 * nothing on either side recorded that it had existed. A member returning after
 * a long session, which is exactly when a chunk is large, lost the most.
 *
 * An oversized single event still gets its own request rather than being
 * dropped. It may be refused by the hub, and being refused is recoverable in a
 * way that vanishing is not.
 */
export function batchEvents(events: readonly ParsedEvent[]): ParsedEvent[][] {
  if (events.length === 0) return [[]];

  const batches: ParsedEvent[][] = [];
  let current: ParsedEvent[] = [];
  let bytes = 0;

  for (const e of events) {
    const size = Buffer.byteLength(JSON.stringify(e), 'utf8');
    if (current.length > 0 && (current.length >= MAX_BATCH || bytes + size > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(e);
    bytes += size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

export interface UploaderOptions {
  readonly apiBaseUrl: string;
  readonly deviceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class Uploader {
  constructor(private readonly opts: UploaderOptions) {}

  /**
   * Sends every event, in as many requests as the limits require.
   *
   * ★ STOPS AT THE FIRST FAILURE, AND THAT IS DELIBERATE ★
   *
   * A partial success reports `ok: false`, so the watcher leaves its offset
   * alone and reads the same window again next pass. The batches that DID land
   * are re-sent and the hub discards them on the event key — which is precisely
   * what that key is for, and why retrying is safe rather than double-counting.
   *
   * The alternative — advancing past whatever happened to succeed — needs the
   * offset to track a position inside a chunk, and gets it wrong exactly once
   * before losing events for good.
   */
  async send(
    events: readonly ParsedEvent[],
    options: { gameRunning?: boolean; gameStopped?: boolean } = {},
  ): Promise<UploadResult> {
    const batches = batchEvents(events);
    if (batches.length <= 1) return this.#sendOne(events, options);

    let acc: UploadResult = {
      ok: true,
      accepted: 0,
      duplicates: 0,
      unauthorised: false,
      refused: {},
      error: null,
      txBytes: 0,
      rxBytes: 0,
    };

    for (const batch of batches) {
      /*
       * The flags ride on every request rather than only the first. Both are
       * idempotent stamps on the server — "they are playing", "they stopped" —
       * and putting them on one request would mean a member's presence depended
       * on which chunk happened to succeed.
       */
      const r = await this.#sendOne(batch, options);

      acc = {
        ok: r.ok,
        accepted: acc.accepted + r.accepted,
        duplicates: acc.duplicates + r.duplicates,
        unauthorised: r.unauthorised,
        refused: mergeCounts(acc.refused, r.refused),
        error: r.error,
        // Counted across every request, including the one that failed.
        txBytes: acc.txBytes + r.txBytes,
        rxBytes: acc.rxBytes + r.rxBytes,
      };

      if (!r.ok) break;
    }

    return acc;
  }

  async #sendOne(
    events: readonly ParsedEvent[],
    options: { gameRunning?: boolean; gameStopped?: boolean } = {},
  ): Promise<UploadResult> {
    const gameRunning = options.gameRunning ?? false;
    const gameStopped = options.gameStopped ?? false;

    /*
     * An empty batch is normally nothing to do. It is NOT nothing when the
     * journal is still growing: that is the heartbeat, and it is the only way
     * the hub learns somebody is mid-flight rather than gone.
     */
    /*
     * The stop signal is worth a request on its own — it is the whole point of
     * sending it, and it carries no events by definition.
     */
    if (events.length === 0 && !gameRunning && !gameStopped) {
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
    const payload = JSON.stringify({
      // Already sized by `batchEvents`. The cap stays as a floor under a caller
      // that reaches this directly, but it is no longer where events go missing.
      events: events.slice(0, MAX_BATCH),
      gameRunning,
      ...(gameStopped ? { gameStopped: true } : {}),
    });
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

/** Adds two refusal tallies together, so a split upload reports one total. */
function mergeCounts(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}
