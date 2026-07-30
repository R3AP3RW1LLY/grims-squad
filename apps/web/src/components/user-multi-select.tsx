'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  type Candidate,
  DEBOUNCE_MS,
  emptyStateFor,
  isCurrentResponse,
  labelFor,
  nextHighlight,
  shouldQuery,
  visibleCandidates,
} from './user-multi-select-rules';

/**
 * A searchable, autocompleting multi-select of commanders.
 *
 * Squadron owner, 2026-07-29: "a dropdown on the post that allows an admin to allow
 * access to one or more users (multi select dropdown that is searchable and
 * autocompletable)".
 *
 * ★ STYLING FOLLOWS THE SITE, WHICH IS NON-NEGOTIABLE ★
 *
 * Owner, same phase: "keep the styling and branding in line with the current website
 * please! this is non negotiable!" So there is no component library here and no new
 * palette — every colour is an existing design token, the border radius and hairline
 * borders match `Panel`, and the focus ring is the one the rest of the hub uses.
 *
 * A combobox is the kind of widget that arrives with its own design language attached,
 * and that is precisely what must not happen.
 *
 * Two of the tokens this file first reached for did not exist — a "raised" surface and
 * a generic "accent" — and `theme-tokens.spec` caught both. Worth knowing why that
 * guard matters: CSS does not warn about an undefined custom property. The declaration
 * is simply invalid, the element inherits its parent's colour, and the page looks
 * subtly wrong while every test passes.
 *
 * The same guard also caught this comment naming the token pattern literally, which it
 * read as a token called `--color-`. Hence the circumlocution above.
 *
 * ★ AND WHY IT IS HAND-WRITTEN RATHER THAN A DEPENDENCY ★
 *
 * The obvious move is a combobox package. That means a bundle, a stylesheet to
 * override, and a second set of design decisions to fight. The behaviour that
 * actually matters — debounce, out-of-order responses, keyboard handling — is a small
 * amount of logic, and it lives in `user-multi-select-rules.ts` where it is tested
 * directly.
 *
 * ★ ACCESSIBILITY IS NOT DECORATION HERE ★
 *
 * `role="combobox"` with `aria-expanded`, `aria-controls` and `aria-activedescendant`,
 * because a div with click handlers is invisible to a screen reader and unusable from
 * a keyboard. An admin tool that only works with a mouse is a tool somebody cannot
 * use.
 */

export interface UserMultiSelectProps {
  /** Already-selected people, shown as chips. Owned by the parent. */
  readonly selected: readonly Candidate[];
  readonly onChange: (next: readonly Candidate[]) => void;
  /** Runs the search. Injected so tests and Storybook need no network. */
  readonly search: (query: string) => Promise<readonly Candidate[]>;
  readonly label: string;
  readonly describedBy?: string;
  readonly disabled?: boolean;
}

