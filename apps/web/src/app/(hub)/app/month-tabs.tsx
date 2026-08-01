/**
 * Month tabs, for looking back through history.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "add tabs to the admin console for each month of the year so we can go back and look at history
 * please, do this for the member activiy & promotions too."
 *
 * ★ WHAT PROMPTED IT ★
 *
 * The console was opened four minutes into August and every chart was empty. Nothing was broken and
 * nothing was lost — August simply had no data yet, and 355 rows were sitting in July with no way
 * to reach them.
 *
 * That is the real gap. A month view without history is only ever complete on the 31st.
 *
 * ★ ONLY MONTHS THAT HAVE DATA ★
 *
 * The list comes from the activity table rather than from a generated range of the last twelve
 * months. Offering a tab that leads to a blank page is offering the exact thing that caused the
 * complaint.
 */

/** `2026-07` -> `July 2026`. The tab itself says the short form; this is for the label. */
function monthName(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (year === undefined || month === undefined) return key;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `2026-07` -> `Jul`. Years are shown only when the list spans more than one. */
function shortMonth(key: string, showYear: boolean): string {
  const [year, month] = key.split('-').map(Number);
  if (year === undefined || month === undefined) return key;
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleDateString('en-GB', {
    month: 'short',
    ...(showYear ? { year: '2-digit' as const } : {}),
    timeZone: 'UTC',
  });
}

export function MonthTabs({
  months,
  current,
  basePath,
  tab,
}: {
  readonly months: readonly string[];
  readonly current: string;
  readonly basePath: string;
  /** Preserved so switching month does not throw you back to the default tab. */
  readonly tab: string;
}) {
  /*
   * ★ THE LIST IS THE SAME WHICHEVER MONTH YOU ARE ON ★
   *
   * ★ THE BUG THIS FIXES ★
   *
   * This used to inject the SELECTED month when it was missing from the list, which is subtly and
   * badly wrong. On the 1st of August, `months` is ['2026-07'] — August has no rows yet. Viewing
   * August injected August and showed two tabs. Clicking July then made July the selection, August
   * was no longer selected, nothing injected it, and the only tab left was July.
   *
   * The squadron owner's words: "when i choose a month im locked on the month". Exactly that — a
   * one-way door into history with no way back to today.
   *
   * The set is now built from facts that do not depend on what is selected: every month with data,
   * plus the month it actually is. Navigation is then stable in both directions, always.
   */
  const thisMonth = new Date().toISOString().slice(0, 7);
  const all = [...new Set([thisMonth, ...months, current])].sort().reverse();

  const spansYears = new Set(all.map((m) => m.slice(0, 4))).size > 1;

  return (
    <nav aria-label="Month" className="mb-6 flex flex-wrap items-center gap-1">
      <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
        Period
      </span>

      {/*
        ★ YTD FIRST, BECAUSE IT IS THE WIDEST VIEW ★
        Squadron owner: "a new tab that is YTD that shows everything the monthly tabs show but an
        aggregate of the year total." It answers "how has the year gone", which is the question you
        arrive with; the months answer "what happened in June", which is the one you drill into.
      */}
      <a
        href={`${basePath}?tab=${encodeURIComponent(tab)}&month=ytd`}
        aria-current={current === String(new Date().getUTCFullYear()) ? 'page' : undefined}
        title={`Everything so far in ${new Date().getUTCFullYear()}`}
        className={`rounded border px-2.5 py-1 font-mono text-[11px] transition-colors ${
          // The API answers a YTD request with the YEAR as its label, which is how the tab knows.
          current === String(new Date().getUTCFullYear())
            ? 'border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] text-[var(--color-brand-orange-bright)]'
            : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        YTD
      </a>
      {all.map((m) => {
        const active = m === current;
        // A month in the list purely because it is TODAY may have no rows yet. Marked rather than
        // hidden: a tab that vanishes when you leave it is what caused the lock-in above.
        const empty = !months.includes(m);
        return (
          <a
            key={m}
            href={`${basePath}?tab=${encodeURIComponent(tab)}&month=${encodeURIComponent(m)}`}
            aria-current={active ? 'page' : undefined}
            title={empty ? `${monthName(m)} — nothing recorded yet` : monthName(m)}
            className={`rounded border px-2.5 py-1 font-mono text-[11px] transition-colors ${
              active
                ? 'border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] text-[var(--color-brand-orange-bright)]'
                : empty
                  ? 'border-[var(--color-border-hairline)] text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]'
                  : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {shortMonth(m, spansYears)}
          </a>
        );
      })}
    </nav>
  );
}
