/**
 * Refreshing every commander's Inara profile, on a schedule.
 *
 * ★ WHY THIS JOB EXISTS AT ALL ★
 *
 * Nothing on the website may call Inara (ADR-004). The roster reads a cache
 * table; this is the only thing that fills it. A page load has therefore no
 * dependency on Inara's availability, its rate limit, or our key still being
 * approved — the worst any of those can do is make the cached data older.
 *
 * ★ WHY EVERY TWENTY MINUTES IS AFFORDABLE ★
 *
 * The adapter batches thirty commanders per request, so a hundred members cost
 * four requests — around two minutes of the global 2/min budget, three times an
 * hour. Under the old one-name-per-request shape this same sweep would have
 * taken fifty minutes and could only ever have run nightly.
 *
 * ★ WHAT IT DOES NOT DO ★
 *
 * It never writes a commander NAME, and it never touches verification. Inara's
 * public profile is self-reported: a member types their squadron and ranks into
 * a website, and treating that as evidence of anything would undo the whole
 * point of key-based verification. This is enrichment for a roster card.
 */

export interface SyncableCommander {
  readonly userId: string;
  /** The commander name to ask Inara about. Never one Inara gave us. */
  readonly cmdrName: string;
}

/** One commander's Inara profile, as stored. */
export interface InaraProfileRow {
  readonly userId: string;
  readonly searchName: string;
  readonly ranks: ReadonlyArray<{ key: string; label: string; name: string; index: number }>;
  readonly squadronName: string | null;
  readonly squadronRank: string | null;
  readonly isFound: boolean;
  readonly fetchedAt: Date;
}

export interface InaraRankStore {
  /** Every member with a commander name worth asking about. */
  listCommanders(): Promise<SyncableCommander[]>;
  save(rows: readonly InaraProfileRow[]): Promise<void>;
}

export interface InaraProfileSource {
  getCommanderProfiles(names: readonly string[]): Promise<
    Map<
      string,
      {
        squadronName: string | null;
        squadronRank: string | null;
        ranks: ReadonlyArray<{ key: string; label: string; name: string; index: number }>;
      } | null
    >
  >;
}

export interface RankSyncReport {
  /** Members we had a name for. */
  readonly asked: number;
  /** Inara knew them. */
  readonly found: number;
  /** Inara answered "no such commander" — expected, not a failure. */
  readonly absent: number;
  /** Inara did not answer for them at all. Their stored row is untouched. */
  readonly unanswered: number;
  /** True when we did not even try, so a caller can tell that from "nobody to sync". */
  readonly skipped: boolean;
}

/**
 * Runs one sweep.
 *
 * `now` is injected rather than read, so a test can assert exactly what
 * `fetchedAt` was written as instead of asserting it is roughly the time the
 * test ran.
 */
export async function syncInaraRanks(
  store: InaraRankStore,
  source: InaraProfileSource,
  now: Date = new Date(),
): Promise<RankSyncReport> {
  const commanders = await store.listCommanders();
  if (commanders.length === 0) {
    return { asked: 0, found: 0, absent: 0, unanswered: 0, skipped: false };
  }

  const profiles = await source.getCommanderProfiles(commanders.map((c) => c.cmdrName));

  const rows: InaraProfileRow[] = [];
  let found = 0;
  let absent = 0;
  let unanswered = 0;

  for (const c of commanders) {
    /*
     * ★ ABSENT AND NULL ARE DIFFERENT ANSWERS ★
     *
     * `null` means Inara answered and had no such commander. Missing means the
     * request never got an answer for them — a failed chunk, a throttle, a
     * short reply.
     *
     * Only the first is written. Writing the second would clear a commander's
     * ranks every time Inara had a bad minute, and the card would flicker
     * between full and empty for reasons no one could see.
     */
    if (!profiles.has(c.cmdrName.toLowerCase())) {
      unanswered += 1;
      continue;
    }

    const p = profiles.get(c.cmdrName.toLowerCase()) ?? null;
    if (p === null) absent += 1;
    else found += 1;

    rows.push({
      userId: c.userId,
      searchName: c.cmdrName,
      ranks: p?.ranks ?? [],
      squadronName: p?.squadronName ?? null,
      squadronRank: p?.squadronRank ?? null,
      // Recorded even when absent, so the next sweep knows we asked and the
      // roster can say "Inara has no profile" rather than staying silent.
      isFound: p !== null,
      fetchedAt: now,
    });
  }

  if (rows.length > 0) await store.save(rows);

  return { asked: commanders.length, found, absent, unanswered, skipped: false };
}
