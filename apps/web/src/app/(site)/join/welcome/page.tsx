import type { Metadata } from 'next';

export const metadata: Metadata = { title: "Welcome — Grim's Squad" };

/**
 * Post-join confirmation. Reads only the OUTCOME from the query string — never
 * a role id — so there is nothing here worth tampering with.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string; status?: string }>;
}) {
  const { as, status } = await searchParams;
  const isAlly = as === 'ally';
  const existed = status === 'existing';

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-24">
      <div className="mx-auto max-w-[62ch] text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          {existed ? 'Already aboard' : 'Welcome aboard'}
        </p>
        <h1
          className="mt-4 text-[clamp(2rem,5vw,3.5rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isAlly ? 'FLY SAFE, ALLY' : 'WELCOME, CMDR'}
        </h1>
        <div className="rule-glow mx-auto mt-6 max-w-xs" aria-hidden="true" />

        <p className="mt-8 text-lg text-[var(--color-text-primary)]">
          {existed
            ? 'You were already in the Discord server, so we just made sure your role is set correctly.'
            : isAlly
              ? 'You have been added to the Discord server with the Allies role.'
              : 'You have been added to the Discord server as a squadron member.'}
        </p>

        <p className="mt-5 text-[var(--color-text-secondary)]">
          {isAlly
            ? 'Public channels are open to you. If you ever want to fly with us properly, ask an officer and they will move you across.'
            : 'Head to the Discord server and say hello — an officer will pick up your onboarding from there and get you into a division.'}
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <a
            href="https://discord.com/channels/801929816596152320"
            className="bg-[var(--color-brand-orange)] px-7 py-3.5 text-[var(--color-text-on-accent)] transition-opacity hover:opacity-90"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            OPEN DISCORD
          </a>
          <a
            href="/"
            className="border border-[var(--color-border-active)] px-7 py-3.5 text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[var(--color-surface-panel-hover)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            BACK TO THE HUB
          </a>
        </div>
      </div>
    </main>
  );
}
