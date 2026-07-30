'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * The @mention autocomplete.
 *
 * ★ BUILT HERE RATHER THAN PULLED IN ★
 *
 * TipTap ships a suggestion plugin. It is not used, for the same reason the image and video nodes
 * are ours: it renders its own popup with its own positioning library and its own styling, and the
 * instruction on this project has been "keep the styling and branding in line with the current
 * website, this is non negotiable". A dropdown that arrives with a third-party stylesheet is a
 * dropdown that does not match the site.
 *
 * The mechanism is small enough to own: watch the text before the caret for an `@` run, ask the
 * server who can be mentioned, and on a pick replace that run with marked text.
 *
 * ★ THE TRIGGER MUST NOT FIRE INSIDE AN EMAIL ADDRESS ★
 *
 * `#activeQuery` requires the `@` to be at the start of the block or preceded by whitespace.
 * Without that, typing an email address opens a member search halfway through it — and the first
 * Enter, meant for the next line, picks a name instead.
 */

export interface MentionCandidate {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string | null;
  readonly avatarUrl?: string | null;
}

/** The `@` run immediately before the caret, or null. */
function activeQuery(editor: Editor): { from: number; to: number; query: string } | null {
  const { state } = editor;
  const { from, empty } = state.selection;
  // A selection spanning text is somebody highlighting, not typing a name.
  if (!empty) return null;

  const block = state.doc.resolve(from);
  const start = block.start();
  const before = state.doc.textBetween(start, from, '\n', '\n');

  const match = /(^|\s)@([\p{L}\p{N}_.-]{0,32})$/u.exec(before);
  if (match === null) return null;

  const typed = match[2] ?? '';
  return { from: from - typed.length - 1, to: from, query: typed };
}

export function MentionAutocomplete({
  editor,
  threadId,
}: {
  readonly editor: Editor | null;
  /** Candidates are scoped to a thread: mentioning somebody who cannot read it does nothing. */
  readonly threadId: string;
}) {
  const [state, setState] = useState<{
    range: { from: number; to: number };
    query: string;
  } | null>(null);
  const [results, setResults] = useState<readonly MentionCandidate[]>([]);
  const [highlight, setHighlight] = useState(0);

  /*
   * ★ A SEQUENCE NUMBER, SO A SLOW RESPONSE CANNOT OVERWRITE A FAST ONE ★
   *
   * The same guard the grant multi-select carries. Typing "peb" issues three requests, and without
   * this the reply for "pe" arriving after the reply for "peb" replaces correct results with stale
   * ones — a dropdown that flickers back to the wrong list as you type.
   */
  const seq = useRef(0);

  // Watch the caret.
  useEffect(() => {
    if (editor === null) return;
    const sync = () => {
      const active = activeQuery(editor);
      if (active === null) {
        setState(null);
        setResults([]);
        return;
      }
      setState({ range: { from: active.from, to: active.to }, query: active.query });
    };
    editor.on('selectionUpdate', sync);
    editor.on('update', sync);
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('update', sync);
    };
  }, [editor]);

  // Fetch, debounced.
  useEffect(() => {
    if (state === null || state.query.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void fetch(
        `/v1/forum/threads/${encodeURIComponent(threadId)}/mention-candidates?q=${encodeURIComponent(state.query)}`,
        { credentials: 'same-origin' },
      )
        .then((r) => (r.ok ? r.json() : { candidates: [] }))
        .then((body: { candidates?: MentionCandidate[] }) => {
          if (mine !== seq.current) return;
          setResults(body.candidates ?? []);
          setHighlight(0);
        })
        .catch(() => {
          if (mine === seq.current) setResults([]);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [state, threadId]);

  const pick = useCallback(
    (c: MentionCandidate) => {
      if (editor === null || state === null) return;
      const label = c.displayName ?? c.handle;
      editor
        .chain()
        .focus()
        .insertContentAt(state.range, [
          { type: 'text', text: `@${label}`, marks: [{ type: 'mention', attrs: { userId: c.userId } }] },
          /*
           * A trailing SPACE, unmarked. Without it the next character typed continues inside the
           * mention mark, so the rest of the sentence becomes part of somebody's name.
           */
          { type: 'text', text: ' ' },
        ])
        .run();
      setState(null);
      setResults([]);
    },
    [editor, state],
  );

  /*
   * Keyboard handling on the DOCUMENT, captured before ProseMirror sees it.
   *
   * Arrow keys and Enter mean something different while this list is open, and the editor would
   * otherwise move the caret or split the paragraph. Bound only while there are results, so normal
   * typing is never intercepted.
   */
  useEffect(() => {
    if (results.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + results.length) % results.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const chosen = results[highlight];
        if (chosen !== undefined) {
          e.preventDefault();
          pick(chosen);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setResults([]);
        setState(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [results, highlight, pick]);

  if (results.length === 0) return null;

  return (
    <div
      /*
       * Anchored under the toolbar rather than floated at the caret. Caret-following popups need
       * measurement, a scroll listener and a flip-when-clipped rule; this is one position that is
       * always visible and never covers what is being typed.
       */
      role="listbox"
      aria-label="Members you can mention"
      className="mt-1 max-h-56 overflow-y-auto rounded border border-[var(--color-border-active)] bg-[var(--color-surface-panel)] shadow-lg"
    >
      {results.map((c, i) => (
        <button
          key={c.userId}
          type="button"
          role="option"
          aria-selected={i === highlight}
          // `onMouseDown` with preventDefault: a click would otherwise blur the editor first and
          // collapse the range the insertion is about to replace.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(c);
          }}
          onMouseEnter={() => setHighlight(i)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
            i === highlight
              ? 'bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          <span className="truncate text-[var(--color-text-primary)]">
            {c.displayName ?? c.handle}
          </span>
          <span className="truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
            {c.handle}
          </span>
        </button>
      ))}
    </div>
  );
}
