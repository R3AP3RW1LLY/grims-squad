'use client';

import { useState } from 'react';
import { apiGet } from '../../../../lib/api-client';
import type { AiConversation, AiConversationTurn } from '../../../../lib/api';
import { formatLocal } from '../../../../lib/time';

/**
 * The conversation list, with one expandable at a time.
 *
 * ★ TURNS ARE FETCHED WHEN OPENED, NOT UP FRONT ★
 *
 * A hundred conversations of six turns each is six hundred prompt-and-answer pairs, most of them
 * several hundred characters. Sending all of that to render a list nobody reads in full would make
 * the page slow in exactly the way that stops officers opening it.
 */
export function ConversationList({
  threads,
  /** The member's stored zone. Never the browser's — see the note on the page. */
  viewerTz,
}: {
  threads: AiConversation[];
  viewerTz: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [turns, setTurns] = useState<Record<string, AiConversationTurn[]>>({});
  const [loading, setLoading] = useState<string | null>(null);

  async function toggle(threadId: string): Promise<void> {
    if (open === threadId) {
      setOpen(null);
      return;
    }
    setOpen(threadId);
    if (turns[threadId] !== undefined) return;

    setLoading(threadId);
    try {
      const r = await apiGet<{ turns: AiConversationTurn[] }>(`/v1/ai/conversations/${threadId}`);
      setTurns((prev) => ({ ...prev, [threadId]: r.turns }));
    } catch {
      // Left unset, so the row shows "could not load" rather than an empty conversation — which
      // would read as a member who asked nothing.
      setTurns((prev) => ({ ...prev, [threadId]: [] }));
    } finally {
      setLoading(null);
    }
  }

  if (threads.length === 0) {
    return (
      <p className="mt-8 text-[var(--color-text-secondary)]">
        Nobody has asked GMSD AI anything yet. Conversations appear here as soon as they do.
      </p>
    );
  }

  return (
    <div className="mt-8 space-y-2">
      {threads.map((t) => (
        <div
          key={t.threadId}
          className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]"
        >
          <button
            type="button"
            onClick={() => void toggle(t.threadId)}
            className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 text-left"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)]">
              {t.displayName ?? 'Unknown member'}
            </span>
            <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">
              {t.opener}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
              {t.turns} {t.turns === 1 ? 'question' : 'questions'}
              {t.refusals > 0 && ` · ${t.refusals} declined`}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
              {formatLocal(t.lastAt, viewerTz)}
            </span>
          </button>

          {open === t.threadId && (
            <div className="border-t border-[var(--color-border-hairline)] px-5 py-4">
              {loading === t.threadId && (
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Loading…
                </p>
              )}
              {loading !== t.threadId &&
                (turns[t.threadId] ?? []).map((turn, i) => (
                  <div key={i} className="mb-5 last:mb-0">
                    <p className="text-[var(--color-text-primary)]">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-brand-cyan-bright)]">
                        Asked
                      </span>{' '}
                      {turn.prompt}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-[var(--color-text-secondary)]">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-brand-orange)]">
                        {turn.refusedReason === null ? 'Answered' : 'Declined'}
                      </span>{' '}
                      {/*
                        The refusal REASON is shown, not just the fact of one. "nothing retrieved"
                        and "over the hourly limit" are completely different problems — the first is
                        a gap in what we hold and worth acting on, the second is somebody scripting
                        it — and a single "declined" badge would hide which.
                      */}
                      {turn.refusedReason ?? turn.response ?? 'The assistant was unreachable.'}
                    </p>
                    <p className="mt-1 font-mono text-[10px] tabular-nums text-[var(--color-text-secondary)]">
                      {formatLocal(turn.createdAt, viewerTz)}
                      {turn.tookMs !== null && ` · ${(turn.tookMs / 1000).toFixed(1)}s`}
                    </p>
                  </div>
                ))}
              {loading !== t.threadId && (turns[t.threadId] ?? []).length === 0 && (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Could not load this conversation.
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
