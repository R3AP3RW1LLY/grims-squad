import type { Metadata } from 'next';
import { getPublicGuides } from '../../../lib/api';

/**
 * The public guides index.
 *
 * ★ WHY A PUBLIC ROUTE AND NOT THE HUB'S FORUM PAGE ★
 *
 * Squadron owner, 2026-07-29: "when a post is public in guides it should be publically
 * visible on the website homepage navbar".
 *
 * `/forum` lives in the `(hub)` route group, which redirects anybody without a session
 * to sign in. So the existing "Comms" nav link sent a prospective member to a login
 * wall — including for the guides board, which is the one board deliberately readable
 * by the public, and whose entire purpose is being read by people who have not joined
 * yet. A joining guide behind a login is a joining guide nobody can use.
 *
 * These pages therefore sit in `(site)` and fetch with NO credentials, so what they can
 * render is by construction exactly what an anonymous visitor may see.
 */

export const metadata: Metadata = {
  title: "Guides — Grim's Squad",
  description:
    "Step-by-step guides for joining Grim's Squad, setting up Inara, and using the companion app.",
};

/*
 * ★ FORCED DYNAMIC, AND WHY ISR WAS WRONG HERE ★
 *
 * These pages first declared `export const revalidate = 300`, reasoning that guides change
 * rarely. In production that 500'd with `DYNAMIC_SERVER_USAGE`, and the contradiction is real:
 * the shared `get()` helper in `lib/api.ts` fetches with `cache: 'no-store'` — deliberately,
 * because a cached response could show a member who has just opted OUT of the roster — and a
 * `no-store` fetch inside a route that asks to be statically revalidated cannot be satisfied.
 *
 * Dev never surfaced it: `next dev` does not attempt static generation the same way, so the
 * page rendered perfectly on localhost and failed on the first real request.
 *
 * Rendering per request is the right answer anyway. The API is on the same host, the query is
 * one indexed read, and it means a guide edit is live immediately rather than up to five
 * minutes later — which matters when somebody is following the steps and an officer is fixing
 * a wrong one.
 */
export const dynamic = 'force-dynamic';

export default async function GuidesIndex() {
  const guides = await getPublicGuides();

  return (
    <div className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
      <header className="mb-10">
        <p
          className="font-mono text-xs tracking-[0.3em] text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          SQUADRON GUIDES
        </p>
        <h1
          className="mt-3 text-3xl tracking-wide text-[var(--color-text-primary)] sm:text-4xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Getting started
        </h1>
        <p className="mt-4 max-w-[62ch] leading-relaxed text-[var(--color-text-secondary)]">
          Everything you need to join Grim&rsquo;s Squad and get set up, written for
          commanders who have never used any of these tools before. Work through the
          joining guide in order and each step will have what it needs.
        </p>
      </header>

      {guides.length === 0 ? (
        /*
         * Reached either because nothing is published or because the API is briefly
         * unreachable — `getPublicGuides` returns an empty list for both, so this
         * message must be true of both. It says where to go instead rather than
         * guessing which case it is.
         */
        <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6">
          <p className="text-[var(--color-text-primary)]">
            No guides are published right now.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Ask in our Discord and somebody will walk you through joining directly.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
          {guides.map((g) => (
            <li key={g.id}>
              <a
                href={`/guides/${g.slug}`}
                className="block h-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5 transition-colors hover:border-[var(--color-border-active)] hover:bg-[var(--color-surface-panel-hover)]"
              >
                <h2 className="text-lg leading-snug text-[var(--color-text-primary)]">
                  {g.title}
                </h2>
                <p className="mt-3 font-mono text-xs tracking-wide text-[var(--color-text-secondary)]">
                  {/* Steps, not "posts" — the reader does not care how it is stored. */}
                  {g.postCount} {g.postCount === 1 ? 'section' : 'sections'}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
