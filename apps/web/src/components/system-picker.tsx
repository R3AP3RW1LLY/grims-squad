'use client';

// The SUBPATH, not the barrel: this is a client component and the barrel reaches node:crypto,
// which webpack follows into an UnhandledSchemeError that takes down every hub page.
import {
  rankSystemChoices,
  type SystemChoice,
} from '@grims/shared/system-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiCall } from '../lib/api-client';

/**
 * A system box that remembers.
 *
 * ★ SQUADRON OWNER, 2026-08-08 ★
 *
 * "any where that asks to enter a system ... saves entries and keeps them in a dropdown or a
 * 'book mark' system so that they can just find stuff they have entered quick instead of constantly
 * having to type this information in"
 *
 * Seven fields on this site ask for a system — the freight office, the commodities index, a
 * commodity's own page, a build's shopping list, build types, the scout and post-project — and the
 * app has seven more. Every one was a bare text box. This replaces the box, not the form: it still
 * renders a real `<input name=…>`, so the plain GET forms it drops into keep working exactly as
 * they did and the rollout is a one-line swap in each place.
 *
 * ★ IT IS NOT ONLY A CONVENIENCE ★
 *
 * On 2026-08-07 the owner typed his own system into the scout and was told "We hold no coordinates
 * for COL 285 SECTOR GL-W C2-12. Check the spelling — it has to match the game." The spelling was
 * perfect; we simply did not hold the system, and the error blamed him. A box that offers what we
 * actually have cannot produce that sentence.
 *
 * ★ IT MUST NEVER BE WORSE THAN THE INPUT IT REPLACES ★
 *
 * Every network call here fails silently to an empty list. A signed-out visitor gets a 401 from the
 * marks endpoint and simply sees galaxy suggestions; somebody offline sees none. In every failure
 * the member is left with a working text field, which is what they had before.
 */

interface Props {
  /** The form field name. Kept, because the surrounding GET forms submit it. */
  readonly name: string;
  readonly defaultValue?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly className?: string | undefined;
  /** Where the commander is standing, when the page knows. Offered above everything else. */
  readonly here?: string | null | undefined;
  readonly required?: boolean | undefined;
  /**
   * Controlled mode.
   *
   * ★ BOTH MODES, BECAUSE THE SEVEN FIELDS ARE NOT ALIKE ★
   *
   * Most of them are plain GET forms that read the submitted value off the query string, and want
   * nothing more than a `defaultValue`. But the commodity page's origin box drives a live re-fetch
   * from React state and owns its value. Supporting only the first would have meant leaving that
   * one as a bare text input — the "mostly rolled out" outcome that makes a feature feel unfinished.
   */
  readonly value?: string | undefined;
  readonly onValueChange?: ((next: string) => void) | undefined;
}

const SOURCE_BADGE: Readonly<Record<string, string>> = {
  here: 'you are here',
  pinned: 'pinned',
  project: 'project',
  carrier: 'carrier',
  recent: 'recent',
  galaxy: '',
};

