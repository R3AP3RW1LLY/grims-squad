/**
 * The period selector: year to date, a year, or a month within it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "in the period section there needs to be categories. Year: (shows aggregate years), Month (shows
 * the current months in the year, if no data exists for that month, disable the button, but as soon
 * as that new month starts then un block the button for the new month, and then YTD should be to
 * the left of the Period."
 *
 * ★ WHY ALL TWELVE MONTHS ARE ALWAYS DRAWN ★
 *
 * The first version listed only months that had data, which made the row change length as you moved
 * around and — worse — let it shrink to a single entry, so picking a month became a one-way door
 * with no way back. Twelve fixed positions mean the control never moves under the pointer, and a
 * month with nothing in it is visibly empty rather than absent.
 *
 * ★ AND WHY THE CURRENT MONTH IS NEVER DISABLED ★
 *
 * "as soon as that new month starts then un block the button". At 00:04 on the 1st there is
 * genuinely no data yet, and disabling it would lock somebody out of the month they are living in —
 * which is exactly the state that started all of this.
 */

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MONTH_NAME = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Shared by every control here, so a row of them cannot drift apart visually. */
const CHIP = 'rounded border px-2.5 py-1 font-mono text-[11px] transition-colors';
const ACTIVE =
  'border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] text-[var(--color-brand-orange-bright)]';
const IDLE =
  'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]';
/** Present, positioned, and plainly not clickable. See the note on twelve fixed positions. */
const DISABLED =
  'border-[var(--color-border-hairline)] text-[var(--color-text-dim)] cursor-not-allowed opacity-50';

export function MonthTabs({
  months,
  current,
  basePath,
  tab,
}: {
  /** Months that actually hold data, as `YYYY-MM`. */
  readonly months: readonly string[];
  /** What is selected: `YYYY-MM` for a month, or a bare `YYYY` for the year view. */
  readonly current: string;
  readonly basePath: string;
  /** Preserved so changing period does not throw you back to the default tab. */
  readonly tab: string;
}) {
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const thisMonthKey = now.toISOString().slice(0, 7);

  // A bare year means the YTD view; otherwise the year of the selected month.
  const isYtd = /^\d{4}$/.test(current);
  const selectedYear = Number(current.slice(0, 4));

  /*
   * Years come from the data, plus the current one — the same rule as the months, and for the same
   * reason: the year you are in must be reachable on 1 January before anything has happened in it.
   */
  const years = [...new Set([thisYear, ...months.map((m) => Number(m.slice(0, 4)))])]
    .sort()
    .reverse();

  const href = (value: string): string =>
    `${basePath}?tab=${encodeURIComponent(tab)}&month=${encodeURIComponent(value)}`;

  return (
    <div className="mb-6 flex flex-wrap items-start gap-x-6 gap-y-3">
      {/*
        YTD sits to the LEFT of everything, on the owner's instruction. It is also the widest view,
        so reading left to right goes from the whole year inwards — which is the order somebody
        arrives with the question.
      */}
      <a
        href={href('ytd')}
        aria-current={isYtd ? 'page' : undefined}
        title={`Everything so far in ${thisYear}`}
        className={`${CHIP} ${isYtd ? ACTIVE : IDLE}`}
      >
        YTD
      </a>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 w-12 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Year
          </span>
          {years.map((y) => {
            // The year reads as selected when a month inside it is, so the two rows agree.
            const active = y === selectedYear;
            return (
              <a
                key={y}
                href={href(String(y))}
                aria-current={active ? 'page' : undefined}
                className={`${CHIP} ${active ? ACTIVE : IDLE}`}
              >
                {y}
              </a>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 w-12 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Month
          </span>
          {MONTH_ABBR.map((abbr, i) => {
            const key = `${selectedYear}-${String(i + 1).padStart(2, '0')}`;
            const active = key === current;
            /*
             * Clickable when it holds data, OR when it is the month we are currently in. The second
             * clause is the "un block the button as soon as that new month starts" rule, and it is
             * what stops the 1st of a month being a dead end.
             */
            const usable = months.includes(key) || key === thisMonthKey;

            if (!usable) {
              return (
                <span
                  key={key}
                  aria-disabled="true"
                  title={`${MONTH_NAME[i]} ${selectedYear} — nothing recorded`}
                  className={`${CHIP} ${DISABLED}`}
                >
                  {abbr}
                </span>
              );
            }

            return (
              <a
                key={key}
                href={href(key)}
                aria-current={active ? 'page' : undefined}
                title={`${MONTH_NAME[i]} ${selectedYear}`}
                className={`${CHIP} ${active ? ACTIVE : IDLE}`}
              >
                {abbr}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
