import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProfile } from '../../../lib/api';

/**
 * One commander's profile.
 *
 * Every gated block tests for the KEY, not the value. The API omits a field the
 * member has not opted into (INV-027), so `'credits' in profile` distinguishes
 * "chose not to share" from "shared, but we have no figure yet" — which are
 * different statements and deserve different rendering.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const p = await getProfile(handle);
  if (p === null) return { title: "Commander not found — Grim's Squad" };
  return {
    title: `${p.displayName} — Grim's Squad`,
    // No bio in the description: a member's own words are theirs, and a search
    // engine snippet is a wider audience than a profile page.
    description: `Commander profile on the Grim's Squad hub.`,
    robots: { index: false },
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--color-border-hairline)] py-4 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-muted)] sm:w-44 sm:shrink-0">
        {label}
      </dt>
      <dd className="text-[var(--color-text-primary)]">{children}</dd>
    </div>
  );
}

export default async function MemberPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const p = await getProfile(handle);
  if (p === null) notFound();

  const joined = new Date(p.joinedAt);

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[70ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          Commander record
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,5vw,3.25rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {p.displayName.toUpperCase()}
        </h1>
        {p.cmdrName !== null && (
          <p className="mt-2 font-mono text-sm uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
            CMDR {p.cmdrName}
          </p>
        )}
        <div className="rule-glow mt-5" aria-hidden="true" />

        {p.bio !== null && p.bio !== '' && (
          <p className="mt-6 text-lg text-[var(--color-text-primary)]">{p.bio}</p>
        )}

        <dl className="mt-10">
          <Row label="Joined">
            <time dateTime={p.joinedAt}>
              {joined.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </time>
          </Row>
          {p.ranks.length > 0 && <Row label="Ranks">{p.ranks.join(' · ')}</Row>}
          <Row label="Timezone">{p.timezone}</Row>

          {'location' in p && (
            <Row label="Last known position">
              {p.location == null ? (
                <span className="text-[var(--color-text-muted)]">Not recorded yet</span>
              ) : (
                <>
                  {p.location.system}
                  {p.location.station !== null && (
                    <span className="text-[var(--color-text-muted)]">
                      {' '}
                      &mdash; {p.location.station}
                    </span>
                  )}
                </>
              )}
            </Row>
          )}

          {'credits' in p && (
            <Row label="Balance">
              {p.credits == null ? (
                <span className="text-[var(--color-text-muted)]">Not recorded yet</span>
              ) : (
                // Formatted from the STRING via BigInt. Passing it through
                // Number first would round a balance over 2^53.
                <span className="font-mono">{BigInt(p.credits).toLocaleString('en-GB')} CR</span>
              )}
            </Row>
          )}

          {'fleet' in p && (
            <Row label="Fleet">
              {p.fleet == null || p.fleet.length === 0 ? (
                <span className="text-[var(--color-text-muted)]">Not recorded yet</span>
              ) : (
                <ul className="space-y-1">
                  {p.fleet.map((s, i) => (
                    <li key={`${s.shipType}-${i}`}>
                      {s.shipType}
                      {s.name !== null && (
                        <span className="text-[var(--color-text-muted)]"> &ldquo;{s.name}&rdquo;</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Row>
          )}

          {'activity' in p && p.activity != null && (
            <Row label="Activity">
              {p.activity.messages.toLocaleString('en-GB')} messages ·{' '}
              {Math.round(p.activity.voiceMinutes / 60).toLocaleString('en-GB')} hours in voice
            </Row>
          )}
        </dl>

        <p className="mt-8 text-sm text-[var(--color-text-muted)]">
          Commanders choose which details appear here. A field that is not shown has not been shared
          — it is not missing data.
        </p>
      </div>
    </main>
  );
}
