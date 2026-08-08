import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { rankSystemChoices, type SystemChoice } from '@grims/shared/system-picker';
import { C, inputStyle } from './ui.js';

/** Defined locally, as every other renderer screen does — it is two properties, not a dependency. */
const MONO: JSX.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
};

/**
 * A system box that remembers, in the app.
 *
 * ★ THE SAME LIST AS THE WEBSITE, AND THE SAME ORDER ★
 *
 * Seven boxes here ask for a system and seven more do on the site. They share one table, one
 * service and one ranking — `rankSystemChoices` in @grims/shared — because a member who pins
 * something in the browser and cannot find it on the second monitor would rightly stop trusting the
 * star. Writing the order twice is how those two lists quietly diverge.
 *
 * ★ IT MUST NEVER BE WORSE THAN THE INPUT IT REPLACES ★
 *
 * Every call fails silently to an empty list. An unpaired device, a hub that is down, a timeout —
 * in every case the member is left with a working text field, which is what they had before.
 */

declare const window: {
  systems?: {
    saved(): Promise<{ ok: boolean; data?: SystemChoice[] }>;
    use(system: string, systemId64?: string): Promise<unknown>;
    pin(system: string, label?: string): Promise<unknown>;
    unpin(system: string): Promise<unknown>;
  };
} & Window;

const BADGE: Readonly<Record<string, string>> = {
  here: 'you are here',
  pinned: 'pinned',
  project: 'project',
  carrier: 'carrier',
  recent: 'recent',
  galaxy: '',
};

interface Props {
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly placeholder?: string | undefined;
  /** Where the commander is standing, when the app knows. Offered above everything else. */
  readonly here?: string | null | undefined;
  readonly style?: JSX.CSSProperties | undefined;
  /** Fired when a suggestion is CHOSEN, so a page can search immediately. */
  readonly onPick?: ((system: string) => void) | undefined;
  /**
   * What Enter does when the member is NOT picking from the list.
   *
   * The scout runs its search on Enter, and swallowing that to serve a dropdown would take away a
   * behaviour somebody already has. Enter chooses when a suggestion is highlighted and does this
   * otherwise — which is what every search box in the app already does.
   */
  readonly onEnter?: (() => void) | undefined;
}

export function SystemPicker({
  value,
  onValueChange,
  placeholder,
  here = null,
  style,
  onPick,
  onEnter,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<readonly SystemChoice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  /*
   * Loaded on first focus, not on mount. Several of these can share a screen — the colonisation
   * page has more than one — and mounting them should not fire a request each before anybody has
   * clicked anything.
   */
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    void (async () => {
      try {
        const r = await window.systems?.saved();
        if (r?.ok === true && Array.isArray(r.data)) setMarks(r.data);
      } catch {
        /* A dropdown is not worth an error message. */
      }
    })();
  }, [open, loaded]);

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
    return rankSystemChoices(value, [...hereChoice, ...marks]).slice(0, 8);
  }, [value, here, marks]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(c: SystemChoice): void {
    onValueChange(c.name);
    setOpen(false);
    void window.systems?.use(c.name, c.systemId64 ?? undefined);
    onPick?.(c.name);
  }

  function togglePin(c: SystemChoice, e: Event): void {
    // The row underneath would otherwise take the click and close the dropdown.
    e.preventDefault();
    e.stopPropagation();

    const pinning = c.source !== 'pinned';
    setMarks((prev) => {
      const rest = prev.filter((x) => x.name.toLowerCase() !== c.name.toLowerCase());
      return [{ ...c, source: pinning ? ('pinned' as const) : ('recent' as const) }, ...rest];
    });
    void (pinning ? window.systems?.pin(c.name) : window.systems?.unpin(c.name));
  }

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input
        value={value}
        placeholder={placeholder}
        style={{ ...inputStyle, ...style }}
        onInput={(e) => {
          onValueChange((e.target as HTMLInputElement).value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || choices.length === 0) {
            // Nothing to pick from, so Enter means whatever it meant before the picker existed.
            if (e.key === 'Enter') onEnter?.();
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % choices.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + choices.length) % choices.length);
          } else if (e.key === 'Enter') {
            const picked = choices[active];
            // Only swallow Enter when it is genuinely choosing something — otherwise the member is
            // submitting, which is what Enter does everywhere else in this app.
            if (picked !== undefined) {
              e.preventDefault();
              choose(picked);
            } else {
              onEnter?.();
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />

      {open && choices.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 50,
            top: '100%',
            left: 0,
            minWidth: '220px',
            width: '100%',
            marginTop: '3px',
            maxHeight: '240px',
            overflowY: 'auto',
            background: C.raised,
            border: `1px solid ${C.subtle}`,
            borderRadius: '4px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.45)',
          }}
        >
          {choices.map((c, i) => (
            <div
              key={`${c.source}:${c.name}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c)}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '8px',
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: '12px',
                background: i === active ? C.hover : 'transparent',
                color: i === active ? C.text : C.dim,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.label ?? c.name}
              </span>
              {c.label == null ? null : (
                <span style={{ fontSize: '10px', color: C.faint }}>{c.name}</span>
              )}
              {BADGE[c.source] === '' ? null : (
                <span
                  style={{
                    ...MONO,
                    marginLeft: 'auto',
                    fontSize: '9px',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: C.faint,
                  }}
                >
                  {BADGE[c.source]}
                </span>
              )}
              <span
                title={c.source === 'pinned' ? 'Unpin' : 'Pin this system'}
                onClick={(e) => togglePin(c, e as unknown as Event)}
                style={{
                  flexShrink: 0,
                  padding: '0 3px',
                  color: c.source === 'pinned' ? C.orangeBright : C.faint,
                }}
              >
                ★
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
