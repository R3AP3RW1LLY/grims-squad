'use client';

import { useState } from 'react';
import type { GalnetArticle } from '@grims/ed-clients';

/**
 * GalNet headline ticker.
 *
 * ★ THE PAUSE BUTTON IS NOT OPTIONAL. ★
 * WCAG 2.2.2 (Pause, Stop, Hide) is a Level A requirement: any content that
 * moves automatically and runs for more than five seconds must have a way to
 * stop it. A marquee without one is one of the most common accessibility
 * failures on the web, and it is a real problem — moving text is unreadable for
 * many dyslexic readers and a vestibular trigger for others.
 *
 * So this pauses on hover, on keyboard focus, on click of an explicit control,
 * and does not animate at all under prefers-reduced-motion.
 *
 * The headlines are REAL, pulled from Frontier's own GalNet CMS. If the feed is
 * empty or unreachable the strip renders nothing rather than inventing news —
 * fake headlines on a page about a real game would be worse than no ticker.
 */
export function GalnetTicker({ articles }: { articles: readonly GalnetArticle[] }) {
  const [paused, setPaused] = useState(false);

  if (articles.length === 0) return null;

  // Duplicated so the strip can translate a full -50% and land exactly where it
  // started, giving a seamless loop. The copy is aria-hidden: a screen reader
  // announcing every headline twice is worse than useless.
  const run = [...articles, ...articles];

  return (
    <div
      // Already full-bleed: its parent is pinned inset-x-0 inside the hero
      // section, so no break-out transform is needed and the strip reaches both
      // viewport edges, where the mask fades it to nothing.
      className="galnet-ticker relative w-full"
      role="region"
      aria-label="GalNet news headlines"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <ul
        className="galnet-track m-0 flex list-none items-center gap-12 whitespace-nowrap p-0"
        style={{ animationPlayState: paused ? 'paused' : 'running' }}
      >
        {run.map((a, i) => (
          <li key={`${a.id}-${i}`} aria-hidden={i >= articles.length}>
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              // Only the first copy is reachable by keyboard; tabbing through
              // the same headlines twice is a trap-shaped nuisance.
              tabIndex={i >= articles.length ? -1 : 0}
              className="text-[13px] text-[var(--color-text-secondary)] no-underline transition-colors hover:text-[var(--color-brand-orange-bright)] focus-visible:text-[var(--color-brand-orange-bright)]"
            >
              <span className="mr-2 font-mono text-[10px] tracking-wider text-[var(--color-brand-cyan)]">
                {a.gameDate}
              </span>
              {a.title}
            </a>
          </li>
        ))}
      </ul>

      {/*
        WCAG 2.2.2 (Level A) — moving content that runs for more than five
        seconds needs a way to stop it. Hover and focus pause it too, but
        neither is available to someone on a touch screen using a screen
        reader, so the explicit control is the one that actually satisfies it.
      */}
      <button
        type="button"
        onClick={() => setPaused((v) => !v)}
        aria-pressed={paused}
        aria-label={paused ? 'Resume the news ticker' : 'Pause the news ticker'}
        className="absolute right-3 top-1/2 z-10 -translate-y-1/2 p-2 text-[var(--color-text-secondary)] opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      >
        <svg width="9" height="11" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
          {paused ? <path d="M0 0l10 6-10 6z" /> : <path d="M0 0h3v12H0zM7 0h3v12H7z" />}
        </svg>
      </button>
    </div>
  );
}
