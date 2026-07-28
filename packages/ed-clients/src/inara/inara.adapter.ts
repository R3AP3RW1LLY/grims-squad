import { inaraLimiter } from './limiter.js';

/**
 * Inara, for CMDR verification by nonce (P1.8b).
 *
 * The member puts a short nonce in their Inara profile; we read the profile and
 * confirm it is there. That proves they control the Inara account, which is
 * bound to a CMDR name — weaker than Frontier's cAPI (trust tier 3) and much
 * stronger than an officer taking their word for it (tier 1). Hence tier 2.
 *
 * ★ THE TRAP: INARA RETURNS 200 FOR FAILURES ★
 *
 * Inara's API is a single POST that always answers HTTP 200. Whether the call
 * worked is in the BODY: `header.eventStatus` for the envelope and
 * `events[0].eventStatus` for the individual event. 204 there means "no
 * results", 400 means a bad request, 401/403 mean the API key is not approved.
 *
 * Checking `res.ok` alone therefore reports success for every one of those, and
 * the caller goes on to parse an empty body — which reads as "the nonce is not
 * there yet" and quietly never verifies anybody. That is why this adapter reads
 * both status fields and refuses to guess.
 */

const API = 'https://inara.cz/inapi/v1/';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * How long a REQUEST-PATH caller will wait for a rate-limit slot.
 *
 * Eight seconds: long enough that an idle queue always serves immediately —
 * which is every realistic case, since 108 members link a key once each over
 * weeks — and short enough that a member never sits watching a spinner while
 * nine other calls drain at thirty seconds apiece.
 */
const REQUEST_PATH_WAIT_MS = 8_000;

/**
 * The application identity Inara whitelists us by.
 *
 * ★ THIS STRING MUST MATCH WHAT WAS REGISTERED, EXACTLY ★
 *
 * Inara's own instructions: "let me know your app name/identifier you will be
 * using, as it needs to be white-listed first" and "your application name,
 * exactly as it will be sent in the requests". A mismatch is not a soft
 * failure — every call comes back "This application has no access allowed",
 * which is indistinguishable from never having applied.
 *
 * Plain ASCII, no apostrophe and no spaces. The squadron is "Grim's Squad", but
 * an identifier carrying a typographic apostrophe travels through JSON, a
 * whitelist lookup and somebody's copy-paste before it is compared, and only
 * one of those has to normalise it differently for the match to fail silently.
 *
 * Defined ONCE. It was previously written out in two call sites, which is the
 * same shape as the API-origin bug that cost hours: one value in two places
 * drifts, and the failure looks like something else entirely.
 */
export const INARA_APP_NAME = 'GrimsSquadHub';

/** Sent alongside the name. Bump when behaviour Inara would care about changes. */
export const INARA_APP_VERSION = '1.0.0';

export class InaraApiError extends Error {
  constructor(
    message: string,
    readonly eventStatus: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'InaraApiError';
  }
}

/** Inara is not approved for us, or the key was revoked. NOT retryable. */
export class InaraNotApprovedError extends InaraApiError {
  constructor(status: number, detail: string) {
    super(`Inara rejected our API key (${status}): ${detail}`, status, false);
    this.name = 'InaraNotApprovedError';
  }
}

export interface InaraConfig {
  readonly appName: string;
  readonly appVersion: string;
  readonly apiKey: string;
  readonly isDeveloped?: boolean;
  readonly timeoutMs?: number;
}

export interface InaraProfile {
  readonly cmdrName: string;
  /** The free-text bio. Where the nonce is looked for. */
  readonly bio: string;
  readonly profileUrl: string | null;
  readonly squadronName: string | null;
}

interface InaraEnvelope {
  header?: { eventStatus?: number; eventStatusText?: string };
  events?: Array<{
    eventStatus?: number;
    eventStatusText?: string;
    eventData?: {
      userName?: string;
      commanderName?: string;
      commanderRanksPilot?: unknown;
      preferredGameRole?: string;
      commanderSquadron?: { SquadronName?: string };
      inaraURL?: string;
      otherNamesFound?: string[];
      commanderBio?: string;
      userProfileText?: string;
    };
  }>;
}

export class InaraAdapter {
  constructor(private readonly config: InaraConfig) {}

  /**
   * The commander name bound to THIS API key.
   *
   * ★ THIS IS THE VERIFICATION PRIMITIVE ★
   *
   * `searchName` is omitted deliberately. With no search term Inara answers for
   * the account the key belongs to, so the name that comes back is a fact about
   * the key rather than a request the caller made. That is the entire
   * difference between verifying a commander and taking somebody's word for it,
   * and it is why this method takes no name parameter and never will.
   *
   * Returns null when Inara does not recognise the key.
   */
  async getOwnCommanderName(apiKey: string): Promise<string | null> {
    // BOUNDED. This is the one Inara call that happens while a member waits on
    // an HTTP response, and the global limiter is legitimately minutes deep
    // under contention (INV-033). Waiting it out inside a request would time
    // the connection out; in practice the queue is empty and this is instant.
    const profile = await this.#call(apiKey, undefined, REQUEST_PATH_WAIT_MS);
    return profile?.cmdrName ?? null;
  }

