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
 * How many commanders one request may ask about.
 *
 * Thirty is a deliberate compromise. Inara publishes no hard cap on events per
 * request, and the whole squadron would fit in one — but a single oversized
 * body is the kind of thing an operator throttles without warning, and if it
 * fails, it fails for everybody at once. Thirty keeps a hundred members inside
 * four requests while leaving each one small enough to be unremarkable.
 *
 * Enforced HERE rather than left to callers, so no future caller can quietly
 * send a batch of four hundred.
 */
const MAX_EVENTS_PER_REQUEST = 30;

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
  /** The squadron Inara says they belong to, and their rank in it. */
  readonly squadronRank: string | null;
  /**
   * Pilot ranks, in INARA'S OWN VOCABULARY.
   *
   * ★ REINSTATED 2026-07-28, ON THE SQUADRON OWNER'S DECISION ★
   *
   * Parsed here, removed on 2026-07-27 when Inara was narrowed to name and
   * squadron only, and now the roster's preferred rank source again (ADR-004,
   * amended). Empty when Inara reports none, which is the normal answer for a
   * commander with no Inara account.
   *
   * ★ DELIBERATELY NOT MAPPED ONTO OUR LADDERS ★
   *
   * Inara says `exploration` where the game says `Explore`, and translating
   * between them is a decision about OUR domain. This package knows about
   * external APIs and nothing else (ADR-013) — it depends on no internal
   * package, and importing our rank tables to do the mapping here would be the
   * first edge in a graph that is currently empty for good reason.
   *
   * So this reports what Inara said, faithfully, and the caller decides what it
   * means. `rankValue` is the same ordinal the journal uses, which is the one
   * fact about the shape worth relying on.
   *
   * ENRICHMENT, not evidence. A member types these into a website; they are not
   * read from anyone's game and prove nothing. The journal is the authority.
   */
  readonly pilotRanks: ReadonlyArray<{ rankName: string; rankValue: number }>;
}

interface InaraEnvelope {
  header?: { eventStatus?: number; eventStatusText?: string };
  events?: Array<{
    eventStatus?: number;
    eventStatusText?: string;
    eventData?: {
      userName?: string;
      commanderName?: string;
      /*
       * ★ INARA'S REAL FIELD NAMES, VERIFIED AGAINST A LIVE RESPONSE ★
       *
       * These were written as `SquadronName` and `SquadronRank` — capitalised,
       * and the rank key invented. Inara actually sends:
       *
       *   { squadronID, squadronName, squadronMembersCount,
       *     squadronMemberRank, inaraURL }
       *
       * So every read was `undefined`, every commander looked like they were in
       * no squadron, and a member who IS in Grim's Squad was told Inara could
       * not see them. Nothing errored — a missing optional field is silence.
       *
       * Both spellings are accepted rather than swapped, because this cost a
       * whole feature once and an API that changes its casing must not do it
       * again.
       */
      commanderSquadron?: {
        squadronName?: string;
        squadronMemberRank?: string;
        SquadronName?: string;
        SquadronRank?: string;
      };
      /** `[{rankName:"exploration",rankValue:5,...}]`. Inara's names, not the journal's. */
      commanderRanksPilot?: unknown;
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
  async getOwnIdentity(apiKey: string): Promise<{
    cmdrName: string;
    squadronName: string | null;
    squadronRank: string | null;
  } | null> {
    // BOUNDED, for the same reason as below: a member is waiting on this.
    const p = await this.#call(apiKey, undefined, REQUEST_PATH_WAIT_MS);
    if (p === null || p.cmdrName === '') return null;
    return { cmdrName: p.cmdrName, squadronName: p.squadronName, squadronRank: p.squadronRank };
  }

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
    const events = await this.#post(apiKey, [cmdrName], maxWaitMs);

    const event = events[0];
    if (event === undefined) {
      throw new InaraApiError('Inara returned no event for our request.', 0, true);
    }

    return parseEvent(event, cmdrName);
  }

  /**
   * Reads many commanders' public profiles in as few requests as possible.
   *
   * ★ THIS IS WHY A TWENTY-MINUTE SWEEP IS AFFORDABLE ★
   *
   * Inara's request body takes an ARRAY of events, so one POST asks about thirty
   * commanders and comes back with thirty results in the order they were sent.
   * A hundred members therefore cost four requests rather than a hundred — the
   * difference between roughly fifty minutes of the global budget and roughly
   * two (ADR-004, amended 2026-07-28).
   *
   * INV-033 is untouched by this. It bounds REQUESTS, which is what Inara's
   * guidance bounds and what its throttle counts, and every chunk below still
   * queues through the one global limiter.
   *
   * ★ WHAT THE CALLER GETS BACK ★
   *
   * Keyed by LOWERCASED name, because Elite treats commander names
   * case-insensitively and so does the column this ends up in. Names that
   * differ only by case are one request, not two.
   *
   * A name maps to `null` when Inara answered "no such commander" — the normal
   * answer for someone with no Inara account. A name is ABSENT from the map
   * when its chunk failed outright, which is a different fact: absent means
   * "unknown, ask again", null means "asked, and there is nothing". Collapsing
   * the two would let one failed request erase real ranks from every card in it.
   */
  async getCommanderProfiles(
    names: readonly string[],
  ): Promise<Map<string, InaraProfile | null>> {
    /*
     * ★ DE-DUPLICATED CASE-INSENSITIVELY, TO MATCH THE LOOKUP ★
     *
     * The returned map is keyed by lowercased name. De-duplicating by exact
     * spelling therefore sends "Pebble" and "PEBBLE" as two separate questions
     * — paying twice from a rate budget measured in requests per minute — and
     * then collapses both answers onto one key, where the last one silently
     * wins. Two members whose names differ only in case would overwrite each
     * other's ranks.
     *
     * The FIRST spelling seen is the one sent, because Inara's search is itself
     * case-insensitive and any of them would do.
     */
    const seen = new Set<string>();
    const wanted: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (name === '') continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      wanted.push(name);
    }

    const out = new Map<string, InaraProfile | null>();

    for (let i = 0; i < wanted.length; i += MAX_EVENTS_PER_REQUEST) {
      const chunk = wanted.slice(i, i + MAX_EVENTS_PER_REQUEST);

      let events: NonNullable<InaraEnvelope['events']>;
      try {
        // Unbounded wait: this is a scheduled job with nobody watching, and
        // giving up on the limiter would silently sync only the first chunk.
        events = await this.#post(this.config.apiKey, chunk);
      } catch (cause) {
        // One bad chunk must not lose the others. A rejected key throws on
        // every chunk anyway, so nothing is masked by continuing.
        if (cause instanceof InaraNotApprovedError) throw cause;
        continue;
      }

      chunk.forEach((name, index) => {
        const event = events[index];
        // A short array is Inara disagreeing with us about what we asked. Left
        // ABSENT rather than recorded as "not found", because index-shifted
        // results would otherwise be written onto the wrong commanders.
        if (event === undefined) return;

        try {
          out.set(name.toLowerCase(), parseEvent(event, name));
        } catch {
          // A per-event error — malformed, throttled, unavailable. Absent, so
          // the next sweep retries it and the stored row is left alone.
        }
      });
    }

    return out;
  }

