/**
 * A colour that means "this commander", everywhere, for everybody.
 *
 * ★ SQUADRON OWNER, 2026-08-12 ★
 *
 * "assign different and random colors for each player and list the carrier id and each player
 * commander name with a color legend under each item that they hold"
 *
 * ★ STABLE RATHER THAN RANDOM — the owner's choice when asked ★
 *
 * Random was the literal request and would have worked exactly once. This legend is read while
 * deciding what to buy, on a page somebody returns to all evening and compares against what another
 * member is looking at. A colour that changes between sessions — or between two people reading the
 * same build — turns the legend into something you must re-read every time rather than something
 * you learn.
 *
 * Derived from the commander's id, so it is identical on the website and in the app with nothing
 * stored and no coordination between them.
 */

/**
 * Twelve colours, spaced around the wheel and picked to stay legible on the dark panel.
 *
 * ★ DELIBERATELY CLEAR OF THE BUILD-STATE COLOURS ★
 *
 * `complete` is green and `started` is amber on both surfaces. A "held by" dot in either would read
 * as a state rather than as a person, which is worse than having no colour at all — so neither
 * appears here, and the greens that do are pushed towards teal.
 */
export const COMMANDER_PALETTE: readonly string[] = [
  '#5cd9ff', // cyan
  '#b58cff', // violet
  '#ff7ab8', // rose
  '#4ecdc4', // teal
  '#ffd166', // sand
  '#8ab6ff', // periwinkle
  '#ff8c6b', // coral
  '#9ee37d', // lime — well clear of the success green
  '#d4a5ff', // orchid
  '#6fd3e8', // sky
  '#ffb3c7', // blush
  '#c3b1ff', // lilac
];

/**
 * The colour for a commander, from their id.
 *
 * A small deterministic hash rather than a random pick or a stored column: the same answer in the
 * browser, in Electron and on the server, with no migration and nothing to keep in sync.
 *
 * Not a promise of global uniqueness — with twelve colours the thirteenth commander must repeat —
 * but the handful who appear together under one commodity are what has to be told apart, and the
 * spread is wide enough that they are.
 */
export function commanderColour(userId: string): string {
  /*
   * FNV-1a. Chosen because it is four lines, has no dependencies and distributes short similar
   * strings well — "u-grim" and "u-grim2" must not land on the same colour, which a naive sum of
   * character codes would do routinely.
   */
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  const index = Math.abs(hash) % COMMANDER_PALETTE.length;
  // Non-null: index is bounded by the palette length, and the palette is never empty.
  return COMMANDER_PALETTE[index] ?? COMMANDER_PALETTE[0] ?? '#5cd9ff';
}
