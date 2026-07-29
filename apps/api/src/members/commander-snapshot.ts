import { allEliteRanks, describeEliteRanks, type EliteRankKey } from '@grims/shared';

/**
 * What the journal knows about a commander, reduced to what a roster card shows.
 *
 * ★ READ FROM THE EVENTS, NOT A PROJECTION TABLE ★
 *
 * There is no materialised view of commander state yet, and building one to put
 * six fields on a card would be a schema, a backfill and a consistency problem
 * bought in advance of any need. The latest event of each type per member is one
 * indexed query at a hundred members.
 *
 * When something needs this data at scale — a leaderboard sorting a thousand
 * rows by combat rank — that is the moment to project it, and this function is
 * where the shape to project is already written down.
 *
 * ★ WHAT IS SHOWN, AND ON WHAT AUTHORITY ★
 *
 * Ranks, squadron rank and last-played come from the BASELINE categories, which
 * every member running the app supplies and which the roster's audience — other
 * members — is the natural readership for. They are what "who do I fly with"
 * actually means.
 *
 * Ships are NOT here. They are governed by `showFleet`, they stay governed by
 * it, and this file must never become a way around a toggle a member set.
 */

export interface CommanderSnapshot {
  /**
   * Ranks, e.g. `Trade: Tycoon`.
   *
   * HELD-ONLY inside the API; expanded to all six ladders by `fillLadders` on
   * the way out, at which point `name` and `index` are null for a ladder
   * nothing has been reported for.
   *
   * `index` travels with the name because the UI ranks them by ACHIEVEMENT,
   * and the names sort alphabetically into nonsense — "Surveyor" beats "Elite"
   * in a string comparison, which is the opposite of true.
   */
  readonly ranks: Array<{
    key: EliteRankKey;
    label: string;
    name: string | null;
    index: number | null;
  }>;
  /**
   * Where the ranks above came from.
   *
   * ★ TWO SOURCES MAKING DIFFERENT CLAIMS ★
   *
   * A rank read from a member's own game and a rank they typed into a website
   * are not the same statement, and presenting them identically would quietly
   * upgrade the second. The card says which it got.
   *
   * `null` when there are no ranks at all, because "no source" and "the journal
   * said nothing" are the same thing to a reader.
   */
  readonly rankSource: 'inara' | 'journal' | null;
  /** When Inara was last asked. Null unless the ranks came from Inara. */
  readonly ranksFetchedAt: string | null;
  /** Squadron rank as the GAME reports it, which is not our own rank ladder. */
  readonly squadronRank: number | null;
  /** The ship they were last flying. */
  readonly currentShip: string | null;
  /** When they last launched the game. */
  readonly lastPlayedAt: string | null;
}

export const EMPTY_SNAPSHOT: CommanderSnapshot = {
  ranks: [],
  rankSource: null,
  ranksFetchedAt: null,
  squadronRank: null,
  currentShip: null,
  lastPlayedAt: null,
};

/** Inara's cached view of one commander, as the roster reads it. */
export interface InaraRanks {
  readonly ranks: Array<{ key: EliteRankKey; label: string; name: string; index: number }>;
  readonly fetchedAt: Date;
}

/**
 * Puts Inara's ranks in front of the journal's, where Inara has any.
 *
 * ★ WHY THIS IS A MERGE AND NOT A REPLACEMENT ★
 *
 * Inara only knows commanders who have an Inara account and have made their
 * ranks public. The journal knows every member running the companion app, live,
 * with no third party involved. Replacing one with the other outright would
 * empty the cards of the majority to standardise on a source covering a
 * minority (ADR-004, amended 2026-07-28).
 *
 * An EMPTY Inara rank list does not win. A commander Inara has never heard of,
 * or one who has published nothing, comes back with `[]` — and letting that
 * overwrite real journal ranks is precisely the "it worked yesterday" bug this
 * function exists to prevent.
 */
