import type { Metadata } from 'next';
import { CompanionStep } from './companion-step';

export const metadata: Metadata = {
  title: "The companion app — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The companion app step in onboarding.
 *
 * ★ SQUADRON OWNER, 2026-08-01: "onboarding download step" ★
 *
 * ★ WHY IT SITS BEFORE VERIFICATION ★
 *
 * Verification is an officer confirming which commander somebody is, and the evidence is the
 * journal the companion uploads. Asking for the app afterwards means every member arrives at the
 * queue with nothing to be verified by — which is what had happened: six of fifty-six members had
 * a paired device.
 *
 * ★ IT DOES NOT SAY WHAT IS OPTIONAL ★
 *
 * Squadron owner, standing instruction: never tell members what is and is not optional. So this
 * page says what the app is FOR and what it does, and the button says what happens next. Somebody
 * on a machine that cannot run it continues on the same visit, having been told what it does —
 * which is the entire job of a step.
 */
export default function OnboardingCompanionPage() {
  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-16">
      <div className="mx-auto max-w-[46rem]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          Setting up
        </p>
        <h1
          className="mt-3 text-[clamp(1.75rem,4vw,2.5rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          THE COMPANION APP
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        <p className="mt-8 text-lg text-[var(--color-text-primary)]">
          Elite writes a journal of everything you do — where you jump, what you carry, what you
          fly. The companion app reads that file and sends it to your account here.
        </p>

        <p className="mt-5 text-[var(--color-text-primary)]">
          It is what puts your commander name, your ships and your activity on your profile, and it
          is the evidence an officer uses to verify you. It is also where the squadron&rsquo;s
          market prices come from: when you open a station&rsquo;s commodity screen, everyone
          routing against that station gets a price somebody actually saw.
        </p>

        <div className="mt-8 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
            What it sends
          </p>
          <ul className="mt-4 space-y-2 text-[var(--color-text-primary)]">
            <li>Your commander name, ships, and where you have been.</li>
            <li>Market prices from stations you visit.</li>
            <li>That the game is running, so the site can show who is flying.</li>
          </ul>
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
            You choose which of those it sends, and you can change it or disconnect the app at any
            time. It never reads anything outside Elite&rsquo;s journal folder.
          </p>
        </div>

        <div className="mt-8 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
            Connecting it
          </p>
          <p className="mt-4 text-[var(--color-text-primary)]">
            Install it, open it, and press{' '}
            <span className="text-[var(--color-brand-cyan-bright)]">Sign in with Discord</span>. It
            brings you back here to confirm. There is no key to copy and nothing to keep safe.
          </p>
        </div>

        <CompanionStep />
      </div>
    </main>
  );
}
