import type { Metadata } from 'next';

/**
 * The join-the-server page.
 *
 * Two intents, and the choice is made HERE rather than after authorising, so
 * nobody lands in the Discord server without having said why they came. The
 * intent is carried in a signed OAuth state on the server side — nothing on
 * this page names a Discord role, because a role id in the markup is a role id
 * someone can edit.
 */
export const metadata: Metadata = {
  title: "Join — Grim's Squad",
  description:
    "Join the Grim's Squad Discord server, either as a squadron member or as an ally and observer.",
};

const OPTIONS = [
  {
    intent: 'squadron',
    label: 'JOIN THE SQUADRON',
    lede: 'I want to fly with Grim’s Squad.',
    body: 'You will be added to the Discord server as a member, and an officer will pick up your onboarding from there. Combat, AX, trade, mining, exploration, BGS — pick a division once you are in, or several.',
    accent: 'var(--color-brand-orange)',
  },
  {
    intent: 'ally',
    label: 'ALLY OR OBSERVER',
    lede: 'I am from an allied squadron, or I just want to watch.',
    body: 'You will be added with the Allies role. Full access to public channels and the open parts of the hub, no commitment, and no expectation that you fly with us.',
    accent: 'var(--color-brand-cyan-bright)',
  },
] as const;

export default function JoinPage() {
  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[70ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          New arrivals
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,5vw,3.25rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          JOIN THE SERVER
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />
        <p className="mt-6 text-lg text-[var(--color-text-primary)]">
          Tell us why you are here and we will put you in the right place. You can change your mind
          later &mdash; an officer can move you between the two at any time.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-[70ch] grid-cols-1 gap-5 md:max-w-none md:grid-cols-2">
        {OPTIONS.map((o, i) => (
          <article
            key={o.intent}
            className="hud panel panel-interactive draw-in flex flex-col p-7"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <h2 className="text-xl" style={{ fontFamily: 'var(--font-display)', color: o.accent }}>
              {o.label}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-primary)]">{o.lede}</p>
            <p className="mt-4 flex-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {o.body}
            </p>
            <a
              href={`/v1/auth/discord/join?intent=${o.intent}`}
              className="mt-7 inline-flex items-center justify-center gap-2 border border-[var(--color-border-active)] px-6 py-3 text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[var(--color-surface-panel-hover)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              CONTINUE WITH DISCORD
            </a>
          </article>
        ))}
      </div>

      <div className="mx-auto mt-12 max-w-[70ch]">
        <div className="panel p-6">
          <h2
            className="text-sm tracking-[0.2em] text-[var(--color-brand-cyan-bright)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            WHAT WE ASK FOR
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Discord will ask you to approve two things: your basic profile, and permission to add
            you to this one server. That is all &mdash; we do not request your email address, we
            cannot read your messages, and we cannot see what other servers you are in. See the{' '}
            <a
              href="/privacy"
              className="text-[var(--color-brand-cyan-bright)] underline underline-offset-4"
            >
              privacy policy
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