export function withInaraRanks(
  snapshot: CommanderSnapshot,
  inara: InaraRanks | undefined,
): CommanderSnapshot {
  if (inara === undefined || inara.ranks.length === 0) return snapshot;

  return {
    ...snapshot,
    ranks: inara.ranks,
    rankSource: 'inara',
    ranksFetchedAt: inara.fetchedAt.toISOString(),
  };
}

/**
 * Expands a snapshot's ranks to ALL SIX LADDERS before it leaves the API.
 *
 * ★ WHY HERE AND NOT IN THE BROWSER ★
 *
 * The ladder names live in @grims/shared, which the API depends on and the web
 * app does not. Adding that dependency to ship six labels would pull a package
 * built for the server into the browser bundle; filling them here costs
 * nothing and leaves the card rendering exactly what it is given.
 *
 * The internals stay HELD-ONLY on purpose. `withInaraRanks` decides whether
 * Inara has anything to say by looking at the length of its list, and a
 * pre-filled six would make that test always true — Inara would then win with
 * six nulls and wipe the journal's real ranks off every card.
 */
export function fillLadders(snapshot: CommanderSnapshot): CommanderSnapshot {
  /*
   * The null filter is a type narrowing, not a behaviour change: nothing
   * reaches here with a null name, because filling is the LAST step and the
   * held-only shape is what every producer emits.
   */
  const held = snapshot.ranks.flatMap((r) =>
    r.name === null || r.index === null ? [] : [{ key: r.key, name: r.name, index: r.index }],
  );

  return { ...snapshot, ranks: allEliteRanks(held) };
}

/** One raw event, as stored. */
export interface SnapshotEvent {
  readonly userId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly payload: unknown;
}

/** The event types this reads. Anything else is ignored. */
export const SNAPSHOT_EVENT_TYPES = ['Rank', 'SquadronStartup', 'LoadGame'] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Builds one snapshot per member from their latest events.
 *
 * Takes rows already narrowed to the newest of each (user, type) pair. Doing the
 * narrowing in SQL rather than here matters at a hundred members with months of
 * history — this would otherwise sort tens of thousands of rows in memory to
 * find six.
 */
export function buildSnapshots(events: readonly SnapshotEvent[]): Map<string, CommanderSnapshot> {
  const byUser = new Map<string, { rank?: SnapshotEvent; squadron?: SnapshotEvent; load?: SnapshotEvent }>();

  for (const e of events) {
    const slot = byUser.get(e.userId) ?? {};

    /*
     * Guarded even though the caller narrows. If a second row for the same pair
     * ever arrives — a distinct clause dropped, a join widened — keeping the
     * NEWER one degrades to correct-but-slower rather than to a card showing
     * somebody's ranks from March.
     */
    const keepNewer = (current: SnapshotEvent | undefined): SnapshotEvent =>
      current === undefined || e.occurredAt > current.occurredAt ? e : current;

    if (e.eventType === 'Rank') slot.rank = keepNewer(slot.rank);
    else if (e.eventType === 'SquadronStartup') slot.squadron = keepNewer(slot.squadron);
    else if (e.eventType === 'LoadGame') slot.load = keepNewer(slot.load);

    byUser.set(e.userId, slot);
  }

  const out = new Map<string, CommanderSnapshot>();

  for (const [userId, slot] of byUser) {
    const squadronPayload = asRecord(slot.squadron?.payload);
    const loadPayload = asRecord(slot.load?.payload);

    const rank = squadronPayload['CurrentRank'];
    const ship = loadPayload['Ship_Localised'] ?? loadPayload['Ship'];

    const ranks = slot.rank === undefined ? [] : describeEliteRanks(asRecord(slot.rank.payload));

    out.set(userId, {
      ranks,
      // Attributed even before Inara is consulted, so a snapshot is always
      // self-describing and `withInaraRanks` has nothing to remember to set.
      rankSource: ranks.length > 0 ? 'journal' : null,
      ranksFetchedAt: null,
      squadronRank: typeof rank === 'number' ? rank : null,
      currentShip: typeof ship === 'string' && ship !== '' ? ship : null,
      lastPlayedAt: slot.load?.occurredAt.toISOString() ?? null,
    });
  }

  return out;
}