export function SystemPicker({
  name,
  defaultValue = '',
  placeholder,
  className = '',
  here = null,
  required = false,
  value: controlled,
  onValueChange,
}: Props) {
  const [own, setOwn] = useState(defaultValue);
  const value = controlled ?? own;

  /** One setter for both modes, so nothing below has to know which one it is in. */
  const setValue = (next: string): void => {
    if (controlled === undefined) setOwn(next);
    onValueChange?.(next);
  };
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<readonly SystemChoice[]>([]);
  const [galaxy, setGalaxy] = useState<readonly SystemChoice[]>([]);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  /*
   * The member's own systems, fetched once on first focus rather than on mount. Seven of these can
   * be on one page — the shopping list has one per build — and mounting them should not fire seven
   * identical requests before anybody has clicked anything.
   */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    void (async () => {
      try {
        const res = await fetch('/v1/me/systems', { credentials: 'include' });
        if (!res.ok) return; // 401 for a signed-out visitor. Galaxy suggestions still work.
        const body = (await res.json()) as { systems?: SystemChoice[] };
        setMarks(body.systems ?? []);
      } catch {
        /* A dropdown is not worth an error message. */
      }
    })();
  }, [open, loaded]);

  /* Type-ahead over the galaxy, debounced. Two characters minimum, matching the endpoint. */
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setGalaxy([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/v1/market/systems?q=${encodeURIComponent(q)}`, {
            credentials: 'include',
          });
          if (!res.ok) return;
          const body = (await res.json()) as { systems?: Array<{ name: string; id64?: string }> };
          setGalaxy(
            (body.systems ?? []).map((s) => ({
              name: s.name,
              systemId64: s.id64 ?? null,
              source: 'galaxy' as const,
              label: null,
              lastUsedAt: 0,
              useCount: 0,
            })),
          );
        } catch {
          /* ignored, see the note at the top */
        }
      })();
    }, 180);
    return () => clearTimeout(timer);
  }, [value]);

  const choices = useMemo(() => {
    const hereChoice: SystemChoice[] =
      here == null || here.trim() === ''
        ? []
        : [
            {
              name: here,
              systemId64: null,
              source: 'here' as const,
              label: null,
              lastUsedAt: Number.MAX_SAFE_INTEGER,
              useCount: 0,
            },
          ];
    return rankSystemChoices(value, [...hereChoice, ...marks, ...galaxy]).slice(0, 10);
  }, [value, here, marks, galaxy]);

  /* Click anywhere else closes it. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(choice: SystemChoice): void {
    setValue(choice.name);
    setOpen(false);
    // Fire and forget: recording a use must never be able to fail a search that worked.
    void apiCall('POST', '/v1/me/systems/use', {
      body: { system: choice.name, systemId64: choice.systemId64 ?? undefined },
    }).catch(() => undefined);
  }

  async function togglePin(choice: SystemChoice, e: React.MouseEvent): Promise<void> {
    // The row underneath would otherwise take the click and close the dropdown.
    e.preventDefault();
    e.stopPropagation();

    const pinning = choice.source !== 'pinned';
    setMarks((prev) => {
      const rest = prev.filter((c) => c.name.toLowerCase() !== choice.name.toLowerCase());
      return pinning
        ? [{ ...choice, source: 'pinned' }, ...rest]
        : [{ ...choice, source: 'recent' }, ...rest];
    });

    try {
      await (pinning
        ? apiCall('POST', '/v1/me/systems/pin', { body: { system: choice.name } })
        : apiCall('DELETE', `/v1/me/systems/pin?system=${encodeURIComponent(choice.name)}`));
    } catch {
      /* The optimistic state stands; the next open re-reads the truth. */
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (!open || choices.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % choices.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + choices.length) % choices.length);
    } else if (e.key === 'Enter') {
      const picked = choices[active];
      // Only swallow the Enter if it is actually choosing something — otherwise the member is
      // submitting the form, which is what Enter does in every other field on the page.
      if (picked !== undefined) {
        e.preventDefault();
        choose(picked);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={box} className="relative">
      <input
        name={name}
        value={value}
        required={required}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          setValue(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open && choices.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full min-w-[220px] overflow-y-auto rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-raised)] py-1 shadow-lg"
        >
          {choices.map((c, i) => (
            <li key={`${c.source}:${c.name}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                  i === active
                    ? 'bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                <span className="truncate">{c.label ?? c.name}</span>
                {c.label === null || c.label === undefined ? null : (
                  <span className="truncate text-[10px] text-[var(--color-text-dim)]">{c.name}</span>
                )}
                {SOURCE_BADGE[c.source] === '' ? null : (
                  <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
                    {SOURCE_BADGE[c.source]}
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={c.source === 'pinned' ? `Unpin ${c.name}` : `Pin ${c.name}`}
                  title={c.source === 'pinned' ? 'Unpin' : 'Pin this system'}
                  onClick={(e) => void togglePin(c, e)}
                  className={`shrink-0 px-1 ${
                    c.source === 'pinned'
                      ? 'text-[var(--color-brand-orange-bright)]'
                      : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  ★
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
