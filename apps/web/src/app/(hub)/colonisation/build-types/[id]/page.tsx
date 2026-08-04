import type { Metadata } from 'next';
import { PageHeader, PageBody, Section, StatGrid, StatTile } from '../../../../../components/hub-page';
import { NoAccess, AdminUnavailable } from '../../../app/no-access';
import { getBuildType } from '../../../../../lib/api';
import { CopySystem } from '../../../../../components/copy-system';

/**
 * One build type, costed.
 *
 * ★ THE QUESTION A PROJECT PAGE CANNOT ANSWER ★
 *
 * A project has no needs until somebody physically flies to the site and docks. So "what will this
 * cost me" was unanswerable at exactly the moment it is worth asking — before committing a
 * fortnight of the squadron's hauling to it.
 *
 * ★ NO ORIGIN MEANS NO PRICES, DELIBERATELY ★
 *
 * A cheapest-anywhere total is a number nobody can act on, and worse, it looks like a real quote.
 * The page asks where you are buying from rather than inventing an answer.
 */
export const metadata: Metadata = {
  title: "Build type — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TH =
  'py-2.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] ' +
  'text-[var(--color-text-secondary)]';
const TD = 'border-t border-[var(--color-border-hairline)] py-2.5 pr-4 align-middle';

export default async function BuildTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const raw = await searchParams;
  const near = typeof raw['near'] === 'string' ? raw['near'] : '';

  const read = await getBuildType(id, near === '' ? {} : { near });

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const { buildType: b, origin, unknownSystem } = read.data;

  return (
    <>
      <PageHeader
        eyebrow={`Colonisation · ${b.category}`}
        title={b.displayName.toUpperCase()}
        subtitle={`Tier ${b.tier} · ${b.location}${b.padSize === 'none' ? '' : ` · ${b.padSize} pad`}`}
      />
      <PageBody wide>
        <StatGrid>
          <StatTile label="To haul" value={`${b.totalTonnes.toLocaleString()} t`} />
          <StatTile label="Commodities" value={String(b.commodities)} />
          <StatTile
            label="Cost near you"
            value={origin === null ? '—' : `${Math.round(b.total).toLocaleString()} cr`}
            tone={origin === null ? 'default' : 'accent'}
          />
          <StatTile
            label="Figures"
            value={b.source === 'observed' ? 'Measured' : 'Unchecked'}
            tone={b.source === 'observed' ? 'accent' : 'default'}
          />
        </StatGrid>

        {/*
          ★ WHAT FINISHING ONE DOES TO A SYSTEM ★

          The seven Raven-style scalars, on the page where a member PICKS a type — they were seeded
          for every build since the simulation shipped and visible only after adding one to a plan,
          which is the wrong side of the decision. Labelled as gathered, because that is what they
          are.
        */}
        <Section title="What it does to a system">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ['Population', b.effects.population],
                ['Max population', b.effects.maxPopulation],
                ['Security', b.effects.security],
                ['Technology', b.effects.technology],
                ['Wealth', b.effects.wealth],
                ['Standard of living', b.effects.standardOfLiving],
                ['Development', b.effects.development],
              ] as const
            ).map(([label, value]) => (
              <span key={label} className="text-sm text-[var(--color-text-secondary)]">
                {label}{' '}
                <span
                  className={
                    value < 0
                      ? 'font-mono tabular-nums text-[var(--color-semantic-warning)]'
                      : 'font-mono tabular-nums text-[var(--color-text-primary)]'
                  }
                >
                  {value > 0 ? '+' : ''}
                  {value}
                </span>
              </span>
            ))}
          </div>
          <p className="m-0 mt-3 text-[11px] text-[var(--color-text-secondary)]">
            {b.economyFixed !== null
              ? `Its own economy is locked: ${b.economyFixed}, wherever it stands.`
              : b.economyInfluence === 'none'
                ? 'It feeds no economy into the port that receives it.'
                : `It feeds ${b.economyInfluence} into the port that receives it.`}{' '}
            All seven figures are gathered by players, not published by Frontier — a negative
            security on a big starport is the game, not a mistake.
          </p>
        </Section>

        {/*
          Where prices are measured from. A GET form so the answer is in the URL and can be shared —
          "what would this cost from Shinrarta" is a link somebody can paste into Discord.
        */}
        <Section title="Price it from">
          <form
            method="get"
            action={`/colonisation/build-types/${encodeURIComponent(b.id)}`}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                Buying from
              </span>
              <input
                name="near"
                defaultValue={near}
                placeholder="a system you can reach"
                className="w-[240px] rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
              />
            </label>
            <button
              type="submit"
              className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]"
            >
              Price it
            </button>
          </form>

          {unknownSystem === null ? null : (
            <p className="m-0 mt-3 rounded border border-[var(--color-semantic-warning)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
              We hold no system called “{unknownSystem}”, so nothing below is priced.
            </p>
          )}

          {origin === null && unknownSystem === null ? (
            <p className="m-0 mt-3 text-sm text-[var(--color-text-secondary)]">
              Name a system and every line below is priced against the nearest place that sells it.
              Without one there is nothing honest to quote — a cheapest-anywhere figure is a number
              nobody can act on.
            </p>
          ) : null}
        </Section>

        <Section title="What it asks for">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className={TH}>Commodity</th>
                  <th className={`${TH} text-right`}>Tonnes</th>
                  <th className={TH}>Nearest source</th>
                  <th className={`${TH} text-right`}>Price</th>
                  <th className={`${TH} text-right`}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {b.costs.map((c) => (
                  <tr key={c.commodity}>
                    <td className={`${TD} text-[var(--color-text-primary)]`}>{c.commodity}</td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>
                      {c.tonnes.toLocaleString()}
                    </td>
                    <td className={`${TD} text-[var(--color-text-secondary)]`}>
                      {c.stationName === null ? (
                        <span className="text-[var(--color-text-dim)]">
                          {origin === null ? '—' : 'nobody in range sells this'}
                        </span>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-x-1">
                          {c.stationName}
                          <span className="text-[11px]">
                            {c.systemName}
                            {c.distance === null ? '' : ` · ${c.distance.toFixed(0)} ly`}
                          </span>
                          {c.systemName === null ? null : (
                            <CopySystem system={c.systemName} size="small" />
                          )}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums text-[var(--color-text-secondary)]`}>
                      {c.price === null ? '—' : c.price.toLocaleString()}
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>
                      {c.cost === null ? '—' : Math.round(c.cost).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {origin === null ? null : (
            <p className="m-0 mt-3 text-sm text-[var(--color-text-secondary)]">
              {/*
                Qualified whenever it is incomplete. A confident total that silently omits three
                commodities nobody sells is worse than no total at all.
              */}
              {b.unsourced === 0
                ? `About ${Math.round(b.total).toLocaleString()} cr in cargo, bought near ${origin.system}.`
                : `About ${Math.round(b.total).toLocaleString()} cr for what can be bought near ${origin.system} — ${b.unsourced} not sold in range, so the real total is higher.`}
            </p>
          )}
        </Section>

        {b.layouts.length === 0 ? null : (
          <Section title="Also known as">
            {/*
              Every name the game and the community have used for this. Worth showing because the
              construction menu, the station's own name and the community lists do not always agree
              — and somebody trying to match what is on their screen to this page needs the bridge.
            */}
            <p className="m-0 font-mono text-[11px] text-[var(--color-text-secondary)]">
              {b.layouts.join(' · ')}
            </p>
          </Section>
        )}
      </PageBody>
    </>
  );
}
