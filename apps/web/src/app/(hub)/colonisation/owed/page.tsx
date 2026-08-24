import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, PageBody, Section } from '../../../../components/hub-page';
import { LiveRefresh } from '../../../../components/live-refresh';
import { NoAccess, AdminUnavailable } from '../../app/no-access';
import { getColonyOwed } from '../../../../lib/api';

/**
 * One shopping list across every build a member is on.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "SrvSurvey will then show cargo items needed only for the primary or all projects" — under the
 * standing rule, "we need all of this in full parity on the website and the companion app".
 *
 * ★ WHY THIS IS A PAGE AND NOT A SECTION ON THE BOARD ★
 *
 * The boards answer "what is the squadron building". This answers "what do I still owe", which is a
 * different question with a different reader: somebody about to spend credits, deciding what to fill
 * a hold with before they undock. Folding it into a board would make it a footnote on a page nobody
 * opens with that question in mind.
 *
 * ★ NOINDEX, LIKE EVERY OTHER COLONISATION PAGE ★
 *
 * A list of what one member owes the squadron is operational, and it stays out of search results
 * whatever a permission check does.
 */
export const metadata: Metadata = {
  title: "What you owe — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function OwedPage() {
  const read = await getColonyOwed();

  if (read.state === 'forbidden') {
    return <NoAccess what="colonisation" permission="COLONY_VIEW" />;
  }
  if (read.state !== 'ok') {
    return <AdminUnavailable />;
  }

  const owed = read.data;

  return (
    <>
      <PageHeader
        eyebrow="Colonisation"
        title="What you owe"
        subtitle="Every commodity still outstanding across the builds you have joined, added up."
      />
      {/*
        The same live channel the project pages use, so a wingmate's delivery moves these figures
        without a reload — see `colony-broadcast.spec.ts` for why the event is squadron-wide.
      */}
      <LiveRefresh types={['telemetry', 'colony']} />

      <PageBody>
        {owed.rows.length === 0 ? (
          <Section title="Nothing outstanding">
            {/*
              Said in words. An empty table and a table that failed to load look identical on
              screen, and only one of them is good news.
            */}
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              {owed.projects === 0
                ? 'You have not joined a build yet. Join one from the squadron or members’ boards and what it needs will appear here.'
                : 'Every build you are on has everything it asked for.'}
            </p>
          </Section>
        ) : (
          <Section
            title={`${owed.rows.length} commodities · ${owed.totalTonnes.toLocaleString('en-GB')} t to buy`}
          >
            <p className="m-0 mb-3 text-sm text-[var(--color-text-secondary)]">
              Across {owed.projects} build{owed.projects === 1 ? '' : 's'}. A commodity more than one
              build wants is marked — buy it in bulk and split the hold on arrival.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
                    <th className="py-1 pr-3 font-normal">Commodity</th>
                    <th className="py-1 pr-3 text-right font-normal">To buy</th>
                    <th className="py-1 font-normal">Where it goes</th>
                  </tr>
                </thead>
                <tbody>
                  {owed.rows.map((row) => (
                    <tr
                      key={row.commodity}
                      className="border-t border-[var(--color-border-subtle)] align-baseline"
                    >
                      <td className="py-1.5 pr-3 text-[var(--color-text-primary)]">
                        {row.commodity}
                        {row.shared ? (
                          <span className="ml-2 rounded border border-[var(--color-border-active)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">
                            Shared
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--color-text-primary)]">
                        {row.tonnes.toLocaleString('en-GB')} t
                      </td>
                      {/*
                        ★ THE SPLIT, NAMED ★

                        800 t across two builds is 800 t to BUY and not 800 t to hand to either of
                        them. A member who cannot see the breakdown fills a hold for one site and
                        finds half of it unwanted when they land — a wasted trip this page caused.
                      */}
                      <td className="py-1.5 text-[var(--color-text-secondary)]">
                        {row.wantedBy.map((w, i) => (
                          <span key={w.projectId}>
                            {i > 0 ? <span className="text-[var(--color-text-dim)]"> · </span> : null}
                            <Link
                              href={`/colonisation/${w.projectId}`}
                              className="text-[var(--color-text-secondary)] underline decoration-[var(--color-border-subtle)] underline-offset-2 hover:text-[var(--color-text-primary)]"
                            >
                              {w.title}
                            </Link>
                            <span className="tabular-nums text-[var(--color-text-dim)]">
                              {' '}
                              {w.tonnes.toLocaleString('en-GB')} t
                            </span>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </PageBody>
    </>
  );
}
