import type { WeaponsChart } from '../../../lib/api';

/**
 * What the squadron carries on foot.
 *
 * ★ SQUADRON OWNER'S LIST: "SuitLoadout weapons chart" ★
 *
 * ★ BARS, NOT A TABLE ★
 *
 * The question is "what do we use", which is a comparison — and a comparison of twelve numbers is
 * read far faster as lengths than as digits. The count sits beside each bar for anybody who wants
 * the exact figure.
 *
 * ★ AND IT SAYS WHEN IT IS EMPTY ★
 *
 * `SuitLoadout` was not collected until now, so this is empty until members update the companion
 * app and go on foot. An empty chart that says nothing reads as broken; one that says why reads as
 * waiting.
 */
export function WeaponsChartPanel({ chart }: { chart: WeaponsChart }) {
  if (chart.members === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6">
        <p className="text-[var(--color-text-primary)]">
          Nothing on foot yet.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          The companion app has only just started reporting suits and weapons. This fills in as
          members drop into a settlement — nobody needs to do anything but play.
        </p>
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          It is its own switch in the app, under{' '}
          <span className="text-[var(--color-brand-cyan-bright)]">On foot</span>, so anybody who
          would rather not share a loadout can turn just that off.
        </p>
      </div>
    );
  }

  const top = chart.weapons[0]?.members ?? 1;

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
          Weapons
        </p>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          How many of the {chart.members} commanders reporting a loadout carry each one.
        </p>

        <ul className="mt-5 space-y-2">
          {chart.weapons.map((w) => (
            <li key={w.name} className="flex items-center gap-3">
              <span className="w-52 shrink-0 truncate text-sm text-[var(--color-text-primary)]">
                {w.name}
              </span>
              {/*
                Scaled against the most-carried weapon rather than the member count: with 3 of 40
                members on foot every bar would be a sliver, and the comparison between weapons is
                the thing being shown.
              */}
              <span className="h-3 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-panel-sunken)]">
                <span
                  className="block h-full rounded-full bg-[var(--color-brand-cyan-bright)]"
                  style={{ width: `${Math.max(4, Math.round((w.members / top) * 100))}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                {w.members}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {chart.suits.length > 0 && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
            Suits
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {chart.suits.map((s) => (
              <li
                key={s.name}
                className="rounded-full border border-[var(--color-border-hairline)] px-4 py-1.5 text-sm text-[var(--color-text-primary)]"
              >
                {s.name}{' '}
                <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                  {s.members}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
