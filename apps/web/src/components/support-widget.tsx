'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiCallError, apiCall, apiGet, apiPost } from '../lib/api-client';
import { useLiveEvent } from './use-live-event';
import { notificationAge } from './notifications-format';

/**
 * Help & Support — the floating chat, on every page.
 *
 * ★ ONE WIDGET, TWO KINDS OF CALLER ★
 *
 * A signed-in member talks through the session like every other panel, and hears about replies
 * over the live stream. A guest holds no session, so their conversation is addressed by a
 * one-time token this browser keeps, and they POLL — the stream authenticates by session, and a
 * token-authenticated stream for strangers would be a second live system to keep safe.
 *
 * The two are SEPARATE inner components rather than branches of one, because the member half
 * uses the live hook and hooks cannot be conditional. The shell owns the launcher, the panel
 * and its a11y; the halves own their data.
 *
 * ★ THE A11Y IS THE NOTIFICATIONS PANEL'S, DELIBERATELY ★
 *
 * role=dialog, Escape closes and returns focus to the launcher, focus moves in on open, `inert`
 * while closed. A second overlay with different keyboard behaviour is how members learn that
 * keys work "sometimes".
 */

interface ConversationSummary {
  readonly id: string;
  readonly status: 'open' | 'closed';
  readonly subject: string | null;
  readonly lastMessageAt: string;
  readonly unread: boolean;
  readonly preview: string;
}

interface Message {
  readonly id: string;
  readonly authorKind: 'member' | 'officer' | 'guest' | 'ai' | 'system';
  readonly author: { readonly id: string; readonly displayName: string } | null;
  readonly body: string;
  readonly attachmentPath: string | null;
  readonly createdAt: string;
}

interface Transcript {
  readonly conversation: ConversationSummary & { readonly guestName: string | null };
  readonly messages: readonly Message[];
}

/** Where this browser keeps a guest's conversation token. Shown once by the API, held here. */
const GUEST_TOKEN_KEY = 'gs.support.guest-token';

/** How eagerly a guest's open panel asks for new words, and how lazily a closed one does. */
const GUEST_OPEN_POLL_MS = 5_000;
const GUEST_IDLE_POLL_MS = 60_000;

/** The client-side courtesy copy of the server's 4000 cap — the server is the control. */
const MAX_CHARS = 4000;

