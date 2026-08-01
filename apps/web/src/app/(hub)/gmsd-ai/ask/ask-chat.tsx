'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost } from '../../../../lib/api-client';

/**
 * Asking GMSD AI.
 *
 * ★ THE SURFACE EVERYTHING ELSE WAS BUILT FOR ★
 *
 * The galaxy import, the market flattening, the EDDN collector, the embedder — all of it existed to
 * answer questions nobody could yet ask. This is where a member asks.
 *
 * ★ SOURCES ARE PART OF THE ANSWER, NOT A FOOTNOTE ★
 *
 * Every reply shows what it was built from. That is not decoration and it is not an apology for the
 * model: it is the only way a member can tell a retrieved fact from a generated sentence. A price
 * with a station and a date beside it can be checked; the same price in a paragraph cannot.
 *
 * It also sets the right expectation. Somebody who can see that an answer came from six stations
 * and a guide understands what this is — a search over squadron data with a model reading it out —
 * rather than an oracle that happens to know about Elite.
 */

interface Source {
  source: string;
  kind: string;
  name: string;
  text: string;
  url: string | null;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

/**
 * Questions offered when the page is empty.
 *
 * ★ THEY TEACH THE SHAPE, NOT THE SUBJECT ★
 *
 * An empty text box next to something called an assistant is a test a member can fail. These are
 * one of each KIND of question it can answer — a price, a place, a ship, a guide — so the first
 * thing anybody learns is what it is for, rather than that it did not understand them.
 */
const EXAMPLES = [
  'Where can I sell Painite?',
  'What does a Krait Mk II hold?',
  'What stations are within 30ly of Deciat?',
  'Where can I buy Tritium near Sol?',
];

export function AskChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadId = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only once there is something to scroll to, or the page jumps on first paint.
    if (turns.length > 0) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (q === '' || busy) return;

      setBusy(true);
      setError(null);
      setQuestion('');

      /*
       * The question is shown IMMEDIATELY, before the request goes out.
       *
       * An answer takes ten to fifteen seconds — the model is a 7B running on the same card that
       * serves post screening. Leaving the box empty and the transcript unchanged for that long
       * reads as a page that swallowed the question, and the member asks it again.
       */
      const asked: Turn = { role: 'user', content: q };
      const history = turns.map((t) => ({ role: t.role, content: t.content }));
      setTurns((prev) => [...prev, asked]);

      try {
        const r = await apiPost<{ answer: string; sources: Source[]; threadId: string }>(
          '/v1/ai/ask',
          { question: q, history, ...(threadId.current === null ? {} : { threadId: threadId.current }) },
          'GMSD AI could not answer that.',
        );
        // Minted by the server on the first question and echoed back, so every turn of this
        // conversation lands in one thread for review.
        threadId.current = r.threadId;
        setTurns((prev) => [...prev, { role: 'assistant', content: r.answer, sources: r.sources }]);
      } catch (e) {
        setError((e as Error).message);
        // The question is taken back out. Leaving it above an error reads as though it was asked
        // and ignored, and the member cannot tell whether to ask again.
        setTurns((prev) => prev.slice(0, -1));
        setQuestion(q);
      } finally {
        setBusy(false);
      }
    },
    [busy, turns],
  );

  return (
    <div className="mt-6">
      {turns.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6">
          <p className="text-[var(--color-text-primary)]">
            Ask about market prices, systems and stations, ships and modules, or our own guides.
            Answers are built from squadron data — if it is not in there, it says so rather than
            guessing.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => void send(e)}
                className="rounded-full border border-[var(--color-border-hairline)] px-4 py-2 text-sm text-[var(--color-brand-cyan-bright)] transition-colors hover:border-[var(--color-brand-cyan-bright)]"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {turns.length > 0 && (
        <div className="space-y-5">
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[42rem] rounded-lg border border-[var(--color-brand-cyan-bright)]/40 bg-[var(--color-surface-panel)] px-4 py-3 text-[var(--color-text-primary)]">
                  {t.content}
                </p>
              </div>
            ) : (
              <div key={i} className="max-w-[52rem]">
                <p className="whitespace-pre-wrap rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3 text-[var(--color-text-primary)]">
                  {t.content}
                </p>
                {t.sources !== undefined && t.sources.length > 0 && <Sources sources={t.sources} />}
              </div>
            ),
          )}

          {busy && (
            <p className="max-w-[52rem] rounded-lg border border-[var(--color-border-hairline)] px-4 py-3 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
              Searching squadron data…
            </p>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error !== null && (
        <p
          role="alert"
          className="mt-5 rounded border border-[var(--color-brand-orange)] bg-[var(--color-brand-orange)]/5 px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {error}
        </p>
      )}

      <form
        className="mt-6 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          disabled={busy}
          placeholder="Ask about prices, systems, ships or our guides"
          maxLength={500}
          className="min-w-0 flex-1 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-4 py-3 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-cyan-bright)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || question.trim() === ''}
          className="rounded border border-[var(--color-brand-cyan-bright)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}

/**
 * What the answer was built from.
 *
 * Collapsed by default: the answer is the answer, and eight rows of station data under every reply
 * would bury the next question. Open is one click for anybody who wants to check.
 */
function Sources({ sources }: { sources: Source[] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] hover:text-[var(--color-brand-cyan-bright)]">
        {sources.length} source{sources.length === 1 ? '' : 's'}
      </summary>
      <ul className="mt-3 space-y-2">
        {sources.map((s, i) => (
          <li
            key={i}
            className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-brand-cyan-bright)]">
              {s.source}
            </span>{' '}
            {s.url === null ? (
              <span className="text-[var(--color-text-primary)]">{s.name}</span>
            ) : (
              <a href={s.url} className="text-[var(--color-text-primary)] underline underline-offset-4">
                {s.name}
              </a>
            )}
            <span className="block pt-1">{s.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
