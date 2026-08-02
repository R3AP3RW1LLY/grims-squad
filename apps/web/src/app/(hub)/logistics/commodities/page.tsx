import type { Metadata } from 'next';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../../components/hub-page';
import { getCommodities } from '../../../../lib/api';
import { MarketTable } from './market-table';

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

export default async function CommoditiesPage() {
  const read = await getCommodities();

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
        <Section title="Every commodity we hold a price for">
          {read === null ? (
            <CouldNotLoad what="the commodities market" />
          ) : (
            <MarketTable rows={read.commodities} />
          )}
        </Section>
      </PageBody>
    </>
  );
}
