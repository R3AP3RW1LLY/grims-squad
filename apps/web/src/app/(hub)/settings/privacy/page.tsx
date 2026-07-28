import type { Metadata } from 'next';
import { getMyPrivacy } from '../../../../lib/api';
import { PrivacyForm } from './privacy-form';

export const metadata: Metadata = {
  title: "Privacy — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function PrivacySettingsPage() {
  const settings = await getMyPrivacy();

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
          PRIVACY
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        {settings === null ? (
          <div className="mt-8">
            <p className="text-lg text-[var(--color-text-primary)]">
              Sign in to manage your privacy settings.
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
            <p className="mt-6 text-lg text-[var(--color-text-primary)]">
              Everything here starts switched off. Nothing on this list is shared with anyone until
              you turn it on, and each item is separate — showing your position does not also show
              your balance.
            </p>
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">
              Changes save as you make them. A field you have not turned on is not sent to anyone
              asking — it is left out of the answer entirely, rather than sent blank.
            </p>
            <PrivacyForm initial={settings} />
          </>
        )}
      </div>
    </main>
  );
}
