import type { Metadata } from 'next';
import { getRoster } from '../../../lib/api';

/**
 * The public roster.
 *
 * Lists ONLY members who have opted in (INV-027). The API filters before
 * serialising, so this page cannot accidentally render someone who opted out —
 * there is nothing here to filter and no flag to check.
 */
export const metadata: Metadata = {
  title: "Roster — Grim's Squad",
  description:
    "Commanders of Grim's Squad who have chosen to appear publicly. Flying since 2006.",
};

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const data = await getRoster();
  const members = data?.members ?? [];
  const total = data?.total ?? 0;

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[70ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          Squadron register
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,5vw,3.25rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          ROSTER
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />
        <p className="mt-6 text-lg text-[var(--color-text-primary)]">
          {total > 0 ? (
            <>
              <strong className="text-[var(--color-brand-cyan-bright)]">{total}</strong> commanders
              fly under Grim&rsquo;s Squad.{' '}
              {members.length === total
                ? 'All of them appear here.'
                : `${members.length} of them have chosen to appear publicly.`}
            </>
          ) : (
            'The register is not available right now.'
          )}
        </p>
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Appearing on this page is opt-in, and so is every field on it. A commander who is not
          listed has simply chosen not to be — it says nothing about their standing.
        </p>
      </div>

      {members.length === 0 ? (
        <p className="mx-auto mt-14 max-w-[70ch] rounded border border-[var(--color-border-hairline)] px-5 py-6 text-sm text-[var(--color-text-muted)]">
          No commander has opted into the public roster yet. Members can turn this on under{' '}
          <a href="/settings/privacy" className="text-[var(--color-brand-cyan-bright)]">
            privacy settings
          </a>
          .
        </p>
      ) : (
        <ul className="mx-auto mt-14 grid max-w-[1100px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <li
              key={m.handle}
              className="rounded border border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-panel)_60%,transparent)] p-5"
            >
              <a href={`/members/${encodeURIComponent(m.handle)}`} className="block">
                <p
                  className="text-lg text-[var(--color-brand-orange)]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {m.displayName}
                </p>
                {m.cmdrName !== null && (
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
                    CMDR {m.cmdrName}
                  </p>
                )}
                {m.ranks.length > 0 && (
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">{m.ranks.join(' · ')}</p>
                )}
                {/*
                  Rendered ONLY when the key is present. `m.location != null`
                  would read the same for "opted out" and "opted in with no
                  data", and the second of those deserves a different answer.
                */}
                {'location' in m && m.location != null && (
                  <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
                    {m.location.system}
                  </p>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
