import { describeEliteRanks, type EliteRankKey } from '@grims/shared';

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
   * Named ranks, e.g. `Trade: Tycoon`. Empty when nothing has been reported.
   *
   * `index` is carried alongside the name because the UI needs to rank them by
   * ACHIEVEMENT, and the names sort alphabetically into nonsense — "Surveyor"
   * beats "Elite" in a string comparison, which is the opposite of true.
   */
  readonly ranks: Array<{ key: EliteRankKey; label: string; name: string; index: number }>;
  /** Squadron rank as the GAME reports it, which is not our own rank ladder. */
  readonly squadronRank: number | null;
  /** The ship they were last flying. */
  readonly currentShip: string | null;
  /** When they last launched the game. */
  readonly lastPlayedAt: string | null;
}

export const EMPTY_SNAPSHOT: CommanderSnapshot = {
  ranks: [],
  squadronRank: null,
  currentShip: null,
  lastPlayedAt: null,
};

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

    out.set(userId, {
      ranks:
        slot.rank === undefined
          ? []
          : describeEliteRanks(asRecord(slot.rank.payload)),
      squadronRank: typeof rank === 'number' ? rank : null,
      currentShip: typeof ship === 'string' && ship !== '' ? ship : null,
      lastPlayedAt: slot.load?.occurredAt.toISOString() ?? null,
    });
  }

  return out;
}
