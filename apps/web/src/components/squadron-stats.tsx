import type { SquadronStats } from '../lib/api';

/**
 * Live squadron statistics (P1.9).
 *
 * ★ WHAT IS PUBLIC HERE, AND WHY ★
 *
 * Counts only. The squadron's SIZE is public on Inara anyway, and "how many of
 * us were active this month" says nothing about any individual. WHO those
 * people are is private and governed by INV-027 — which is why nothing in this
 * component can render a name, a handle or an id: the API does not return one.
 *
 * ★ WHY IT DEGRADES RATHER THAN FAILS ★
 *
 * If the API is unreachable this renders NOTHING at all, rather than zeros. A
 * row of zeros is a claim — "nobody has been active this month" — and it is a
 * claim we would be making on no evidence. Silence is honest; zero is not.
 */
function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="text-center">
      <p
        className="text-[clamp(2rem,5vw,3.25rem)] leading-none text-[var(--color-brand-orange)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
        {label}
      </p>
      {hint !== undefined && (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{hint}</p>
      )}
    </div>
  );
}

export function SquadronStatsBand({ stats }: { stats: SquadronStats | null }) {
  if (stats === null) return null;

  const years = new Date().getUTCFullYear() - stats.foundedYear;
  const n = (v: number): string => v.toLocaleString('en-GB');

  return (
    <section
      className="border-y border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-panel-sunken)_45%,transparent)]"
      aria-labelledby="stats-heading"
    >
      <div className="mx-auto max-w-[1440px] px-6 py-16">
        <h2 id="stats-heading" className="sr-only">
          Squadron at a glance
        </h2>

        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <Stat value={n(years)} label="Years flying" hint={`Founded ${stats.foundedYear}`} />
          <Stat value={n(stats.members)} label="Commanders" hint="Signed in to the hub" />
          <Stat
            value={n(stats.activeThisMonth)}
            label="Active this month"
            hint="Chat, forum or voice"
          />
          <Stat
            value={n(stats.activityThisMonth)}
            label="Logged actions"
            hint="Messages, posts and voice joins"
          />
        </div>

        <p className="mt-10 text-center text-xs text-[var(--color-text-secondary)]">
          {/*
            Says WHEN, rather than implying the numbers are live to the second.
            They are read from our own database on each request, but "this
            month" is a rolling total that only means something with a date
            attached.
          */}
          From our own records, as of{' '}
          <time dateTime={stats.generatedAt}>
            {new Date(stats.generatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
          </time>
          .
        </p>
      </div>
    </section>
  );
}
