'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../../lib/api-client';
import type { SupportConsoleRow } from '../../../lib/api';
import { formatLocal } from '../../../lib/time';
import { useLiveEvent } from '../../../components/use-live-event';

/**
 * The support console — the answering side of the help chat.
 *
 * ★ ONE SHARED QUEUE ★
 *
 * Every conversation, member or guest, lands here for any SUPPORT_AGENT holder to take.
 * "Unread" means no officer has opened it since the last message — the queue's promise is that
 * somebody answers, not that a particular somebody does. Opening a conversation marks it seen
 * for everyone, which is what stops two officers answering the same question at once.
 *
 * Replies go out under the replying officer's own name and Discord avatar — the owner's
 * explicit ask. There is no anonymous voice here; the only unsigned lines are the `system`
 * ones the room writes when a conversation is closed or reopened.
 *
 * Times are absolute and in the OFFICER's stored timezone (INV-025) — a queue is worked
 * against a clock, and "4m ago" hides the conversation that has been waiting since yesterday.
 */

interface ConsoleMessage {
  readonly id: string;
  readonly authorKind: 'member' | 'officer' | 'guest' | 'ai' | 'system';
  readonly author: { readonly id: string; readonly displayName: string } | null;
  readonly body: string;
  readonly attachmentPath: string | null;
  readonly createdAt: string;
}

interface ConsoleTranscript {
  readonly conversation: SupportConsoleRow;
  readonly messages: readonly ConsoleMessage[];
}

const MAX_CHARS = 4000;

