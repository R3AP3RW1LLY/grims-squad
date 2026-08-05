import { shipDisplayName } from '@grims/shared';
import { allEliteRanks, describeEliteRanks, type EliteRankStanding } from '@grims/shared';

/**
 * A commander's own dashboard: what THEY have, not what the squadron has.
 *
 * ★ WHERE EACH FIELD COMES FROM, AND WHY IT IS NOT ALL ONE PLACE ★
 *
 *   ranks     INARA, refreshed on a schedule, falling back to the journal.
 *             Inara is the member's own published record; the journal is live
 *             but only exists for members running the companion app.
 *
 *   fleet     THE JOURNAL, and only the journal. Inara's API returns
 *             `commanderMainShip` and nothing else — one ship, no hangar — so
 *             there is no second source and no way to fill this for a member
 *             who does not run the app.
 *
 *   credits   NEITHER, and that is deliberate rather than missing. See the
 *             note on `credits` below.
 *
 * ★ THIS IS THE MEMBER'S OWN DATA ★
 *
 * Privacy toggles govern what OTHER people see. They do not apply here: a
 * member looking at their own dashboard is not an audience, and hiding
 * somebody's own fleet from them because they chose not to publish it would be
 * a misreading of what the toggle is for.
 */

export interface OwnedShip {
  readonly shipType: string;
  readonly name: string | null;
  /** True for the ship they were last flying. */
  readonly current: boolean;
  /** Null when the journal did not say where it is. */
  readonly location: string | null;
}

export interface CommanderProfile {
  readonly cmdrName: string | null;
  /** All six ladders, always, with null for one nothing has been reported for. */
  readonly ranks: readonly EliteRankStanding[];
  readonly rankSource: 'inara' | 'journal' | null;
  readonly ranksFetchedAt: string | null;
  /** The ship they were last seen flying. */
  readonly currentShip: string | null;
  readonly fleet: readonly OwnedShip[];
  /**
   * Their balance, from the newest LoadGame.
   *
   * ★ COLLECTED SINCE 2026-07-29 ★
   *
   * It was stripped on the member's machine and this field was permanently
   * null. Telemetry is opt-out now and the balance was asked for, so it rides
   * with the `profile` category — which a member CAN switch off. Deliberately
   * not with `session`, which they cannot: the required category must never be
   * the reason somebody has no way to refuse something.
   *
   * Null when no session has been reported since the change, or when they have
   * declined `profile`.
   */
  readonly credits: number | null;
  readonly lastPlayedAt: string | null;
  /** Squadron rank as the GAME reports it. Not our ladder, not Inara's. */
  readonly squadronRank: number | null;
  /** The system they were last seen in, and when. Null until something reports one. */
  readonly currentSystem: string | null;
  readonly systemSeenAt: string | null;
  /** Station, settlement or body — whatever the journal last named inside the system. */
  readonly currentLocation: string | null;
  /** Its own timestamp: a docking and a jump age at different rates. */
  readonly locationSeenAt: string | null;
}

/** One raw event, as stored. */
export interface ProfileEvent {
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly payload: unknown;
}

