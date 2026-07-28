import type { Metadata } from 'next';
import { getTotpStatus } from '../../../../lib/api';
import { SecurityForm } from '../../../../components/security-form';

export const metadata: Metadata = {
  title: "Security — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const status = await getTotpStatus();

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[70ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          Your account
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,5vw,3.25rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          SECURITY
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        {status === null ? (
          <div className="mt-8">
            <p className="text-lg text-[var(--color-text-primary)]">
              Sign in to manage your security settings.
            </p>
            <a
              href="/v1/auth/discord"
              className="mt-6 inline-block rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]"
            >
              Sign in with Discord
            </a>
          </div>
        ) : (
          <>
            <p className="mt-6 text-[var(--color-text-primary)]">
              Signing in to the hub takes one step — your Discord account. A second factor is
              required only to open the admin console, because those accounts can grant roles and
              change how the site works.
            </p>
            <SecurityForm enrolled={status.enrolled} />
          </>
        )}
      </div>
    </main>
  );
}
