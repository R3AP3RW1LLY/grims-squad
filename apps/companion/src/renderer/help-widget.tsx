import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { HelpConversation, HelpTranscript, SupportMessage } from '../hub-support.js';
import { C } from './ui.js';
import { useLive } from './use-live.js';

/**
 * Help & Support — the floating chat, in the app.
 *
 * ★ THE ASKING SIDE, FOR EVERY PAIRED MEMBER ★
 *
 * The website's widget (apps/web/src/components/support-widget.tsx), mirrored for the member
 * behind this device: their own conversations, the AI answering first, an officer one press
 * away. Deliberately NOT gated on SUPPORT_AGENT — that bit is the answering side's, and lives
 * on the sidebar's Support entry. This launcher is for everybody, which is the entire point of
 * a help door.
 *
 * The copy is the website widget's, byte for byte where the surface is the same, so the two
 * cannot drift into describing one desk two ways.
 *
 * ★ TEXT-FIRST, HONESTLY ★
 *
 * No attach button. The website's attach flow rides a browser file input into the hardened
 * media path, which is a session's; the device door deliberately offers no attachment
 * parameter, and a button whose every press the hub refuses would be furniture. Attachments
 * arriving FROM the website still show as the same honest line the officer console uses.
 *
 * There is no suggestion tab here either: the suggestion box posts through the website's
 * session door, which this device does not hold. The widget is the chat, whole.
 *
 * ★ POLLING, THE useLive IDIOM, WHILE OPEN ★
 *
 * Thirty seconds and window focus, like the officer console — a conversation and a minute of
 * lag reads as being ignored. The loader checks whether the panel is open at call time, so a
 * closed widget costs the hub nothing.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    readonly help: {
      conversations(): Promise<Answer<{ conversations: HelpConversation[] }>>;
      start(subject: string, body: string): Promise<Answer<{ id: string }>>;
      conversation(id: string): Promise<Answer<HelpTranscript>>;
      send(id: string, body: string): Promise<Answer<{ message: SupportMessage }>>;
      escalate(id: string): Promise<Answer<{ ok: boolean }>>;
    };
  }
}

const POLL_MS = 30_000;

/** The client-side courtesy copy of the hub's 4000 cap — the hub is the control. */
const MAX_CHARS = 4000;

