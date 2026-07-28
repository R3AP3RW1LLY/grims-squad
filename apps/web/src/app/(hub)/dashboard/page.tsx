import type { Metadata } from 'next';
import {
  getAccountStatus,
  getInaraStatus,
  getSquadronStats,
  getMe,
  getMyDevices,
} from '../../../lib/api';

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

function Stat({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl leading-none ${
          accent ? 'text-[var(--color-brand-cyan-bright)]' : 'text-[var(--color-text-primary)]'
        }`}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </p>
      {hint !== undefined && (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{hint}</p>
      )}
    </div>
  );
}

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
    <div className="mx-auto max-w-[1100px]">
      {/*
        ★ A GREETING, NOT A CONTROL PANEL ★

        A hobby squadron of about a hundred people who fly together on evenings
        and weekends. The first line should read like somebody is glad they
        turned up, not like a status board for an outage.
      */}
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          {greeting()}
        </p>
        <h1
          className="mt-2 text-[clamp(1.6rem,3.5vw,2.4rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {verified === null ? name.toUpperCase() : `CMDR ${verified.toUpperCase()}`}
        </h1>
        {me.user?.rank != null && (
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            {me.user.rank}
          </p>
        )}
      </header>
      <div className="rule-glow mt-6" aria-hidden="true" />

      {/* ------------------------------------------------------------ stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Squadron"
          value={stats === null ? '—' : String(stats.members)}
          hint="Commanders on the roster"
        />
        <Stat
          label="Active this month"
          value={stats === null ? '—' : String(stats.activeThisMonth)}
          hint="Seen in Discord or in game"
          accent
        />
        <Stat
          label="Your commander"
          value={verified === null ? 'Unverified' : 'Verified'}
          hint={verified === null ? 'Link Inara, or ask an officer' : `CMDR ${verified}`}
        />
        <Stat
          label="Paired devices"
          value={String(activeDevices)}
          hint={activeDevices === 0 ? 'The companion app is not running' : 'Sending journal data'}
        />
      </div>

      {/* ------------------------------------------------------------- todo */}
      {todo.length > 0 && (
        <div className="mt-8">
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
        </div>
      )}

      {/* ----------------------------------------------------------- panels */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
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
 * Morning, afternoon or evening.
 *
 * ★ IN UTC, WHICH IS A KNOWN COMPROMISE ★
 *
 * The honest version reads the member's own timezone — we store one on `User` —
 * but that would mean blocking the render on a lookup, for a greeting. The
 * squadron is largely UK and US-evening and the server runs UTC, so this is
 * right for most people most of the time.
 *
 * Written down rather than left to be discovered: if somebody in Australia is
 * wished good morning at bedtime, this is why, and `User.timezone` is the fix.
 */
function greeting(): string {
  const hour = new Date().getUTCHours();
  if (hour < 12) return 'Good morning, commander';
  if (hour < 18) return 'Good afternoon, commander';
  return 'Good evening, commander';
}
