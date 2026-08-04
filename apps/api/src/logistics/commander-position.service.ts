import type { PrismaClient } from '@grims/db';

/**
 * Where a member was last, and when.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "make the Commodities page and all commodity subpages more accurate, based on the users current
 * or last know position."
 *
 * ★ WHY THIS EXISTS AT ALL, AND WHY IT IS NOT IN THE COMPANION ★
 *
 * The companion reads the journal and always knows where somebody is. The WEBSITE has never known,
 * so every page that needed an origin either asked for one or quietly ranked the whole galaxy by
 * price — which is the exact bug the colonisation shopping list was reported for: "this is telling
 * us to leave the system!"
 *
 * But the website is not blind. The app has been uploading journal events all along, and four of
 * them carry a position. Nothing had ever read them back.
 *
 * ★ THE ANSWER ALWAYS CARRIES ITS AGE, AND THAT IS THE POINT ★
 *
 * A position from six hours ago is useful. A position from three weeks ago is a trap: it looks
 * exactly as authoritative and will send somebody shopping four hundred light years from where they
 * are. So this never returns a bare system name — it returns when it was true and what said so, and
 * the pages print that next to every number measured from it.
 *
 * Nothing here decides what is "too old". That is a judgement for the surface: a commodity page
 * happily measures from a week-old position, and a route planner should probably say something.
 */

/** Journal events that say where somebody is, newest wins. */
const POSITION_EVENTS = ['FSDJump', 'CarrierJump', 'Location', 'Docked'] as const;

export interface CommanderPosition {
  readonly systemName: string;
  /** Present when they were docked, so a page can say "at Jameson Memorial" rather than guess. */
  readonly stationName: string | null;
  /** When the event happened in game, not when we received it. */
  readonly at: Date;
  /** Which journal event said so — shown, because "docked" and "jumped" mean different things. */
  readonly source: string;
  /**
   * Coordinates, when we can get them.
   *
   * `FSDJump` carries `StarPos` outright, which is better than a lookup: it is exact, it costs
   * nothing, and it works for a system our galaxy dump has never heard of. Everything else needs
   * the name resolved, and a name we cannot place comes back null rather than wrong.
   */
  readonly coords: { readonly x: number; readonly y: number; readonly z: number } | null;
}

/** Reads `[x, y, z]` out of a journal payload, refusing anything that is not three finite numbers. */
function starPos(raw: unknown): { x: number; y: number; z: number } | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const [x, y, z] = raw;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

export class CommanderPositionService {
  constructor(
    private readonly db: PrismaClient,
    /** Resolves a system name to coordinates for the events that carry no `StarPos`. */
    private readonly coordsOf: (system: string) => Promise<{ x: number; y: number; z: number } | null>,
  ) {}

  /**
   * The most recent place we know this member to have been.
   *
   * ★ ORDERED BY WHEN IT HAPPENED, NOT BY WHEN WE HEARD ★
   *
   * `received_at` is when the upload landed, and the app uploads in batches after the fact — a
   * member who plays offline and syncs later would otherwise appear to have jumped in the order the
   * files were read rather than the order they flew.
   */
  async lastKnown(userId: string): Promise<CommanderPosition | null> {
    const [row] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT event_type, occurred_at, payload
         FROM telemetry_events
        WHERE user_id = $1::uuid
          AND event_type = ANY($2::text[])
          AND payload ->> 'StarSystem' IS NOT NULL
        ORDER BY occurred_at DESC
        LIMIT 1`,
      userId,
      [...POSITION_EVENTS],
    );

    if (row === undefined) return null;

    const payload = (row['payload'] ?? {}) as Record<string, unknown>;
    const systemName = typeof payload['StarSystem'] === 'string' ? payload['StarSystem'] : '';
    if (systemName === '') return null;

    const station = payload['StationName'];

    return {
      systemName,
      stationName: typeof station === 'string' && station !== '' ? station : null,
      at: row['occurred_at'] as Date,
      source: String(row['event_type']),
      coords: starPos(payload['StarPos']) ?? (await this.coordsOf(systemName)),
    };
  }
}

/**
 * How long ago, in the words a page should print.
 *
 * ★ SAID IN UNITS SOMEBODY FLIES IN ★
 *
 * "6h ago" is a decision — you have probably not moved far. "3 weeks ago" is also a decision, the
 * opposite one. A timestamp is neither, which is why this exists rather than a date on the page.
 */
export function positionAge(at: Date, now: number): { readonly text: string; readonly stale: boolean } {
  const minutes = Math.max(0, Math.floor((now - at.getTime()) / 60_000));

  if (minutes < 2) return { text: 'just now', stale: false };
  if (minutes < 60) return { text: `${minutes} minutes ago`, stale: false };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { text: `${hours} hour${hours === 1 ? '' : 's'} ago`, stale: false };

  const days = Math.floor(hours / 24);
  /*
   * A day is the line. Somebody who last docked yesterday is almost certainly still in the same
   * region; somebody who last docked a fortnight ago may be on the other side of the bubble, and a
   * page measuring distances from there is lying with a straight face.
   */
  if (days < 30) return { text: `${days} day${days === 1 ? '' : 's'} ago`, stale: days >= 1 };

  const months = Math.floor(days / 30);
  return { text: `${months} month${months === 1 ? '' : 's'} ago`, stale: true };
}