function when(iso: string): string {
  // The app runs on the member's own machine, so the device clock IS their local time.
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/** The widget's own error line — the panel is too small for the page-level Problem card. */
function ProblemLine({ children }: { children: ComponentChildren }): JSX.Element {
  return (
    <p role="alert" style={{ margin: 0, padding: '6px 14px 0', fontSize: '11px', color: C.bad }}>
      {children}
    </p>
  );
}

function MessageRow({ message }: { message: SupportMessage }): JSX.Element {
  if (message.authorKind === 'system') {
    return (
      <li style={{ listStyle: 'none', textAlign: 'center', fontSize: '11px', color: C.faint }}>
        {message.body} · {when(message.createdAt)}
      </li>
    );
  }

  /*
   * ★ EVERY TURN WEARS ITS AUTHOR — THE OWNER'S ASK, BOTH WAYS ★
   *
   * The member's own turns carry their own name; officers answer as themselves, name and face
   * (the avatar arrives as a data URI, inlined by the main process — see hub-support.ts). The
   * AI's turns wear ITS name, plainly: a model's answer must never read as a person's. Both
   * desk kinds sit on the desk side, exactly as the officer console draws them.
   */
  const self = message.authorKind === 'member';
  const name = message.author?.displayName ?? (message.authorKind === 'ai' ? 'GMSD AI' : 'Guest');

  return (
    <li
      style={{
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        alignItems: self ? 'flex-end' : 'flex-start',
      }}
    >
      <span
        style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: C.faint }}
      >
        {message.author !== null && message.author.avatar !== null ? (
          <img
            src={message.author.avatar}
            alt=""
            style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : null}
        {name}
      </span>
      <div
        style={{
          maxWidth: '85%',
          border: `1px solid ${self ? C.active : C.hairline}`,
          background: self ? C.orangeTint : C.raised,
          borderRadius: '6px',
          padding: '7px 10px',
          fontSize: '13px',
          color: C.text,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {message.attachmentPath !== null ? (
          // The hub serves the hardened image; the app has no media of its own to show.
          <p style={{ margin: '0 0 6px', fontSize: '12px', color: C.dim }}>
            An image is attached — open this conversation on the website to see it.
          </p>
        ) : null}
        {message.body}
      </div>
      <span style={{ fontSize: '10px', color: C.faint }}>{when(message.createdAt)}</span>
    </li>
  );
}

function StartForm({
  onStart,
  onCancel,
}: {
  onStart: (subject: string, body: string) => Promise<void>;
  onCancel: (() => void) | null;
}): JSX.Element {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (): void => {
    setSending(true);
    setProblem(null);
    onStart(subject.trim(), body)
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'That could not be sent. Try again.');
      })
      .finally(() => setSending(false));
  };

  const labelCls: JSX.CSSProperties = { fontSize: '11px', color: C.dim };
  const inputCls: JSX.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    background: C.sunken,
    border: `1px solid ${C.hairline}`,
    borderRadius: '4px',
    color: C.text,
    fontFamily: 'inherit',
    fontSize: '13px',
    padding: '7px 10px',
  };

  return (
    <form
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '14px',
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim() !== '' && !sending) submit();
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={labelCls}>What is this about?</span>
        <input
          style={inputCls}
          value={subject}
          onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
          maxLength={120}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minHeight: 0 }}>
        <span style={labelCls}>Your question</span>
        <textarea
          style={{ ...inputCls, minHeight: '90px', flex: 1, resize: 'none' }}
          value={body}
          onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          maxLength={MAX_CHARS}
        />
      </label>
      {problem !== null ? (
        <p role="alert" style={{ margin: 0, fontSize: '11px', color: C.bad }}>
          {problem}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '8px' }}>
        {onCancel !== null ? (
          <button type="button" class="btn btn-default" onClick={onCancel}>
            Back
          </button>
        ) : null}
        <button
          type="submit"
          class="btn btn-primary"
          style={{ flex: 1 }}
          disabled={sending || body.trim() === ''}
        >
          {sending ? 'Sending…' : 'Send to the officers'}
        </button>
      </div>
    </form>
  );
}

