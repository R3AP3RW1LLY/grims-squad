import { groupByCategory } from '@grims/shared/commodity-category';
import { needsFreshness, type FreshnessVerdict } from '@grims/shared/needs-freshness';
import type { ColonyNeed } from '../../../../lib/api';

/**
 * What a construction site still wants, biggest shortfall first.
 *
 * Each commodity links to the market, because "we need 4,000 tonnes of Steel" and "where is Steel"
 * are the same question asked half a second apart.
 */

const TH =
  'py-2.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] ' +
  'text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

/**
 * How old this reading is, and whether somebody about to spend credits should stop and check.
 *
 * ★ A NEEDS LIST IS A SNAPSHOT, NOT A FEED ★
 *
 * It is only as current as the last time somebody docked at the site. Ten minutes old and it is
 * worth planning an evening around; a fortnight old and half of it may already be delivered — or
 * the whole build may be finished. Those look identical without this line, which is why
 * `observedAt` being stored and never shown was worse than not storing it.
 *
 * ★ NOW THE SHARED MODEL, NOT A SECOND OPINION — SQUADRON OWNER, 2026-08-12 ★
 *
 * "someone without the companion app completed a project and it did not update ... this causes our
 * members to go buy materials for a project thats completed and not needed."
 *
 * This used to compute its own answer here, in words that stopped at "N days ago" and never said
 * the thing a member needed to hear. It now asks `needsFreshness`, which the companion asks too, so
 * the two apps cannot tell somebody different things about the same figure — the same reason the
 * build catalogue collapsed its duplicate comparison earlier today.
 */
function freshness(needs: readonly ColonyNeed[]): FreshnessVerdict {
  const stamps = needs
    .map((n) => (n.observedAt === null ? null : Date.parse(n.observedAt)))
    .filter((t): t is number => t !== null && Number.isFinite(t));

  // The NEWEST reading, because one commodity refreshed today makes the whole list that current.
  const newest = stamps.length === 0 ? null : new Date(Math.max(...stamps));
  return needsFreshness(newest, new Date());
}

/**
 * The three-segment progress bar: delivered (filled), aboard attached carriers (yellow), still to
 * source (empty track).
 *
 * ★ THE MIDDLE SEGMENT IS THE ONE THAT CHANGES DECISIONS ★
 *
 * A two-state bar makes 20,000 t on a carrier parked at the site look identical to 20,000 t nobody
 * has bought — and those are different builds to plan an evening around. The staged tonnage is the
 * server's effective figure (manual beats journal beats mirror), capped so the bar never claims
 * more than the site still wants.
 */
/**
 * The two filled widths, as percentages.
 *
 * Pulled out of the component because this is the arithmetic the legend promises — blue is
 * delivered, yellow is aboard a carrier — and it is the part that can be wrong while the page still
 * renders. This repo has no DOM testing library, so logic that matters lives where a test can reach
 * it rather than inside JSX nobody can assert on.
 */
export function barSegments({
  delivered,
  staged,
  required,
}: {
  delivered: number;
  staged: number;
  required: number;
}): { deliveredPct: number; stagedPct: number } {
  const deliveredPct = Math.max(0, Math.min(100, (delivered / required) * 100));
  return {
    deliveredPct,
    // Capped by what is left of the bar: a carrier holding more than the site wants covers it, it
    // does not make the bar longer than itself.
    stagedPct: Math.max(0, Math.min(100 - deliveredPct, (staged / required) * 100)),
  };
}

export function SegmentedBar({
  delivered,
  staged,
  required,
}: {
  delivered: number;
  staged: number;
  required: number;
}) {
  if (required <= 0) return null;
  const { deliveredPct, stagedPct } = barSegments({ delivered, staged, required });

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-panel-sunken)]">
      <div className="h-full bg-[var(--color-brand-cyan)]" style={{ width: `${deliveredPct}%` }} />
      <div
        className="h-full bg-[var(--color-semantic-warning)]"
        style={{ width: `${stagedPct}%` }}
      />
    </div>
  );
}

