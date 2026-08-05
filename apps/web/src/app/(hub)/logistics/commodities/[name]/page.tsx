import type { Metadata } from 'next';
import {
  PageHeader,
  PageBody,
  Section,
  CouldNotLoad,
  StatGrid,
  StatTile,
} from '../../../../../components/hub-page';
import { getCommodity } from '../../../../../lib/api';
import { PlaceTable } from './place-table';
import { PriceHistory } from './price-history';
import { OriginBox } from './origin-box';

/**
 * One commodity: what it is worth, where to trade it, and how it has moved.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "all the comoditiy details, average pricing, price over time lots of data, as well as the best
 * places to buy both in general and based on the players current location and station they are at."
 *
 * The filters live in the URL rather than in component state, which is what makes a result
 * SHAREABLE — "here is where to buy Painite near me with a large pad" is a link somebody can paste
 * into Discord. It also means the server renders the answer directly, with no loading state between
 * arriving and reading it.
 */

export const dynamic = 'force-dynamic';

type Params = { name: string };
type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { name } = await params;
  const commodity = decodeURIComponent(name);
  return {
    title: `${commodity} prices — Grim's Squad`,
    description: `Where to buy and sell ${commodity} in Elite Dangerous: live prices, supply, demand, and the best markets near you.`,
  };
}

/** One string from a query parameter that Next may hand over as an array. */
function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export default async function CommodityPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const commodity = decodeURIComponent(name);

  /*
   * Passed through verbatim rather than re-derived. The API owns the defaults and the clamping —
   * restating them here would be a second set of rules free to disagree with the first, and the one
   * that disagreed would be the one the member could see.
   */
  const query: Record<string, string> = {};
  for (const key of ['near', 'withinLy', 'carriers', 'largePad', 'minQty', 'freshDays', 'hours']) {
    const v = one(sp[key]);
    if (v !== '') query[key] = v;
  }

  const read = await getCommodity(commodity, query);

  if (read === null) {
    return (
      <>
        <PageHeader eyebrow="Logistics & Trade" title={commodity.toUpperCase()} />
        <PageBody wide>
          <CouldNotLoad what="this commodity" />
        </PageBody>
      </>
    );
  }

  const c = read.commodity;

  if (c === null) {
    return (
      <>
        <PageHeader eyebrow="Logistics & Trade" title={commodity.toUpperCase()} />
        <PageBody wide>
          <Section title="Not a commodity we hold">
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              Nobody has reported a market for “{commodity}”.{' '}
              <a href="/logistics/commodities" className="text-[var(--color-brand-cyan-bright)]">
                Back to the market
              </a>
              .
            </p>
          </Section>
        </PageBody>
      </>
    );
  }

  const spread = c.avgBuy !== null && c.avgSell !== null ? c.avgSell - c.avgBuy : null;

  return (
    <>
      <PageHeader
        eyebrow={c.category ?? 'Logistics & Trade'}
        title={c.commodity.toUpperCase()}
        subtitle={`Traded at ${(c.buyMarkets + c.sellMarkets).toLocaleString()} markets`}
      />
      <PageBody wide>
        <StatGrid>
          <StatTile label="Average buy" value={c.avgBuy === null ? '—' : c.avgBuy.toLocaleString()} />
          <StatTile
            label="Average sell"
            value={c.avgSell === null ? '—' : c.avgSell.toLocaleString()}
          />
          <StatTile
            label="Margin per tonne"
            value={spread === null ? '—' : `${spread > 0 ? '+' : ''}${spread.toLocaleString()}`}
          />
          <StatTile
            label="Best sell seen"
            value={c.maxSell === null ? '—' : c.maxSell.toLocaleString()}
          />
        </StatGrid>

        <Section title="Where you are">
          <OriginBox
            commodity={c.commodity}
            origin={read.origin}
            unknownSystem={read.unknownSystem}
            query={query}
          />
        </Section>

        <Section title="Price over time">
          <PriceHistory points={read.history} />
        </Section>

        <Section title="Best places to buy">
          <PlaceTable
            places={read.buys}
            side="buy"
            emptyMessage={
              read.origin === null
                ? 'Nobody is selling this anywhere we have a price for.'
                : `Nobody is selling this within range of ${read.origin.system}. Widen the radius, or clear it to search the whole bubble.`
            }
          />
        </Section>

        <Section title="Best places to sell">
          <PlaceTable
            places={read.sells}
            side="sell"
            emptyMessage={
              read.origin === null
                ? 'Nobody is buying this anywhere we have a price for.'
                : `Nobody is buying this within range of ${read.origin.system}.`
            }
          />
        </Section>
      </PageBody>
    </>
  );
}
