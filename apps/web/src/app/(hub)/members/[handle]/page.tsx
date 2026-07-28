import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProfile, getMe } from '../../../../lib/api';
import { PageHeader, PageBody, Panel, RailStat } from '../../../../components/hub-page';
import { formatLocal } from '../../../../lib/time';

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
      <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] sm:w-44 sm:shrink-0">
        {label}
      </dt>
      <dd className="text-[var(--color-text-primary)]">{children}</dd>
    </div>
  );
}

export default async function MemberPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const [p, me] = await Promise.all([getProfile(handle), getMe()]);
  if (p === null) notFound();

  const isSelf = me.user?.handle === p.handle;

  return (
    <>
      <PageHeader
        eyebrow="Commander record"
        title={p.displayName.toUpperCase()}
        {...(p.cmdrName !== null && { subtitle: `CMDR ${p.cmdrName}` })}
        action={
          <a
            href="/roster"
            className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]"
          >
            Back to roster
          </a>
        }
      />

      <PageBody
        rail={
          <>
            <Panel title="At a glance">
              <RailStat label="Joined" value={formatLocal(p.joinedAt, 'UTC', { withTime: false })} />
              <RailStat label="Timezone" value={p.timezone} />
              <RailStat
                label="Commander"
                value={p.cmdrName ?? 'Not verified'}
                tone={p.cmdrName === null ? 'default' : 'good'}
              />
            </Panel>

            {isSelf ? (
              <Panel title="This is you">
                {/*
                  Said plainly, because a member looking at their own page
                  cannot otherwise tell WHICH fields others can see — the API
                  shows them everything when they are the caller.
                */}
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  You are seeing your own record, which includes fields others may not. What each
                  person sees depends on what you have turned on.
                </p>
                <a
                  href="/settings/privacy"
                  className="mt-3 block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  Your privacy settings
                </a>
              </Panel>
            ) : (
              <Panel title="What is missing">
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  Fields this commander has not turned on are absent entirely rather than blank.
                  Nothing here is hidden from you — it was never sent.
                </p>
              </Panel>
            )}
          </>
        }
      >
        {p.bio !== null && p.bio !== '' && (
          <p className="mb-8 max-w-[68ch] text-lg text-[var(--color-text-primary)]">{p.bio}</p>
        )}

        <dl>
          <Row label="Joined">
            {/*
              In the VIEWER's timezone, like every other date outside the audit
              log. "When did they join" is a question about the reader's
              calendar, not about UTC.
            */}
            <time dateTime={p.joinedAt}>
              {formatLocal(p.joinedAt, me.user?.timezone ?? 'UTC', { withTime: false })}
            </time>
          </Row>
          {p.ranks.length > 0 && <Row label="Ranks">{p.ranks.join(' · ')}</Row>}
          <Row label="Timezone">{p.timezone}</Row>

          {'location' in p && (
            <Row label="Last known position">
              {p.location == null ? (
                <span className="text-[var(--color-text-secondary)]">Not recorded yet</span>
              ) : (
                <>
                  {p.location.system}
                  {p.location.station !== null && (
                    <span className="text-[var(--color-text-secondary)]">
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
                <span className="text-[var(--color-text-secondary)]">Not recorded yet</span>
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
                <span className="text-[var(--color-text-secondary)]">Not recorded yet</span>
              ) : (
                <ul className="space-y-1">
                  {p.fleet.map((s, i) => (
                    <li key={`${s.shipType}-${i}`}>
                      {s.shipType}
                      {s.name !== null && (
                        <span className="text-[var(--color-text-secondary)]"> &ldquo;{s.name}&rdquo;</span>
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

        <p className="mt-8 max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Commanders choose which details appear here. A field that is not shown has not been shared
          — it is not missing data.
        </p>
      </PageBody>
    </>
  );
}
