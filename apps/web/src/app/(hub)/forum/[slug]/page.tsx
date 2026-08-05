import { notFound } from 'next/navigation';
import { PageHeader, PageBody, Panel, RailStat } from '../../../../components/hub-page';
import { getForumCategories, getHubThreads } from '../../../../lib/api';
import { BoardNav } from '../../../../components/forum/board-nav';
import { ThreadRow } from '../../../../components/forum/thread-row';

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
  /*
   * Both at once. The board list is not needed to decide whether this page 404s, so serialising
   * them would add a whole round trip to every board view for no ordering benefit.
   */
  const [data, cats] = await Promise.all([getHubThreads(slug), getForumCategories()]);

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
          <span className="flex items-center gap-4">
            {/*
              Shown only to somebody who can actually post here. A "New thread" button that always
              appeared and then refused would be worse than none — it invites writing a post before
              telling you it cannot be posted.
            */}
            {category.canPost && (
              <a
                href={`/forum/${slug}/new`}
                className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)]"
              >
                New thread
              </a>
            )}
            <a
              href="/forum"
              className="font-mono text-xs tracking-[0.2em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              &larr; ALL BOARDS
            </a>
          </span>
        }
      />

      <PageBody
        rail={
          <div className="space-y-6">
            {/*
              The board list sits ABOVE the stats. Somebody who came here to go somewhere else
              should not have to read this board's numbers first.
            */}
            <BoardNav categories={cats?.categories ?? []} currentSlug={slug} />
            <Panel title="Board">
              <RailStat label="Threads" value={String(threads.length)} />
            {/*
              `canPost` comes from the server, recomputed from the category each request. A
              boolean sent to a browser is a boolean a browser can change, which is why the
              write endpoint checks again rather than trusting this.
            */}
              <RailStat label="You can post" value={category.canPost ? 'Yes' : 'No'} />
            </Panel>
          </div>
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
            {category.canPost && (
              <p className="mt-4">
                {/*
                  The empty state OFFERS the action rather than describing it. "Be the first" with
                  nothing to click is an instruction with no verb.
                */}
                <a
                  href={`/forum/${slug}/new`}
                  className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)]"
                >
                  Start the first thread
                </a>
              </p>
            )}
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
                      <ThreadRow key={t.id} thread={t} boardSlug={slug} />
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