export function Support({
  initial,
  viewerTz,
}: {
  readonly initial: readonly SupportConsoleRow[];
  readonly viewerTz: string;
}) {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [rows, setRows] = useState<readonly SupportConsoleRow[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ConsoleTranscript | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const loadList = useCallback(
    (which: 'open' | 'closed' = status) => {
      apiGet<{ conversations: SupportConsoleRow[] }>(
        `/v1/support/console/conversations?status=${which}`,
      )
        .then((r) => setRows(r.conversations))
        .catch(() => {
          // The list retries on the next event; a transient miss must not blank the queue.
        });
    },
    [status],
  );

  const loadTranscript = useCallback((id: string) => {
    apiGet<ConsoleTranscript>(`/v1/support/console/conversations/${id}`)
      .then(setTranscript)
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'That conversation could not be opened.');
        setActiveId(null);
      });
  }, []);

  useEffect(() => {
    if (activeId !== null) loadTranscript(activeId);
    else setTranscript(null);
  }, [activeId, loadTranscript]);

  // The same coarse event the widget hears. New message anywhere: re-read what is on screen.
  useLiveEvent('support', () => {
    loadList();
    if (activeId !== null) loadTranscript(activeId);
  });

  const waiting = rows.filter((r) => r.unread).length;

  if (activeId !== null && transcript !== null) {
    return (
      <ConsoleConversation
        transcript={transcript}
        viewerTz={viewerTz}
        onBack={() => {
          setActiveId(null);
          loadList();
        }}
        onChanged={() => {
          loadTranscript(activeId);
          loadList();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {(['open', 'closed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => {
              setStatus(s);
              loadList(s);
            }}
            className={`rounded border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] ${
              status === s
                ? 'border-[var(--color-brand-orange)] text-[var(--color-brand-orange)]'
                : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {s === 'open' ? 'Open' : 'Closed'}
          </button>
        ))}
        {status === 'open' ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            {waiting === 0
              ? 'Everything open has been seen.'
              : `${waiting} waiting for a first look.`}
          </p>
        ) : null}
      </div>

      {problem !== null && (
        <p
          role="alert"
          className="rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {problem}
        </p>
      )}

      {rows.length === 0 ? (
        <section className="rounded border border-[var(--color-border-hairline)] p-8 text-center">
          <p className="text-lg text-[var(--color-text-primary)]">
            {status === 'open' ? 'Nothing is waiting.' : 'Nothing has been closed yet.'}
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            {status === 'open'
              ? 'Conversations appear here the moment anybody — member or guest — asks for help.'
              : 'Closed conversations keep their transcripts here.'}
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => {
                  setProblem(null);
                  setActiveId(row.id);
                }}
                className="w-full rounded border border-[var(--color-border-hairline)] p-4 text-left transition-colors hover:bg-[var(--color-surface-panel-hover)]"
              >
                <span className="flex flex-wrap items-baseline gap-2">
                  {row.unread ? (
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 self-center rounded-full bg-[var(--color-brand-orange)]"
                    />
                  ) : null}
                  <span className="text-sm text-[var(--color-text-primary)]">
                    {row.subject ?? row.preview}
                  </span>
                  <RequesterBadge requester={row.requester} />
                  <span className="ml-auto font-mono text-xs text-[var(--color-text-secondary)]">
                    {formatLocal(row.lastMessageAt, viewerTz)}
                  </span>
                </span>
                <span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">
                  {row.preview}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Guest and member are labelled apart — a guest cannot be looked up, DMed or ranked.
 *
 * A member wears their Discord identity: stored avatar beside the display name, so an officer
 * knows AT A GLANCE which member they are talking to before opening a single message. A guest
 * wears the commander name they typed, and nothing pretends it is more than that.
 */
function RequesterBadge({ requester }: { requester: SupportConsoleRow['requester'] }) {
  return requester.kind === 'guest' ? (
    <span className="rounded border border-[var(--color-border-hairline)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
      Guest · {requester.name}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded border border-[var(--color-brand-cyan)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-brand-cyan-bright)]">
      <img
        src={`/v1/media/avatars/${requester.id}`}
        alt=""
        className="h-4 w-4 rounded-full object-cover"
        onError={(e) => {
          // No stored avatar answers 404 by design; the name still identifies them.
          e.currentTarget.style.display = 'none';
        }}
      />
      Member · {requester.displayName}
    </span>
  );
}

function ConsoleConversation({
  transcript,
  viewerTz,
  onBack,
  onChanged,
}: {
  transcript: ConsoleTranscript;
  viewerTz: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { conversation, messages } = transcript;
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ id: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const count = messages.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  const act = (run: () => Promise<unknown>): void => {
    setBusy(true);
    setProblem(null);
    run()
      .then(() => onChanged())
      .catch((err: unknown) => {
        // The server's own sentence — "already closed" from a colleague's race is actionable,
        // "something went wrong" starts a bug report.
        setProblem(err instanceof Error ? err.message : 'That did not go through.');
      })
      .finally(() => setBusy(false));
  };

  const reply = (): void =>
    act(async () => {
      await apiPost(`/v1/support/console/conversations/${conversation.id}/messages`, {
        body,
        ...(attachment === null ? {} : { attachmentId: attachment.id }),
      });
      setBody('');
      setAttachment(null);
    });

  const attach = (file: File): void => {
    if (file.size > 8 * 1024 * 1024) {
      setProblem('That image is over 8 MB. Crop or resize it, then attach it again.');
      return;
    }
    setUploading(true);
    setProblem(null);
    fetch('/v1/media/uploads', {
      method: 'POST',
      body: file,
      headers: {
        'content-type': file.type === '' ? 'application/octet-stream' : file.type,
        'x-csrf-token': readCsrf(),
      },
      credentials: 'same-origin',
    })
      .then(async (res) => {
        const parsed = (await res.json()) as {
          id?: string;
          path?: string;
          error?: { message?: string };
        };
        if (!res.ok || typeof parsed.id !== 'string' || typeof parsed.path !== 'string') {
          throw new Error(parsed.error?.message ?? 'That image could not be uploaded.');
        }
        setAttachment({ id: parsed.id, path: parsed.path });
      })
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'That image could not be uploaded.');
      })
      .finally(() => setUploading(false));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          ← All conversations
        </button>
        <RequesterBadge requester={conversation.requester} />
        <span className="font-mono text-xs text-[var(--color-text-secondary)]">
          Started {formatLocal(conversation.createdAt, viewerTz)}
        </span>
        <div className="ml-auto flex gap-2">
          {conversation.status === 'open' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(() => apiPatch(`/v1/support/console/conversations/${conversation.id}/close`))
              }
              className="rounded border border-[var(--color-brand-orange)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)] disabled:opacity-50"
            >
              Close it
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(() => apiPatch(`/v1/support/console/conversations/${conversation.id}/reopen`))
              }
              className="rounded border border-[var(--color-brand-cyan-bright)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
            >
              Reopen it
            </button>
          )}
        </div>
      </div>

      {conversation.subject !== null && (
        <h3 className="text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
          {conversation.subject.toUpperCase()}
        </h3>
      )}

      {problem !== null && (
        <p
          role="alert"
          className="rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {problem}
        </p>
      )}

      <ol className="space-y-4">
        {messages.map((m) => (
          <ConsoleMessageRow
            key={m.id}
            message={m}
            viewerTz={viewerTz}
            guestName={conversation.requester.kind === 'guest' ? conversation.requester.name : null}
          />
        ))}
        <div ref={endRef} />
      </ol>

      {conversation.status === 'closed' ? (
        <p className="rounded border border-[var(--color-border-hairline)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          This conversation is closed. Reopen it to reply.
        </p>
      ) : (
        <form
          className="rounded border border-[var(--color-border-hairline)] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim() !== '' && !busy) reply();
          }}
        >
          {attachment !== null && (
            <div className="mb-2 flex items-center gap-2">
              <img
                src={attachment.path}
                alt="Attached image"
                className="h-10 w-10 rounded object-cover"
              />
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                Remove image
              </button>
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            maxLength={MAX_CHARS}
            rows={3}
            aria-label="Your reply"
            placeholder="Reply as yourself — your name and avatar go with it."
            className="w-full resize-y rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || uploading || body.trim() === ''}
              className="rounded border border-[var(--color-brand-cyan-bright)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Send the reply'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file !== undefined) attach(file);
                e.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Attach a screenshot'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ConsoleMessageRow({
  message,
  viewerTz,
  guestName,
}: {
  message: ConsoleMessage;
  viewerTz: string;
  guestName: string | null;
}) {
  if (message.authorKind === 'system') {
    return (
      <li className="text-center font-mono text-xs text-[var(--color-text-secondary)]">
        {message.body} · {formatLocal(message.createdAt, viewerTz)}
      </li>
    );
  }

  const fromDesk = message.authorKind === 'officer' || message.authorKind === 'ai';

  return (
    <li
      className={`rounded border p-4 ${
        fromDesk
          ? 'border-[var(--color-border-active)] bg-[color-mix(in_srgb,var(--color-brand-orange)_6%,transparent)]'
          : 'border-[var(--color-border-hairline)]'
      }`}
    >
      <p className="flex items-center gap-2 font-mono text-xs text-[var(--color-text-secondary)]">
        {/*
          Every ACCOUNT-BACKED turn wears its Discord identity — the member's messages as much
          as the officer's, which is what lets a reviewer read a transcript months later and
          still see who said what. Guest turns wear the commander name they typed.
        */}
        {message.author !== null ? (
          <img
            src={`/v1/media/avatars/${message.author.id}`}
            alt=""
            className="h-5 w-5 rounded-full object-cover"
            onError={(e) => {
              // No stored avatar answers 404 by design; the name still identifies them.
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
        <span className="text-[var(--color-text-primary)]">
          {message.author?.displayName ??
            (message.authorKind === 'guest' ? (guestName ?? 'Guest') : message.authorKind)}
        </span>
        · {formatLocal(message.createdAt, viewerTz)}
      </p>
      {message.attachmentPath !== null && (
        <a href={message.attachmentPath} target="_blank" rel="noopener noreferrer">
          <img
            src={message.attachmentPath}
            alt="Attached screenshot"
            className="mt-3 max-h-64 max-w-full rounded"
          />
        </a>
      )}
      <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--color-text-primary)]">
        {message.body}
      </p>
    </li>
  );
}

/**
 * The CSRF double-submit token, read the way `image-uploader.tsx` reads it — the attach call
 * posts a raw file body, so it goes through fetch rather than the JSON api-client.
 */
function readCsrf(): string {
  const jar = document.cookie.split('; ').map((c) => c.split('='));
  const host = jar.find(([name]) => name === '__Host-gs_csrf')?.[1];
  const plain = jar.find(([name]) => name === 'gs_csrf')?.[1];
  const raw = host ?? plain ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
