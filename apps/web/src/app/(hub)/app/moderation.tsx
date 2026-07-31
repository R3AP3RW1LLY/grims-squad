'use client';

import { useState } from 'react';
import { apiPut } from '../../../lib/api-client';
import type { HeldPostRow } from '../../../lib/api';
import { AiLogPanel } from './ai-log';

/**
 * The moderation queue.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "ensure that there is a full moderation suite built into a new tab on the /app page please. only
 * visible to admins."
 *
 * ★ WHY THIS TAB IS NOT OPTIONAL ★
 *
 * Screening already runs on every post and already holds the ones it objects to. Without this
 * screen those posts accumulate somewhere nobody can see, their authors are told "an officer will
 * look" and no officer can, and the feature is worse than not having it. The queue existing is what
 * makes the promise true.
 *
 * ★ TWO REASONS A POST IS HERE, AND THEY NEED DIFFERENT ATTENTION ★
 *
 * `flagged` means the model objected — read it properly, the categories say what it objected to.
 * `unavailable` means the screener could not be reached and NOBODY has judged this post. Those are
 * sorted into separate groups rather than one list, because forty posts held by a GPU being off is
 * a completely different afternoon from forty the model flagged, and mixing them buries the second
 * kind inside the first.
 */

interface Props {
  readonly initial: readonly HeldPostRow[];
  readonly total: number;
  readonly health: {
    text: { configured: boolean; reachable: boolean; model: string | null };
    image: { configured: boolean; reachable: boolean };
  } | null;
}

type Settled = { readonly id: string; readonly decision: 'release' | 'refuse' };

