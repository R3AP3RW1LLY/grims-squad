import { CapiAuthError } from '@grims/ed-clients';
import type { CarrierManifest } from '@grims/ed-clients';

/**
 * What the squadron's fleet carriers are ACTUALLY holding, asked of Frontier.
 *
 * ★ WHY THIS EXISTS WHEN THREE SOURCES ALREADY SPEAK ★
 *
 * Every carrier figure on the boards comes from a source that can only ever UNDERSTATE:
 *
 *   the market mirror  sees public sell orders. Staged cargo is exactly the cargo not on sale.
 *   the journal        sees what an app watched move, for the one member running it.
 *   a crew member      sees what they counted, when they counted it.
 *
 * None of them can tell "sold" from "nobody looked". A carrier that held 20,000 t of Steel a
 * fortnight ago and was emptied yesterday reads as full on every board we have, and the first
 * person to learn otherwise is whoever flies out to collect it.
 *
 * Frontier answers with the WHOLE manifest. A commodity absent from it is absent from the hold —
 * which makes this the only source that can prove a hold empty, and the reason a cAPI row REPLACES
 * the floors rather than joining their argument. See `effectiveTonnes`.
 *
 * ★ SCOPE — SQUADRON OWNER, 2026-08-16 ★
 *
 * Asked whether to poll every linked member's carrier or only those attached to live builds, the
 * answer was: only carriers attached to live builds. So a request is spent where a build benefits
 * and nowhere else, and a carrier nobody has offered stays entirely off this path.
 *
 * ★ AND IT CAN ONLY EVER ASK FOR THE CALLER'S OWN CARRIER ★
 *
 * `/fleetcarrier` returns the carrier belonging to whoever's token is presented — there is no way
 * to ask about somebody else's. So this cannot be driven from "which carriers are attached"; it is
 * driven from "which members might own one that is", and Frontier's answer is then matched back
 * against the attached set. A wrong guess about ownership costs one request and stores nothing,
 * because nothing is ever stored under a market id we did not resolve from the callsign Frontier
 * itself returned.
 */

/** The floor between two requests. Frontier's limit is shared, so this is the squadron's pacing. */
export const CAPI_MIN_SPACING_MS = 1_100;

/**
 * The most carriers one run will ask about.
 *
 * A cap, not a queue — the same reasoning as the journal poller. Without it one run over a large
 * squadron spends the whole limit and the next run is refused outright. The cap makes the failure
 * "some carriers are late", which the report says out loud, instead of "everything stops", which
 * nothing says at all.
 */
export const MAX_REQUESTS_PER_RUN = 25;

/** A member who might own a carrier attached to a live build. */
export interface CarrierCandidate {
  readonly userId: string;
  readonly cmdrName: string;
}

export interface CargoLine {
  readonly commodity: string;
  readonly tonnes: number;
}

export interface CarrierPollStore {
  /**
   * cAPI-linked members plausibly connected to a carrier attached to a LIVE build.
   *
   * Plausibly, not certainly: the hub records who PUSHED a manifest and who ATTACHED a carrier, and
   * neither is proof of ownership. Frontier settles it — see the header.
   */
  candidates(): Promise<readonly CarrierCandidate[]>;
  /** Null when the grant is dead. Marking it stale is the store's job, not ours. */
  accessToken(userId: string): Promise<string | null>;
  /**
   * The market id for a callsign, or null when the catalogue has never seen it.
   *
   * Resolved through the catalogue rather than trusted from the response, because every other
   * carrier query in the platform keys on the catalogue's market id. A row written under a
   * different one would be invisible to the boards it exists to correct.
   */
  marketIdForCallsign(callsign: string): Promise<string | null>;
  /** Whether this carrier is attached to a build that is still running. */
  isAttachedToLiveBuild(marketId: string): Promise<boolean>;
  /**
   * Replaces this carrier's cAPI rows with exactly these lines.
   *
   * REPLACES. A commodity absent from the manifest must be REMOVED, not left behind — that removal
   * is the entire value of asking Frontier, and an upsert-only store would keep every figure it had
   * ever seen and quietly become another floor.
   */
  replaceCapiCargo(input: {
    readonly marketId: string;
    readonly ownerId: string;
    readonly lines: readonly CargoLine[];
    readonly at: Date;
  }): Promise<void>;
}

export interface CarrierPollOptions {
  readonly store: CarrierPollStore;
  readonly fetchCarrier: (input: {
    accessToken: string;
  }) => Promise<CarrierManifest | null>;
  readonly now: () => Date;
  /** Injected so a spec does not spend twenty-eight seconds proving the pacing. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly maxRequests?: number;
}

export interface CarrierOutcome {
  readonly userId: string;
  readonly cmdrName: string;
  readonly result:
    | 'stored'
    | 'no-carrier'
    | 'not-attached'
    | 'unknown-callsign'
    | 'no-token'
    | 'failed';
  readonly marketId?: string;
  readonly callsign?: string;
  /** Commodities stored. Zero is a real answer here — it means the hold is empty. */
  readonly lines?: number;
  readonly detail?: string;
}

