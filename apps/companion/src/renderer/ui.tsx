import type { JSX } from 'preact';

/**
 * The pieces every panel is built from.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we need the companion app to have a nice Navigation UI ... its time to really take the companion
 * app to the next level."
 *
 * Shared so the panels look like one application rather than five screens that happen to be in the
 * same window — which is what happens when each one grows its own idea of a heading.
 *
 * The palette is the website's, taken from the same tokens the site ships. "Matches the website"
 * has to be literal, or it is just an aspiration in a commit message.
 */

export const C = {
  void: '#070b0e',
  panel: '#0e141a',
  raised: '#151d25',
  hairline: 'rgba(255,255,255,0.08)',
  subtle: 'rgba(255,255,255,0.16)',
  text: '#e8eef2',
  dim: 'rgba(232,238,242,0.62)',
  faint: 'rgba(232,238,242,0.38)',
  cyan: '#3fd0d4',
  orange: '#ff7a33',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
} as const;

export function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: preact.ComponentChildren;
  aside?: preact.ComponentChildren;
}): JSX.Element {
  return (
    <section style={{ marginBottom: '22px' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '10px',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '11px',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: C.dim,
          }}
        >
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Card({
  children,
  accent,
}: {
  children: preact.ComponentChildren;
  accent?: string;
}): JSX.Element {
  return (
    <div
      style={{
        border: `1px solid ${accent ?? C.hairline}`,
        background: C.panel,
        borderRadius: '10px',
        padding: '14px 16px',
      }}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  tone = 'default',
  disabled,
  type = 'button',
}: {
  children: preact.ComponentChildren;
  onClick?: () => void;
  tone?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}): JSX.Element {
  const border = tone === 'primary' ? C.cyan : tone === 'danger' ? C.bad : C.subtle;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled === true}
      style={{
        border: `1px solid ${border}`,
        background: tone === 'primary' ? `${C.cyan}1a` : C.raised,
        color: tone === 'primary' ? C.cyan : tone === 'danger' ? C.bad : C.text,
        borderRadius: '7px',
        padding: '7px 14px',
        fontSize: '13px',
        cursor: disabled === true ? 'default' : 'pointer',
        opacity: disabled === true ? 0.55 : 1,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

export const inputStyle: JSX.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${C.hairline}`,
  background: C.void,
  color: C.text,
  borderRadius: '7px',
  padding: '8px 10px',
  fontSize: '13px',
  fontFamily: 'inherit',
  outline: 'none',
};

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: preact.ComponentChildren;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <span
        style={{
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '9px',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: C.faint,
        }}
      >
        {label}
      </span>
      {children}
      {hint === undefined ? null : (
        <span style={{ fontSize: '11px', color: C.faint }}>{hint}</span>
      )}
    </label>
  );
}

/** Something went wrong, said in a sentence rather than left as an empty panel. */
export function Problem({ children }: { children: preact.ComponentChildren }): JSX.Element {
  return (
    <p
      style={{
        margin: 0,
        border: `1px solid ${C.warn}`,
        background: C.panel,
        borderRadius: '8px',
        padding: '10px 12px',
        fontSize: '13px',
        color: C.warn,
      }}
    >
      {children}
    </p>
  );
}

export function Empty({ children }: { children: preact.ComponentChildren }): JSX.Element {
  return <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>{children}</p>;
}

/** A labelled number. Tabular figures, so a column of them does not jitter as they change. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): JSX.Element {
  return (
    <div>
      <p
        style={{
          margin: 0,
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '9px',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: C.faint,
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: '4px 0 0',
          fontSize: '20px',
          fontVariantNumeric: 'tabular-nums',
          color: tone ?? C.text,
        }}
      >
        {value}
      </p>
    </div>
  );
}

/** Progress, drawn only when the total is genuinely known. See the note in `Bar`. */
export function Bar({ done, total }: { done: number; total: number }): JSX.Element | null {
  /*
   * Null rather than an empty bar when the total is unknown. A bar at 0% is a claim that nothing has
   * been delivered, which is a different statement from "we do not know how much this build wants" —
   * and the second is the normal state for a project nobody has docked at yet.
   */
  if (total <= 0) return null;

  const pct = Math.max(0, Math.min(100, (done / total) * 100));
  return (
    <div
      style={{ height: '4px', background: C.raised, borderRadius: '3px', overflow: 'hidden' }}
      role="img"
      aria-label={`${Math.round(pct)} per cent delivered`}
    >
      <div style={{ height: '100%', width: `${pct}%`, background: C.cyan }} />
    </div>
  );
}

export const tonnes = (n: number): string => `${n.toLocaleString()} t`;
export const credits = (n: number): string => `${n.toLocaleString()} cr`;
