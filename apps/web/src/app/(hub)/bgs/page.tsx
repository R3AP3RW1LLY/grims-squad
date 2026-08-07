import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, PageBody, Section, CouldNotLoad } from '../../../components/hub-page';
import { getBgsWatchlist } from '../../../lib/api';
import { OrdersBoard } from './orders-board';

/**
 * BGS — the factions the squadron backs, and what it wants done about them.
 *
 * ★ THE COMING-SOON PAGE THAT STOOD HERE MADE THREE PROMISES ★
 *
 * "Influence across every system the faction holds", "states worth knowing about", and "this week's
 * orders, so effort lands where it changes something". The third is the one that changes what a
 * member does tonight, and it is built: `bgs_orders`, written by officers in the admin console and
 * scored against by the worker every five minutes.
 *
 * The first arrives as `bgs_activity_reports` fills. The second needs faction state tracking we do
 * not have, and this page does not pretend otherwise.
 *
 * ★ ORDERS FIRST, BECAUSE THAT IS WHY SOMEBODY OPENED THE PAGE ★
 *
 * The watchlist is context. The orders are the instruction. A member standing at a mission board
 * wants to know which faction to hand to, and everything else on this page is background to that.
 */
export const metadata: Metadata = {
  title: "BGS — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BgsPage() {
  const data = await getBgsWatchlist();

  return (
    <>
      <PageHeader
        eyebrow="Background simulation"
        title="BGS"
        subtitle="Which factions we back, and what the squadron wants done about them"
      />
      <PageBody
        wide
        lead="Standing orders are set by officers and scored automatically: every mission you hand in for a watched faction moves influence, and influence that matches an order pays out on Faction Hands."
      >
        {data === null ? (
          <Section title="Standing orders">
            <CouldNotLoad what="the BGS board" />
          </Section>
        ) : (
          <>
            <Section title="Standing orders">
              <OrdersBoard factions={data.factions} />
            </Section>

            <Section title="Factions we watch">
              {data.factions.length === 0 ? (
                <p className="m-0 text-sm text-[var(--color-text-secondary)]">
                  {/*
                    An empty watchlist is not merely quiet — it means the ingest records nothing at
                    all, because a faction nobody tracks has nowhere to be recorded against. Worth
                    saying, since it explains an empty Faction Hands board too.
                  */}
                  No factions are being watched yet. Until an officer adds one, mission influence is
                  not recorded and Faction Hands stays empty.
                </p>
              ) : (
                <div className="grid gap-2">
                  {data.factions
                    .slice()
                    .sort((a, b) => Number(b.isOurs) - Number(a.isOurs) || a.name.localeCompare(b.name))
                    .map((f) => (
                      <div
                        key={f.id}
                        className="flex flex-wrap items-baseline gap-3 border-t border-[var(--color-border-hairline)] py-2 text-sm"
                      >
                        <span className="text-[var(--color-text-primary)]">{f.name}</span>
                        {f.isOurs ? (
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-brand-orange-bright)]">
                            our faction
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
                            ally
                          </span>
                        )}
                        <span className="ml-auto font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                          {f.orders.length === 0
                            ? 'no orders'
                            : `${f.orders.length} order${f.orders.length === 1 ? '' : 's'}`}
                        </span>
                        {f.notes === null || f.notes.trim() === '' ? null : (
                          <p className="m-0 w-full text-xs text-[var(--color-text-secondary)]">
                            {f.notes}
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </Section>
          </>
        )}

        <Section title="How it scores">
          <div className="grid gap-2 text-sm text-[var(--color-text-secondary)]">
            <p className="m-0">
              Hand a mission in for a watched faction and the influence it moves is recorded against
              you automatically — the companion reads it from your journal, so there is nothing to
              submit.
            </p>
            <p className="m-0">
              {/*
                The rule that makes the board mean something, stated where members will read it.
              */}
              Influence only <strong className="text-[var(--color-text-primary)]">pays</strong> when
              it matches a standing order. That is deliberate: it makes{' '}
              <Link
                href="/leaderboards/bgs"
                className="text-[var(--color-brand-orange-bright)] underline hover:text-[var(--color-brand-orange)]"
              >
                Faction Hands
              </Link>{' '}
              a record of what the squadron asked for rather than of who played the most hours.
            </p>
            <p className="m-0">
              Work for a faction nobody has named is still recorded — it just scores nothing until an
              officer sets an order for it.
            </p>
          </div>
        </Section>
      </PageBody>
    </>
  );
}