/** The event types this reads. Anything else is ignored. */
export const PROFILE_EVENT_TYPES = [
  'Rank',
  'LoadGame',
  /*
   * What they are actually flying. `LoadGame` fires once at login and reports whatever they logged
   * out IN — a SUIT, for an on-foot logout — so it cannot answer "current ship" on its own.
   * `Loadout` fires on every ship change, which is the question being asked.
   */
  'Loadout',
  'StoredShips',
  'SquadronStartup',
  /*
   * Where they are. Collectable by default since telemetry became opt-out
   * (INV-013, amended 2026-07-29) — under opt-in this was off for everybody
   * unless they went looking for the switch.
   *
   * BOTH, because they answer at different moments: `FSDJump` fires on arrival
   * in a new system and `Location` on loading into one you were already in. A
   * member who logs in without jumping has only the second, and reading just
   * the first would show them nothing.
   */
  'FSDJump',
  'Location',
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Reads one member's hangar out of a `StoredShips` event.
 *
 * ★ BOTH LISTS, AND THE DIFFERENCE MATTERS ★
 *
 * `ShipsHere` is what is parked where they are standing; `ShipsRemote` is
 * everything else, scattered across the bubble. A fleet view that showed only
 * the first would tell a member they own three ships when they own twenty.
 *
 * The localised name wins where present — "Lynx Highliner" rather than
 * "mediumtransport01", which is the internal symbol and means nothing to a
 * player.
 */
function readFleet(payload: unknown, here: string | null): OwnedShip[] {
  const p = asRecord(payload);
  const out: OwnedShip[] = [];

  const take = (raw: unknown, location: string | null) => {
    if (!Array.isArray(raw)) return;
    for (const entry of raw as unknown[]) {
      const ship = asRecord(entry);
      const type = str(ship['ShipType_Localised']) ?? str(ship['ShipType']);
      if (type === null) continue;

      out.push({
        shipType: type,
        name: str(ship['Name']),
        current: false,
        // ShipsRemote entries carry their own StarSystem; ShipsHere are where
        // the member was standing when the event fired.
        location: str(ship['StarSystem']) ?? location,
      });
    }
  };

  take(p['ShipsHere'], here);
  take(p['ShipsRemote'], null);

  return out;
}

/**
 * Builds one member's commander profile from their latest events.
 *
 * `inaraRanks` wins over the journal when it has anything, matching the roster
 * — a member should not see one set of ranks on their dashboard and another on
 * their card.
 */
export function buildCommanderProfile(
  events: readonly ProfileEvent[],
  cmdrName: string | null,
  inara: { ranks: EliteRankStanding[]; fetchedAt: Date } | null,
): CommanderProfile {
  const latest = new Map<string, ProfileEvent>();
  for (const e of events) {
    const held = latest.get(e.eventType);
    // Guarded even though the caller narrows: keeping the NEWER one degrades to
    // correct-but-slower rather than to a dashboard showing March's fleet.
    if (held === undefined || e.occurredAt > held.occurredAt) latest.set(e.eventType, e);
  }

  const load = asRecord(latest.get('LoadGame')?.payload);
  const stored = latest.get('StoredShips');
  const squadron = asRecord(latest.get('SquadronStartup')?.payload);

  /*
   * ★ Loadout FIRST, LoadGame ONLY AS A FALLBACK ★
   *
   * This read `LoadGame` alone, which is wrong twice over. `LoadGame` fires ONCE at login, so it
   * goes stale the moment somebody swaps ship — and it reports whatever you logged out IN, which
   * for an on-foot logout is a SUIT. Production had a member whose "current ship" resolved to
   * `$TacticalSuit_Class1_Name;`.
   *
   * `Loadout` fires on every ship change and every login, so it is the event that actually answers
   * "what are they flying". It carries the hull in lowercase with NO `Ship_Localised` at all,
   * which is why the name is resolved from the raw value rather than from Frontier's localisation.
   *
   * `allowSuits` is left off deliberately: a suit is not a ship, and a profile field labelled
   * "current ship" showing a Maverick is worse than showing nothing.
   */
  const loadout = asRecord(latest.get('Loadout')?.payload);

  const currentShip =
    shipDisplayName(str(loadout['Ship']), str(loadout['Ship_Localised'])) ??
    shipDisplayName(str(load['Ship']), str(load['Ship_Localised']));

  /*
   * Inara first, journal as the fallback — the same order the roster uses, so a
   * member never sees one set of ranks on their dashboard and a different set
   * on their own card.
   *
   * `describeEliteRanks` is the SAME function the roster calls. An earlier
   * draft of this hand-rolled the mapping and got it wrong; there is one place
   * that knows how to turn a Rank payload into named ladders and this is not
   * it.
   */
  const journalRanks = describeEliteRanks(asRecord(latest.get('Rank')?.payload));
  const held = inara !== null && inara.ranks.length > 0
    ? inara.ranks.flatMap((r) =>
        r.name === null || r.index === null ? [] : [{ key: r.key, name: r.name, index: r.index }],
      )
    : journalRanks;

  const fleet = readFleet(stored?.payload, str(asRecord(stored?.payload)['StarSystem']));

  // The ship they are flying is marked rather than listed twice — it is already
  // in the hangar list, and a duplicate row reads as owning two of them.
  const withCurrent = fleet.map((s) => ({
    ...s,
    current: currentShip !== null && s.shipType === currentShip,
  }));

  const rank = squadron['CurrentRank'];

  /*
   * The NEWER of the two location events wins. A jump and a load can both be
   * present, and taking either by preference would sometimes show the system
   * they left rather than the one they are in.
   */
  const jump = latest.get('FSDJump');
  const location = latest.get('Location');
  const newest =
    jump === undefined
      ? location
      : location === undefined
        ? jump
        : jump.occurredAt > location.occurredAt
          ? jump
          : location;

  const currentSystem = newest === undefined ? null : str(asRecord(newest.payload)['StarSystem']);

  /*
   * ★ WHERE IN THE SYSTEM — squadron owner, 2026-07-30 ★
   *
   * "show the system they are currently in ... and then in the second column, show the station,
   * settlement, planet or what ever sublocation that is transmitted."
   *
   * ★ FOUR EVENTS, AND THE NEWEST OF THEM WINS ★
   *
   * A sublocation is not one field. `Docked` names a station; `Location` can name either a station
   * or a body; `SupercruiseExit` names the body they dropped at; `ApproachSettlement` names a
   * settlement on a planet. Reading only one of them means a member who docks after loading in
   * still shows the body they loaded at — right event, stale answer.
   *
   * ★ AND WHY UNDOCKING HAS TO COUNT ★
   *
   * `Undocked` carries a station name too, and using it would say somebody is AT the station they
   * just left. It is included as a CLEAR rather than as a value: it is the only event that says
   * "no longer anywhere in particular", and without it a member who undocks and flies off keeps
   * showing as docked indefinitely.
   */
  const sub = [
    latest.get('Docked'),
    latest.get('Location'),
    latest.get('SupercruiseExit'),
    latest.get('ApproachSettlement'),
    latest.get('Undocked'),
  ]
    .filter((e): e is NonNullable<typeof e> => e !== undefined)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

  const subPayload = asRecord(sub?.payload);
  const currentLocation =
    sub === undefined || sub === latest.get('Undocked')
      ? null
      : /*
         * Station first, then settlement, then body. A station on a planet reports both, and the
         * station is the more useful of the two — "Jameson Memorial" tells somebody where you are
         * in a way "Shinrarta Dezhra A 1" does not.
         */
        (str(subPayload['StationName']) ??
        str(subPayload['Name']) ??
        str(subPayload['Body']) ??
        null);

  return {
    cmdrName,
    ranks: allEliteRanks(held),
    rankSource: inara !== null && inara.ranks.length > 0 ? 'inara' : held.length > 0 ? 'journal' : null,
    ranksFetchedAt: inara?.fetchedAt.toISOString() ?? null,
    currentShip,
    fleet: withCurrent,
    /*
     * From the newest LoadGame. Allowed through since 2026-07-29 — it rides
     * with `profile`, which a member can switch off, deliberately NOT with
     * `session`, which they cannot.
     */
    credits: typeof load['Credits'] === 'number' ? load['Credits'] : null,
    lastPlayedAt: latest.get('LoadGame')?.occurredAt.toISOString() ?? null,
    squadronRank: typeof rank === 'number' ? rank : null,
    currentSystem,
    // The timestamp travels with it: "Sol" with no date is a claim about now,
    // and it might be three weeks old.
    systemSeenAt: currentSystem === null ? null : (newest?.occurredAt.toISOString() ?? null),
    currentLocation,
    /*
     * Its OWN timestamp, not the system's.
     *
     * They move at different rates — somebody can sit docked for an hour after a jump — and
     * sharing one timestamp would date the sublocation from the jump, making a current docking
     * look an hour old (or a stale docking look fresh, which is worse).
     */
    locationSeenAt: currentLocation === null ? null : (sub?.occurredAt.toISOString() ?? null),
  };
}
