import type { Metadata } from 'next';
import { getRoster, getMe } from '../../../lib/api';
import { PageHeader, PageBody, Panel, RailStat } from '../../../components/hub-page';

/**
 * The squadron roster.
 *
 * ★ MEMBERS ONLY, AS OF 2026-07-28 ★
 *
 * It used to be a public page and part of the recruitment surface. It is now
 * behind the sign-in, on the squadron owner's instruction, and the API endpoint
 * moved with it — gating the page alone would have been theatre, since the data
 * was one curl away.
 *
 * ★ WHAT DID NOT CHANGE ★
 *
 * Appearing here is still opt-in, and so is every field on it. The API filters
 * by `showOnPublicRoster` BEFORE serialising, so a member who has not opted in
 * is not in the response at all — not hidden by this page (INV-027). Signing in
 * does not entitle anybody to see somebody who chose not to be listed.
 */
export const metadata: Metadata = {
  title: "Roster — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const [data, me] = await Promise.all([getRoster(), getMe()]);
  const members = data?.members ?? [];
  const total = data?.total ?? 0;

  const listed = members.length;
  const withCmdr = members.filter((m) => m.cmdrName !== null).length;

  return (
    <>
      <PageHeader eyebrow="Squadron register" title="ROSTER" />

      <PageBody
        lead="Everyone who flies with Grim's Squad. Being listed is not optional — this is the squadron's own directory — but every detail on an entry is: a commander who has shared nothing appears here as a name and a rank."
        rail={
          <>
            <Panel title="At a glance">
              <RailStat label="Squadron" value={String(total)} />
              <RailStat label="Listed" value={String(listed)} tone={listed === 0 ? 'warn' : 'default'} />
              <RailStat label="Verified CMDRs" value={String(withCmdr)} />
            </Panel>

            <Panel title="What is shown">
              <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                Everybody appears. What appears on YOUR entry beyond a name and a rank — your
                position, your ships, your activity — is yours to decide, field by field.
              </p>
              <a
                href="/settings/privacy"
                className="mt-3 block text-sm text-[var(--color-brand-cyan-bright)]"
              >
                Your privacy settings
              </a>
            </Panel>

            {me.user !== null && (
              <Panel title="Your entry">
                <a
                  href={`/members/${encodeURIComponent(me.user.handle)}`}
                  className="block text-sm text-[var(--color-brand-cyan-bright)]"
                >
                  See how others see you
                </a>
              </Panel>
            )}
          </>
        }
      >
        {members.length === 0 ? (
          /*
           * An empty roster now means something went WRONG, not that nobody
           * opted in — everybody active is listed. The old copy blamed a
           * privacy setting, which sent me looking in exactly the wrong place
           * when the real cause was an unauthenticated fetch.
           */
          <p className="rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_8%,transparent)] px-5 py-6 text-sm leading-relaxed text-[var(--color-text-primary)]">
            The roster came back empty, which should not happen — every active member is listed.
            This is our end rather than a setting of yours. Try again in a moment, and tell an
            officer if it persists.
          </p>
        ) : (
          <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 2xl:grid-cols-3">
            {members.map((m) => (
              <li
                key={m.handle}
                className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] transition-colors hover:border-[var(--color-border-active)]"
              >
                <a href={`/members/${encodeURIComponent(m.handle)}`} className="block p-5">
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
                    <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                      {m.ranks.join(' · ')}
                    </p>
                  )}
                  {/*
                    Rendered ONLY when the key is present. `m.location != null`
                    would read the same for "opted out" and "opted in with no
                    data", and the second of those deserves a different answer.
                  */}
                  {'location' in m && m.location != null && (
                    <p className="mt-3 font-mono text-xs text-[var(--color-text-secondary)]">
                      {m.location.system}
                    </p>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