export function Moderation({ initial, total, health }: Props) {
  /*
   * Decided posts are REMEMBERED, not removed. A row that vanishes the instant it is clicked gives
   * an officer no confirmation that the right one went, and no way to notice they hit the wrong
   * button — which on a refusal is somebody's post deleted by accident.
   */
  const [settled, setSettled] = useState<Settled[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decisionFor = (id: string): 'release' | 'refuse' | null =>
    settled.find((s) => s.id === id)?.decision ?? null;

  async function decide(post: HeldPostRow, decision: 'release' | 'refuse') {
    setBusy(post.id);
    setError(null);
    try {
      await apiPut(`/v1/forum/review/held/${post.id}`, { decision });
      setSettled((prev) => [...prev, { id: post.id, decision }]);
    } catch (e) {
      /*
       * The server's own message, not a generic one. The likeliest failure here is two officers
       * working the queue at once — "that post is not waiting for review" tells them exactly what
       * happened, where "something went wrong" starts a bug report.
       */
      setError(e instanceof Error ? e.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }

  const outstanding = initial.filter((p) => decisionFor(p.id) === null);
  const flagged = outstanding.filter((p) => p.reason === 'flagged');
  const unjudged = outstanding.filter((p) => p.reason === 'unavailable');

  return (
    <div className="space-y-10">
      <Health health={health} />

      {error !== null && (
        <p
          role="alert"
          className="rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {error}
        </p>
      )}

      {outstanding.length === 0 ? (
        <Empty settledCount={settled.length} total={total} />
      ) : (
        <>
          <Group
            title="The screener objected"
            hint="Read these properly. The categories say what it objected to — it is often wrong, and a false alarm costs a member's goodwill."
            posts={flagged}
            busy={busy}
            onDecide={decide}
          />
          <Group
            title="Nobody has judged these"
            hint="The screener could not be reached when they were posted, so no verdict exists. Usually fine and just needs a glance."
            posts={unjudged}
            busy={busy}
            onDecide={decide}
          />
        </>
      )}

      {settled.length > 0 && (
        <section>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Decided just now
          </h3>
          <ul className="mt-3 space-y-1 text-sm text-[var(--color-text-secondary)]">
            {settled.map((s) => {
              const post = initial.find((p) => p.id === s.id);
              return (
                <li key={s.id}>
                  <span
                    className={
                      s.decision === 'release'
                        ? 'text-[var(--color-brand-cyan-bright)]'
                        : 'text-[var(--color-brand-orange)]'
                    }
                  >
                    {s.decision === 'release' ? 'Published' : 'Refused'}
                  </span>{' '}
                  — {post?.threadTitle ?? 'a post'} by {post?.authorName ?? 'a member'}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
            Reload to refresh the queue.
          </p>
        </section>
      )}

      <AiLogPanel />
    </div>
  );
}

/**
 * Whether the AI is actually answering.
 *
 * ★ REPORTED PER RUNTIME, AND THAT IS THE POINT ★
 *
 * Screening and artwork run on two different graphics cards and fail independently. The normal
 * state on an evening when somebody is playing is text up, image busy. A single "AI: ok/down" would
 * be wrong most nights and would send an officer looking for a fault that is somebody flying.
 *
 * It also answers the question this tab raises: a pile of unjudged posts means the screener was
 * unreachable, and this says whether it still is.
 */
function Health({ health }: { health: Props['health'] }) {
  if (health === null) return null;

  const rows = [
    { label: 'Screening & assistant', s: health.text, extra: health.text.model },
    { label: 'Artwork', s: health.image, extra: null },
  ];

  return (
    <section className="rounded border border-[var(--color-border-hairline)] p-5">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
        AI services
      </h3>
      <ul className="mt-3 space-y-2">
        {rows.map(({ label, s, extra }) => (
          <li key={label} className="flex items-baseline gap-3 text-sm">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 rounded-full ${
                !s.configured
                  ? 'bg-[var(--color-text-secondary)]'
                  : s.reachable
                    ? 'bg-[var(--color-brand-cyan-bright)]'
                    : 'bg-[var(--color-brand-orange)]'
              }`}
            />
            <span className="text-[var(--color-text-primary)]">{label}</span>
            <span className="text-[var(--color-text-secondary)]">
              {!s.configured ? 'not switched on' : s.reachable ? 'answering' : 'not reachable'}
              {extra !== null && extra !== '' && s.reachable ? ` — ${extra}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {health.text.configured && !health.text.reachable && (
        /*
         * Said plainly, because it changes what an officer should DO. While the screener is
         * unreachable every new post lands in the second group below rather than being published,
         * and that backlog is not anybody misbehaving.
         */
        <p className="mt-4 text-sm text-[var(--color-brand-orange)]">
          While this is unreachable, every new post is held for review rather than published.
        </p>
      )}
    </section>
  );
}

function Empty({ settledCount, total }: { settledCount: number; total: number }) {
  return (
    <section className="rounded border border-[var(--color-border-hairline)] p-8 text-center">
      <p className="text-lg text-[var(--color-text-primary)]">
        {settledCount > 0 ? 'Queue cleared.' : 'Nothing is waiting.'}
      </p>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        {settledCount > 0
          ? `You handled ${settledCount} ${settledCount === 1 ? 'post' : 'posts'}.`
          : total > 0
            ? 'Everything held has been dealt with.'
            : 'Posts appear here when the screener objects, or when it cannot be reached.'}
      </p>
    </section>
  );
}

function Group({
  title,
  hint,
  posts,
  busy,
  onDecide,
}: {
  title: string;
  hint: string;
  posts: readonly HeldPostRow[];
  busy: string | null;
  onDecide: (p: HeldPostRow, d: 'release' | 'refuse') => void;
}) {
  if (posts.length === 0) return null;

  return (
    <section>
      <h3 className="text-[var(--color-brand-orange)]" style={{ fontFamily: 'var(--font-display)' }}>
        {title.toUpperCase()}{' '}
        <span className="font-mono text-sm text-[var(--color-text-secondary)]">
          ({posts.length})
        </span>
      </h3>
      <p className="mt-2 max-w-[70ch] text-sm text-[var(--color-text-secondary)]">{hint}</p>

      <ul className="mt-5 space-y-5">
        {posts.map((post) => (
          <li
            key={post.id}
            className="rounded border border-[var(--color-border-hairline)] p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <a
                  href={`/forum/${post.categorySlug}/${post.threadId}`}
                  className="text-[var(--color-brand-cyan-bright)] hover:underline"
                >
                  {post.threadTitle}
                </a>
                <p className="mt-1 font-mono text-xs text-[var(--color-text-secondary)]">
                  {post.authorName} · {new Date(post.createdAt).toLocaleString('en-GB')}
                </p>
              </div>
              {post.categories.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {post.categories.map((c) => (
                    <li
                      key={c}
                      className="rounded border border-[var(--color-brand-orange)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-brand-orange)]"
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/*
              The post itself, in full.
              A moderation queue that shows an excerpt makes people click through to decide, and
              somebody deciding without reading is the failure this whole feature exists to avoid.
              Already sanitised before storage (INV-035) — this is the same HTML a reader sees.
            */}
            <div
              className="prose-forum mt-4 max-w-none border-l-2 border-[var(--color-border-hairline)] pl-4 text-[var(--color-text-primary)]"
              dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
            />

            {post.modelReason !== null && (
              <p className="mt-4 border-l-2 border-[var(--color-brand-orange)] pl-4 text-sm italic text-[var(--color-text-secondary)]">
                {/*
                  The model's words, shown ONLY here. The author is never told which category fired
                  — naming it teaches anybody determined exactly which wording gets through.
                */}
                “{post.modelReason}”
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => onDecide(post, 'release')}
                className="rounded border border-[var(--color-brand-cyan-bright)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
              >
                {busy === post.id ? 'Working…' : 'Publish it'}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => onDecide(post, 'refuse')}
                className="rounded border border-[var(--color-brand-orange)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)] disabled:opacity-50"
              >
                Refuse it
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
