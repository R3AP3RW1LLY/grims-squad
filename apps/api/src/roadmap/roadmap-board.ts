/**
 * The roadmap board — the rules, with nothing else attached.
 *
 * ★ THE APPROVED DESIGN, BRIEFLY ★
 *
 * A webmaster-managed kanban: Ideas / Considering / Planned / Building / Shipped, managed from
 * the admin console, readable by every member at /roadmap. Feature Requests threads are
 * promoted onto it, landing in Ideas with a link back to the vote.
 *
 * ★ PURE, LIKE suggestion-box.ts, AND FOR THE SAME REASON ★
 *
 * Column order, the caps and the reordering arithmetic are the correctness of this feature.
 * The service applies these; the spec drives them directly.
 */

/** The five columns, in board order — left to right, idea to shipped. */
export const ROADMAP_COLUMNS = [
  'ideas',
  'considering',
  'planned',
  'building',
  'shipped',
] as const;

export type RoadmapColumn = (typeof ROADMAP_COLUMNS)[number];

/** What each column is called on the board. One place, so the console and /roadmap agree. */
export const COLUMN_LABELS: Record<RoadmapColumn, string> = {
  ideas: 'Ideas',
  considering: 'Considering',
  planned: 'Planned',
  building: 'Building',
  shipped: 'Shipped',
};

export function isRoadmapColumn(raw: unknown): raw is RoadmapColumn {
  return typeof raw === 'string' && (ROADMAP_COLUMNS as readonly string[]).includes(raw);
}

/**
 * The thread-title ceiling, because promoted cards take their title from one — a cap below it
 * would truncate the very title the squadron voted on.
 */
export const CARD_TITLE_MAX_CHARS = 200;

/** A card's body says what and why, not how. The suggestion cap, for the same reason. */
export const CARD_BODY_MAX_CHARS = 2000;

/** Cleans a card title, or says what is wrong with it in a sentence a human can act on. */
export function cleanCardTitle(raw: unknown): { title: string } | { problem: string } {
  if (typeof raw !== 'string') return { problem: 'Give the card a title first.' };
  const title = raw.replace(/\s+/g, ' ').trim();
  if (title.length < 3) return { problem: 'A card title is at least 3 characters.' };
  if (title.length > CARD_TITLE_MAX_CHARS) {
    return { problem: `A card title is at most ${CARD_TITLE_MAX_CHARS} characters.` };
  }
  return { title };
}

/** Cleans a card body. Empty becomes null: the title speaks for itself. */
export function cleanCardBody(raw: unknown): { body: string | null } | { problem: string } {
  if (raw === undefined || raw === null) return { body: null };
  if (typeof raw !== 'string') return { problem: 'That card body is not text.' };
  const body = raw.replace(/\r\n/g, '\n').trim();
  if (body === '') return { body: null };
  if (body.length > CARD_BODY_MAX_CHARS) {
    return {
      problem: `A card body is at most ${CARD_BODY_MAX_CHARS.toLocaleString('en-GB')} characters — say what and why here, and put the how in the thread.`,
    };
  }
  return { body };
}

/**
 * Where a card lands in its target column: the requested index, clamped to what exists.
 *
 * Clamped rather than refused, deliberately. The console's arrow buttons compute an index from
 * a list that can be seconds stale — a colleague may have archived the card above — and
 * refusing "position 4 of 3" would turn every such race into an error a human has to retry.
 * Landing at the nearest real slot is what they meant.
 */
export function clampPosition(requested: unknown, columnSize: number): number {
  const n = typeof requested === 'number' && Number.isInteger(requested) ? requested : columnSize;
  return Math.max(0, Math.min(n, columnSize));
}

/**
 * The new order of ids after placing `cardId` at `index` — the whole-column renumber the
 * colonisation planner's build order uses. Positions are rewritten 0..n rather than averaged
 * between neighbours, so they never need compacting and two moves never collide.
 */
export function placeInOrder(ids: readonly string[], cardId: string, index: number): string[] {
  const without = ids.filter((id) => id !== cardId);
  const at = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, at), cardId, ...without.slice(at)];
}