export function SupportWidget({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  /*
   * A support.reply notification links to `?support=<id>` — the widget is the destination, so
   * it opens itself on that conversation. Read once; navigation within the app remounts layouts
   * rarely, and a stale param re-opening the panel on refresh is the intended behaviour.
   */
  const [requestedId, setRequestedId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('support');
    if (id !== null && id !== '' && signedIn) {
      setRequestedId(id);
      setOpen(true);
    }
  }, [signedIn]);

  // Escape closes and hands focus back to the launcher — the notifications panel's idiom.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      launcherRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="support-widget-panel"
        className="fixed right-4 bottom-4 z-40 flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-border-active)] bg-[var(--color-surface-panel-raised)] text-[var(--color-brand-orange)] shadow-xl transition-colors hover:bg-[var(--color-surface-panel-hover)]"
      >
        <span className="sr-only">Help and support</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 8.25h9m-9 3.75h5.25M4.5 4.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-6.75L9 20.25v-3.75H4.5A1.5 1.5 0 0 1 3 15V6a1.5 1.5 0 0 1 1.5-1.5Z"
          />
        </svg>
        {unread ? (
          <span
            aria-hidden
            className="absolute top-0 right-0 h-3 w-3 rounded-[var(--radius-pill)] border-2 border-[var(--color-surface-void)] bg-[var(--color-brand-orange)]"
          />
        ) : null}
      </button>

      <div
        id="support-widget-panel"
        ref={panelRef}
        role="dialog"
        aria-label="Help and support"
        tabIndex={-1}
        inert={!open}
        className={`fixed right-4 bottom-20 z-40 flex h-[min(32rem,calc(100dvh-7rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-panel)_96%,transparent)] shadow-xl backdrop-blur-md outline-hidden transition-all duration-200 ease-out ${
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
        }`}
      >
        <header className="border-b border-[var(--color-border-hairline)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
            Help &amp; Support
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            Your question goes to the squadron&rsquo;s officers. Replies land right here.
          </p>
        </header>

        {signedIn ? (
          <MemberChat open={open} requestedId={requestedId} onUnread={setUnread} />
        ) : (
          <GuestChat open={open} onUnread={setUnread} />
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The member half — session calls, live updates, image attach.
// ─────────────────────────────────────────────────────────────────────────────

function MemberChat({
  open,
  requestedId,
  onUnread,
}: {
  open: boolean;
  requestedId: string | null;
  onUnread: (unread: boolean) => void;
}) {
  const [conversations, setConversations] = useState<readonly ConversationSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [composing, setComposing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const loadList = useCallback(() => {
    apiGet<{ conversations: ConversationSummary[] }>('/v1/support/conversations')
      .then((r) => {
        setConversations(r.conversations);
        onUnread(r.conversations.some((c) => c.unread));
      })
      .catch(() => {
        // The launcher must never break a page. The list retries on the next event or open.
      });
  }, [onUnread]);

  const loadTranscript = useCallback(
    (id: string) => {
      apiGet<Transcript>(`/v1/support/conversations/${id}`)
        .then((t) => {
          setTranscript(t);
          // Opening marked it seen server-side; the list still says unread until re-read.
          loadList();
        })
        .catch((err: unknown) => {
          setProblem(err instanceof Error ? err.message : 'That conversation could not be opened.');
          setActiveId(null);
        });
    },
    [loadList],
  );

  useEffect(loadList, [loadList]);
  useEffect(() => {
    if (requestedId !== null) setActiveId(requestedId);
  }, [requestedId]);
  useEffect(() => {
    if (activeId !== null && activeId !== 'new') loadTranscript(activeId);
    else setTranscript(null);
  }, [activeId, loadTranscript]);

  // One coarse event for everything support: re-read the list, and the open transcript with it.
  useLiveEvent('support', () => {
    loadList();
    if (open && activeId !== null && activeId !== 'new') loadTranscript(activeId);
  });

  const start = async (subject: string, body: string): Promise<void> => {
    const started = await apiPost<{ id: string }>('/v1/support/conversations', {
      subject,
      body,
    });
    setComposing(false);
    setActiveId(started.id);
    loadList();
  };

  const send = async (body: string, attachmentId: string | null): Promise<void> => {
    if (activeId === null) return;
    await apiPost(`/v1/support/conversations/${activeId}/messages`, {
      body,
      ...(attachmentId === null ? {} : { attachmentId }),
    });
    loadTranscript(activeId);
  };

  if (composing || (conversations !== null && conversations.length === 0 && activeId === null)) {
    return (
      <StartForm
        askName={false}
        onCancel={conversations !== null && conversations.length > 0 ? () => setComposing(false) : null}
        onStart={async ({ subject, body }) => start(subject, body)}
      />
    );
  }

  if (activeId !== null && transcript !== null) {
    return (
      <ConversationPane
        transcript={transcript}
        selfKinds={['member']}
        onBack={() => {
          setActiveId(null);
          loadList();
        }}
        onSend={send}
        canAttach
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {problem !== null ? (
        <p role="alert" className="px-4 pt-3 text-xs text-[var(--color-semantic-hostile-bright)]">
          {problem}
        </p>
      ) : null}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {(conversations ?? []).map((c) => (
          <li key={c.id} className="border-b border-[var(--color-border-hairline)]">
            <button
              type="button"
              onClick={() => {
                setProblem(null);
                setActiveId(c.id);
              }}
              className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-panel-hover)]"
            >
              <span className="flex items-center gap-2">
                {c.unread ? (
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-[var(--radius-pill)] bg-[var(--color-brand-orange)]" />
                ) : null}
                <span className="truncate text-sm text-[var(--color-text-primary)]">
                  {c.subject ?? c.preview}
                </span>
                {c.status === 'closed' ? (
                  <span className="ml-auto shrink-0 text-[10px] tracking-wide text-[var(--color-text-secondary)] uppercase">
                    Closed
                  </span>
                ) : null}
              </span>
              <span className="truncate text-xs text-[var(--color-text-secondary)]">{c.preview}</span>
              <span className="text-[10px] text-[var(--color-text-secondary)]">
                {notificationAge(c.lastMessageAt)}
              </span>
            </button>
          </li>
        ))}
        {conversations === null ? (
          <li className="px-4 py-6 text-center text-xs text-[var(--color-text-secondary)]">Loading…</li>
        ) : null}
      </ul>
      <div className="border-t border-[var(--color-border-hairline)] p-3">
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-active)] bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_20%,transparent)]"
        >
          Start a new conversation
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The guest half — token calls, polling.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A guest's call: the same sanctioned client every other request uses, with the one-time token
 * riding in the Authorization header instead of a cookie.
 */
function guestCall<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  return apiCall<T>(method, path, {
    ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
    ...(body === undefined ? {} : { body }),
    fallbackMessage: 'The help desk could not be reached. Try again in a moment.',
  });
}

