import { notFound } from 'next/navigation';
import { badgeDisplay, type BadgeDisplay } from '@grims/shared';
import { PageHeader, PageBody, Panel, RailStat } from '../../../../../components/hub-page';
import {
  getHubThread,
  getHubThreads,
  getThreadGrants,
  getMe,
  getThreadSubscription,
  getDmPreferences,
} from '../../../../../lib/api';
import { formatLocal } from '../../../../../lib/time';
import { ThreadAccess } from './thread-access';
import { Conversation } from './conversation';
import { NotifyMe } from './notify-me';
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

  const { thread, posts, signatures, identities } = data;
  const access = await getThreadGrants(thread.id);

  /*
   * ★ BADGE KEYS ARE RESOLVED HERE, ON THE SERVER ★
   *
   * The thread response carries up to three showcased badge KEYS per author; what a key looks
   * like lives in the shared catalogue. `Conversation` is a client component, and a client bundle
   * may not import runtime values from the `@grims/shared` barrel — it drags in `node:crypto` and
   * fails the build (see client-imports.spec.ts) — so the lookup happens here and the chips travel
   * as resolved display data. A key the catalogue no longer knows resolves to null and is dropped
   * silently: an old award is not worth an "unknown badge" chip on somebody's post.
   */
  const badges: Record<string, BadgeDisplay[]> = {};
  for (const [authorId, keys] of Object.entries(data.badges ?? {})) {
    const resolved = keys
      .slice(0, 3)
      .map((key) => badgeDisplay(key))
      .filter((b): b is BadgeDisplay => b !== null);
    if (resolved.length > 0) badges[authorId] = resolved;
  }

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

  /*
   * The follow state and the DM preference, fetched together. Both are per-caller and neither is
   * cacheable, so they ride alongside the thread read rather than being fetched by the button after
   * it mounts — a button that renders "Notify me" and then flips to "Notifying you" is a button
   * that looked wrong for a moment.
   */
  const [subscription, dmPrefs] = await Promise.all([
    getThreadSubscription(thread.id),
    getDmPreferences(),
  ]);

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
            <Panel title="Follow">
              <NotifyMe
                threadId={thread.id}
                initialLevel={subscription?.level ?? 'none'}
                dmEnabled={dmPrefs?.notifyDmWatched ?? false}
              />
            </Panel>

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

        {/*
          Posts and composer together, as one client island. "Reply to this post" and "Quote this
          post" are messages from a post TO the composer, and splitting them would mean inventing a
          channel for something React already models as state. The bodies are still the server's
          pre-sanitised HTML, unchanged.
        */}
        <Conversation
          posts={posts}
          viewerTz={viewerTz}
          threadId={thread.id}
          locked={thread.isLocked}
          canPost={board?.category.canPost ?? false}
          /* Server-decided. See `ThreadView.canMarkSolution` for why it is not computed here. */
          canMarkSolution={thread.canMarkSolution}
          boardSlug={slug}
          threadSlug={threadSlug}
          signatures={signatures}
          identities={identities}
          badges={badges}
        />
      </PageBody>
    </>
  );
}
