import type { ReactNode } from 'react';

/**
 * Shared shell for the policy pages.
 *
 * These are read by people deciding whether to hand us their Discord identity,
 * so they are set at a comfortable reading measure with real heading hierarchy
 * rather than squeezed into the dense instrument styling the rest of the site
 * uses. A privacy policy nobody can read is a privacy policy nobody read.
 */
export function LegalPage({
  title,
  updated,
  version,
  summary,
  children,
}: {
  title: string;
  updated: string;
  version: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-16">
      <div className="mx-auto max-w-[72ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          Grim&rsquo;s Squad Hub
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,5vw,3.25rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        <p className="mt-6 font-mono text-[11px] tracking-[0.2em] text-[var(--color-text-secondary)]">
          VERSION {version} · UPDATED {updated}
        </p>

        {/* The plain-English summary sits ABOVE the detail deliberately. Most
            people will read only this, and they are entitled to an honest
            version rather than a reassuring one. */}
        <div className="hud panel mt-8 p-6">
          <h2
            className="text-sm tracking-[0.2em] text-[var(--color-brand-cyan-bright)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            IN SHORT
          </h2>
          <p className="mt-3 text-[var(--color-text-primary)]">{summary}</p>
        </div>

        <div className="legal-prose mt-12">{children}</div>
      </div>
    </main>
  );
}

export function Section({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2
        id={id}
        className="text-xl text-[var(--color-brand-orange-bright)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {heading}
      </h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}
