import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  SupportConversationRow,
  SupportMessage,
  SupportTranscript,
} from '../hub-support.js';
import { Button, C, Card, Empty, Problem, Section, Tabs } from './ui.js';
import { useLive } from './use-live.js';

/**
 * The Help & Support console, in the app.
 *
 * ★ THE ANSWERING SIDE, MIRRORED ★
 *
 * The website's officers' console, for members holding SUPPORT_AGENT — an officer at their desk
 * with the game running should not need a browser to tell a guest how to join. Same device-door
 * routes, same rules, same close/reopen edges; the app only draws them.
 *
 * The sidebar entry for this page is gated in the shell (app.tsx) on the hub's own answer to
 * `support.access()` — the hub decides who works the console, never the app.
 *
 * ★ POLLING, NOT A STREAM ★
 *
 * The useLive idiom every page here uses: a re-read on an interval and on window focus. Thirty
 * seconds, tighter than the default sixty, because a help queue is a conversation and a minute
 * of lag reads as being ignored.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    readonly support: {
      access(): Promise<Answer<{ agent: boolean }>>;
      badge(): Promise<Answer<{ waiting: number }>>;
      conversations(status: string): Promise<Answer<{ conversations: SupportConversationRow[] }>>;
      conversation(id: string): Promise<Answer<SupportTranscript>>;
      reply(id: string, body: string): Promise<Answer<{ message: SupportMessage }>>;
      close(id: string): Promise<Answer<{ ok: boolean }>>;
      reopen(id: string): Promise<Answer<{ ok: boolean }>>;
    };
  }
}

const POLL_MS = 30_000;

function when(iso: string): string {
  // The app runs on the officer's own machine, so the device clock IS their local time.
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/**
 * Who is asking, at a glance — the owner's ask. A member wears their Discord identity: the
 * stored avatar (inlined by the main process as a data URI; see hub-support.ts) beside their
 * display name. A guest wears the commander name they typed, and nothing pretends it is more.
 */
function RequesterTag({
  requester,
}: {
  requester: SupportConversationRow['requester'];
}): JSX.Element {
  const guest = requester.kind === 'guest';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '10px',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: guest ? C.dim : C.cyan,
        border: `1px solid ${guest ? C.hairline : C.cyan}`,
        borderRadius: '3px',
        padding: '1px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      {!guest && requester.avatar !== null ? (
        <img
          src={requester.avatar}
          alt=""
          style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : null}
      {guest ? `Guest · ${requester.name}` : `Member · ${requester.displayName}`}
    </span>
  );
}

function MessageRow({
  message,
  guestName,
}: {
  message: SupportMessage;
  guestName: string | null;
}): JSX.Element {
  if (message.authorKind === 'system') {
    return (
      <p style={{ margin: '10px 0', textAlign: 'center', fontSize: '11px', color: C.faint }}>
        {message.body} · {when(message.createdAt)}
      </p>
    );
  }

  const fromDesk = message.authorKind === 'officer' || message.authorKind === 'ai';
  /*
   * Every account-backed turn wears its Discord identity — the member's as much as the
   * officer's. Guest turns wear the commander name they typed when the chat began.
   */
  const name =
    message.author?.displayName ??
    (message.authorKind === 'guest' ? (guestName ?? 'Guest') : message.authorKind);

  return (
    <div
      style={{
        margin: '10px 0',
        padding: '10px 12px',
        border: `1px solid ${fromDesk ? C.hairline : 'transparent'}`,
        borderLeft: `2px solid ${fromDesk ? C.orange : C.hairline}`,
        borderRadius: '4px',
        background: fromDesk ? C.raised : 'transparent',
      }}
    >
      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: C.faint }}>
        {message.author !== null && message.author.avatar !== null ? (
          <img
            src={message.author.avatar}
            alt=""
            style={{ width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : null}
        <span style={{ color: fromDesk ? C.orange : C.dim }}>{name}</span> · {when(message.createdAt)}
      </p>
      {message.attachmentPath !== null ? (
        // The hub serves the hardened image; the app has no media of its own to show.
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: C.dim }}>
          An image is attached — open this conversation on the website to see it.
        </p>
      ) : null}
      <p style={{ margin: '6px 0 0', fontSize: '13px', color: C.text, whiteSpace: 'pre-wrap' }}>
        {message.body}
      </p>
    </div>
  );
}

