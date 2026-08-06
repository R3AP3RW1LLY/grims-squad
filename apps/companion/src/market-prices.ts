/**
 * Attaching a station's prices to the journal event that announced it.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "nothing happens when someone lands here and opens the commodities market, they are supposed to
 * be credited on the leaderboard with the points etc ... none of this is working!"
 *
 * They were right, and it had never worked once. Production: 1,092 `Market` events received, ZERO
 * market rows written from a member's journal, ZERO data bounty claims in the ledger, ever.
 *
 * ★ THE JOURNAL'S `Market` EVENT HAS NO PRICES IN IT ★
 *
 * Frontier writes it as a five-field announcement — timestamp, event, MarketID, StationName,
 * StarSystem — and puts the commodity list in a SEPARATE file, `Market.json`, rewritten each time
 * a market screen is opened.
 *
 * The hub's `applySnapshot` returns 0 the moment `Items` is missing, so no market row was ever
 * written from an upload, so `awardBounty` — which only runs when rows were written — was never
 * once reached. Every link in that chain was correct, and the first one had no data.
 *
 * ★ THE FILE WAS DELIBERATELY OFF LIMITS, AND THAT CHANGED OPENLY ★
 *
 * `journal-paths.spec` asserted this app ignores Market.json, reasoning "the app says it reads the
 * journal, so it reads the journal". The promise was kept and the feature built on top of it could
 * not work. The squadron owner chose to read the file and change the promise where it is written
 * down — the settings page now names it — rather than keep a leaderboard that credits nobody.
 *
 * It stays under the SAME `trade` consent as the Market event itself: a member who has switched
 * trade off sends neither, and nothing here can be reached without the event that triggers it.
 */

/** Whatever `Market.json` parsed to, treated as unknown until proven otherwise. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Frontier writes this as a number; a journal through a JSON round trip can carry a string. */
function marketIdOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

/**
 * The event, with `Items` attached when — and only when — the prices on disk belong to it.
 *
 * @param event the journal event, exactly as read.
 * @param marketJson the contents of `Market.json`, or null when it could not be read.
 */
export function withMarketPrices(
  event: Record<string, unknown>,
  marketJson: string | null,
): Record<string, unknown> {
  if (event['event'] !== 'Market' || marketJson === null) return event;

  let parsed: unknown;
  try {
    parsed = JSON.parse(marketJson);
  } catch {
    // The file is rewritten while the game runs, so a read can catch it half-written. Normal.
    return event;
  }

  const file = asRecord(parsed);
  if (file === null) return event;

  /*
   * ★ THE IDS MUST AGREE, AND THIS IS THE WHOLE SAFETY OF IT ★
   *
   * Market.json holds ONE market — the last one opened — and is overwritten. Catching up on an old
   * journal, or a member docking somewhere else while a batch is in flight, means the file on disk
   * describes a DIFFERENT station than the event being processed.
   *
   * Attaching those prices would publish one station's prices under another station's name, to the
   * whole squadron, as fact — and route members across the bubble to buy something that was never
   * there. Wrong data stated confidently is far worse than the feature not paying out.
   */
  const wanted = marketIdOf(event['MarketID']);
  if (wanted === null || wanted !== marketIdOf(file['MarketID'])) return event;

  const items = file['Items'];
  /*
   * An EMPTY list is refused rather than passed on. The hub's snapshot path deletes every row for
   * the station before inserting what it was given, so an empty array would wipe a station's whole
   * market — turning a half-written file into "this station trades nothing".
   */
  if (!Array.isArray(items) || items.length === 0) return event;

  // Spread the EVENT last: the journal's own fields win. The file's copy is usually identical and
  // would silently stop being so the day Frontier changes one of them.
  return { ...event, Items: items };
}
