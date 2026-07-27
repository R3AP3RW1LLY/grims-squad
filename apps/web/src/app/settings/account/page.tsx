import type { Metadata } from 'next';
import { getMySessions } from '../../../lib/api';
import { SessionsPanel } from './sessions-panel';

export const metadata: Metadata = {
  title: "Account — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const data = await getMySessions();

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
          ACCOUNT
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        {data === null ? (
          <div className="mt-8">
            <p className="text-lg text-[var(--color-text-primary)]">
              Sign in to manage your account.
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
            <section aria-labelledby="sessions-heading" className="mt-10">
              <h2
                id="sessions-heading"
                className="text-xl text-[var(--color-brand-orange)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                SIGNED-IN DEVICES
              </h2>
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                Ending a session signs that device out immediately. If you see something here you do
                not recognise, end it and tell an officer.
              </p>
              <SessionsPanel initial={data.sessions} />
            </section>

            <section aria-labelledby="export-heading" className="mt-16">
              <h2
                id="export-heading"
                className="text-xl text-[var(--color-brand-orange)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                YOUR DATA
              </h2>
              <p className="mt-3 text-[var(--color-text-primary)]">
                Download everything the hub holds about you as a JSON file: your profile, privacy
                settings, Discord link, roles, verified commander names, activity totals and
                sessions.
              </p>
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                Access tokens are not included. They are credentials for your Discord account that
                we hold on your behalf, and a copy in your downloads folder would help nobody.
              </p>
              <a
                href="/v1/me/export"
                download="grims-squad-export.json"
                className="mt-6 inline-block rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]"
              >
                Download my data
              </a>
            </section>

            <p className="mt-16 text-sm text-[var(--color-text-muted)]">
              Also here:{' '}
              <a href="/settings/privacy" className="text-[var(--color-brand-cyan-bright)]">
                privacy settings
              </a>
              ,{' '}
              <a href="/settings/commander" className="text-[var(--color-brand-cyan-bright)]">
                your commander
              </a>{' '}
              and{' '}
              <a href="/settings/security" className="text-[var(--color-brand-cyan-bright)]">
                security
              </a>
              .
            </p>
          </>
        )}
      </div>
    </main>
  );
}
