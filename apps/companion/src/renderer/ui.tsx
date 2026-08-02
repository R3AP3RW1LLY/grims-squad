import { Component, type ComponentChildren, type JSX } from 'preact';

/**
 * The pieces every panel is built from.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "brand/theme the companion app so it matches the website background and glass look. because this
 * looks really basic."
 *
 * Shared so the panels look like one application rather than five screens that happen to be in the
 * same window — which is what happens when each one grows its own idea of a heading.
 *
 * The palette is the website's, resolved from the same tokens the site ships. "Matches the website"
 * has to be literal, or it is just an aspiration in a commit message. The structural half of the
 * look — the starfield, the chamfered glass, every hover and focus state — is in theme.css, because
 * a JavaScript style object cannot express a pseudo-element or a media query.
 */

/**
 * ★ EVERY VALUE IS A HEX OR AN rgba(), DELIBERATELY ★
 *
 * These strings are handed to Chart.js, which puts them into canvas `fillStyle`. Canvas has its own
 * colour parser and it is not the CSS one: `color-mix()` and `var(--token)` both resolve there to
 * transparent black — a chart that silently draws nothing. The website writes its tints as
 * `color-mix(in srgb, X 12%, transparent)`; those are pre-resolved to rgba() here rather than
 * copied verbatim.
 *
 * The same rule killed an old landmine at the Button below, which built a tint by string
 * concatenation (`${C.cyan}1a`). That produces a valid colour only while the token happens to be
 * six-digit hex, and an invalid one the day somebody makes it an rgba(). Real tint tokens now.
 *
 * Source of truth: ssot/07-design/tokens.json, via apps/web/src/app/theme.generated.css.
 */
export const C = {
  void: '#05070a',
  panel: '#0b0f14',
  /** The glass fill: the panel colour at 82%, which is what the site's `.panel` resolves to. */
  panelGlass: 'rgba(11,15,20,0.82)',
  raised: '#121820',
  hover: '#18202a',
  sunken: '#080b10',

  hairline: 'rgba(255,113,0,0.18)',
  active: 'rgba(255,113,0,0.55)',
  subtle: 'rgba(147,164,184,0.14)',
  focus: '#ff9d3f',

  text: '#e8eef5',
  dim: '#93a4b8',
  faint: '#5b6b7d',
  onAccent: '#05070a',

  orange: '#ff7100',
  orangeBright: '#ff9d3f',
  orangeTint: 'rgba(255,113,0,0.12)',
  cyan: '#5cd9ff',
  cyanCore: '#00c8ff',
  cyanTint: 'rgba(92,217,255,0.12)',

  good: '#3dff8f',
  warn: '#ffc400',
  warnTint: 'rgba(255,196,0,0.07)',
  bad: '#ff7a7a',
  badTint: 'rgba(255,122,122,0.12)',
} as const;

/**
 * Radii.
 *
 * Panels are CHAMFERED rather than rounded — a cut corner, not a curve — which is done with a
 * clip-path in theme.css and has no radius at all. Controls keep the site's 4px.
 */
