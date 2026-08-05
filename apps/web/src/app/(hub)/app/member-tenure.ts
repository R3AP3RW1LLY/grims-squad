/*
 * ★ THE SUBPATH, NOT THE BARREL ★
 *
 * This file has no `'use client'` of its own, but the activity table does and imports it — so
 * anything it pulls in ends up in the client bundle. `@grims/shared`'s index re-exports
 * `nonce.service`, which imports `node:crypto`, and webpack fails the whole route with
 * `UnhandledSchemeError`. That took `/app` to a 500 for a few minutes here, exactly as
 * `client-imports.spec.ts` warns.
 *
 * That guard only inspects files carrying `'use client'`, so it did not see this one. It now
 * follows relative imports out of client components, which is how this would have been caught.
 */
import { tenureBetween, formatTenure, type Tenure } from '@grims/shared/tenure';
import type { AdminActivityRow } from '../../../lib/api';

/**
 * How long a member has been in the squadron, and how confident we are about it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "add a member for column that shows how long a member has been in the Grim's Squad Discord server
 * this will also psudo serve as the length of time they have been a member of Grims Squad, unless we
 * can pull this from the Inara Squadron roster"
 *
 * Inara cannot. Its only commander endpoint returns a squadron name and rank and no dates, and there
 * is no roster endpoint; the game's `SquadronStartup` has no date either. The Discord join date is
 * the only exact answer that exists anywhere, and since this squadron recruits through Discord it is
 * not a proxy at all — it IS the membership start.
 *
 * ★ TWO SOURCES, NEVER MIXED SILENTLY ★
 *
 * `joinedAt` is what Discord says. `activeSince` is the earliest month we recorded anything, used
 * only when the first is missing — which means everybody who has left, because Discord discards a
 * join date on departure.
 *
 * They are different claims. "Joined in March" and "we first saw them in March" are not the same
 * sentence, and somebody could easily have been here a year before the bot was. So the source comes
 * back with the value and the column says which it is showing.
 */

export interface SquadronTenure {
  readonly label: string;
  /** Days, for sorting and for the filter buckets. */
  readonly totalDays: number;
  /**
   * `joined`   Discord's own join date. Exact.
   * `seen`     earliest recorded activity. A floor, not a start.
   */
  readonly source: 'joined' | 'seen';
  readonly at: string;
}

/** The parts of a row this reads. Narrow, so tests need three fields rather than thirty. */
export type TenureSource = Pick<AdminActivityRow, 'joinedAt' | 'activeSince'>;

function parse(iso: string | null): Date | null {
  if (iso === null) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * The tenure for one row, or null when we genuinely do not know.
 *
 * Null is a real answer here and is rendered as "unknown" rather than as a dash or a zero. A member
 * whose tenure we cannot establish must not be shown as having joined today — that is the reading an
 * officer would act on, and it would be wrong in the direction that matters.
 */
export function squadronTenure(row: TenureSource, now: number = Date.now()): SquadronTenure | null {
  const joined = parse(row.joinedAt);
  const seen = joined === null ? parse(row.activeSince) : null;
  const from = joined ?? seen;
  if (from === null) return null;

  const t: Tenure = tenureBetween(from, new Date(now));

  return {
    label: formatTenure(t),
    totalDays: t.totalDays,
    source: joined !== null ? 'joined' : 'seen',
    at: from.toISOString(),
  };
}
