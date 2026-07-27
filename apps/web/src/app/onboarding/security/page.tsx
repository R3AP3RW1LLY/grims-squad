import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAccountStatus, getTotpStatus } from '../../../lib/api';
import { SecurityForm } from '../../settings/security/security-form';

export const metadata: Metadata = {
  title: "Secure your account — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The forced onboarding step for a privileged account.
 *
 * A member lands here automatically the first time they sign in holding an
 * admin permission, or the next time they sign in after being promoted into
 * one. Nobody is told to go and find a settings page.
 *
 * ★ IT SENDS THEM ON WHEN THEY ARE DONE ★
 *
 * Once enrolled there is nothing to do here, so arriving at this URL bounces to
 * the console rather than showing a completed form somebody has to interpret.
 * A page that says "you already did this" is a dead end wearing a hat.
 *
 * ★ AND IT IS NOT THE ENFORCEMENT ★
 *
 * The admin API refuses without a confirmed second factor whatever the browser
 * does. This flow exists so that the right thing happens without anyone being
 * told to do it — not to be the thing standing in the way.
 */
export default async function SecurityOnboardingPage() {
  const [status, totp] = await Promise.all([getAccountStatus(), getTotpStatus()]);

  if (status === null || totp === null) {
    return (
      <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
        <div className="mx-auto max-w-[60ch]">
          <p className="text-lg text-[var(--color-text-primary)]">Sign in to continue.</p>
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

  // Already done, or never required. Either way this page has nothing to offer.
  if (totp.enrolled) redirect(status.privileged ? '/app' : '/dashboard');
  if (!status.privileged) redirect('/dashboard');

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[62ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-orange)]">
          Required before you continue
        </p>
        <h1
          className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          SECURE YOUR ACCOUNT
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        <p className="mt-6 text-lg text-[var(--color-text-primary)]">
          Your account can affect other members, so it needs a second factor before you can use the
          admin tools.
        </p>

        {status.because.length > 0 && (
          <div className="mt-6 rounded border border-[var(--color-border-hairline)] p-5">
            {/*
              WHY, not just what. "Secure your account" on its own is an
              instruction; naming what they hold makes it an explanation, and
              people follow explanations.
            */}
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
              You hold
            </p>
            <ul className="mt-3 space-y-1 font-mono text-xs text-[var(--color-brand-cyan-bright)]">
              {status.because.map((p) => (
                <li key={p}>{p.replace(/_/g, ' ').toLowerCase()}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">
              A stolen Discord account with these permissions is other people&rsquo;s problem, not
              just yours. That is the whole reason this step exists.
            </p>
          </div>
        )}

        <SecurityForm enrolled={false} onDone="/app" />

        <p className="mt-12 text-sm text-[var(--color-text-muted)]">
          Nothing else on the site is blocked — you can browse normally. Only the admin tools wait
          on this.
        </p>
      </div>
    </main>
  );
}
