import type { Metadata } from 'next';
import { getPublicBoardThreads } from '../../../lib/api';

/**
 * The public recruiting index.
 *
 * ★ WHY THIS SITS IN `(site)` AND NOT IN THE HUB ★
 *
 * Squadron owner, 2026-07-30: "add a category to the forums called Recruiting please, this should
 * be a publically visible category please like the Guides are".
 *
 * The `(hub)` route group redirects anybody without a session to sign in. Recruitment copy behind
 * a login is recruitment nobody is recruited by — the reader this page exists for is precisely the
 * one who has not joined. So it lives here and fetches with NO credentials, which means what it can
 * render is by construction exactly what an anonymous visitor may see.
 *
 * Being a public BOARD does not make its threads public: `is_public` defaults to false, so a post
 * is drafted privately and published on purpose. Members see drafts on `/forum/recruiting`; this
 * page only ever sees what was explicitly published.
 */

export const metadata: Metadata = {
  title: "Recruiting — Grim's Squad",
  description:
    "Who we are, who we are looking for, and how to join Grim's Squad — an Elite Dangerous squadron.",
};

/*
 * ★ FORCED DYNAMIC, FOR THE REASON THE GUIDES PAGE LEARNED THE HARD WAY ★
 *
 * The shared `get()` helper fetches with `cache: 'no-store'`, and a `no-store` fetch inside a route
 * asking to be statically revalidated cannot be satisfied — it 500s with `DYNAMIC_SERVER_USAGE` in
 * production while rendering perfectly in dev, because `next dev` does not attempt static
 * generation the same way.
 */
export const dynamic = 'force-dynamic';

export default async function RecruitingIndex() {
  const posts = await getPublicBoardThreads('recruiting');

  return (
    <div className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
      <header className="mb-10">
        <p
          className="font-mono text-xs tracking-[0.3em] text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          RECRUITING
        </p>
        <h1
          className="mt-3 text-3xl tracking-wide text-[var(--color-text-primary)] sm:text-4xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Fly with us
        </h1>
        <p className="mt-4 max-w-[62ch] leading-relaxed text-[var(--color-text-secondary)]">
          Grim&rsquo;s Squad flies out of Alrai under the Blood Brothers. Below is what we do, who
          we are looking for, and what joining involves &mdash; and the{' '}
          <a
            href="/guides"
            className="text-[var(--color-brand-cyan-bright)] underline underline-offset-2"
          >
            joining guide
          </a>{' '}
          walks through the steps one at a time.
        </p>
      </header>

      {posts.length === 0 ? (
        /*
         * Reached either because nothing is published or because the API is briefly unreachable —
         * `getPublicBoardThreads` returns an empty list for both, so this message has to be true of
         * both. It offers the next step rather than guessing which case it is.
         */
        <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6">
          <p className="text-[var(--color-text-primary)]">
            Nothing is posted here at the moment.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            The{' '}
            <a
              href="/guides"
              className="text-[var(--color-brand-cyan-bright)] underline underline-offset-2"
            >
              joining guide
            </a>{' '}
            covers everything you need, or ask in our Discord and somebody will walk you through it.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
          {posts.map((p) => (
            <li key={p.id}>
              <a
                href={`/recruiting/${p.slug}`}
                className="block h-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5 transition-colors hover:border-[var(--color-border-active)] hover:bg-[var(--color-surface-panel-hover)]"
              >
                <h2 className="text-lg leading-snug text-[var(--color-text-primary)]">{p.title}</h2>
                <p className="mt-3 font-mono text-xs tracking-wide text-[var(--color-text-secondary)]">
                  {/* Sections, not "posts" — the reader does not care how it is stored. */}
                  {p.postCount} {p.postCount === 1 ? 'section' : 'sections'}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