export interface CarrierPollReport {
  readonly asked: number;
  readonly stored: number;
  readonly outcomes: readonly CarrierOutcome[];
  /** Set when the run stopped early. Named so the log says WHY rather than showing a short list. */
  readonly stoppedBecause?: 'rate-limited' | 'cap-reached';
}

/**
 * One pass over the candidates.
 *
 * Pure but for the injected store, fetcher and clock — the same shape as the journal poller, and
 * for the same reason: everything hard here is reasoning about a shared rate limit, a dead grant
 * and a source that is allowed to say "empty", and none of that should need Postgres to test.
 */
export async function pollCapiCarriers(opts: CarrierPollOptions): Promise<CarrierPollReport> {
  const cap = opts.maxRequests ?? MAX_REQUESTS_PER_RUN;
  const candidates = await opts.store.candidates();

  const outcomes: CarrierOutcome[] = [];
  let asked = 0;
  let stored = 0;
  let stoppedBecause: CarrierPollReport['stoppedBecause'];

  for (const who of candidates) {
    if (asked >= cap) {
      stoppedBecause = 'cap-reached';
      break;
    }

    const token = await opts.store.accessToken(who.userId);
    if (token === null) {
      // A dead grant. The store has already marked it stale; asking again would spend a request
      // proving something we have been told.
      outcomes.push({ userId: who.userId, cmdrName: who.cmdrName, result: 'no-token' });
      continue;
    }

    // Before the request, not after: the floor is between REQUESTS, and a member skipped for a
    // dead token has not made one.
    if (asked > 0) await opts.sleep(CAPI_MIN_SPACING_MS);

    let manifest: CarrierManifest | null;
    try {
      asked += 1;
      manifest = await opts.fetchCarrier({ accessToken: token });
    } catch (e) {
      const err = e as CapiAuthError;

      /*
       * ★ A RATE LIMIT STOPS THE RUN ★
       *
       * The limit is the squadron's, not this member's. Carrying on would spend the remaining
       * budget discovering it is spent, and the next run — which might carry a build that is
       * actually being hauled to — is refused for it.
       */
      if (err?.kind === 'rate_limited') {
        outcomes.push({
          userId: who.userId,
          cmdrName: who.cmdrName,
          result: 'failed',
          detail: 'rate limited',
        });
        stoppedBecause = 'rate-limited';
        break;
      }

      /*
       * ★ AND A FAILURE NEVER CLEARS A HOLD ★
       *
       * "Frontier is broken" and "the carrier is empty" are one keystroke apart in this file and
       * indistinguishable on every board downstream. Writing an empty manifest here would blank the
       * carrier column across the squadron on the strength of an HTTP 500.
       */
      outcomes.push({
        userId: who.userId,
        cmdrName: who.cmdrName,
        result: 'failed',
        detail: err?.message ?? String(e),
      });
      continue;
    }

    // Most members do not own a carrier and Frontier answers 404. Not a fault, and not a reason to
    // stop asking about the ones who do.
    if (manifest === null) {
      outcomes.push({ userId: who.userId, cmdrName: who.cmdrName, result: 'no-carrier' });
      continue;
    }

    const callsign = manifest.callsign.trim();
    const marketId = callsign === '' ? null : await opts.store.marketIdForCallsign(callsign);
    if (marketId === null) {
      /*
       * Frontier knows a carrier our catalogue does not. Storing it under an invented id would put
       * rows nothing can join to; the honest answer is that we cannot place it yet, and EDDN will
       * report it the next time anybody flies near.
       */
      outcomes.push({
        userId: who.userId,
        cmdrName: who.cmdrName,
        result: 'unknown-callsign',
        callsign,
      });
      continue;
    }

    /*
     * The scope the owner chose. A carrier on no live build is not stored — the request has already
     * been spent finding that out, which is the cost of Frontier only answering about the caller's
     * own carrier.
     */
    if (!(await opts.store.isAttachedToLiveBuild(marketId))) {
      outcomes.push({
        userId: who.userId,
        cmdrName: who.cmdrName,
        result: 'not-attached',
        callsign,
        marketId,
      });
      continue;
    }

    await opts.store.replaceCapiCargo({
      marketId,
      ownerId: who.userId,
      lines: manifest.cargo.map((c) => ({ commodity: c.commodity, tonnes: c.tonnes })),
      at: opts.now(),
    });

    stored += 1;
    outcomes.push({
      userId: who.userId,
      cmdrName: who.cmdrName,
      result: 'stored',
      callsign,
      marketId,
      lines: manifest.cargo.length,
    });
  }

  return {
    asked,
    stored,
    outcomes,
    ...(stoppedBecause === undefined ? {} : { stoppedBecause }),
  };
}
