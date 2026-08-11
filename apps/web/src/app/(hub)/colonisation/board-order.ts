import { rankOpportunities, type Opportunity } from '@grims/shared/colony-opportunity';
import type { ColonyProject } from '../../../lib/api';

/**
 * Ordering a board for the member reading it.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "what can I do tonight" — chosen from the colonisation suggestions, along with board sorts and
 * stall detection.
 *
 * ★ THE RANKING ITSELF IS SHARED, ON PURPOSE ★
 *
 * `rankOpportunities` lives in @grims/shared and the companion calls the same function with the
 * same inputs. Two implementations of "which build wants me most" would drift, and the half that
 * drifted would be the one sending somebody nine hundred light years for a build that was finished
 * on the other surface an hour ago.
 *
 * This module is only the glue: it converts the board's own row shape into the ranking's input,
 * applies the sort the member asked for, and hands back both the order and the annotations.
 */

export const BOARD_SORTS = [
  { key: 'best', label: 'Best for you' },
  { key: 'nearest', label: 'Nearest' },
  { key: 'progress', label: 'Closest to done' },
  { key: 'stalled', label: 'Needs attention' },
  { key: 'newest', label: 'Recently posted' },
] as const;

export type BoardSort = (typeof BOARD_SORTS)[number]['key'];

export function resolveSort(raw: string | undefined): BoardSort {
  return BOARD_SORTS.some((s) => s.key === raw) ? (raw as BoardSort) : 'best';
}

/** Where the caller was last seen, as the board endpoint sends it. */
export interface Viewer {
  systemName: string;
  coords: { x: number; y: number; z: number } | null;
  at: string;
}

export interface OrderedBoard {
  readonly projects: readonly ColonyProject[];
  /** Per project id — distance, stall and the sentences that earned its rank. */
  readonly notes: ReadonlyMap<string, Opportunity>;
  /** True when the ranking had no position to work from, so the page can say why. */
  readonly positionless: boolean;
}

export function orderBoard(
  projects: readonly ColonyProject[],
  you: Viewer | null,
  sort: BoardSort,
): OrderedBoard {
  const ranked = rankOpportunities(
    projects.map((p) => ({
      id: p.id,
      title: p.title,
      systemName: p.systemName,
      owner: p.owner,
      isPriority: p.isPriority,
      remaining: p.remaining,
      required: p.required,
      coords: p.coords ?? null,
      lastDeliveryAt: p.lastDeliveryAt === null ? null : new Date(p.lastDeliveryAt),
    })),
    { coords: you?.coords ?? null, now: Date.now() },
  );

  const notes = new Map(ranked.map((o) => [o.id, o]));
  const byId = new Map(projects.map((p) => [p.id, p]));

  /*
   * ★ FINISHED BUILDS ARE NOT DROPPED FROM THE BOARD ★
   *
   * The ranking refuses to OFFER them — it answers "what could I do tonight" and a finished build is
   * not an answer. The board is a different thing: it is the record of what the squadron is doing,
   * and a completed project disappearing from it the moment it completes would read as deletion.
   *
   * So ranked rows lead, in rank order, and everything the ranking dropped follows in the order the
   * server sent it — which already puts priority first and finished last.
   */
  const ordered = [...ranked]
    .sort((a, b) => compare(a, b, sort))
    .map((o) => byId.get(o.id))
    .filter((p): p is ColonyProject => p !== undefined);

  const rest = projects.filter((p) => !notes.has(p.id));

  return { projects: [...ordered, ...rest], notes, positionless: (you?.coords ?? null) === null };
}

function compare(a: Opportunity, b: Opportunity, sort: BoardSort): number {
  switch (sort) {
    case 'nearest': {
      // Unknown distance sorts last rather than first: "we cannot place it" is not "it is here".
      const x = a.distanceLy ?? Number.POSITIVE_INFINITY;
      const y = b.distanceLy ?? Number.POSITIVE_INFINITY;
      return x !== y ? x - y : a.id.localeCompare(b.id);
    }
    case 'progress': {
      const x = a.pctDone ?? -1;
      const y = b.pctDone ?? -1;
      return y !== x ? y - x : a.id.localeCompare(b.id);
    }
    case 'stalled': {
      // Most neglected first. A build nobody has ever hauled to has no idle days and is not the
      // thing this sort is looking for, so it goes below the ones that have gone quiet.
      const x = a.daysSinceDelivery ?? -1;
      const y = b.daysSinceDelivery ?? -1;
      return y !== x ? y - x : a.id.localeCompare(b.id);
    }
    case 'newest':
      // The server's own order, which is already priority-then-recently-touched.
      return 0;
    case 'best':
    default:
      return b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id);
  }
}