function GuestChat({ open, onUnread }: { open: boolean; onUnread: (unread: boolean) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    setToken(window.localStorage.getItem(GUEST_TOKEN_KEY) ?? '');
  }, []);

  const load = useCallback(() => {
    const held = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (held === null || held === '') return;
    guestCall<Transcript>('GET', '/v1/support/guest/conversation', held)
      .then((t) => {
        setTranscript(t);
        onUnread(t.conversation.unread);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiCallError && err.status === 404) {
          // The conversation is gone — most likely cleared site data elsewhere, or a stale
          // token. A fresh start is the only remedy, so offer exactly that.
          window.localStorage.removeItem(GUEST_TOKEN_KEY);
          setToken('');
          setTranscript(null);
        }
      });
  }, [onUnread]);

  // Guests poll: eagerly while the panel is open, lazily for the launcher dot while it is not.
  useEffect(() => {
    load();
    const timer = setInterval(load, open ? GUEST_OPEN_POLL_MS : GUEST_IDLE_POLL_MS);
    const onFocus = (): void => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load, open]);

  if (token === null) return null; // First client render; localStorage not read yet.

  if (token === '' || transcript === null) {
    return (
      <StartForm
        askName
        onCancel={null}
        note="This browser keeps your conversation. Signing in with Discord keeps it on your account instead."
        onStart={async ({ name, subject, body }) => {
          const started = await guestCall<{ id: string; guestToken: string }>(
            'POST',
            '/v1/support/guest/conversations',
            '',
            { name, subject, body },
          );
          window.localStorage.setItem(GUEST_TOKEN_KEY, started.guestToken);
          setToken(started.guestToken);
          setProblem(null);
          load();
        }}
      />
    );
  }

  return (
    <>
      {problem !== null ? (
        <p role="alert" className="px-4 pt-2 text-xs text-[var(--color-semantic-hostile-bright)]">
          {problem}
        </p>
      ) : null}
      <ConversationPane
        transcript={transcript}
        selfKinds={['guest']}
        onBack={null}
        canAttach={false}
        onSend={async (body) => {
          const held = window.localStorage.getItem(GUEST_TOKEN_KEY) ?? '';
          await guestCall('POST', '/v1/support/guest/messages', held, { body });
          load();
        }}
        onStartFresh={() => {
          window.localStorage.removeItem(GUEST_TOKEN_KEY);
          setToken('');
          setTranscript(null);
        }}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared pieces.
// ─────────────────────────────────────────────────────────────────────────────

function StartForm({
  askName,
  note,
  onStart,
  onCancel,
}: {
  askName: boolean;
  note?: string;
  onStart: (fields: { name: string; subject: string; body: string }) => Promise<void>;
  onCancel: (() => void) | null;
}) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (): void => {
    setSending(true);
    setProblem(null);
    onStart({ name: name.trim(), subject: subject.trim(), body })
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'That could not be sent. Try again.');
      })
      .finally(() => setSending(false));
  };

  const labelCls = 'text-xs font-medium text-[var(--color-text-secondary)]';
  const inputCls =
    'w-full rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]';

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {askName ? (
        <label className="flex flex-col gap-1">
          <span className={labelCls}>What should we call you?</span>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            maxLength={60}
            autoComplete="name"
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className={labelCls}>What is this about?</span>
        <input
          className={inputCls}
          value={subject}
          onChange={(e) => setSubject(e.currentTarget.value)}
          maxLength={120}
        />
      </label>
      <label className="flex min-h-0 flex-1 flex-col gap-1">
        <span className={labelCls}>Your question</span>
        <textarea
          className={`${inputCls} min-h-24 flex-1 resize-none`}
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          maxLength={MAX_CHARS}
        />
      </label>
      {note !== undefined ? (
        <p className="text-[11px] text-[var(--color-text-secondary)]">{note}</p>
      ) : null}
      {problem !== null ? (
        <p role="alert" className="text-xs text-[var(--color-semantic-hostile-bright)]">
          {problem}
        </p>
      ) : null}
      <div className="flex gap-2">
        {onCancel !== null ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel-hover)]"
          >
            Back
          </button>
        ) : null}
        <button
          type="submit"
          disabled={sending || body.trim() === '' || (askName && name.trim() === '')}
          className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-active)] bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_20%,transparent)] disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send to the officers'}
        </button>
      </div>
    </form>
  );
}

