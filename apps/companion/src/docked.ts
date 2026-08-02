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
 * ★ WHY IT IS NOT ENOUGH TO READ THE NEWEST `Docked` ★
 *
 * `Docked` fires on arrival and is never followed by an "undocked at" record we can use in the same
 * way — `Undocked` says you left but not what you left. So the last `Docked` alone would keep
 * claiming a member is at a station they departed an hour ago, and would pre-fill a project form
 * with the wrong site.
 *
 * `Undocked` and `FSDJump` both clear it, which is the honest reading: you are docked from the
 * moment you dock until you leave the pad or the system.
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
        };
        break;
      }

      default:
        break;
    }
  }

  return current;
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