export const R = { control: '4px' } as const;

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
    <section style={{ marginBottom: '28px' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '14px',
        }}
      >
        <h2
          style={{
            margin: 0,
            // Display face, orange, uppercase, no tracking — the site's section heading exactly.
            fontFamily: 'var(--font-display)',
            fontSize: '15px',
            lineHeight: 1.4,
            textTransform: 'uppercase',
            color: C.orange,
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

/**
 * A panel of glass.
 *
 * ★ CHAMFERED AND TRANSLUCENT, NOT A ROUNDED BOX ★
 *
 * The site has two panel systems — this one and the hub's plain rounded boxes — and this is the one
 * the owner means by "the glass look". It is also the only one that works here: an opaque box would
 * sit on top of the starfield behind it and make the whole theme invisible.
 *
 * The visual is entirely in the `panel` class, because a clip-path corner and a backdrop blur are
 * not things an inline style object should be re-declaring on every card in the app.
 */
export function Card({
  children,
  accent,
  hud,
}: {
  children: preact.ComponentChildren;
  accent?: string;
  /** Corner brackets. For a panel that is instrumentation — never for a list of forty rows. */
  hud?: boolean;
}): JSX.Element {
  return (
    <div
      class={hud === true ? 'panel hud' : 'panel'}
      style={{
        padding: '14px 16px',
        // Overrides the class's border colour only. Everything else about the panel is shared.
        ...(accent === undefined ? {} : { borderColor: accent }),
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
  /*
   * ★ NO INLINE STYLE AT ALL, AND THAT IS THE POINT ★
   *
   * Colour, border and opacity all have to change on hover and when disabled. An inline value for
   * any of them outranks the stylesheet and freezes the control — see the long note in theme.css.
   * Everything visual about a button lives in `.btn` / `.btn-<tone>`.
   */
  return (
    <button type={type} onClick={onClick} disabled={disabled === true} class={`btn btn-${tone}`}>
      {children}
    </button>
  );
}

export const inputStyle: JSX.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${C.hairline}`,
  // The sunken surface, so a field reads as a hole in the panel rather than another panel on it.
  background: C.sunken,
  color: C.text,
  borderRadius: R.control,
  padding: '8px 10px',
  fontSize: '13px',
  // Mono, like every input on the site — what people type here is data.
  fontFamily: 'var(--font-mono)',
  /*
   * ★ NO `outline: none` HERE ★
   *
   * It was here, with a comment claiming the shared `:focus-visible` rule in theme.css would supply
   * the ring instead. It would not: an inline `outline` beats that rule the same way an inline
   * colour beats a hover rule, so every text field, the notes textarea and the overlay's select
   * had NO focus indicator at all. A keyboard user could not tell which field they were in.
   * accessibility.md treats that as a review-blocking defect and it is right to.
   */
};

/** The small tracked uppercase label. Mono on this site, not the display face. */
const LABEL: JSX.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  letterSpacing: '0.24em',
  textTransform: 'uppercase',
  color: C.dim,
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
      <span style={LABEL}>{label}</span>
      {children}
      {hint === undefined ? null : <span style={{ fontSize: '11px', color: C.faint }}>{hint}</span>}
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
        // A wash of the warning colour rather than the panel fill, so the whole block reads as the
        // warning — which is the site's own treatment for exactly this.
        background: C.warnTint,
        borderRadius: R.control,
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
      <p style={{ margin: 0, ...LABEL }}>{label}</p>
      <p
        style={{
          margin: '4px 0 0',
          fontFamily: 'var(--font-display)',
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
      style={{
        height: '4px',
        // The neutral subtle token, not the raised panel colour: #121820 is nearly invisible
        // against a translucent card, so the track would vanish and the bar would look unbounded.
        background: C.subtle,
        borderRadius: '999px',
        overflow: 'hidden',
      }}
      role="img"
      aria-label={`${Math.round(pct)} per cent delivered`}
    >
      <div
        style={{ height: '100%', width: `${pct}%`, background: C.cyan, transition: 'width 200ms ease' }}
      />
    </div>
  );
}

/**
 * The tab strip.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "tab this out please so the project pages are nice and clean and crisp and clear."
 *
 * Visually the website's PageTabs; semantically NOT. The site's tabs are anchors with real URLs, so
 * they are `<nav>` + `aria-current="page"`. This app has no router at all, so these are buttons that
 * swap a panel — which is the actual WAI-ARIA tab pattern, and `aria-current="page"` on a button
 * that navigates nowhere would be a lie to a screen reader.
 */
export function Tabs<K extends string>({
  tabs,
  current,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<{ readonly key: K; readonly label: string }>;
  current: K;
  onChange: (next: K) => void;
  /** Names the strip for a screen reader — "Project sections", not "Tabs". */
  label: string;
}): JSX.Element {
  /*
   * Arrow keys move between tabs and Home/End jump to the ends, which is what the pattern requires
   * and what anybody who navigates by keyboard will try. Without it, only the selected tab is
   * reachable at all — `tabIndex: -1` on the others is what makes the strip one stop rather than
   * five, and that is only correct if the arrows work.
   */
  const move = (event: KeyboardEvent, index: number): void => {
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;

    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next];
    if (target === undefined) return;
    onChange(target.key);
    document.getElementById(`tab-${target.key}`)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
      {tabs.map((tab, index) => {
        const selected = tab.key === current;
        return (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${tab.key}`}
            tabIndex={selected ? 0 : -1}
            // Selected and idle are both in the stylesheet, keyed off `aria-selected` — so the
            // state a screen reader is told and the state that is drawn cannot disagree.
            class="tab"
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => move(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Catches a render failure and says so, instead of leaving a blank rectangle.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "in the companion app Deliveries and Haulers tabs are 100% empty."
 *
 * They were, and the cause was a hub serving an older shape than this build expected: one field was
 * undefined, reading `.length` off it threw during render, and Preact unmounted the subtree. The
 * two tabs that touched that field went blank — silently, with no message and nothing in the app to
 * suggest anything had gone wrong. The other three were fine, which is exactly what made it look
 * like a layout bug rather than a crash.
 *
 * A boundary does not fix the cause. It changes the symptom from "this feature is missing" to "this
 * panel could not be drawn", which is the difference between a member filing a useful report and a
 * member concluding the app is broken.
 */
export class Guard extends Component<
  { children: ComponentChildren; what: string },
  { failed: string | null }
> {
  override state = { failed: null as string | null };

  static override getDerivedStateFromError(error: unknown): { failed: string } {
    return { failed: error instanceof Error ? error.message : String(error) };
  }

  override render(): JSX.Element {
    if (this.state.failed === null) return <>{this.props.children}</>;

    return (
      <Card accent={C.warn}>
        <p style={{ margin: 0, fontSize: '13px', color: C.warn }}>
          {this.props.what} could not be drawn.
        </p>
        {/*
          The real message, not a friendly paraphrase. Whoever sees this is the person who can
          report it, and "something went wrong" gives them nothing to report.
        */}
        <p style={{ margin: '6px 0 0', fontSize: '11px', color: C.dim }}>{this.state.failed}</p>
        <p style={{ margin: '6px 0 0', fontSize: '11px', color: C.faint }}>
          This usually means the app and the hub are on different versions. Everything else on this
          page still works.
        </p>
      </Card>
    );
  }
}

export const tonnes = (n: number): string => `${n.toLocaleString()} t`;
export const credits = (n: number): string => `${n.toLocaleString()} cr`;
