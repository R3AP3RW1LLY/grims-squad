import type { Metadata } from 'next';
import { getRoster, getMe } from '../../../lib/api';
import { PageHeader, PageBody, Panel, RailStat } from '../../../components/hub-page';
import { RosterCard } from '../../../components/roster-card';

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
              <RailStat
                label="Flew this week"
                value={String(
                  members.filter(
                    (m) =>
                      m.commander.lastPlayedAt !== null &&
                      Date.now() - new Date(m.commander.lastPlayedAt).getTime() < 7 * 86400_000,
                  ).length,
                )}
              />
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
              <RosterCard
                key={m.handle}
                member={m}
                viewerTimezone={me.user?.timezone ?? 'UTC'}
              />
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