  /**
   * Reads a commander's public Inara profile.
   *
   * Returns `null` when Inara has no such commander — an expected outcome, not
   * an exception. A member who typed their name wrong must be distinguishable
   * from Inara being down, and collapsing the two would show "service
   * unavailable" to someone who simply made a typo.
   */
  async getCommanderProfile(cmdrName: string): Promise<InaraProfile | null> {
    return this.#call(this.config.apiKey, cmdrName);
  }

  /**
   * One Inara call.
   *
   * `searchName` is OMITTED when undefined rather than sent empty — an empty
   * search term is a different request from no search term, and only the latter
   * means "tell me about the key's own account".
   *
   * `apiKey` is a parameter rather than always `this.config.apiKey`, because
   * verification calls Inara with the MEMBER'S key while everything else uses
   * the squadron's.
   */
  async #call(
    apiKey: string,
    cmdrName: string | undefined,
    maxWaitMs?: number,
  ): Promise<InaraProfile | null> {
    // EVERY call goes through the global limiter (INV-033). Worker calls wait
    // as long as it takes; a request-path caller passes maxWaitMs and gives up
    // rather than holding a connection open behind a minutes-deep queue.
    const limiter = inaraLimiter();
    const dispatch = async (): Promise<InaraProfile | null> => {
      const body = {
        header: {
          appName: this.config.appName,
          appVersion: this.config.appVersion,
          isBeingDeveloped: this.config.isDeveloped ?? false,
          // The CALLER's key, not necessarily the squadron's: verification
          // calls Inara with the MEMBER's key, which is the whole reason the
          // returned name is proof rather than a claim.
          APIkey: apiKey,
        },
        events: [
          {
            eventName: 'getCommanderProfile',
            eventTimestamp: new Date().toISOString(),
            // Absent, not empty, when we want the key owner's own profile.
            eventData: cmdrName === undefined ? {} : { searchName: cmdrName },
          },
        ],
      };

      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      let json: InaraEnvelope;
      try {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        // An HTTP-level failure is still worth reporting, but it is NOT the
        // check that matters — Inara answers 200 for its own errors.
        if (!res.ok) {
          throw new InaraApiError(`Inara returned HTTP ${res.status}.`, res.status, res.status >= 500);
        }
        json = (await res.json()) as InaraEnvelope;
      } catch (cause) {
        if (cause instanceof InaraApiError) throw cause;
        throw new InaraApiError(
          ac.signal.aborted ? 'Inara request timed out.' : 'Inara request failed.',
          0,
          true,
        );
      } finally {
        clearTimeout(t);
      }

      // ---- the envelope -----------------------------------------------------
      const headerStatus = json.header?.eventStatus ?? 0;
      if (headerStatus === 400 || headerStatus === 401 || headerStatus === 403) {
        // Our key is wrong, revoked, or was never approved. Not retryable, and
        // distinct from a transient failure so the caller can stop asking.
        throw new InaraNotApprovedError(headerStatus, json.header?.eventStatusText ?? '');
      }
      if (headerStatus >= 500) {
        throw new InaraApiError(
          `Inara envelope error ${headerStatus}: ${json.header?.eventStatusText ?? ''}`,
          headerStatus,
          true,
        );
      }

      // ---- the event itself -------------------------------------------------
      const event = json.events?.[0];
      if (event === undefined) {
        throw new InaraApiError('Inara returned no event for our request.', 0, true);
      }

      const status = event.eventStatus ?? 0;

      // 204 = no results. The commander name is not on Inara. Expected.
      if (status === 204) return null;

      if (status !== 200) {
        const retryable = status >= 500;
        throw new InaraApiError(
          `Inara event error ${status}: ${event.eventStatusText ?? ''}`,
          status,
          retryable,
        );
      }

      const d = event.eventData ?? {};
      return {
        cmdrName: d.commanderName ?? d.userName ?? cmdrName ?? '',
        // Inara exposes the bio under two different keys depending on which
        // field the member filled in. Both are checked, and they are JOINED
        // rather than one preferred — a nonce in either is proof of control.
        bio: [d.commanderBio ?? '', d.userProfileText ?? ''].join('\n').trim(),
        profileUrl: d.inaraURL ?? null,
        squadronName: d.commanderSquadron?.SquadronName ?? null,
      };
    };

    // Unbounded for the worker, bounded for a request. Both go through the SAME
    // singleton, so INV-033's "at most twice a minute globally" holds either
    // way — the only difference is who is willing to keep waiting.
    return maxWaitMs === undefined
      ? limiter.run(dispatch)
      : limiter.runWithin(maxWaitMs, dispatch);
  }
}
