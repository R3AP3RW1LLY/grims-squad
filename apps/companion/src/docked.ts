/**
 * Where the commander is docked, from their own journal.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "where do i find this? it should appear automatically in the companion app on the new project
 * page if it is not being used please!" — of the market id the post-a-project form asks for.
 *
 * They were right twice over. The form's hint said to copy the id "the app shows on Status", and
 * Status showed no such thing: it was a reference to something that did not exist, written into the
 * UI on the assumption somebody would add it later. And asking at all was the wrong shape — the app
 * is already reading the journal that contains the answer, so making a member find and retype a
 * ten-digit number is asking them to do work the machine has already done.
 *
 * ★ WHY `Docked` ALONE DOES NOT WORK — MEASURED AGAINST A LIVE GAME, 2026-08-02 ★
 *
 * The first version watched only `Docked`, and the owner reported it populating nothing while
 * sitting at a construction site. Their journal explained it exactly:
 *
 *   Docked                        17:33:08   once, and already behind the app's saved offset
 *   ColonisationConstructionDepot 17:45:12   and every fifteen seconds before that
 *
 * `Docked` fires ONCE per arrival. The app reads journals forward from a saved byte offset, so an
 * event consumed before this feature existed is gone for good — and even afterwards, any restart
 * or re-pair loses it. Waiting for the member to undock and dock again to fix it is not a feature.
 *
 * `ColonisationConstructionDepot` is the opposite in every way that matters: it repeats every
 * fifteen seconds while docked at a site, it carries the `MarketID`, and it carries everything the
 * site still needs. It is a heartbeat, so it SELF-HEALS — whatever was missed, the next one is
 * fifteen seconds away.
 *
 * So the identity comes from `Docked`/`Location` when we have it, and the depot proves we are still
 * there and supplies the detail. A member whose `Docked` is long gone is still recognised, because
 * `seedFromJournal` reads the tail of the newest journal on startup without touching offsets.
 *
 * `Undocked` and `FSDJump` clear it: you are docked from the moment you dock until you leave the
 * pad or the system.
 */

