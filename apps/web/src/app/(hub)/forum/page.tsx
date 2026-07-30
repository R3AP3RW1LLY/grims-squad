import type { Metadata } from 'next';
import { ChatBubbleLeftRightIcon, LockClosedIcon } from '@heroicons/react/20/solid';
import { getForumCategories, type ForumCategory } from '../../../lib/api';
import { PageHeader, PageBody, Panel, RailStat, CouldNotLoad } from '../../../components/hub-page';

/**
 * The forum index — the boards, and which of them this member can post in.
 *
 * ★ THE SAME PRIMITIVES AS EVERY OTHER HUB PAGE ★
 *
 * Squadron owner, 2026-07-29: keep the styling and branding in line with the rest
 * of the site — non-negotiable. So this is `PageHeader` + `PageBody` + `Panel` +
 * `RailStat`, exactly as the roster and the admin console are, and every colour
 * comes from a design token rather than a hex literal. A page that hand-rolls its
 * own header looks like a different site however carefully the hexes are copied —
 * which is the mistake the coming-soon screens made first and a test caught.
 *
 * (That token guard also caught this very comment: an earlier draft spelled a
 * token name with an ellipsis inside it, and the scanner correctly read it as a
 * variable nobody defines. It does not parse prose differently from code, which
 * is the right trade — a guard that tried to would be a guard with an excuse.)
 *
 * ★ WHAT IS NOT DECIDED HERE ★
 *
 * Visibility. The API returns only the categories this caller may see (INV-002,
 * enforced by the bound client), so there is no filtering in this file. An empty
 * list is a real answer — for a signed-out visitor it is the correct one while
 * every category requires membership — and is distinct from a null, which means
 * the API could not be reached.
 */
