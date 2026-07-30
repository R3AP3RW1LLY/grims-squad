import { notFound } from 'next/navigation';
import { PageHeader, PageBody, Panel, RailStat } from '../../../../../components/hub-page';
import { getHubThread, getHubThreads, getThreadGrants, getMe } from '../../../../../lib/api';
import { formatLocal } from '../../../../../lib/time';
import { ThreadAccess } from './thread-access';
import { ReplyComposer } from './reply-composer';
import { ImageUploader } from '../../../../../components/image-uploader';
import { YouTubeConsent } from '../../../../../components/editor/youtube-consent';

/**
 * One thread, with its posts.
 *
 * ★ THE ACCESS PANEL IS FETCHED, NOT INFERRED ★
 *
 * Whether to show the grant controls is decided by ASKING the API: `getThreadGrants`
 * returns null for a caller who may not manage access, and the panel is simply not
 * rendered. Nothing here reasons about the caller's permissions.
 *
 * That matters because the alternative — shipping the mask to the browser and branching on
 * it — would put a copy of the authorisation rule in a place a member can edit. This way
 * the only thing the client knows is what the server chose to tell it, and every route the
 * panel calls re-checks server-side regardless.
 *
 * ★ THE POST BODIES ARE PRE-SANITISED, WHICH IS WHY THEY CAN BE EMBEDDED ★
 *
 * `bodyHtml` was sanitised BEFORE STORAGE (INV-035) and is served under a nonce CSP. The
 * same reasoning as the public guide pages: the guarantee lives at the write boundary so
 * every consumer inherits it, rather than each one re-implementing it and one forgetting.
 */

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ slug: string; threadSlug: string }>;
}) {
  const { slug, threadSlug } = await params;
  const data = await getHubThread(slug, threadSlug);

  /*
   * 404 for every reason it could be unavailable — absent, invisible, soft-deleted. The API
   * already answers RESOURCE_NOT_VISIBLE rather than 403 (INV-024), and rendering a distinct
   * "not allowed" page here would undo that by confirming the thread exists.
   */
  if (data === null) notFound();

  const { thread, posts } = data;
  const access = await getThreadGrants(thread.id);

  /*
   * ★ THE MEMBER'S STORED TIMEZONE, NEVER THE BROWSER'S ★
   *
   * This page first used `new Date(x).toLocaleString()`, and an existing guard rejected it.
   * Two things go wrong with that: the value is simply WRONG for anybody whose device is set
   * to another country, and it differs between server and client — so the timestamp changes
   * after hydration, which React reports as a mismatch and a reader sees as the page flickering
   * to a different time.
   *
   * `formatLocal` takes the zone explicitly, so the server renders what the client will.
   */
  const me = await getMe();
  const viewerTz = me.user?.timezone ?? 'UTC';

  /*
   * The category, for `canPost`. Fetched separately rather than added to the thread response: the
   * thread endpoint is @Public and shared with anonymous readers, and posting permission is a
   * question about the CALLER — mixing it in would make a cacheable public response depend on who
   * asked. Two cheap reads on a page that already does two.
   */
  const board = await getHubThreads(slug);

  return (
    <>
      {/*
        Turns a stored video placeholder into a player, but only on a click. The stored HTML
        contains no iframe at all — see `youtube-consent`. Renders nothing itself.
      */}
      <YouTubeConsent />

      <PageHeader
        eyebrow="FORUM"
        title={thread.title}
        subtitle={`Started by ${thread.author.displayName} · ${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`}
        action={
          <a
            href={`/forum/${slug}`}
            className="font-mono text-xs tracking-[0.2em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            &larr; BOARD
          </a>
        }
      />

      <PageBody
        rail={
          <>
            <Panel title="Thread">
              <RailStat label="Posts" value={String(thread.postCount)} />
              <RailStat
                label="Started"
                value={formatLocal(thread.createdAt, viewerTz, { withTime: false })}
              />
              {thread.isLocked && (
                /*
                 * Said plainly, and with the reason. A locked thread with no explanation reads
                 * as a bug — "why can't I reply" — and the answer here is deliberate: the
                 * guides are documentation, and questions belong where somebody will see them.
                 */
                <RailStat label="Locked" value="Read only" />
              )}
            </Panel>

            {access !== null && (
              <Panel title="Who can read this">
                <ThreadAccess threadId={thread.id} initialGrants={access.grants} />
              </Panel>
            )}

            {/*
              Shown to anybody who can post in this board. The upload endpoint re-checks the
              caller's permission server-side, so this is presentation only — but there is no
              point offering an uploader to somebody who has nowhere to put the result.
            */}
            <Panel title="Add a screenshot">
              <ImageUploader />
            </Panel>
          </>
        }
      >
        {thread.isLocked && (
          <div className="mb-8 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3">
            <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
              This thread is read-only. If something here is wrong or you are stuck on a step,
              post in the help board — somebody will see it there.
            </p>
          </div>
        )}

        <div className="space-y-8">
          {posts.map((post, i) => (
            <article
              key={post.id}
              id={`post-${i + 1}`}
              className="scroll-mt-24 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5"
            >
              <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border-hairline)] pb-3">
                <p className="text-sm text-[var(--color-text-primary)]">
                  {post.author.displayName}
                </p>
                <p className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                  {formatLocal(post.createdAt, viewerTz)}
                  {/*
                    Shown only when the server set `editedAt`. The grace window means a typo
                    fixed moments after posting is not flagged — a forum that flags that
                    teaches members to post twice instead of editing.
                  */}
                  {post.editedAt !== null && ' · edited'}
                </p>
              </header>

              <div
                /* Same scoped prose styling as the public guides, on existing tokens. */
                className="guide-prose"
                dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
              />
            </article>
          ))}
        </div>

        {/*
          The composer decides for itself whether to render controls — a locked thread or no
          posting permission gets an explanation instead of a disabled box. `canPost` comes from
          the server and is re-checked there on submit, so this is presentation only.
        */}
        <ReplyComposer threadId={thread.id} locked={thread.isLocked} canPost={board?.category.canPost ?? false} />
      </PageBody>
    </>
  );
}
