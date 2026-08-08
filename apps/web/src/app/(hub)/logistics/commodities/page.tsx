import type { Metadata } from 'next';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../../components/hub-page';
import { getCommodities } from '../../../../lib/api';
import { MarketTable } from './market-table';
import { SystemPicker } from '../../../../components/system-picker';

/**
 * The commodities market.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a realt time commodities market that operates similar to uexcorp.space/commodities that shows
 * all the comoditiy details, average pricing, price over time lots of data."
 *
 * ★ INDEXED, LIKE THE PUBLIC BUILD BOARD ★
 *
 * No `noindex` here, unlike most pages under this layout. The owner made this public — "this will
 * also be available to the public for use" — and a commodity price table is exactly the sort of
 * thing somebody finds by searching for it. Every number on it is Frontier's own market data
 * reported by players, so there is nothing of the squadron's to keep back.
 */
export const metadata: Metadata = {
  title: "Commodities market — Grim's Squad",
  description:
    'Live Elite Dangerous commodity prices across the bubble: what everything is worth, where to buy it, where to sell it, and which way the price is moving.',
};

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

export default async function CommoditiesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  /*
   * ★ SQUADRON OWNER, 2026-08-04: "based on the users current or last know position" ★
   *
   * Same contract as the Freight Office: the near box wins, else the journal's last word with its
   * age printed, else the page is exactly what it always was. The URL carries the choice, so a
   * pasted link measures from the same place for whoever opens it.
   */
  const sp = await searchParams;
  const rawNear = sp['near'];
  const near = Array.isArray(rawNear) ? (rawNear[0] ?? '') : (rawNear ?? '');
  const read = await getCommodities(near);

  return (
    <>
      <PageHeader
        eyebrow="Logistics & Trade"
        title="COMMODITIES"
        subtitle="What everything is worth, right now, across the bubble"
      />
      <PageBody
        wide
        lead="Prices reported by commanders flying the game, updated continuously. Open any commodity to see where to buy it, where to sell it, and how the price has moved."
      >
        {read !== null ? (
          <div className="mb-4">
            {read.origin !== null ? (
              <p className="m-0 mb-2 text-sm text-[var(--color-text-secondary)]">
                Near-you prices measure from{' '}
                <strong className="text-[var(--color-text-primary)]">{read.origin.system}</strong>
                {read.origin.station === null ? null : <> ({read.origin.station})</>} —{' '}
                {read.origin.from === 'journal'
                  ? `where your ship last was${read.origin.age === undefined ? '' : `, ${read.origin.age}`}.`
                  : 'the system you named.'}{' '}
                Within {read.nearWithinLy} ly.
                {read.origin.stale === true ? (
                  <span className="ml-1 text-[var(--color-semantic-warning)]">
                    That is a while ago — if you have moved, name your system below.
                  </span>
                ) : null}
              </p>
            ) : read.unknownSystem !== null ? (
              <p className="m-0 mb-2 text-sm text-[var(--color-semantic-warning)]">
                We hold no system called &ldquo;{read.unknownSystem}&rdquo;. Check the spelling and
                try again.
              </p>
            ) : (
              <p className="m-0 mb-2 text-sm text-[var(--color-text-secondary)]">
                Name a system (or pair the companion app) and every commodity gains its best price
                near you.
              </p>
            )}
            <form method="get" className="flex items-end gap-2">
              <SystemPicker
                name="near"
                defaultValue={near}
                placeholder="Measure from system…"
                className="w-[220px] rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]"
              />
              <button
                type="submit"
                className="rounded-md border border-[var(--color-border-hairline)] px-3 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-subtle)]"
              >
                Measure
              </button>
            </form>
          </div>
        ) : null}
        <Section title="Every commodity we hold a price for">
          {read === null ? (
            <CouldNotLoad what="the commodities market" />
          ) : (
            <MarketTable rows={read.commodities} nearWithinLy={read.nearWithinLy} />
          )}
        </Section>
      </PageBody>
    </>
  );
}
