import type { Metadata } from 'next';
import { getInaraStatus } from '../../../lib/api';
import { InaraForm } from './inara-form';

export const metadata: Metadata = {
  title: "Commander — Grim's Squad",
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function CommanderPage() {
  const status = await getInaraStatus();

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
          COMMANDER
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        {status === null ? (
          <div className="mt-8">
            <p className="text-lg text-[var(--color-text-primary)]">
              Sign in to link your commander.
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
              Link your Inara account and we can confirm which commander is yours, rather than
              taking your word for it. Your Discord nickname is then kept matching your in-game
              name.
            </p>
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">
              Entirely optional. Without a key an officer verifies you by hand instead — it works
              just as well, it simply needs a person. Adding a key later upgrades you without
              anyone else being involved.
            </p>

            <InaraForm initial={status} />

            <section aria-labelledby="privacy-heading" className="mt-16">
              <h2
                id="privacy-heading"
                className="text-xl text-[var(--color-brand-orange)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                WHAT WE DO WITH IT
              </h2>
              <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-muted)]">
                <li>
                  We ask Inara which commander the key belongs to. That answer is what verifies you
                  — you never type your own commander name here.
                </li>
                <li>
                  The key is encrypted before it is stored and is never shown again, to you or to
                  anyone else.
                </li>
                <li>
                  Removing the key does not un-verify you. You proved it once; taking the key back
                  is about us not calling Inara on your behalf any more.
                </li>
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
