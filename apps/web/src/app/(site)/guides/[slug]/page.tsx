import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicGuide } from '../../../../lib/api';
import { YouTubeConsent } from '../../../../components/editor/youtube-consent';

/**
 * One public guide.
 *
 * ★ THE `dangerouslySetInnerHTML` HERE IS THE INTENDED DESIGN, NOT A SHORTCUT ★
 *
 * `bodyHtml` was sanitised SERVER-SIDE BEFORE STORAGE (INV-035): markdown-it with
 * `html: false` so raw HTML is escaped rather than passed through, then sanitize-html
 * over the result with a small allowlist. What is in the database is already safe to
 * embed, and 55 tests in `sanitize.spec.ts` cover script tags, event handlers,
 * `javascript:` and `data:` URLs, SVG payloads and nested encodings.
 *
 * The alternative — sanitising at render time — is what the invariant explicitly
 * rejects, because "we escape on output" holds only while every output path remembers
 * to, and there will be several: this page, the hub, search, the Discord bridge, RAG.
 * The second consumer is the one that forgets.
 *
 * So the safety property lives at the write boundary, and this page is one of the
 * consumers that inherits it rather than one that re-implements it.
 */

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicGuide(slug);
  if (data === null) return { title: "Guide — Grim's Squad" };
  return {
    title: `${data.thread.title} — Grim's Squad`,
    description: `A step-by-step guide from Grim's Squad: ${data.thread.title}.`,
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicGuide(slug);

  /*
   * A 404 for every reason it could be unavailable — absent, not public, or the API
   * being unreachable. The API already answers `RESOURCE_NOT_VISIBLE` rather than 403
   * for a thread the caller may not see (INV-024), and rendering a distinct "you are not
   * allowed" page here would undo that by confirming the guide exists.
   */
  if (data === null) notFound();

  return (
    <article className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
      {/*
        Turns a stored video placeholder into a player, but only on a click. The stored HTML
        contains no iframe at all — see `youtube-consent`. Renders nothing itself.
      */}
      <YouTubeConsent />

      <nav aria-label="Breadcrumb" className="mb-8">
        <a
          href="/guides"
          className="font-mono text-xs tracking-[0.2em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          &larr; ALL GUIDES
        </a>
      </nav>

      <header className="mb-10 border-b border-[var(--color-border-hairline)] pb-6">
        <h1
          className="text-3xl leading-tight tracking-wide text-[var(--color-text-primary)] sm:text-4xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {data.thread.title}
        </h1>
      </header>

      <div className="space-y-10">
        {data.posts.map((post, i) => (
          <section
            key={post.id}
            /*
             * Each post is a section with its own anchor, so somebody in Discord can
             * link a new commander straight to the step they are stuck on rather than
             * to the top of a long page.
             */
            id={`section-${i + 1}`}
            className="scroll-mt-24"
          >
            <div
              /*
               * `guide-prose` carries the typography for server-rendered HTML we did not
               * write element by element. Tailwind's utility classes cannot reach inside
               * an innerHTML blob, so the styling is a descendant selector in globals.css
               * scoped to this one class.
               */
              className="guide-prose"
              dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
            />
          </section>
        ))}
      </div>

      <footer className="mt-16 border-t border-[var(--color-border-hairline)] pt-6">
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Something in this guide wrong or out of date? Tell us in Discord — we would
          rather fix it than have the next commander hit the same wall.
        </p>
      </footer>
    </article>
  );
}