function ConversationPane({
  transcript,
  onBack,
  onSend,
  onEscalate,
}: {
  transcript: HelpTranscript;
  onBack: () => void;
  onSend: (body: string) => Promise<void>;
  onEscalate: () => Promise<void>;
}): JSX.Element {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const endRef = useRef<HTMLLIElement | null>(null);

  const count = transcript.messages.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  const send = (): void => {
    setSending(true);
    setProblem(null);
    onSend(body)
      .then(() => setBody(''))
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'That could not be sent. Try again.');
      })
      .finally(() => setSending(false));
  };

  const escalate = (): void => {
    setEscalating(true);
    setProblem(null);
    onEscalate()
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'That did not go through. Press it again.');
      })
      .finally(() => setEscalating(false));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ borderBottom: `1px solid ${C.hairline}`, padding: '7px 12px' }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            border: 'none',
            background: 'transparent',
            padding: 0,
            fontFamily: 'inherit',
            fontSize: '11px',
            color: C.dim,
            cursor: 'pointer',
          }}
        >
          ← All conversations
        </button>
      </div>

      <ol
        style={{
          margin: 0,
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {transcript.messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
        <li ref={endRef} style={{ listStyle: 'none' }} aria-hidden />
      </ol>

      {/*
        ★ THE STANDING HINT — THE "HUMAN ON DEMAND" HALF OF THE APPROVED DESIGN ★

        Shown the whole time a conversation is the AI's, in the chrome rather than in any
        message body — the promise "a person is one press away" has to hold on every screen.
        Pressing the button flips the conversation to the officers for good.
      */}
      {transcript.conversation.status === 'open' && transcript.conversation.handledBy === 'ai' ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            borderTop: `1px solid ${C.hairline}`,
            background: C.sunken,
            padding: '7px 12px',
          }}
        >
          <p style={{ margin: 0, fontSize: '11px', color: C.dim }}>
            GMSD AI is answering. An officer is one press away.
          </p>
          <button
            type="button"
            class="btn btn-default"
            onClick={escalate}
            disabled={escalating}
            style={{ flexShrink: 0 }}
          >
            {escalating ? 'Asking…' : 'Talk to an officer'}
          </button>
        </div>
      ) : null}

      {problem !== null ? <ProblemLine>{problem}</ProblemLine> : null}

      {transcript.conversation.status === 'closed' ? (
        <div style={{ borderTop: `1px solid ${C.hairline}`, padding: '12px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '12px', color: C.dim }}>This conversation is closed.</p>
        </div>
      ) : (
        <form
          style={{ borderTop: `1px solid ${C.hairline}`, padding: '10px 12px' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim() !== '' && !sending) send();
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
            <textarea
              value={body}
              onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
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
              style={{
                flex: 1,
                boxSizing: 'border-box',
                background: C.sunken,
                border: `1px solid ${C.hairline}`,
                borderRadius: '4px',
                color: C.text,
                fontFamily: 'inherit',
                fontSize: '13px',
                padding: '7px 10px',
                resize: 'none',
              }}
            />
            <button type="submit" class="btn btn-primary" disabled={sending || body.trim() === ''}>
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function HelpWidget(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<HelpConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<HelpTranscript | null>(null);
  const [composing, setComposing] = useState(false);

  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // What a frozen poll closure would read stale — the officer console's ref idiom.
  const openRef = useRef(open);
  openRef.current = open;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const loadList = (): void => {
    void window.help.conversations().then((a) => {
      if (a.ok) {
        setConversations(a.data.conversations);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  const loadTranscript = (id: string): void => {
    void window.help.conversation(id).then((a) => {
      if (a.ok) {
        setTranscript(a.data);
        setError(null);
        // Opening marked it seen on the hub; the list's dot follows on its next read.
        loadList();
      } else {
        setError(a.error);
        setActiveId(null);
        setTranscript(null);
      }
    });
  };

  const load = (): void => {
    if (!openRef.current) return; // A closed widget costs the hub nothing.
    loadList();
    const id = activeRef.current;
    if (id !== null) loadTranscript(id);
  };

  // One load at launch, so the launcher's dot is honest before the panel is ever opened.
  useEffect(loadList, []);
  useLive(load, POLL_MS);

  // Opening asks fresh; a panel drawn from minutes-old rows reads as being ignored.
  useEffect(() => {
    if (!open) return;
    loadList();
    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (activeId !== null) loadTranscript(activeId);
    else setTranscript(null);
  }, [activeId]);

  // Escape closes and hands focus back to the launcher — the website widget's idiom.
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

  const unread = (conversations ?? []).some((c) => c.unread);

  const start = async (subject: string, body: string): Promise<void> => {
    const started = await window.help.start(subject, body);
    if (!started.ok) throw new Error(started.error);
    setComposing(false);
    setActiveId(started.data.id);
    loadList();
  };

  const send = async (body: string): Promise<void> => {
    const id = activeRef.current;
    if (id === null) return;
    const sent = await window.help.send(id, body);
    if (!sent.ok) throw new Error(sent.error);
    loadTranscript(id);
  };

  const escalate = async (): Promise<void> => {
    const id = activeRef.current;
    if (id === null) return;
    const asked = await window.help.escalate(id);
    if (!asked.ok) throw new Error(asked.error);
    loadTranscript(id);
  };

  const showStartForm =
    composing || (conversations !== null && conversations.length === 0 && activeId === null);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="help-widget-panel"
        aria-label="Help and support"
        style={{
          position: 'fixed',
          right: '18px',
          bottom: '18px',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '46px',
          height: '46px',
          borderRadius: '999px',
          border: `1px solid ${C.active}`,
          background: C.raised,
          color: C.orange,
          cursor: 'pointer',
          boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
        }}
      >
        {/* The website launcher's own outline, transcribed — the icons.tsx idiom. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          style={{ width: '22px', height: '22px' }}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 8.25h9m-9 3.75h5.25M4.5 4.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-6.75L9 20.25v-3.75H4.5A1.5 1.5 0 0 1 3 15V6a1.5 1.5 0 0 1 1.5-1.5Z"
          />
        </svg>
        {unread ? (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '11px',
              height: '11px',
              borderRadius: '999px',
              border: `2px solid ${C.void}`,
              background: C.orange,
            }}
          />
        ) : null}
      </button>

      <div
        id="help-widget-panel"
        ref={panelRef}
        role="dialog"
        aria-label="Help and support"
        aria-hidden={!open}
        tabIndex={-1}
        style={{
          position: 'fixed',
          right: '18px',
          bottom: '74px',
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          width: 'min(360px, calc(100vw - 36px))',
          height: 'min(500px, calc(100vh - 110px))',
          overflow: 'hidden',
          borderRadius: '6px',
          border: `1px solid ${C.hairline}`,
          background: C.panelGlass,
          backdropFilter: 'blur(12px)',
          boxShadow: '0 10px 36px rgba(0,0,0,0.55)',
          outline: 'none',
          // The website widget's slide: closed sits a few pixels low and transparent, and
          // `visibility` keeps it out of the tab order without unmounting the state behind it.
          transition: 'transform 200ms ease, opacity 200ms ease, visibility 200ms',
          transform: open ? 'translateY(0)' : 'translateY(12px)',
          opacity: open ? 1 : 0,
          visibility: open ? 'visible' : 'hidden',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <header style={{ borderBottom: `1px solid ${C.hairline}`, padding: '10px 14px' }}>
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: '13px',
              color: C.text,
            }}
          >
            Help &amp; Support
          </p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.dim }}>
            GMSD AI answers first, from the help pages. The squadron&rsquo;s officers take over
            whenever you ask.
          </p>
        </header>

        {showStartForm ? (
          <StartForm
            onStart={start}
            onCancel={
              conversations !== null && conversations.length > 0 ? () => setComposing(false) : null
            }
          />
        ) : activeId !== null && transcript !== null ? (
          <ConversationPane
            transcript={transcript}
            onBack={() => {
              setActiveId(null);
              loadList();
            }}
            onSend={send}
            onEscalate={escalate}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {error !== null ? <ProblemLine>{error}</ProblemLine> : null}
            <ul style={{ margin: 0, padding: 0, flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {(conversations ?? []).map((c) => (
                <li key={c.id} style={{ listStyle: 'none', borderBottom: `1px solid ${C.hairline}` }}>
                  <button
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      padding: '10px 14px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '7px', width: '100%' }}>
                      {c.unread ? (
                        <span
                          aria-hidden
                          style={{
                            width: '7px',
                            height: '7px',
                            flexShrink: 0,
                            borderRadius: '999px',
                            background: C.orange,
                          }}
                        />
                      ) : null}
                      <span
                        style={{
                          fontSize: '13px',
                          color: C.text,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.subject ?? c.preview}
                      </span>
                      {c.status === 'closed' ? (
                        <span
                          style={{
                            marginLeft: 'auto',
                            flexShrink: 0,
                            fontSize: '10px',
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: C.faint,
                          }}
                        >
                          Closed
                        </span>
                      ) : null}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        color: C.dim,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%',
                      }}
                    >
                      {c.preview}
                    </span>
                    <span style={{ fontSize: '10px', color: C.faint }}>{when(c.lastMessageAt)}</span>
                  </button>
                </li>
              ))}
              {conversations === null && error === null ? (
                <li
                  style={{
                    listStyle: 'none',
                    padding: '20px 14px',
                    textAlign: 'center',
                    fontSize: '12px',
                    color: C.dim,
                  }}
                >
                  Loading…
                </li>
              ) : null}
            </ul>
            <div style={{ borderTop: `1px solid ${C.hairline}`, padding: '10px 12px' }}>
              <button
                type="button"
                class="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => setComposing(true)}
              >
                Start a new conversation
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
