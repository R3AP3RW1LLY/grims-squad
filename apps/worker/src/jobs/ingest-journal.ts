import type { PrismaClient } from '@grims/db';
import type { WritableRow } from './knowledge-writer.js';

/**
 * Where the squadron has actually been, from our own members' journals.
 *
 * ★ THE MOST TRUSTED SOURCE WE HAVE ★
 *
 * Spansh is somebody else's nightly export and Inara is self-reported. This is what our own
 * members' games wrote down while they were flying. When it disagrees with anything else, it wins.
 *
 * ★ AGGREGATED, AND NEVER PER-MEMBER ★
 *
 * Rows say "the squadron has visited Deciat 41 times, most recently yesterday". They do not say
 * who. A member consented to us STORING their location (INV-013) — that is not the same as
 * consenting to the assistant reciting their movements to whoever asks, and the assistant is
 * exactly the surface where that distinction gets lost. The roster already has a privacy-gated
 * answer to "where is CMDR X"; this is not a second one without the gate.
 *
 * ★ WHAT IT ADDS THAT THE GALAXY DUMP CANNOT ★
 *
 * Familiarity. "Have we been there" and "which of our systems is closest" are questions about US,
 * and no external source can answer them — a hundred and forty thousand systems are equally
 * unknown to Spansh, and about forty of them are places this squadron actually flies.
 */

export interface JournalKnowledge {
  readonly rows: WritableRow[];
  readonly systems: number;
  readonly stations: number;
}

interface VisitRow {
  name: string;
  visits: bigint;
  last_at: Date;
  commanders: bigint;
}

interface DockRow {
  station: string;
  system: string;
  visits: bigint;
  last_at: Date;
}

/**
 * Builds the rows.
 *
 * ★ AGGREGATED IN POSTGRES, NOT IN NODE ★
 *
 * Every event the squadron has ever sent is millions of rows and grows forever. Reading them into
 * memory to count them would work today and fail silently later — the job would simply get slower
 * every month until it stopped finishing, which is the failure mode nobody notices until it has
 * been broken for weeks.
 */
export async function readJournalKnowledge(db: PrismaClient): Promise<JournalKnowledge> {
  const [systems, stations] = await Promise.all([
    db.$queryRawUnsafe<VisitRow[]>(
      `SELECT payload->>'StarSystem'        AS name,
              COUNT(*)::bigint              AS visits,
              MAX(occurred_at)              AS last_at,
              COUNT(DISTINCT user_id)::bigint AS commanders
         FROM telemetry_events
        -- The three events that mean "a commander was in this system". CarrierJump is included
        -- because a carrier arriving somewhere IS the squadron being there, and it is often the
        -- only record of a system nobody flew to individually.
        WHERE event_type IN ('FSDJump', 'Location', 'CarrierJump')
          AND payload->>'StarSystem' IS NOT NULL
        GROUP BY 1`,
    ),
    db.$queryRawUnsafe<DockRow[]>(
      `SELECT payload->>'StationName' AS station,
              payload->>'StarSystem'  AS system,
              COUNT(*)::bigint        AS visits,
              MAX(occurred_at)        AS last_at
         FROM telemetry_events
        WHERE event_type IN ('Docked', 'Location')
          AND payload->>'StationName' IS NOT NULL
          AND payload->>'StarSystem'  IS NOT NULL
        GROUP BY 1, 2`,
    ),
  ]);

  const rows: WritableRow[] = [];

  for (const s of systems) {
    const visits = Number(s.visits);
    const commanders = Number(s.commanders);

    rows.push({
      source: 'journal',
      kind: 'visited-system',
      extKey: s.name.toLowerCase(),
      name: s.name,
      data: {
        system: s.name,
        visits,
        commanders,
        lastVisitedAt: s.last_at,
      },
      text:
        `The squadron has been to ${s.name} — ${visits} recorded ${visits === 1 ? 'arrival' : 'arrivals'} ` +
        `by ${commanders} ${commanders === 1 ? 'commander' : 'commanders'}, most recently ` +
        `${s.last_at.toISOString().slice(0, 10)}.`,
      /*
       * No coordinates. The galaxy row for the same system already has them, and writing a second
       * set here would be a copy that can drift — the spatial index would then answer differently
       * depending on which row a query happened to hit.
       */
      coords: null,
    });
  }

  for (const d of stations) {
    const visits = Number(d.visits);

    rows.push({
      source: 'journal',
      kind: 'visited-station',
      // Namespaced by system: station names repeat across the galaxy constantly, and "Jameson
      // Memorial" without its system is not an identifier.
      extKey: `${d.system.toLowerCase()}/${d.station.toLowerCase()}`,
      name: d.station,
      data: {
        station: d.station,
        system: d.system,
        visits,
        lastDockedAt: d.last_at,
      },
      text:
        `The squadron docks at ${d.station} in ${d.system} — ${visits} recorded ` +
        `${visits === 1 ? 'docking' : 'dockings'}, most recently ${d.last_at.toISOString().slice(0, 10)}.`,
      coords: null,
    });
  }

  return { rows, systems: systems.length, stations: stations.length };
}
