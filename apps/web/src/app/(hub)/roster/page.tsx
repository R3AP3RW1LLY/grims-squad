import type { Metadata } from 'next';
import { getRoster, getMe } from '../../../lib/api';
import { PageHeader, PageBody, Panel, RailStat } from '../../../components/hub-page';
import { RosterCard } from '../../../components/roster-card';
import { LiveRefresh } from '../../../components/live-refresh';
import { PageTabs, resolveTab, type PageTab } from '../../../components/page-tabs';
import { foundersFirst, squadronFounders, FOUNDERS_TAB } from './roster-order';

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

/**
 * ★ THE SAME ROSTER, FOUR WAYS IN ★
 *
 * "Everyone" is the default because it is the honest answer to "who is in this
 * squadron" — the others are filters on it, not different pages.
 *
 * Officers and members are complements: every member is in exactly one, and the
 * two counts always add to the whole. Split any other way and somebody appears
 * twice or not at all, and a roster nobody can trust to be complete is a roster
 * nobody uses.
 *
 * The split is a PERMISSION question — does this account hold something that
 * requires a second factor — decided on the server. Not a list of role names,
 * which would silently drop somebody the day a rank was renamed.
 *
 * ★ FOUNDERS CUTS ACROSS BOTH, AND THAT IS FINE ★
 *
 * Squadron owner, 2026-08-04. It is the one tab that is not part of the
 * officers/members partition — a founder appears here AND in whichever of the
 * two their rank puts them in. That does not break the completeness promise
 * above, which is about those two adding to the whole; this is a shortcut to
 * four people, not a third bucket.
 *
 * It sits second because it is a small, fixed list that people come looking for,
 * and burying it behind the two big filters would make it hard to find.
 */
const TABS: readonly PageTab[] = [
  { key: 'all', label: 'All members' },
  { key: FOUNDERS_TAB, label: 'Founders' },
  { key: 'officers', label: 'Officers' },
  { key: 'members', label: 'Members' },
];

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = resolveTab(TABS, params['tab']);

  const [data, me] = await Promise.all([getRoster(), getMe()]);
  /*
   * ★ ORDERED ONCE, THEN FILTERED — NOT ORDERED PER TAB ★
   *
   * The founders are pinned to the top here, and every tab below is a filter on
   * the already-ordered list. That is what makes the Members tab open with
   * Pebblemerchant without knowing anything about them: they are the only
   * founding-standing holder who is not an officer, so filtering the officers
   * out leaves them first. See `roster-order.ts`.
   */
  const all = foundersFirst(data?.members ?? []);
  const total = data?.total ?? 0;

  const officers = all.filter((m) => m.isOfficer);
  const founders = squadronFounders(all);
  const members =
    tab === 'officers'
      ? officers
      : tab === 'members'
        ? all.filter((m) => !m.isOfficer)
        : tab === FOUNDERS_TAB
          ? founders
          : all;

  const listed = all.length;
  const withCmdr = all.filter((m) => m.cmdrName !== null).length;

  return (
    <>
      {/*
        `presence` is squadron-wide: somebody launching the game changes who is
        shown as playing now, and that is the one thing on this page worth
        watching in real time.
      */}
      {/*
        `verification` as well as `roster`.

        A verification publishes BOTH — `roster` squadron-wide so every viewer's
        card refreshes, and `verification` scoped to the member it happened to.
        Listening for both means the person who just verified sees their own
        badge appear here at the same instant everybody else does, rather than
        one event later.
      */}
      <LiveRefresh types={['presence', 'roster', 'verification']} />

      <PageHeader
        eyebrow="Squadron register"
        title="ROSTER"
        action={<PageTabs tabs={TABS} current={tab} basePath="/roster" />}
      />

      <PageBody
        /*
          ★ WRITTEN FOR MEMBERS, NOT FOR THE PEOPLE WHO BUILT IT ★

          The previous line explained which parts of the page were optional and
          which were not. That is a note about how the system works, and it
          answered a question nobody arriving at a roster is asking — the reader
          wants to know who is out there and who they can fly with.

          Nothing anywhere in this application tells a member what they are and
          are not obliged to share. Squadron owner's instruction, 2026-07-29, and
          it applies to every surface, not only this one.
        */
        lead="Every commander flying under Grim's Squad colours — what they fly, what they have mastered, and what time it is where they are. See who is out in the black tonight, and go find yourself a wing."
        rail={
          <>
            <Panel title="At a glance">
              <RailStat label="Squadron" value={String(total)} />
              <RailStat label="Listed" value={String(listed)} tone={listed === 0 ? 'warn' : 'default'} />
              {/*
                Counted from the same list the tab renders, so the number beside
                "Founders" and the number of cards behind it are the same fact.
                A second count derived some other way is a second thing to be
                wrong.
              */}
              <RailStat label="Founders" value={String(founders.length)} />
              <RailStat label="Officers" value={String(officers.length)} />
              <RailStat label="Verified CMDRs" value={String(withCmdr)} />
              {/*
                ★ THE NUDGE, NOT A RENAME — SQUADRON OWNER, 2026-08-02 ★
                
                Asked what should happen to a member with no verified Inara profile, the owner chose
                "Nudge them, then leave it". Their Discord nickname is untouched, because there is
                nothing authoritative to set it to — but an officer should be able to see, at a
                glance, how many of the squadron are wearing a name we did not put there.
                
                Warn-toned only when there ARE any. A permanent amber zero reads as a fault.
              */}
              <RailStat
                label="Awaiting a name"
                value={String(Math.max(0, listed - withCmdr))}
                tone={listed - withCmdr > 0 ? 'warn' : 'good'}
              />
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
        {members.length === 0 && all.length > 0 ? (
          /*
           * The FILTER is empty, not the roster. A squadron with no officers yet
           * is a normal state on a new install, and telling somebody the roster
           * failed would send them looking for a fault that is not there.
           */
          <p className="rounded border border-[var(--color-border-hairline)] px-5 py-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Nobody here yet.{' '}
            <a href="/roster" className="text-[var(--color-brand-cyan-bright)]">
              See everyone
            </a>
            .
          </p>
        ) : members.length === 0 ? (
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
          /*
          ★ EVERY CARD THE SAME HEIGHT ★

          `auto-rows-fr` is the load-bearing class. Grid already stretches
          items to their ROW, so cards within a row match — but rows size to
          their own tallest card, so a row holding somebody with three ranks
          and an award towers over the row below it. Equal rows is what makes
          the grid read as a grid rather than as a ragged pile.

          The card itself must then fill the cell it was given: see the
          flex column and the `mt-auto` footer in RosterCard. Without those,
          uniform rows just add empty space under short cards.
          */
          <ul className="grid list-none auto-rows-fr grid-cols-1 gap-4 p-0 sm:grid-cols-2 2xl:grid-cols-3">
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