/** The legend the segmented bar earns, printed once per table rather than per row. */
export function BarLegend() {
  return (
    <p className="m-0 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--color-text-secondary)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-4 rounded-full bg-[var(--color-brand-cyan)]" />
        delivered
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-4 rounded-full bg-[var(--color-semantic-warning)]" />
        aboard attached carriers
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-4 rounded-full bg-[var(--color-surface-panel-sunken)]" />
        still to source
      </span>
    </p>
  );
}

export function NeedsTable({
  needs,
  carrierCover,
}: {
  needs: readonly ColonyNeed[];
  /** Effective tonnes aboard attached carriers per commodity, from the server's merge. */
  carrierCover: Readonly<Record<string, number>>;
}) {
  if (needs.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing recorded yet. The needs appear the first time somebody with the companion app docks
        at the site.
      </p>
    );
  }

  /*
   * ★ A FINISHED COMMODITY STAYS ON THE TABLE — SQUADRON OWNER, 2026-08-09 ★
   *
   * "OUR WEBSITE AND COMPANION APP ARE NOT UPDATING WHEN ITEMS ARE DELIVERED TO THE COLONIZATION
   * PROJECTS ... BLUE DENOTES WHAT IS DELIVERED! THIS IS NOT WORKING AS IT SHOULD"
   *
   * It was updating. That was the problem. This filtered on `remaining > 0`, so the instant a
   * commodity was finished its row LEFT THE TABLE — and from where a member sits, hauling the last
   * 730 t of Steel and watching the Steel row vanish is indistinguishable from the page ignoring
   * the delivery. The bar never went blue because there was no bar left to look at.
   *
   * Measured on production the day it was reported: 207 of 302 need rows were being hidden this way,
   * 584,108 tonnes of completed work. On the build the owner was watching, a member had just
   * finished six commodities and the page showed none of them.
   *
   * So everything the site asked for is listed, and finishing something turns its bar fully blue
   * instead of deleting the evidence. Outstanding first, because that is what somebody is planning
   * around; the finished ones settle underneath as the record of what the squadron has done.
   *
   * The shopping list still drops them, and should — that one answers "what do I go and buy".
   */
  const rows = orderedNeeds(needs);
  const allDelivered = rows.every((n) => n.remaining <= 0);

  return (
    <>
      {!allDelivered ? null : (
        <p className="m-0 mb-4 text-sm text-[var(--color-semantic-success)]">
          Everything this site asked for has been delivered.
        </p>
      )}
      <NeedRows rows={rows} carrierCover={carrierCover} />
    </>
  );
}

/**
 * Every commodity the site asked for: outstanding first, then the finished ones.
 *
 * ★ NOTHING IS FILTERED OUT, AND THAT IS THE WHOLE FIX ★
 *
 * A `remaining > 0` filter deleted a row the moment its commodity was finished, which is what the
 * owner reported as the page not updating. Ordering is a presentation choice; removal is a lie
 * about what the squadron has done.
 */
export function orderedNeeds(needs: readonly ColonyNeed[]): readonly ColonyNeed[] {
  return [...needs.filter((n) => n.remaining > 0), ...needs.filter((n) => n.remaining <= 0)];
}

