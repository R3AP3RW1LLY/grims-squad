import type { ColonyStatusFilter } from '@grims/shared/colony-status';
import { boardHref, visibleFilters } from './board-filter';
import type { BoardSort } from './board-order';

/**
 * The board's status filter.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "we need to add view filters one for inprogress and one for complete"
 *
 * ★ THE SAME SHAPE AS THE SORT CONTROL BESIDE IT, DELIBERATELY ★
 *
 * Server-rendered links rather than a dropdown, for the reasons `BoardSortLinks` already gives: the
 * boards are server components, and a select would turn the whole board into client code to change
 * one word in a query string — and would stop the filtered view being a URL somebody can send to a
 * squadmate.
 *
 * Both controls build their hrefs through `boardHref`, so choosing one never discards the other.
 */
export function BoardFilterLinks({
  basePath,
  current,
  sort,
  canManage,
  hasAbandoned,
  counts,
}: {
  basePath: string;
  current: ColonyStatusFilter;
  /** Carried so a filter link cannot drop the sort the member already chose. */
  sort: BoardSort;
  canManage: boolean;
  /** Whether this reader has any abandoned build of their own to look at. */
  hasAbandoned: boolean;
  /** How many builds each filter would show, so an empty view is explained before it is opened. */
  counts: Readonly<Record<ColonyStatusFilter, number>>;
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          Show
        </span>
        {visibleFilters({ canManage, hasAbandoned }).map((f) => {
          const active = f.key === current;
          return (
            <a
              key={f.key}
              href={boardHref({ basePath, sort, filter: f.key })}
              aria-current={active ? 'true' : undefined}
              className={
                'rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] no-underline transition-colors ' +
                (active
                  ? 'border-[var(--color-brand-orange)] text-[var(--color-brand-orange)]'
                  : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]')
              }
            >
              {f.label}
              {/*
                The count sits in the tab because the alternative is a member choosing a filter,
                landing on an empty board, and having to guess whether it is empty or broken.
              */}
              <span className="ml-1.5 opacity-60">{counts[f.key]}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