function ConversationPane({
  transcript,
  selfKinds,
  onBack,
  onSend,
  canAttach,
  onStartFresh,
}: {
  transcript: Transcript;
  selfKinds: readonly Message['authorKind'][];
  onBack: (() => void) | null;
  onSend: (body: string, attachmentId: string | null) => Promise<void>;
  canAttach: boolean;
  onStartFresh?: () => void;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ id: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const count = transcript.messages.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  const send = (): void => {
    setSending(true);
    setProblem(null);
    onSend(body, attachment?.id ?? null)
      .then(() => {
        setBody('');
        setAttachment(null);
      })
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'That could not be sent. Try again.');
      })
      .finally(() => setSending(false));
  };

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
    <div className="flex min-h-0 flex-1 flex-col">
      {onBack !== null ? (
        <div className="border-b border-[var(--color-border-hairline)] px-3 py-2">
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            ← All conversations
          </button>
        </div>
      ) : null}

      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {transcript.messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            self={selfKinds.includes(m.authorKind)}
            guestName={transcript.conversation.guestName}
          />
        ))}
        <div ref={endRef} />
      </ol>

      {problem !== null ? (
        <p role="alert" className="px-3 pb-1 text-xs text-[var(--color-semantic-hostile-bright)]">
          {problem}
        </p>
      ) : null}

      {transcript.conversation.status === 'closed' ? (
        <div className="border-t border-[var(--color-border-hairline)] p-3 text-center">
          <p className="text-xs text-[var(--color-text-secondary)]">This conversation is closed.</p>
          {onStartFresh !== undefined ? (
            <button
              type="button"
              onClick={onStartFresh}
              className="mt-2 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-active)] px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-panel-hover)]"
            >
              Start a new conversation
            </button>
          ) : null}
        </div>
      ) : (
        <form
          className="border-t border-[var(--color-border-hairline)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {attachment !== null ? (
            <div className="mb-2 flex items-center gap-2">
              <img src={attachment.path} alt="Attached image" className="h-10 w-10 rounded-[var(--radius-sm)] object-cover" />
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                Remove image
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (body.trim() !== '' && !sending) send();
                }
              }}
              maxLength={MAX_CHARS}
              rows={2}
              aria-label="Your message"
              placeholder="Write a message…"
              className="min-h-10 flex-1 resize-none rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
            />
            {canAttach ? (
              <>
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
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label="Attach a screenshot"
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] p-2 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"
                    />
                  </svg>
                </button>
              </>
            ) : null}
            <button
              type="submit"
              disabled={sending || uploading || body.trim() === ''}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border-active)] bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_20%,transparent)] disabled:opacity-50"
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function MessageRow({
  message,
  self,
  guestName,
}: {
  message: Message;
  self: boolean;
  guestName: string | null;
}) {
  if (message.authorKind === 'system') {
    return (
      <li className="text-center text-[11px] text-[var(--color-text-secondary)]">
        {message.body} · {notificationAge(message.createdAt)}
      </li>
    );
  }

  /*
   * ★ EVERY TURN WEARS ITS AUTHOR — THE OWNER'S ASK, BOTH WAYS ★
   *
   * Officers answer as themselves, and a SIGNED-IN member's own messages carry their own
   * Discord identity too — display name and stored avatar, the same `/v1/media/avatars` route
   * on both sides of the conversation. A guest's turns wear the commander name they gave when
   * the chat began; there is no account behind it, so there is no avatar to draw.
   */
  const identity =
    message.author !== null
      ? { name: message.author.displayName, avatarId: message.author.id }
      : message.authorKind === 'guest' && guestName !== null
        ? { name: guestName, avatarId: null }
        : null;

  return (
    <li className={`flex flex-col gap-1 ${self ? 'items-end' : 'items-start'}`}>
      {identity !== null ? (
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
          {identity.avatarId !== null ? (
            <img
              src={`/v1/media/avatars/${identity.avatarId}`}
              alt=""
              className="h-4 w-4 rounded-[var(--radius-pill)] object-cover"
              onError={(e) => {
                // No stored avatar answers 404 by design; the name still identifies them.
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : null}
          {identity.name}
        </span>
      ) : null}
      <div
        className={`max-w-[85%] rounded-[var(--radius-md)] border px-3 py-2 text-sm whitespace-pre-wrap ${
          self
            ? 'border-[var(--color-border-active)] bg-[color-mix(in_srgb,var(--color-brand-orange)_10%,transparent)] text-[var(--color-text-primary)]'
            : 'border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-raised)] text-[var(--color-text-primary)]'
        }`}
      >
        {message.attachmentPath !== null ? (
          <a href={message.attachmentPath} target="_blank" rel="noopener noreferrer">
            <img
              src={message.attachmentPath}
              alt="Attached screenshot"
              className="mb-2 max-h-48 max-w-full rounded-[var(--radius-sm)]"
            />
          </a>
        ) : null}
        {message.body}
      </div>
      <span className="text-[10px] text-[var(--color-text-secondary)]">
        {notificationAge(message.createdAt)}
      </span>
    </li>
  );
}

/**
 * The CSRF double-submit token, read the way `image-uploader.tsx` reads it — this call posts a
 * raw file body, so it goes through fetch rather than the JSON api-client.
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
