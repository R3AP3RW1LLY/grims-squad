import type { Metadata } from 'next';
import {
  getAccountStatus,
  getInaraStatus,
  getSquadronStats,
  getMe,
  getMyDevices,
} from '../../../lib/api';
import { Avatar } from '../../../components/account-menu';
import { PageHeader, StatGrid, StatTile } from '../../../components/hub-page';
import { SessionCountdown } from '../../../components/session-countdown';

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

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <section className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          className="text-lg text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h2>
        {action !== undefined && (
          <a
            href={action.href}
            className="shrink-0 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)]"
          >
            {action.label}
          </a>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * A feature that is coming, stated plainly.
 *
 * Deliberately not a skeleton loader or a greyed-out chart. Both of those say
 * "this is loading" and then never load, which is how a page teaches somebody
 * that it is broken.
 */
function NotYet({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
      <span className="mr-2 rounded border border-[var(--color-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
        Not built yet
      </span>
      {children}
    </p>
  );
}

export default async function DashboardPage() {
  const [status, inara, stats, me, devices] = await Promise.all([
    getAccountStatus(),
    getInaraStatus(),
    getSquadronStats(),
    getMe(),
    getMyDevices(),
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
    <div>
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

      <StatGrid>
        <StatTile
          label="Squadron"
          value={stats === null ? '—' : String(stats.members)}
          hint="Commanders on the roster"
        />
        <StatTile
          label="Active this month"
          value={stats === null ? '—' : String(stats.activeThisMonth)}
          hint="Seen in Discord or in game"
          tone="accent"
        />
        <StatTile
          label="Your commander"
          value={verified === null ? 'Unverified' : 'Verified'}
          hint={verified === null ? 'Link Inara, or ask an officer' : `CMDR ${verified}`}
        />
        <StatTile
          label="Paired devices"
          value={String(activeDevices)}
          hint={activeDevices === 0 ? 'The companion app is not running' : 'Sending journal data'}
        />
      </StatGrid>

      {/*
        ★ ONE ROW: WHAT YOU OWE, AND HOW LONG YOU HAVE ★

        The countdown deliberately does NOT go in the stat band above. That band
        answers questions about the SQUADRON — how many of us, how many active —
        and this answers one about the browser you happen to be sitting at.
        Mixing the two makes both harder to scan.

        "Worth doing" takes the wide column because its items are sentences.
        When there is nothing outstanding it becomes a short acknowledgement
        rather than vanishing, so the row keeps its shape and the countdown does
        not jump across the page the day somebody finishes their setup.
      */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="order-2 lg:order-1">
          {todo.length > 0 ? (
            <Panel title="Worth doing">
              <ul className="list-none space-y-4 p-0">
                {todo.map((item) => (
                  <li key={item.href} className="flex flex-col gap-1">
                    <a
                      href={item.href}
                      className="text-sm text-[var(--color-brand-cyan-bright)] hover:underline"
                    >
                      {item.label}
                    </a>
                    <span className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                      {item.why}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <Panel title="All set">
              <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                Nothing outstanding on your account — your commander is confirmed, your months
                count, and the companion app is reporting.
              </p>
            </Panel>
          )}
        </div>

        {/*
          First on a phone. On a narrow screen the countdown is the one thing
          here that is time-sensitive, and burying it under a list of chores
          means it is the thing nobody scrolls to.
        */}
        <div className="order-1 lg:order-2">
          <SessionCountdown
            expiresAt={me.session.expiresAt}
            twoFactorExpiresAt={me.session.twoFactorExpiresAt}
          />
        </div>
      </div>

      {/* ----------------------------------------------------------- panels */}
      {/*
        Two columns at lg, three at 2xl. The panels are short and independent,
        so a single column left two thirds of a wide screen empty while pushing
        the last of them below the fold.
      */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Your activity" action={{ href: '/settings/devices', label: 'Devices' }}>
          {activeDevices === 0 ? (
            <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
              Nothing yet. The monthly rank check looks for a Discord message and an Elite session —
              the companion app supplies the second, and until something reports one your months
              read as unknown rather than as inactive.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {activeDevices === 1 ? 'One device is' : `${activeDevices} devices are`} paired and
              sending. Your sessions, ranks and ships update themselves whenever the app is running.
            </p>
          )}
        </Panel>

        <Panel title="Notifications">
          <NotYet>
            The forum arrives in a later phase, and notifications come with it. When there is
            something to tell you — a reply, a promotion, an operation you signed up for — it will
            appear here.
          </NotYet>
        </Panel>

        <Panel title="Operations">
          <NotYet>
            Wings forming up, who has signed on, and what they still need. Coming with the
            operations board.
          </NotYet>
        </Panel>

        <Panel title="The faction">
          <NotYet>
            Our systems, their state, and this week&rsquo;s orders. Coming with the BGS module.
          </NotYet>
        </Panel>
      </div>

      <p className="mt-10 text-xs leading-relaxed text-[var(--color-text-secondary)]">
        Panels marked <em>not built yet</em> are placeholders for features still to come. Nothing on
        this page is invented — every figure above is read from live data, and a panel with nothing
        behind it says so rather than showing a plausible number.
      </p>
    </div>
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