export const metadata: Metadata = {
  title: "Forum — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Top-level boards, each with the children the caller can see beneath it. */
function group(categories: ForumCategory[]): Array<{ parent: ForumCategory; children: ForumCategory[] }> {
  /*
   * Built from the flat list rather than asking the API for a tree.
   *
   * A child is never visible when its parent is not — `isAtLeastAsRestrictive`
   * enforces that on creation — but this does not DEPEND on that being true. An
   * orphan whose parent was filtered out is promoted to top level rather than
   * silently dropped, because a category the server said this member may see is
   * one they should be able to reach.
   */
  const byId = new Map(categories.map((c) => [c.id, c]));
  const roots = categories.filter((c) => c.parentId === null || !byId.has(c.parentId));

  return roots.map((parent) => ({
    parent,
    children: categories.filter((c) => c.parentId === parent.id),
  }));
}

function CategoryRow({ category }: { category: ForumCategory }) {
  return (
    <a
      href={`/forum/${category.slug}`}
      className="group flex items-start justify-between gap-4 border-b border-[var(--color-border-hairline)] px-5 py-4 transition-colors last:border-0 hover:bg-[var(--color-surface-panel-sunken)]"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[var(--color-text-primary)] transition-colors group-hover:text-[var(--color-brand-orange)]">
          {category.name}
          {category.isLocked && (
            <>
              <LockClosedIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-[var(--color-text-dim)]"
              />
              {/*
                Named for screen readers as well as drawn. A padlock glyph alone
                tells somebody using a reader nothing at all.
              */}
              <span className="sr-only">Locked — nobody is posting here</span>
            </>
          )}
          {/*
            ★ THE NEW-POST INDICATOR ★

            Counted against this member's own last visit to the board, so "new" means new TO THEM
            rather than merely recent — a board nobody has posted in for a month is still new to
            somebody who has never opened it.

            The number is included rather than a bare dot: "3 new" tells you whether it is worth
            opening now, and a dot does not. Capped at 99 so a long-neglected board cannot stretch
            the card.
          */}
          {(category.unreadCount ?? 0) > 0 && (
            <span className="ml-auto shrink-0 rounded-full border border-[var(--color-brand-orange)] px-2 py-0.5 font-mono text-[10px] leading-none text-[var(--color-brand-orange-bright)]">
              {(category.unreadCount ?? 0) > 99 ? '99+' : category.unreadCount}
              <span className="sr-only"> threads with new posts since you last looked</span>
            </span>
          )}
        </p>
        {category.description !== null && (
          <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {category.description}
          </p>
        )}
      </div>

      {/*
        ★ SAYS WHY, NOT JUST THAT ★

        A member who cannot post here should learn that from the row rather than
        from a refusal after typing a thread. "Read only" is the honest label:
        the category is readable and this account cannot post, which is a
        different thing from the board being locked for everyone.
      */}
      <span className="shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-dim)]">
        {category.isLocked ? 'Locked' : category.canPost ? '' : 'Read only'}
      </span>
    </a>
  );
}

export default async function ForumPage() {
  const data = await getForumCategories();

  if (data === null) {
    return (
      <>
        <PageHeader eyebrow="Squadron" title="FORUM" />
        <PageBody>
          <CouldNotLoad what="the forum" />
        </PageBody>
      </>
    );
  }

  const groups = group(data.categories);
  const postable = data.categories.filter((c) => c.canPost && !c.isLocked).length;

  return (
    <>
      <PageHeader
        eyebrow="Squadron"
        title="FORUM"
        icon={
          <ChatBubbleLeftRightIcon
            aria-hidden="true"
            className="size-8 text-[var(--color-brand-orange)]"
          />
        }
      />

      <PageBody
        lead="Where the squadron talks when it is not in Discord — the things worth keeping, and finding again six months later."
        rail={
          <>
            <Panel title="Status">
              <RailStat label="Boards" value={String(data.categories.length)} />
              <RailStat
                label="You can post in"
                value={`${postable} of ${data.categories.length}`}
                tone={postable === 0 ? 'default' : 'good'}
              />
            </Panel>

            <Panel title="Related">
              <a href="/roster" className="block text-sm text-[var(--color-brand-cyan-bright)]">
                Who flies with the squadron
              </a>
              <a
                href="/settings/commander"
                className="mt-2 block text-sm text-[var(--color-brand-cyan-bright)]"
              >
                Your commander settings
              </a>
            </Panel>
          </>
        }
      >
        {data.categories.length === 0 ? (
          /*
            ★ AN EMPTY STATE THAT SAYS WHY, AND WHAT TO DO ★

            Reaching this signed in means no category is visible to this account
            — which for a member awaiting verification is the expected state, and
            for anybody else is worth telling an officer about. "No categories"
            on its own reads as a broken page.
          */
          <Panel tone="warning">
            <p className="text-[var(--color-text-primary)]">
              There are no boards you can see yet.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              The forum is open to members of the squadron&rsquo;s Discord. If you have just
              joined and nobody has confirmed your commander yet, that is the step that opens
              this — and if you have been verified for a while and still see this, tell an
              officer, because it is our end rather than yours.
            </p>
          </Panel>
        ) : (
          /*
            ★ TWO COLUMNS, BECAUSE ONE WASTED THE PAGE ★

            A stack of full-width cards left most of the row empty — a board name
            and a post count do not need 900px. Two columns from `md` up, one
            below, which is the same responsive step the dashboard panels use.

            `items-start` matters: without it the grid stretches every card in a
            row to the tallest one, so a board with a long description would pad
            out the board beside it. `auto-rows-min` would fix the row height and
            not the card, which is the wrong half of the problem.
          */
          <>
          <p className="mb-6">
            <a
              href="/forum/search"
              className="font-mono text-xs tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              SEARCH THE BOARDS &rarr;
            </a>
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {groups.map(({ parent, children }) => (
              <section
                key={parent.id}
                /*
                  ★ EQUAL HEIGHT ACROSS A ROW ★

                  `items-start` was removed from the grid so every card stretches to the tallest in
                  its row, and `h-full` makes the section actually take that height rather than
                  sitting at its natural size inside a stretched cell.

                  `flex-col` is what makes the stretch useful: without it the extra height is empty
                  space below the content, which looks like a rendering bug rather than a tidy grid.
                */
                className="flex h-full flex-col rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]"
              >
                <CategoryRow category={parent} />
                {children.length > 0 && (
                  <div className="border-t border-[var(--color-border-hairline)] pl-6">
                    {children.map((child) => (
                      <CategoryRow key={child.id} category={child} />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
          </>
        )}
      </PageBody>
    </>
  );
}
