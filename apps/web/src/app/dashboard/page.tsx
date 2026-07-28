import type { Metadata } from 'next';
import { getAccountStatus, getInaraStatus, getSquadronStats } from '../../lib/api';

export const metadata: Metadata = {
  title: "Your dashboard — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The members' area — where an ordinary member lands after signing in.
 *
 * Deliberately a set of NEXT STEPS rather than a wall of statistics. Somebody
 * arriving here for the first time should be able to see what is left to do
 * about their own account without hunting through a settings menu for it.
 */
function Card({
  title,
  body,
  href,
  cta,
  done = false,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  done?: boolean;
}) {
  return (
    <article className="hud panel p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg text-[var(--color-brand-orange)]" style={{ fontFamily: 'var(--font-display)' }}>
          {title}
        </h3>
        {done && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)]">
            Done
          </span>
        )}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">{body}</p>
      <a
        href={href}
        className="mt-5 inline-block rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-primary)] no-underline transition-colors hover:border-[var(--color-brand-cyan-bright)] hover:text-[var(--color-brand-cyan-bright)]"
      >
        {cta}
      </a>
    </article>
  );
}

export default async function DashboardPage() {
  const [status, inara, stats] = await Promise.all([
    getAccountStatus(),
    getInaraStatus(),
    getSquadronStats(),
  ]);

  if (status === null) {
    return (
      <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
        <div className="mx-auto max-w-[60ch]">
          <p className="text-lg text-[var(--color-text-primary)]">Sign in to see your dashboard.</p>
          <a
            href="/v1/auth/discord"
            className="mt-6 inline-block rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]"
          >
            Sign in with Discord
          </a>
        </div>
      </main>
    );
  }

  const verified = inara?.cmdrName ?? null;

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
        Squadron member
      </p>
      <h1
        className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight text-[var(--color-brand-orange)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {verified === null ? 'YOUR DASHBOARD' : `CMDR ${verified.toUpperCase()}`}
      </h1>
      <div className="rule-glow mt-5" aria-hidden="true" />

      <section aria-labelledby="next-heading" className="mt-12">
        <h2
          id="next-heading"
          className="text-xl text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          YOUR ACCOUNT
        </h2>

        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-3">
          <Card
            title="Your commander"
            done={verified !== null}
            body={
              verified === null
                ? 'Link your Inara account and we can confirm which commander is yours, rather than taking your word for it. Optional — an officer can verify you instead.'
                : `Verified as CMDR ${verified}. Your Discord nickname is kept matching it.`
            }
            href="/settings/commander"
            cta={verified === null ? 'Link Inara' : 'Manage'}
          />
          <Card
            title="Security"
            done={status.twoFactorEnrolled}
            body={
              status.privileged
                ? 'Your account can affect other members, so it needs a second factor before you can use the admin tools.'
                : 'A second factor is optional for your account. It is a good idea regardless — it takes a minute.'
            }
            href={status.privileged && !status.twoFactorEnrolled ? '/onboarding/security' : '/settings/security'}
            cta={status.twoFactorEnrolled ? 'Manage' : 'Set up'}
          />
          <Card
            title="Privacy"
            body="Everything about you starts private. Choose what appears on the public roster, field by field."
            href="/settings/privacy"
            cta="Review"
          />
          <Card
            title="Companion app"
            body="Recommended. Runs quietly in the background and reads the game's own journal files, so your ranks, ships, loadouts and activity keep themselves up to date. Nothing else gives the hub this."
            href="/settings/devices"
            cta="Pair a device"
          />
        </div>

        {status.privileged && status.twoFactorEnrolled && (
          <p className="mt-8 text-sm text-[var(--color-text-muted)]">
            You hold admin permissions.{' '}
            <a href="/app" className="text-[var(--color-brand-cyan-bright)]">
              Open the admin console
            </a>
            .
          </p>
        )}
      </section>

      {stats !== null && (
        <section aria-labelledby="squadron-heading" className="mt-16">
          <h2
            id="squadron-heading"
            className="text-xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            THE SQUADRON
          </h2>
          <p className="mt-4 text-[var(--color-text-primary)]">
            <strong className="text-[var(--color-brand-cyan-bright)]">{stats.activeThisMonth}</strong>{' '}
            of {stats.members} commanders active this month.
          </p>
          <a href="/roster" className="mt-4 inline-block text-sm text-[var(--color-brand-cyan-bright)]">
            See the roster
          </a>
        </section>
      )}
    </main>
  );
}
