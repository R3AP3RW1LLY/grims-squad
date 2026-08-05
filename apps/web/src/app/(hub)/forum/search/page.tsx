import { PageHeader, PageBody, Panel, RailStat } from '../../../../components/hub-page';
import { getForumSearch } from '../../../../lib/api';

/**
 * Forum search (P2.5).
 *
 * ★ THE PAGE DOES NO FILTERING, AND THAT IS THE INVARIANT ★
 *
 * INV-024 requires the ACL to be applied IN THE QUERY. So this renders whatever the API returned
 * and counts nothing itself — a page that filtered or re-counted would be a second answer to "what
 * may this caller see", and the second answer is the one that drifts.
 *
 * The snippets arrive already escaped and already marked up: `renderSnippet` escapes the member's
 * text and only then converts the highlight markers to `<mark>`. That ordering has to happen
 * exactly once, so it happens on the server where there is one implementation of it.
 */

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params['q'];
  const query = typeof raw === 'string' ? raw : '';

  const data = query.trim().length >= 3 ? await getForumSearch(query) : null;

  return (
    <>
      <PageHeader
        eyebrow="FORUM"
        title="Search"
        subtitle="Everything you can see, and nothing you cannot."
        action={
          <a
            href="/forum"
            className="font-mono text-xs tracking-[0.2em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            &larr; ALL BOARDS
          </a>
        }
      />

      <PageBody
        rail={
          <Panel title="Results">
            <RailStat label="Matches" value={data === null ? '—' : String(data.result.total)} />
            {/*
              The total is the API's, over the SAME filtered set it returned rows from. Recomputing
              it here from `hits.length` would show the page size rather than the match count — and
              deriving it any other way would be the disclosure INV-024 names first.
            */}
          </Panel>
        }
      >
        {/*
          A GET form. Search results should be linkable and shareable, and the query belongs in the
          URL where the back button can reach it.
        */}
        <form method="GET" action="/forum/search" className="mb-8 flex flex-wrap gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search the boards you can see"
            aria-label="Search the forum"
            className="min-w-[16rem] flex-1 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          />
          <button
            type="submit"
            className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)]"
          >
            Search
          </button>
        </form>

        {data === null ? (
          <Panel>
            <p className="text-[var(--color-text-primary)]">
              {query.trim() === '' ? 'What are you looking for?' : 'Type at least three characters.'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {/*
                Said plainly rather than left to be discovered: a search that silently returns
                nothing on a two-letter query reads as "there is nothing here".
              */}
              Two letters would match most of the forum, which is no more useful than no search at
              all.
            </p>
          </Panel>
        ) : data.result.hits.length === 0 ? (
          <Panel>
            <p className="text-[var(--color-text-primary)]">
              Nothing matches &ldquo;{query}&rdquo;.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {/*
                Deliberately does NOT say "or you cannot see it". That sentence would tell somebody
                the thing exists, which is precisely what INV-024 exists to prevent — the wording of
                an empty state is part of the invariant, not decoration around it.
              */}
              Try a different word, or fewer of them.
            </p>
          </Panel>
        ) : (
          <ul className="space-y-4">
            {data.result.hits.map((hit, i) => (
              <li key={hit.postId}>
                <a
                  href={`/forum/${hit.categorySlug}/${hit.threadSlug}`}
                  className="block rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4 transition-colors hover:border-[var(--color-border-active)] hover:bg-[var(--color-surface-panel-hover)]"
                >
                  <p className="text-[var(--color-text-primary)]">{hit.threadTitle}</p>
                  <p
                    className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)] [&_mark]:bg-transparent [&_mark]:text-[var(--color-brand-cyan-bright)]"
                    /*
                      Pre-escaped by the server, with only <mark> added afterwards. This is the same
                      write-boundary guarantee as post bodies: nothing here re-escapes or trusts, it
                      embeds what the server produced.
                    */
                    dangerouslySetInnerHTML={{ __html: data.snippets[i] ?? '' }}
                  />
                  <p className="mt-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {hit.categorySlug} &middot; {hit.authorHandle}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