/** The rows themselves, so a finished build still shows its record rather than an empty panel. */
function NeedRows({
  rows,
  carrierCover,
}: {
  rows: readonly ColonyNeed[];
  carrierCover: Readonly<Record<string, number>>;
}) {
  /*
   * ★ GROUPED THE WAY THE COMMODITY BOARD IS GROUPED — SQUADRON OWNER, 2026-08-10 ★
   *
   * "break down all materials into their respective market categories ... so that its easier to
   * search for these commodities"
   *
   * The case is a member docked at a station with the market on one screen and this on the other.
   * Elite's board is grouped; a flat list of thirty commodities is not, so every line was a fresh
   * hunt down an alphabetical list that matched nothing in front of them.
   *
   * The grouping itself is in @grims/shared, shared with the companion, its shopping list and the
   * in-game overlay — five surfaces that a member reads side by side and would notice disagreeing.
   */
  const groups = groupByCategory(rows);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Commodity
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Still needed
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Delivered
            </th>
            <th scope="col" className={`${TH} w-[30%]`}>
              Progress
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.category}>
            <tr>
              <th
                scope="colgroup"
                colSpan={3}
                className="border-t border-[var(--color-border-hairline)] pt-5 pb-1.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]"
              >
                {group.category}
              </th>
              <th className="border-t border-[var(--color-border-hairline)] pt-5 pb-1.5 text-right font-mono text-[10px] tabular-nums text-[var(--color-text-secondary)]">
                {/* The heading carries its own number so a group can be judged without reading it. */}
                {group.complete ? 'complete' : `${group.outstanding.toLocaleString()} t to go`}
              </th>
            </tr>

            {group.rows.map((n) => {
              // A bar drawn with an unknown total claims nothing has been delivered, which is a
              // different statement from "we do not know the total" — so it stays "unknown".
              const knowsTotal = n.required !== null && n.required > 0;
              const staged = Math.min(n.remaining, Math.max(0, carrierCover[n.commodity] ?? 0));
              const done = n.remaining <= 0;

              return (
                <tr
                  key={n.commodity}
                  className={`hover:bg-[var(--color-surface-panel)] ${done ? 'opacity-70' : ''}`}
                >
                  <td className={TD}>
                    {/*
                      ★ STRUCK THROUGH WHEN IT IS DONE — SQUADRON OWNER ★

                      The row is kept rather than filtered, for the reason recorded above
                      `sortByOutstanding`: deleting a line the moment it finished hid 584,108 tonnes
                      of completed work and made a build look barely started. But a kept row that
                      looks like every other row is a line members keep hauling to.

                      Struck through and green says "this is finished" at a glance, without removing
                      the evidence that it was ever needed.
                    */}
                    <a
                      href={`/logistics/commodities/${encodeURIComponent(n.commodity)}`}
                      className={
                        done
                          ? 'text-[var(--color-semantic-success)] line-through decoration-[var(--color-semantic-success)]/60 no-underline hover:underline'
                          : 'text-[var(--color-text-primary)] no-underline hover:underline'
                      }
                    >
                      {n.commodity}
                    </a>
                  </td>
                  <td className={`${TD} text-right font-mono tabular-nums`}>
                    {done ? (
                      <span className="text-[var(--color-semantic-success)]">done</span>
                    ) : (
                      `${n.remaining.toLocaleString()} t`
                    )}
                    {staged > 0 ? (
                      <span
                        className="ml-1.5 text-[11px] text-[var(--color-semantic-warning)]"
                        title="Effective tonnes already aboard the build's attached carriers."
                      >
                        {staged.toLocaleString()} t aboard
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`${TD} text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}
                  >
                    {n.required === null
                      ? '—'
                      : `${(n.required - n.remaining).toLocaleString()} / ${n.required.toLocaleString()}`}
                  </td>
                  <td className={TD}>
                    {!knowsTotal ? (
                      <span className="text-[11px] text-[var(--color-text-secondary)]">unknown</span>
                    ) : (
                      <SegmentedBar
                        delivered={(n.required ?? 0) - n.remaining}
                        staged={staged}
                        required={n.required ?? 0}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>

      <BarLegend />

      {/*
        Design principle: every number carries its provenance. This one is the provenance — and
        when the provenance is a fortnight old it stops being a footnote and becomes the most
        important thing on the page, because the build may be finished and the table above is then
        a shopping list for nothing.
      */}
      {(() => {
        const f = freshness(rows);
        if (!f.warn) {
          return (
            <p className="m-0 mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
              {f.sentence}
            </p>
          );
        }
        return (
          <p
            className="m-0 mt-3 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_8%,transparent)] px-3 py-2 text-[12px] text-[var(--color-semantic-warning)]"
            role="status"
          >
            {f.sentence}
          </p>
        );
      })()}
    </div>
  );
}
