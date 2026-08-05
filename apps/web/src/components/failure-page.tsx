import type { ReactNode } from 'react';

/**
 * The shape every "something went wrong" screen on this site shares.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "add error pages so were not just showing raw json! this looks really un professional!"
 *
 * They were right, and it was worse than untidy. There was no `error.tsx`, no `global-error.tsx`
 * and no `not-found.tsx` anywhere in the app — so a failed server render fell through to Next's
 * default, and anything that reached an API URL directly showed the error ENVELOPE: a wall of JSON
 * with a `requestId` in it. A member seeing that has no idea whether the site is broken, whether
 * they did something wrong, or whether their account is gone.
 *
 * ★ THE requestId IS KEPT, DELIBERATELY ★
 *
 * It is the one genuinely useful thing in that JSON. Every 500 is logged against it, so a member
 * who quotes it can be answered in seconds instead of by sweeping every route. It stays — shown as
 * a reference to quote, in small type, rather than as the headline.
 *
 * ★ ONE COMPONENT, THREE ENTRY POINTS ★
 *
 * Next wants three separate files (a route error boundary, a root one, and a 404), and they must
 * be separate files. What they say and how they look does not need to be three copies, and three
 * copies is how one of them ends up saying something different a year from now.
 */
export function FailurePage({
  eyebrow,
  title,
  children,
  reference,
  actions,
}: {
  /** Small caps above the title — what KIND of thing happened. */
  readonly eyebrow: string;
  readonly title: string;
  /** The explanation. Plain sentences about what this means for them. */
  readonly children: ReactNode;
  /** A requestId or digest worth quoting to an officer. Omitted when there is none. */
  readonly reference?: string | null;
  readonly actions: ReactNode;
}) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-[34rem] text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          {eyebrow}
        </p>
        <h1
          className="mt-3 text-[clamp(1.5rem,3.5vw,2rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h1>
        <div className="rule-glow mx-auto mt-5 w-24" aria-hidden="true" />

        <div className="mt-6 space-y-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {children}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{actions}</div>

        {reference === null || reference === undefined || reference === '' ? null : (
          <p className="mt-8 font-mono text-[11px] text-[var(--color-text-secondary)] opacity-70">
            {/*
              Quotable, and labelled as such. An unexplained hex string reads as debris; the same
              string introduced as a reference is the thing that gets somebody helped quickly.
            */}
            Reference <span className="text-[var(--color-text-primary)]">{reference}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** The two links every failure offers. Styled as the site's buttons, not as bare anchors. */
export const FAILURE_LINK =
  'rounded border border-[var(--color-border-hairline)] px-5 py-2.5 font-mono text-[12px] ' +
  'uppercase tracking-[0.24em] text-[var(--color-text-secondary)] transition-colors ' +
  'hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]';

export const FAILURE_LINK_PRIMARY =
  'rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] ' +
  'uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] transition-colors ' +
  'hover:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_12%,transparent)]';
