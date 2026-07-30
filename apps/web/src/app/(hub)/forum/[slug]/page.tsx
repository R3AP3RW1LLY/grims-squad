import { notFound } from 'next/navigation';
import { PageHeader, PageBody, Panel, RailStat } from '../../../../components/hub-page';
import { getHubThreads } from '../../../../lib/api';

/**
 * The threads in one board.
 *
 * ★ WHAT THIS PAGE DELIBERATELY DOES NOT DECIDE ★
 *
 * Nothing here knows which boards exist, who may see them, or who may post. The API answers
 * with what the caller's ACL-bound client returned and a `canPost` boolean, and this page
 * renders that. A page that reasoned about permissions would be a second place for the
 * decision to live, and the second place is the one that drifts.
 */

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getHubThreads(slug);

  // Absent, invisible, or the API being unreachable all answer identically (INV-024).
  if (data === null) notFound();

  const { category, threads } = data;
  const pinned = threads.filter((t) => t.isPinned);
  const rest = threads.filter((t) => !t.isPinned);

  return (
    <>
      <PageHeader
        eyebrow="FORUM"
        title={category.name}
        /*
         * SPREAD, not `subtitle={x ?? undefined}`. `exactOptionalPropertyTypes` is on, which
         * distinguishes "absent" from "present and undefined" — so an optional prop has to be
         * omitted rather than passed as undefined. Caught by the compiler, which is the point
         * of having that flag on.
         */
        {...(category.description === null ? {} : { subtitle: category.description })}
        action={
          <a
            href="/forum"
            className="font-mono text-xs tracking-[0.2em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            &larr; ALL BOARDS
          </a>
        }
      />

      <PageBody
        rail={
          <Panel title="Board">
            <RailStat label="Threads" value={String(threads.length)} />
            {/*
              `canPost` comes from the server, recomputed from the category each request. A
              boolean sent to a browser is a boolean a browser can change, which is why the
              write endpoint checks again rather than trusting this.
            */}
            <RailStat label="You can post" value={category.canPost ? 'Yes' : 'No'} />
          </Panel>
        }
      >
        {threads.length === 0 ? (
          <Panel tone="warning">
            <p className="text-[var(--color-text-primary)]">Nothing here yet.</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {category.canPost
                ? 'Be the first to start a thread.'
                : 'When somebody posts, it will show up here.'}
            </p>
          </Panel>
        ) : (
          <div className="space-y-8">
            {[
              { label: 'Pinned', items: pinned },
              { label: threads.length === pinned.length ? '' : 'Threads', items: rest },
            ]
              // A heading with nothing under it reads as a loading failure.
              .filter((g) => g.items.length > 0)
              .map((group) => (
                <section key={group.label}>
                  {group.label !== '' && (
                    <h2 className="mb-3 font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
                      {group.label.toUpperCase()}
                    </h2>
                  )}
                  <ul className="divide-y divide-[var(--color-border-hairline)] rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]">
                    {group.items.map((t) => (
                      <li key={t.id}>
                        <a
                          href={`/forum/${slug}/${t.slug}`}
                          className="flex items-baseline justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--color-surface-panel-hover)]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[var(--color-text-primary)]">
                              {t.title}
                            </span>
                            <span className="mt-0.5 block font-mono text-[11px] text-[var(--color-text-secondary)]">
                              {t.author.displayName}
                              {t.isLocked && ' · locked'}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-xs text-[var(--color-text-secondary)]">
                            {t.postCount}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
