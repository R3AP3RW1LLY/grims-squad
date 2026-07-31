'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The live AI log.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "we also want realtime streaming logs for ai in the admin area for the AI, just dont show PC file
 * paths into this streaming logs servic please."
 *
 * Paths are stripped server-side inside `AiStreamService.emit`, which every line passes through —
 * one funnel, so the guarantee is structural rather than something each call site remembers. This
 * component deliberately does no filtering of its own: a second, weaker redactor here would invite
 * somebody to rely on it.
 *
 * ★ WHAT IT IS FOR, WHICH IS NOT AUDITING ★
 *
 * `ai_calls` answers "what did it say to that member last Tuesday". This answers "is it working
 * RIGHT NOW" — the question somebody actually has while a queue is filling up, a tunnel is being
 * set up, or posts are being held for no obvious reason.
 *
 * ★ OPT-IN, NOT ALWAYS-ON ★
 *
 * Connecting opens an SSE stream that stays open. Most visits to this tab are to clear a queue, not
 * to watch a log, and a stream nobody is reading is a held connection on both ends for the life of
 * the tab. So it starts closed and says what it is.
 */

interface LogLine {
  readonly at: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly kind: string;
  readonly message: string;
  readonly tookMs?: number;
}

/** Enough to show a pattern without turning the panel into an archive. */
const MAX_LINES = 200;

const LEVEL_COLOUR: Record<LogLine['level'], string> = {
  info: 'text-[var(--color-text-secondary)]',
  warn: 'text-[var(--color-brand-orange)]',
  error: 'text-[var(--color-brand-orange)]',
};

export function AiLogPanel() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [state, setState] = useState<'idle' | 'connecting' | 'live' | 'lost'>('idle');
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    setState('connecting');
    const source = new EventSource('/v1/ai/stream');

    source.addEventListener('open', () => setState('live'));

    source.addEventListener('ai', (event) => {
      setState('live');
      try {
        const line = JSON.parse((event as MessageEvent<string>).data) as LogLine;
        /*
         * Bounded here as well as on the server. The server's ring buffer decides what a NEW
         * subscriber receives; this decides what a tab left open all evening accumulates, which is
         * otherwise unbounded browser memory.
         */
        setLines((prev) => [...prev, line].slice(-MAX_LINES));
      } catch {
        // A malformed line is not worth breaking the panel over.
      }
    });

    source.addEventListener('error', () => {
      /*
       * EventSource reconnects by itself, so this is "lost" rather than "failed" — saying "error"
       * would have somebody investigating a stream that is already coming back.
       */
      setState('lost');
    });

    return () => source.close();
  }, [open]);

  // Follow the tail, which is the only part anybody is reading.
  useEffect(() => {
    const box = boxRef.current;
    if (box !== null) box.scrollTop = box.scrollHeight;
  }, [lines]);

  return (
    <section className="rounded border border-[var(--color-border-hairline)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
            Live AI log
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            What the AI is doing right now. Machine paths are stripped before it leaves the server.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            if (open) {
              setLines([]);
              setState('idle');
            }
          }}
          className="rounded border border-[var(--color-brand-cyan-bright)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]"
        >
          {open ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      {open && (
        <>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
            {state === 'connecting' && 'connecting…'}
            {state === 'live' && `live · ${lines.length} line${lines.length === 1 ? '' : 's'}`}
            {state === 'lost' && 'connection lost — retrying'}
          </p>

          <div
            ref={boxRef}
            className="mt-3 max-h-80 overflow-y-auto rounded bg-[var(--color-surface-panel-sunken)] p-4 font-mono text-xs"
            // A log is a live region, but an assertive one would read every line aloud to a screen
            // reader as it arrives. Polite lets somebody hear it when they pause.
            aria-live="polite"
          >
            {lines.length === 0 ? (
              <p className="text-[var(--color-text-secondary)]">
                Connected. Nothing has happened yet — screen a post or generate artwork to see it
                here.
              </p>
            ) : (
              <ul className="space-y-1">
                {lines.map((line, i) => (
                  <li key={`${line.at}-${i}`} className={LEVEL_COLOUR[line.level]}>
                    <span className="text-[var(--color-text-secondary)]">
                      {new Date(line.at).toLocaleTimeString('en-GB')}
                    </span>{' '}
                    <span className="uppercase">[{line.kind}]</span> {line.message}
                    {line.tookMs !== undefined && (
                      <span className="text-[var(--color-text-secondary)]">
                        {' '}
                        ({line.tookMs}ms)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