export function UserMultiSelect({
  selected,
  onChange,
  search,
  label,
  describedBy,
  disabled = false,
}: UserMultiSelectProps) {
  const [raw, setRaw] = useState('');
  const [results, setResults] = useState<readonly Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [failed, setFailed] = useState(false);

  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * ★ THE SEQUENCE NUMBER THAT MAKES RESULTS TRUSTWORTHY ★
   *
   * A ref rather than state: it must be readable and writable synchronously inside
   * the effect, and a re-render between issuing a request and recording its number is
   * exactly the window that would break it. See `isCurrentResponse` for the bug.
   */
  const seq = useRef(0);

  useEffect(() => {
    if (disabled) return;

    if (!shouldQuery(raw)) {
      // Short queries are never sent — matching the server, which refuses them so a
      // one-character query cannot be used to walk the roster.
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }

    const mine = ++seq.current;
    setLoading(true);
    setFailed(false);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await search(raw.trim());
          // Discarded if a later keystroke has already issued a newer request.
          if (!isCurrentResponse(mine, seq.current)) return;
          setResults(found);
          setHighlight(found.length > 0 ? 0 : -1);
        } catch {
          if (!isCurrentResponse(mine, seq.current)) return;
          /*
           * Surfaced rather than swallowed. A silent failure here looks identical to
           * "nobody matches", which would have an admin conclude a colleague has no
           * account when in fact the request failed.
           */
          setFailed(true);
          setResults([]);
        } finally {
          if (isCurrentResponse(mine, seq.current)) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [raw, search, disabled]);

  const shown = visibleCandidates(results, selected.map((s) => s.userId));

  const add = useCallback(
    (c: Candidate) => {
      if (selected.some((s) => s.userId === c.userId)) return;
      onChange([...selected, c]);
      /*
       * The query is cleared but the box stays FOCUSED and OPEN. Granting access to
       * three people is one task, and making somebody click back into the field
       * between each name turns it into three.
       */
      setRaw('');
      setResults([]);
      setHighlight(-1);
      inputRef.current?.focus();
    },
    [onChange, selected],
  );

  const remove = useCallback(
    (userId: string) => onChange(selected.filter((s) => s.userId !== userId)),
    [onChange, selected],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => nextHighlight(h, shown.length, e.key === 'ArrowDown' ? 'down' : 'up'));
      return;
    }
    if (e.key === 'Enter') {
      const pick = shown[highlight];
      if (pick !== undefined) {
        // Only when a row is highlighted, so Enter in a form with nothing selected
        // submits the form rather than being swallowed.
        e.preventDefault();
        add(pick);
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Backspace' && raw === '' && selected.length > 0) {
      /*
       * Backspace on an empty box removes the last chip — the convention every
       * tag input follows, and the thing people try first.
       */
      const last = selected[selected.length - 1];
      if (last !== undefined) remove(last.userId);
    }
  }

  const empty = failed
    ? 'That search could not be completed. Try again in a moment.'
    : emptyStateFor(raw, loading, shown);

  return (
    <div className="space-y-2">
      <label
        htmlFor={`${listId}-input`}
        className="block text-sm font-medium text-[var(--color-text-primary)]"
      >
        {label}
      </label>

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Selected commanders">
          {selected.map((s) => (
            <li
              key={s.userId}
              className="inline-flex items-center gap-2 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-2 py-1 text-sm text-[var(--color-text-primary)]"
            >
              <span>{labelFor(s)}</span>
              <button
                type="button"
                onClick={() => remove(s.userId)}
                disabled={disabled}
                /*
                 * A named action, not a bare "×". A screen reader announcing "button
                 * times" tells somebody nothing about which chip they are on.
                 */
                aria-label={`Remove ${labelFor(s)}`}
                className="rounded text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            highlight >= 0 && shown[highlight] !== undefined
              ? `${listId}-opt-${shown[highlight]?.userId}`
              : undefined
          }
          aria-describedby={describedBy}
          autoComplete="off"
          disabled={disabled}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          /*
           * Closed on blur with a delay, because a mousedown on a result row blurs the
           * input before the click registers — closing immediately would make every
           * click-to-select silently do nothing. The keyboard path is unaffected.
           */
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="Search commanders…"
          className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:opacity-60"
        />

        {open && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] shadow-lg">
            {empty !== null ? (
              <p
                className="px-3 py-2 text-sm text-[var(--color-text-secondary)]"
                /* Announced, so a keyboard user learns the list is empty. */
                role="status"
              >
                {empty}
              </p>
            ) : (
              <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto">
                {shown.map((c, i) => (
                  <li
                    key={c.userId}
                    id={`${listId}-opt-${c.userId}`}
                    role="option"
                    aria-selected={i === highlight}
                    /*
                     * `onMouseDown` with preventDefault, not `onClick`: mousedown fires
                     * before the input's blur, so the selection lands even though the
                     * dropdown is about to close.
                     */
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(c);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                      i === highlight
                        ? 'bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)]'
                    }`}
                  >
                    <span className="truncate">{labelFor(c)}</span>
                    {c.alreadyHasAccess && (
                      /*
                       * Shown rather than filtered out. Hiding these would have an
                       * admin type a name, see nothing, and conclude the search is
                       * broken — when the real answer is "they can already read it".
                       */
                      <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                        already has access
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
