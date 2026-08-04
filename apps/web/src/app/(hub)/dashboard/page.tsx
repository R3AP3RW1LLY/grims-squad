import type { Metadata } from 'next';
import {
  getAccountStatus,
  getInaraStatus,
  getSquadronStats,
  getMe,
  getMyDevices,
  getMyCommander,
  getMyBadges,
  getSquadronActivity,
} from '../../../lib/api';
import { kindIcon, notificationAge } from '../../../components/notifications-format';
import { PilotRanks, Location, Fleet, Balance } from './commander-panels';
import { BadgeCase } from './badge-case';
import { Avatar } from '../../../components/account-menu';
import {
  PageHeader,
  PageBody,
  Panel,
  Section,
  StatGrid,
  StatTile,
  RailStat,
  CouldNotLoad,
} from '../../../components/hub-page';
import { SessionCountdown } from '../../../components/session-countdown';
import { LiveRefresh } from '../../../components/live-refresh';

export const metadata: Metadata = {
  title: "Your dashboard — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Where a member lands after signing in.
 *
 * ★ EVERY NUMBER ON THIS PAGE IS REAL ★
 *
 * The brief was "all my analytics, forum notifications, and important things
 * from the various features". Most of those features do not exist yet — the
 * forum is a later phase, operations and BGS later still — and the tempting
 * thing is to fill the grid with plausible-looking placeholders.
 *
 * That would be worse than an empty page. A dashboard is a claim that what it
 * shows is true, and a member who discovers one tile was decorative has no way
 * to know which of the others were. So a feature that is not built says so, in
 * its own words, and the layout is designed to look deliberate while sparse
 * rather than broken.
 *
 * As each feature lands it replaces its own placeholder. Nothing here has to be
 * torn out first.
 */

export default async function DashboardPage() {
  const [status, inara, stats, me, devices, commander, badges, activity] = await Promise.all([
    getAccountStatus(),
    getInaraStatus(),
    getSquadronStats(),
    getMe(),
    getMyDevices(),
    getMyCommander(),
    getMyBadges(),
    getSquadronActivity(),
  ]);

  const verified = inara?.cmdrName ?? null;
  const name = me.user?.displayName ?? 'Commander';
  const activeDevices = devices?.devices.length ?? 0;

  /*
   * What still needs doing about their own account. Computed rather than
   * listed, so a member who has finished everything sees the panel disappear
   * instead of a row of ticks — which is the difference between a dashboard and
   * a chore list.
   */
  const todo: { href: string; label: string; why: string }[] = [];
  if (verified === null) {
    todo.push({
      href: '/settings/commander',
      label: 'Verify your commander',
      why: 'Link Inara and we can confirm which CMDR is yours, rather than taking your word for it. An officer can also do it by hand.',
    });
  }
  if (status !== null && status.privileged && !status.twoFactorEnrolled) {
    todo.push({
      href: '/onboarding/security',
      label: 'Secure your account',
      why: 'Your account can affect other members, so it needs a second factor before the admin tools open.',
    });
  }
  if (activeDevices === 0) {
    todo.push({
      href: '/settings/devices',
      label: 'Install the companion app',
      why: 'Optional, and recommended. It reads the game’s own journals so your ranks, ships and monthly activity keep themselves current.',
    });
  }

  return (
    <>
      {/*
        Live. Only `telemetry` — this page is about ONE commander, and refreshing
        it every time somebody else in the squadron loads the game would be
        constant work showing the same numbers.
      */}
      {/*
        `verification` as well as `telemetry`.

        The page TITLE is the verification state — "CMDR X" once proven, the
        member's display name until then — and the rail says "Verified" or "Not
        verified" beside it. Somebody who links their Inara key in another tab
        would otherwise come back to a dashboard still calling them unverified
        and still telling them to go and verify.

        Squadron owner, 2026-07-29: verifications must show instantly across the
        app. This is the page they land on.
      */}
      {/*
        `notification` joined the list on 2026-08-04, when SQUADRON ACTIVITY below started
        rendering the live feed. Not a contradiction of the "only what this page shows" rule
        above — it is that rule: the feed is now ON the page, and each event is a row this page
        displays, coalesced by LiveRefresh so a burst still costs one refresh.
      */}
      <LiveRefresh types={['telemetry', 'verification', 'notification']} />

      {/*
        ★ A GREETING, NOT A CONTROL PANEL ★

        A hobby squadron of about a hundred people who fly together on evenings
        and weekends. The first line should read like somebody is glad they
        turned up, not like a status board for an outage.
      */}
      <PageHeader
        eyebrow={greeting(me.user?.timezone ?? 'UTC')}
        title={verified === null ? name.toUpperCase() : `CMDR ${verified.toUpperCase()}`}
        {...(me.user?.rank != null && { subtitle: me.user.rank })}
        {...(me.user !== null && { icon: <Avatar user={me.user} size={56} /> })}
      />

      {/*
        ★ YOU IN THE RAIL, THE SQUADRON IN THE BODY ★

        The old layout put both in one band of four tiles: "Squadron 1",
        "Active this month 52", "Your commander Verified", "Paired devices 1".
        Two of those are facts about a hundred people and two are facts about
        one person, and reading across them meant switching subject every tile —
        which is what made the page feel clunky and hard to place.

        Split by SUBJECT. The rail answers "how is my account", which is short,
        personal, and mostly unchanging. The body answers "how is the squadron",
        which is the reason to open a dashboard at all.

        Same shape as the admin console, deliberately: somebody who learns to
        read one should not have to learn the other.
      */}
      <PageBody
        lead={
          stats === null
            ? 'Signed in. Squadron figures are unavailable at the moment.'
            : `${stats.activeThisMonth} of ${stats.members} commanders have been seen this month.`
        }
        rail={
          <>
            <Panel title="Your account">
              <RailStat
                label="Commander"
                value={verified ?? 'Not verified'}
                tone={verified === null ? 'warn' : 'good'}
              />
              <RailStat label="Rank" value={me.user?.rank ?? 'Unranked'} />
              <RailStat
                label="Companion app"
                value={activeDevices === 0 ? 'Not paired' : `${activeDevices} paired`}
                tone={activeDevices === 0 ? 'default' : 'good'}
              />
            </Panel>

            {/*
              The countdown is about the BROWSER somebody is sitting at, which
              is neither an account fact nor a squadron one — so it gets its own
              box rather than being filed under either.
            */}
            <SessionCountdown
              expiresAt={me.session.expiresAt}
              twoFactorExpiresAt={me.session.twoFactorExpiresAt}
              timezone={me.user?.timezone ?? 'UTC'}
            />

            {/*
              Only when there IS something. A panel of ticks is a chore list;
              its absence is the reward for finishing.
            */}
            {todo.length > 0 && (
              <Panel title="Worth doing">
                <ul className="m-0 list-none space-y-4 p-0">
                  {todo.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className="text-sm text-[var(--color-brand-cyan-bright)] hover:underline"
                      >
                        {item.label}
                      </a>
                      <span className="mt-1 block text-sm leading-relaxed text-[var(--color-text-secondary)]">
                        {item.why}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        }
      >
        {/*
          Squadron-wide only. Every tile here answers a question about the same
          subject, so the eye can scan the row instead of re-orienting at each.
        */}
        {/*
          ★ THE COMMANDER FIRST, THE SQUADRON AFTER ★

          This page used to open with squadron counts. That is backwards for the
          page somebody lands on after signing in: they already know roughly how
          many people are in the squadron, and they came to see how THEY are
          doing.

          Ranks, then hangar, then balance — the three things a commander checks
          — and the squadron band below them as context rather than as the
          headline.
        */}
        {commander === null ? (
          <CouldNotLoad what="your commander profile" />
        ) : (
          <>
            <PilotRanks profile={commander} />
            {/* Where they are, before what they own — it is the thing that changes. */}
            <Location profile={commander} />
            <Fleet profile={commander} />
            <Balance profile={commander} />
          </>
        )}

        {/*
          Outside the commander branch above, on purpose: badges are earned on the leaderboards,
          not read from the journal, and a member whose commander profile failed to load has not
          also lost their badge case.
        */}
        <BadgeCase badges={badges?.badges ?? null} />

        {/*
          ★ RENAMED IN THE 2026-08-04 NOTIFICATIONS PASS — A PAIR, ON PURPOSE ★

          YOUR ACTIVITY above SQUADRON ACTIVITY: the same word carried by both headings is what
          says these two sections answer the same question about two different subjects — you,
          then everybody. (Section renders its title uppercase, so the sentence-case strings here
          arrive on screen exactly as the owner spelled them.)
        */}
        <Section
          title="Your activity"
          description="The monthly rank check looks for two things: taking part in Discord, and an Elite session. The first is counted for everybody automatically; the second comes from the companion app."
        >
          {activeDevices === 0 ? (
            <p className="max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
              Nothing is reporting your sessions yet, so your months read as{' '}
              <strong>unknown</strong> rather than as inactive.{' '}
              <a href="/settings/devices" className="text-[var(--color-brand-cyan-bright)]">
                Install the companion app
              </a>{' '}
              and it keeps your ranks, ships and monthly activity current on its own.
            </p>
          ) : (
            <p className="max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {activeDevices === 1 ? 'One device is' : `${activeDevices} devices are`} paired and
              sending. Your sessions, ranks and ships update themselves whenever the app is
              running.{' '}
              <a href="/settings/devices" className="text-[var(--color-brand-cyan-bright)]">
                Manage devices
              </a>
              .
            </p>
          )}
        </Section>

        <Section
          title="Squadron activity"
          description="What has just happened across the squadron, and how the rest of us are doing."
        >
          {/*
            ★ THE FEED LEADS, THE FIGURES FOLLOW ★

            This section was 'The squadron' and held only the four tiles. The feed goes ABOVE
            them because it is the part that changes between two visits — the member counts move
            weekly, the feed moves nightly — and the tiles keep their place below rather than
            leaving: the feed says what happened, the tiles say what we are, and the section
            needs both to earn its heading.

            Ten entries, from the same endpoint the bell's Squadron tab reads, so the two can
            never disagree about what counts as squadron news. Reading it here does NOT advance
            the seen marker — glancing at a dashboard is not opening the feed, and a member who
            saw three rows in passing has not read them.
          */}
          {activity === null ? (
            <p className="mb-8 max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
              The squadron feed could not be loaded just now. It returns on its own — this page
              refreshes as events arrive.
            </p>
          ) : activity.items.length === 0 ? (
            <p className="mb-8 max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
              The squadron feed is empty for now. What members post, build and claim appears here
              as it happens.
            </p>
          ) : (
            <ul className="m-0 mb-8 list-none divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-0">
              {activity.items.slice(0, 10).map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <span aria-hidden="true" className="shrink-0 text-base leading-5">
                    {kindIcon(item.kind)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {item.link === null ? (
                      <span className="block text-sm leading-5 text-[var(--color-text-primary)]">
                        {item.title}
                      </span>
                    ) : (
                      <a
                        href={item.link}
                        className="block text-sm leading-5 text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-brand-orange-bright)]"
                      >
                        {item.title}
                      </a>
                    )}
                    <p className="m-0 mt-1 font-mono text-[10px] tracking-wide text-[var(--color-text-dim)]">
                      {item.actor === null
                        ? notificationAge(item.createdAt)
                        : `${item.actor.displayName} · ${notificationAge(item.createdAt)}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <StatGrid>
            <StatTile
            label="Squadron"
            value={stats === null ? '—' : String(stats.members)}
            hint={stats === null ? 'Unavailable' : `${stats.withAccounts} signed up here`}
          />
            <StatTile
            label="Active this month"
            value={stats === null ? '—' : String(stats.activeThisMonth)}
            hint="Seen in Discord or in game"
            tone="accent"
          />
            <StatTile
            label="Verified commanders"
            value={stats === null ? '—' : String(stats.verifiedCommanders)}
            hint="Proved their CMDR name"
          />
            <StatTile
            label="Flying since"
            value={stats === null ? '—' : String(stats.foundedYear)}
            hint="Grim's Squad was founded"
          />
          </StatGrid>
        </Section>



        {/*
          ★ ONE HONEST SECTION, NOT FOUR EMPTY PANELS ★

          Notifications, Operations and The Faction each had a panel saying "not
          built yet". Three quarters of the page was a list of things that do
          not exist, which reads as an unfinished site rather than a planned
          one — and it pushed the things that ARE real below the fold.

          Named in one line each instead. Still honest, still nothing invented,
          and each becomes its own section the day it lands rather than
          replacing a placeholder.
        */}
        <Section
          title="Still to come"
          description="Named rather than mocked up. Nothing on this page is invented — every figure above is read from live data, and a feature that does not exist says so instead of showing a plausible number."
        >
          <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {/*
              Leaderboards left this list on 2026-08-04 — the three boards are live under
              /leaderboards, and a page cannot both link a feature and call it "soon".
              Notifications followed the same day: the bell is live in the top bar and the
              squadron feed renders above, so calling it "soon" here would be the page
              contradicting itself.
            */}
            {[
              ['Operations', 'Wings forming up, who has signed on, and what they still need.'],
              ['The faction', 'Our systems, their state, and this week’s orders.'],
            ].map(([title, blurb]) => (
              <div key={title} className="flex gap-3 text-sm">
                <dt className="shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-dim)]">
                  Soon
                </dt>
                <dd className="m-0">
                  <span className="text-[var(--color-text-primary)]">{title}</span>{' '}
                  <span className="text-[var(--color-text-secondary)]">— {blurb}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      </PageBody>
    </>
  );
}

/**
 * Morning, afternoon or evening — on THEIR clock.
 *
 * ★ THIS USED TO READ UTC, AND IT WAS WRONG ★
 *
 * It was written when we had no timezone to read, and the compromise was
 * recorded rather than hidden: somebody in Australia was wished good morning at
 * bedtime. The zone is now asked for during onboarding, so the compromise has
 * no reason to survive.
 *
 * `hourCycle: 'h23'` matters. The default for en-GB gives "24" for midnight,
 * which parses as 24 and falls past every branch — a member signing in at
 * 00:30 would be wished good evening.
 */
function greeting(timeZone: string): string {
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(new Date()),
    );
  } catch {
    // An unknown zone costs the right greeting, never the page.
    hour = new Date().getUTCHours();
  }

  if (!Number.isFinite(hour)) hour = new Date().getUTCHours();
  if (hour < 12) return 'Good morning, commander';
  if (hour < 18) return 'Good afternoon, commander';
  return 'Good evening, commander';
}
