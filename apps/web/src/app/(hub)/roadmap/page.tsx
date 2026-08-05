import type { Metadata } from 'next';
import { PageHeader, CouldNotLoad } from '../../../components/hub-page';
import { getRoadmap, type RoadmapCard } from '../../../lib/api';

/**
 * The roadmap — what is being built for the platform, member-readable and read-only.
 *
 * ★ READ-ONLY IS THE DESIGN, NOT A MISSING FEATURE ★
 *
 * The board is drawn on the admin console's Roadmap tab (webmaster only); this page is the
 * squadron's window onto it. The way a member moves something here is the loop the page
 * describes: send a suggestion, vote on Feature Requests threads — promoted cards link back to
 * the thread that earned them, so the vote is one click from the plan it produced.
 *
 * Server-rendered with no client island: there is nothing to press, so there is nothing to
 * hydrate.
 */

export const metadata: Metadata = {
  title: "Roadmap — Grim's Squad",
};

export const dynamic = 'force-dynamic';

const COLUMNS: ReadonlyArray<{ key: RoadmapCard['column']; label: string; blurb: string }> = [
  { key: 'ideas', label: 'Ideas', blurb: 'On the table, nothing promised.' },
  { key: 'considering', label: 'Considering', blurb: 'Being weighed against everything else.' },
  { key: 'planned', label: 'Planned', blurb: 'It is happening; it has not started.' },
  { key: 'building', label: 'Building', blurb: 'Being built now.' },
  { key: 'shipped', label: 'Shipped', blurb: 'Live on the site.' },
];

export default async function RoadmapPage() {
  const board = await getRoadmap();

  if (board === null) {
    return (
      <>
        <PageHeader eyebrow="Squadron" title="ROADMAP" />
        <CouldNotLoad what="the roadmap" />
      </>
    );
  }

  const empty = board.cards.length === 0;

  return (
    <>
      <PageHeader
        eyebrow="Squadron"
        title="ROADMAP"
        subtitle="What is being built for the platform, column by column. Cards promoted from Feature Requests link back to the thread — your vote there is what moves ideas here."
      />

      {empty ? (
        <section className="rounded border border-[var(--color-border-hairline)] p-8 text-center">
          <p className="text-lg text-[var(--color-text-primary)]">The board is empty.</p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--color-text-secondary)]">
            Cards land here from the suggestion box: send an idea from the Help &amp; Support
            widget, and when it is published to Feature Requests the squadron votes on it. What
            gets taken up appears on this board.
          </p>
        </section>
      ) : (
        // The board scrolls sideways as one unit; five honest columns never fit a laptop.
        <div className="overflow-x-auto">
          <div className="grid min-w-[64rem] grid-cols-5 gap-3">
            {COLUMNS.map((column) => {
              const cards = board.cards
                .filter((c) => c.column === column.key)
                .sort((a, b) => a.position - b.position);

              return (
                <section
                  key={column.key}
                  className="rounded border border-[var(--color-border-hairline)] p-3"
                >
                  <h2 className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                    {column.label}
                    <span className="text-[var(--color-text-dim)]">{cards.length}</span>
                  </h2>
                  <p className="mt-1 text-[11px] text-[var(--color-text-dim)]">{column.blurb}</p>

                  {cards.length === 0 ? (
                    <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
                      Nothing here right now.
                    </p>
                  ) : (
                    <ol className="mt-3 space-y-2">
                      {cards.map((card) => (
                        <li
                          key={card.id}
                          className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-3"
                        >
                          <p className="text-sm text-[var(--color-text-primary)]">{card.title}</p>
                          {card.body !== null && (
                            <p className="mt-1 text-xs whitespace-pre-wrap text-[var(--color-text-secondary)]">
                              {card.body}
                            </p>
                          )}
                          {card.threadLink !== null && (
                            <a
                              href={card.threadLink}
                              className="mt-1 inline-block text-[11px] text-[var(--color-brand-cyan-bright)] underline-offset-2 hover:underline"
                            >
                              The thread that earned it
                            </a>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
