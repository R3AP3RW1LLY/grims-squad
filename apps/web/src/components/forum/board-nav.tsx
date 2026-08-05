import type { ForumCategory } from '../../lib/api';

/**
 * Every board this member can see, listed beside whatever they are reading.
 *
 * ★ WHY THIS IS WORTH A COLUMN ★
 *
 * Squadron owner, 2026-07-30, asked for boards that work the way RSI Spectrum's do. The single
 * biggest difference from what we had is this: on Spectrum you move BETWEEN boards without going
 * back to an index. Before this, reading a thread and then wanting the next board meant two
 * navigations through a page you did not want to look at.
 *
 * ★ IT SHOWS UNREAD, AND THAT IS THE POINT ★
 *
 * The same per-board unread counts the cards use. Their value here is higher: from inside a thread
 * you can see that something happened somewhere else, which is the thing that keeps a small forum
 * feeling alive rather than like a page you have to remember to check.
 *
 * ★ NOT A CLIENT COMPONENT ★
 *
 * No state, no effects. The current board is passed in by the page that already knows it, so this
 * stays server-rendered and the counts are correct on first paint rather than after a fetch.
 */
export function BoardNav({
  categories,
  currentSlug,
}: {
  readonly categories: readonly ForumCategory[];
  /** The board being read, or null on a page that is not inside one. */
  readonly currentSlug: string | null;
}) {
  if (categories.length === 0) return null;

  return (
    <nav aria-label="Boards">
      <h2 className="mb-3 font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
        BOARDS
      </h2>
      <ul className="space-y-0.5">
        {categories.map((c) => {
          const current = c.slug === currentSlug;
          const unread = c.unreadCount ?? 0;
          return (
            <li key={c.id}>
              <a
                href={`/forum/${c.slug}`}
                /*
                 * `aria-current="page"` rather than relying on the colour change alone. The border
                 * and weight say "you are here" to someone looking at it; this says the same thing
                 * to someone who is not.
                 */
                {...(current ? { 'aria-current': 'page' as const } : {})}
                className={`flex items-center gap-2 rounded border-l-2 px-3 py-2 text-sm transition-colors ${
                  current
                    ? 'border-[var(--color-brand-orange)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {unread > 0 && (
                  <span
                    /*
                     * The number is in the accessible name, not just the pill. "Announcements, 3
                     * new" is navigable; "Announcements 3" read as two separate things is not.
                     */
                    aria-label={`${unread} new`}
                    className="shrink-0 rounded-full bg-[var(--color-brand-orange)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--color-text-on-accent)]"
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