/** One journal event, as the reader hands it over. */
export interface ParsedLike {
  readonly name: string;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

export interface DockedAt {
  readonly marketId: string;
  readonly stationName: string;
  readonly systemName: string;
  /** The journal's own timestamp, so the UI can say how fresh this is. */
  readonly at: string;
  /**
   * What the construction site still needs, when this dock IS one.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "it should read all data about the site and populate the new project window."
   *
   * Null for an ordinary station. Present the moment a `ColonisationConstructionDepot` names this
   * market — which the game emits every fifteen seconds while docked at one, so it arrives on its
   * own without the member doing anything.
   */
  readonly site: ConstructionSite | null;
}

/** A construction site's state, straight out of the depot event. */
export interface ConstructionSite {
  /** 0–1, as Frontier reports it. */
  readonly progress: number;
  readonly complete: boolean;
  readonly failed: boolean;
  readonly resources: ReadonlyArray<{
    readonly commodity: string;
    readonly required: number;
    readonly provided: number;
  }>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A market id as a STRING.
 *
 * Ids exceed 2^53, so a JSON number is already lossy by the time it reaches us — but it arrives as
 * a number in the journal, so it has to be accepted as one and stringified without going through
 * anything that would round it. `String(n)` on an integer-valued double is exact for every id
 * Frontier issues; `toFixed(0)` guards the exponential form a very large value would otherwise take.
 */
function marketIdOf(value: unknown): string {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value.toFixed(0);
  }
  return '';
}

/**
 * Folds a batch of events over what we already believed.
 *
 * Takes the previous value so it can be called with each pass's events and keep working across
 * passes — a member docks in one twenty-second window and posts a project ten minutes later, and
 * nothing in between mentions the station again.
 */
export function trackDocked(
  previous: DockedAt | null,
  events: readonly ParsedLike[],
): DockedAt | null {
  let current = previous;

  for (const event of events) {
    switch (event.name) {
      case 'Docked': {
        const marketId = marketIdOf(event.data['MarketID']);
        const stationName = text(event.data['StationName']);
        // Both are needed for this to be worth anything: an id with no name cannot be shown to a
        // member, and a name with no id cannot be posted. A half-event leaves the old value alone
        // rather than replacing it with something unusable.
        if (marketId === '' || stationName === '') break;

        current = {
          marketId,
          stationName,
          systemName: text(event.data['StarSystem']),
          at: event.occurredAt,
          // Kept across a re-dock at the same market, so arriving does not blank out detail the
          // heartbeat already supplied.
          site: current !== null && current.marketId === marketId ? current.site : null,
        };
        break;
      }

      /*
       * ★ BOTH OF THESE CLEAR IT ★
       *
       * `Undocked` is the direct one. `FSDJump` is here because a journal can be missing the
       * Undocked — the app may have been started mid-session, or the event may sit in a chunk that
       * was never read — and arriving in another system is unambiguous proof of not being on that
       * pad any more.
       *
       * `Location` deliberately does NOT clear: it fires on logging in, and it carries `Docked:
       * true` when a member resumes at a station. Treating it as a departure would forget where
       * somebody is every time they started the game.
       */
      case 'Undocked':
      case 'FSDJump':
        current = null;
        break;

      /*
       * Resuming a session while docked. The station is in the event, so this RESTORES the value
       * rather than clearing it — which is the case a member hits most: they log in at the
       * construction site they were working on and immediately want to post it.
       */
      case 'Location': {
        if (event.data['Docked'] !== true) break;
        const marketId = marketIdOf(event.data['MarketID']);
        const stationName = text(event.data['StationName']);
        if (marketId === '' || stationName === '') break;

        current = {
          marketId,
          stationName,
          systemName: text(event.data['StarSystem']),
          at: event.occurredAt,
          // Kept across a re-dock at the same market, so arriving does not blank out detail the
          // heartbeat already supplied.
          site: current !== null && current.marketId === marketId ? current.site : null,
        };
        break;
      }

      /*
       * ★ THE HEARTBEAT ★
       *
       * Repeats every fifteen seconds while docked at a construction site, so it is both proof the
       * member is STILL there and the source of everything about the site.
       *
       * It carries no station name or system — only the market id — so it cannot establish identity
       * on its own. When it names the market we already believe we are at, it refreshes the
       * timestamp and attaches the detail. When it names a DIFFERENT one, the belief is stale and
       * the id from the depot is the one to trust; the name follows when a Docked or the startup
       * seed supplies it.
       */
      case 'ColonisationConstructionDepot': {
        const marketId = marketIdOf(event.data['MarketID']);
        if (marketId === '') break;

        const site = siteOf(event.data);
        // Narrowed to a local so the identity fields below are provably reachable — `current` is
        // reassigned in this same expression, which is why the flow analysis cannot do it for us.
        const known = current !== null && current.marketId === marketId ? current : null;

        current = {
          marketId,
          // Kept when it is the same market, dropped when it is not — a name from another station
          // attached to this id would be worse than no name at all.
          stationName: known?.stationName ?? '',
          systemName: known?.systemName ?? '',
          // The heartbeat IS the freshness. This is what keeps a member who docked an hour ago from
          // ageing out of the twelve-hour window while they are still standing there.
          at: event.occurredAt,
          site,
        };
        break;
      }

      default:
        break;
    }
  }

  return current;
}

/** The site's state, out of a depot event. */
function siteOf(data: Record<string, unknown>): ConstructionSite {
  const raw = Array.isArray(data['ResourcesRequired']) ? data['ResourcesRequired'] : [];

  const resources: Array<{ commodity: string; required: number; provided: number }> = [];
  for (const entry of raw) {
    const r = (entry ?? {}) as Record<string, unknown>;
    /*
     * The localised name, because that is what everything else joins on — `market_entries.commodity`
     * holds display names, and the shopping list would silently return nothing for `$aluminium_name;`.
     * Verified against a live journal: every entry carried `Name_Localised`.
     */
    const commodity = text(r['Name_Localised']) !== '' ? text(r['Name_Localised']) : cleanSymbol(text(r['Name']));
    if (commodity === '') continue;

    resources.push({
      commodity,
      required: numberOf(r['RequiredAmount']),
      provided: numberOf(r['ProvidedAmount']),
    });
  }

  return {
    progress: numberOf(data['ConstructionProgress']),
    complete: data['ConstructionComplete'] === true,
    failed: data['ConstructionFailed'] === true,
    resources,
  };
}

function numberOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** `$aluminium_name;` → `Aluminium`, for the rare entry with no localised name. */
function cleanSymbol(symbol: string): string {
  const cleaned = symbol.replace(/^\$/, '').replace(/_name;?$/i, '').replace(/[_;]/g, ' ').trim();
  return cleaned === '' ? '' : cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Is this reading recent enough to offer?
 *
 * ★ A STALE ONE IS WORSE THAN NONE ★
 *
 * The app may have been closed for days with a `Docked` as the last thing it saw. Pre-filling a
 * project form with a station somebody left on Tuesday produces a project pointing at the wrong
 * site — and because the market id is the join to reality, that project would silently never
 * update, which reads as the sync being broken rather than as a stale form.
 *
 * Twelve hours is longer than any single play session and far shorter than "I left it running".
 */
export const DOCK_FRESH_MS = 12 * 60 * 60 * 1000;

export function isFresh(dock: DockedAt | null, now: number): boolean {
  if (dock === null) return false;
  const at = Date.parse(dock.at);
  if (!Number.isFinite(at)) return false;
  // A timestamp in the future is a clock disagreement, not a fresh dock. Accepted within an hour,
  // because a small skew between the game's clock and ours is normal and harmless.
  if (at > now + 60 * 60 * 1000) return false;
  return now - at <= DOCK_FRESH_MS;
}

/**
 * How much of the newest journal to read when the app starts.
 *
 * ★ THE OTHER HALF OF WHY IT SHOWED NOTHING ★
 *
 * The watcher reads forward from a saved byte offset, so anything consumed before this feature
 * existed — or before the app was last restarted, or re-paired — is behind it and will never be
 * seen again. The owner's own journal on 2026-08-02 had `Docked` at byte 184,341 and a saved offset
 * of 211,038: the arrival was thirty thousand bytes in the past and no amount of waiting would
 * bring it back.
 *
 * So on startup we read the TAIL of the newest journal directly, ignoring offsets entirely, purely
 * to answer "where are they right now". Nothing is uploaded from it and no offset moves — it exists
 * only to prime this one value.
 *
 * 512KB is far more than a docking plus a few minutes of depot heartbeats, and small enough to read
 * in a few milliseconds at launch.
 */
export const SEED_TAIL_BYTES = 512 * 1024;

/**
 * Rebuilds the current dock from a chunk of journal text.
 *
 * Takes text rather than a path so the parsing is testable without a filesystem, in the same way
 * everything else in this file is.
 */
export function seedFromJournal(text: string): DockedAt | null {
  const events: ParsedLike[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      /*
       * The first line of a tail read is almost always half a line, because the read starts at a
       * byte offset rather than a line boundary. Skipped in silence: it is expected, not an error,
       * and the whole point of reading a generous tail is that one lost line costs nothing.
       */
      continue;
    }

    const name = typeof parsed['event'] === 'string' ? parsed['event'] : '';
    const occurredAt = typeof parsed['timestamp'] === 'string' ? parsed['timestamp'] : '';
    if (name === '' || occurredAt === '') continue;

    events.push({ name, occurredAt, data: parsed });
  }

  // Folded through exactly the same rules the live path uses. A seed that decided things
  // differently would be a second implementation of "where are they", and the two would disagree
  // in precisely the situations that are hardest to reproduce.
  return trackDocked(null, events);
}