  /**
   * One POST carrying one or more `getCommanderProfile` events.
   *
   * Returns the events array as Inara sent it, positionally aligned with the
   * names given. Envelope-level failures throw; per-event ones are the caller's
   * to interpret, because in a batch they apply to one commander and not the
   * rest.
   */
  async #post(
    apiKey: string,
    cmdrNames: ReadonlyArray<string | undefined>,
    maxWaitMs?: number,
  ): Promise<NonNullable<InaraEnvelope['events']>> {
    // EVERY call goes through the global limiter (INV-033). Worker calls wait
    // as long as it takes; a request-path caller passes maxWaitMs and gives up
    // rather than holding a connection open behind a minutes-deep queue.
    const limiter = inaraLimiter();
    const dispatch = async (): Promise<NonNullable<InaraEnvelope['events']>> => {
      const timestamp = new Date().toISOString();
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
        events: cmdrNames.map((cmdrName) => ({
          eventName: 'getCommanderProfile',
          eventTimestamp: timestamp,
          // Absent, not empty, when we want the key owner's own profile.
          eventData: cmdrName === undefined ? {} : { searchName: cmdrName },
        })),
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

      return json.events ?? [];
    };

    // Unbounded for the worker, bounded for a request. Both go through the SAME
    // singleton, so INV-033's "at most twice a minute globally" holds either
    // way — the only difference is who is willing to keep waiting.
    return maxWaitMs === undefined
      ? limiter.run(dispatch)
      : limiter.runWithin(maxWaitMs, dispatch);
  }
}

/**
 * Turns one event from Inara's reply into a profile.
 *
 * Shared by the single and batch paths deliberately. When these were two copies
 * the batch one is exactly where a subtly different reading of `eventStatus`
 * would go unnoticed, because nobody watches a scheduled job's output.
 *
 * Returns null for 204 (no such commander) and THROWS for anything else that is
 * not 200 — in a batch the caller catches that per event, so one throttled
 * commander does not discard twenty-nine good ones.
 */
function parseEvent(
  event: NonNullable<InaraEnvelope['events']>[number],
  cmdrName: string | undefined,
): InaraProfile | null {
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
    squadronName:
      d.commanderSquadron?.squadronName ?? d.commanderSquadron?.SquadronName ?? null,
    squadronRank:
      d.commanderSquadron?.squadronMemberRank ?? d.commanderSquadron?.SquadronRank ?? null,
    pilotRanks: parsePilotRanks(d.commanderRanksPilot),
  };
}

/**
 * Narrows Inara's rank array to the two fields that carry meaning.
 *
 * Validated rather than cast. Everything past this point can rely on
 * `rankName` being a string and `rankValue` a number, which is what lets the
 * mapping on our side skip defensive checks it would otherwise need at every
 * use — and a malformed entry is dropped rather than propagated as NaN.
 */
function parsePilotRanks(raw: unknown): Array<{ rankName: string; rankValue: number }> {
  if (!Array.isArray(raw)) return [];

  const out: Array<{ rankName: string; rankValue: number }> = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { rankName, rankValue } = entry;
    if (typeof rankName !== 'string') continue;

    /*
     * ★ INARA SENDS rankValue AS A STRING ★
     *
     * `{"rankName":"trade","rankValue":"8"}` — quoted, verified against a live
     * response. The check here required a NUMBER, so every rank failed it and
     * the array came back empty. Silently: an empty rank list is exactly what a
     * commander with no public ranks looks like.
     *
     * Numbers are still accepted, in case Inara ever sends them, and anything
     * that is neither is skipped rather than coerced — Number('') is 0, which
     * is Harmless, and inventing a rank is worse than reporting none.
     */
    const value =
      typeof rankValue === 'number'
        ? rankValue
        : typeof rankValue === 'string' && rankValue.trim() !== ''
          ? Number(rankValue)
          : Number.NaN;

    if (!Number.isInteger(value) || value < 0) continue;
    out.push({ rankName, rankValue: value });
  }

  return out;
}
