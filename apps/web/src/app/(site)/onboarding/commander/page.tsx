import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getMe, getTimezones } from '../../../../lib/api';
import { CommanderOnboardingForm } from './commander-onboarding-form';

export const metadata: Metadata = {
  title: "Set up your commander — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The commander onboarding step, for everybody.
 *
 * ★ WHY IT COMES BEFORE ANYTHING ELSE ★
 *
 * Every time the hub shows a member — when a device last uploaded, when they
 * were verified, when an operation starts — renders in their timezone. Asking
 * afterwards means showing wrong times until they happen to find the setting,
 * and a member who sees 03:00 against something they did at 20:00 does not
 * think "I should check my settings", they think the site is broken.
 *
 * Thirty seconds, once. It is worth insisting on precisely because it is cheap.
 */
export default async function CommanderOnboardingPage() {
  const [me, zones] = await Promise.all([getMe(), getTimezones()]);

  if (me.user === null) redirect('/v1/auth/discord?redirect=%2Fonboarding%2Fcommander');

  /*
   * Already done, or something earlier is owed. Either way this page is not the
   * right one — bounce to wherever the server says they should be, or to the
   * dashboard if they owe nothing.
   *
   * This is what stops the wall becoming a loop: the gate sends them here, and
   * here sends them on the moment the reason stops applying.
   */
  if (me.onboarding.step !== 'commander') {
    redirect(me.onboarding.path ?? '/dashboard');
  }

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[62ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-orange)]">
          One more thing
        </p>
        <h1
          className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          SET UP YOUR COMMANDER
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        <p className="mt-6 text-lg text-[var(--color-text-primary)]">
          Welcome aboard, {me.user.displayName}. One question before you go in, and it takes about
          thirty seconds.
        </p>

        <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Discord does not tell us where in the world you are, so we have to ask. Every time the hub
          shows you — when your last upload landed, when an operation starts — renders in the
          timezone you pick here.
        </p>

        <CommanderOnboardingForm
          initial={me.user.timezone}
          zones={zones?.timezones ?? ['UTC']}
          isAdmin={me.isAdmin}
        />
      </div>
    </main>
  );
}
