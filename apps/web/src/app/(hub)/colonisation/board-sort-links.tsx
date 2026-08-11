import { BOARD_SORTS, type BoardSort } from './board-order';

/**
 * The board's sort control.
 *
 * ★ LINKS, NOT A DROPDOWN ★
 *
 * The boards are server components — every figure on them comes from the server and the page is
 * rendered there. A select would make the whole board a client component to change one word in a
 * query string, and would stop the sorted view being a URL somebody can send to a squadmate.
 *
 * The scout already does exactly this with its search form, and for the same reasons.
 */
export function BoardSortLinks({
  basePath,
  current,
  positionless,
}: {
  basePath: string;
  current: BoardSort;
  /** True when we do not know where the member is, which changes what these sorts can promise. */
  positionless: boolean;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          Sort
        </span>
        {BOARD_SORTS.map((s) => {
          const active = s.key === current;
          return (
            <a
              key={s.key}
              href={`${basePath}?sort=${s.key}`}
              aria-current={active ? 'true' : undefined}
              className={
                'rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] no-underline transition-colors ' +
                (active
                  ? 'border-[var(--color-brand-orange)] text-[var(--color-brand-orange)]'
                  : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]')
              }
            >
              {s.label}
            </a>
          );
        })}
      </div>

      {/*
        ★ SAID, NOT SILENTLY DEGRADED ★

        Without a position, "Best for you" is still a real ranking — priority, nearly-done and
        stalled all still count — but it cannot weigh distance. A member who has never run the app
        would otherwise wonder why the nearest build is not first, and conclude the sort is broken
        rather than uninformed.
      */}
      {!positionless ? null : (
        <p className="m-0 mt-2 text-[11px] text-[var(--color-text-secondary)]">
          We do not know where you are, so distance is not counted. Run the companion app once and
          these sort by how far each build is from you.
        </p>
      )}
    </div>
  );
}