function ConversationDetail({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const [data, setData] = useState<SupportTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = (): void => {
    void window.support.conversation(id).then((a) => {
      if (a.ok) {
        setData(a.data);
        setError(null);
      } else setError(a.error);
    });
  };

  useEffect(load, [id]);
  useLive(load, POLL_MS);

  const act = (run: () => Promise<Answer<unknown>>): void => {
    setBusy(true);
    setProblem(null);
    void run().then((a) => {
      setBusy(false);
      // The hub's own sentence — "already closed" from a colleague's race is actionable.
      if (!a.ok) setProblem(a.error);
      else load();
    });
  };

  if (error !== null) {
    return (
      <Section title="Support">
        <Button onClick={onBack}>← Back</Button>
        <Problem>{error}</Problem>
      </Section>
    );
  }

  if (data === null) {
    return (
      <Section title="Support">
        <Button onClick={onBack}>← Back</Button>
        <Empty>Opening the conversation…</Empty>
      </Section>
    );
  }

  const { conversation, messages } = data;

  return (
    <Section title={conversation.subject ?? 'Support conversation'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <Button onClick={onBack}>← Back</Button>
        <RequesterTag requester={conversation.requester} />
        <span style={{ fontSize: '11px', color: C.faint }}>
          Started {when(conversation.createdAt)}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {conversation.status === 'open' ? (
            <Button onClick={() => act(() => window.support.close(id))} disabled={busy}>
              Close it
            </Button>
          ) : (
            <Button onClick={() => act(() => window.support.reopen(id))} disabled={busy}>
              Reopen it
            </Button>
          )}
        </span>
      </div>

      {problem !== null ? <Problem>{problem}</Problem> : null}

      <Card>
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            guestName={
              conversation.requester.kind === 'guest' ? conversation.requester.name : null
            }
          />
        ))}
      </Card>

      {conversation.status === 'closed' ? (
        <Card>
          <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
            This conversation is closed. Reopen it to reply.
          </p>
        </Card>
      ) : (
        <Card>
          <textarea
            value={reply}
            onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)}
            maxLength={4000}
            rows={3}
            aria-label="Your reply"
            placeholder="Reply as yourself — your name and avatar go with it."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: C.sunken,
              border: `1px solid ${C.hairline}`,
              borderRadius: '4px',
              color: C.text,
              fontFamily: 'inherit',
              fontSize: '13px',
              padding: '8px 10px',
              resize: 'vertical',
            }}
          />
          <div style={{ marginTop: '10px' }}>
            <Button
              tone="primary"
              disabled={busy || reply.trim() === ''}
              onClick={() =>
                act(async () => {
                  const sent = await window.support.reply(id, reply);
                  if (sent.ok) setReply('');
                  return sent;
                })
              }
            >
              {busy ? 'Working…' : 'Send the reply'}
            </Button>
          </div>
        </Card>
      )}
    </Section>
  );
}

export function SupportPage(): JSX.Element {
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [rows, setRows] = useState<SupportConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // The tab a frozen poll closure would read stale — the leaderboards ref idiom.
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const load = (): void => {
    void window.support.conversations(tabRef.current).then((a) => {
      if (a.ok) {
        setRows(a.data.conversations);
        setError(null);
      } else setError(a.error);
    });
  };

  useEffect(load, [tab]);
  useLive(load, POLL_MS);

  if (openId !== null) {
    // Keyed, so switching conversations can never bleed one transcript into another.
    return (
      <ConversationDetail
        key={openId}
        id={openId}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  const waiting = (rows ?? []).filter((r) => r.unread).length;

  return (
    <div>
      <Section title="Support">
        <Card>
          <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
            Every help conversation from the website lands here — members&rsquo; and guests&rsquo;.
            Replies go out under your own name and avatar; the person asking sees exactly who
            answered.
          </p>
          {tab === 'open' ? (
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: waiting > 0 ? C.warn : C.faint }}>
              {waiting === 0
                ? 'Everything open has been seen.'
                : `${waiting} waiting for a first look.`}
            </p>
          ) : null}
        </Card>
      </Section>

      <Tabs
        current={tab}
        onChange={setTab}
        label="Conversation state"
        tabs={[
          { key: 'open', label: 'Open' },
          { key: 'closed', label: 'Closed' },
        ]}
      />

      {error !== null ? <Problem>{error}</Problem> : null}

      {rows === null ? (
        <Empty>Loading the queue…</Empty>
      ) : rows.length === 0 ? (
        <Empty>
          {tab === 'open'
            ? 'Nothing is waiting. Conversations appear the moment anybody asks for help.'
            : 'Nothing has been closed yet.'}
        </Empty>
      ) : (
        <div style={{ marginTop: '12px' }}>
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setOpenId(row.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: `1px solid ${C.hairline}`,
                borderRadius: '4px',
                padding: '10px 12px',
                marginBottom: '8px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {row.unread ? (
                  <span
                    aria-hidden
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: C.orange,
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                <span style={{ fontSize: '13px', color: C.text }}>
                  {row.subject ?? row.preview}
                </span>
                <RequesterTag requester={row.requester} />
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: C.faint }}>
                  {when(row.lastMessageAt)}
                </span>
              </span>
              <span
                style={{
                  display: 'block',
                  marginTop: '4px',
                  fontSize: '12px',
                  color: C.dim,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.preview}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
