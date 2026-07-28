/**
 * The furniture every members-area page is built from.
 *
 * ★ WHY "FILL THE PAGE" IS NOT "STRETCH THE TEXT" ★
 *
 * Each of these pages was written for a full-width layout with no sidebar, so
 * each centred itself in a 70ch column. Inside the shell that leaves a great
 * deal of empty space to the right and makes every screen look unfinished.
 *
 * The wrong fix is to widen the column. Prose stops being readable somewhere
 * around 75 characters — the eye loses its place on the return sweep — and a
 * text input stretched to 1200px is actively worse than a short one, because
 * nothing on screen suggests how much you are expected to type.
 *
 * So the width is filled with DIFFERENT CONTENT rather than wider content: the
 * primary column keeps its readable measure, and a rail beside it carries the
 * status, the context and the related actions that were previously stacked
 * below the fold or not shown at all.
 *
 * ★ NO <main> IN HERE, DELIBERATELY ★
 *
 * The shell already renders `<main id="main">`. Every one of these pages was
 * rendering a second one INSIDE it — two <main> elements and a duplicated id,
 * which is invalid HTML and left the skip link pointing at an ambiguous target.
 */

/**
 * ★ THE LEAD PARAGRAPH IS NOT IN HERE ★
 *
 * It used to be, and it pushed the whole page down: the header spans the full
 * width, so anything in it sits ABOVE both columns — leaving the context rail
 * starting a paragraph lower than the text it belongs beside, and the two
 * reading as unrelated.
 *
 * The lead now belongs to PageBody, which renders it at the top of the primary
 * column. The rail and the first line of prose then start together.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  icon,
}: {
  eyebrow: string;
  title: string;
  /** A line under the title — a rank, a status. */
  subtitle?: string;
  action?: React.ReactNode;
  /** Rendered to the LEFT of the text. The dashboard puts an avatar here. */
  icon?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          {icon}
          <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
            {eyebrow}
          </p>
          {/*
            Smaller than it was. The old size was tuned for a full-bleed page
            with nothing above it; in the shell it sits directly under a sticky
            top bar, and at 3.25rem the two competed for the same attention.
          */}
          <h1
            className="mt-2 text-[clamp(1.6rem,3vw,2.25rem)] leading-tight text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h1>
          {subtitle !== undefined && (
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
              {subtitle}
            </p>
          )}
          </div>
        </div>
        {action}
      </div>

      <div className="rule-glow mt-5" aria-hidden="true" />
    </header>
  );
}

/**
 * The two-column body: readable primary column, context rail beside it.
 *
 * Collapses to one column below `xl` rather than `lg`. At 1024px the sidebar
 * has already taken 16rem, and splitting what is left produces two columns too
 * narrow to be worth having — the rail would wrap every label.
 */
export function PageBody({
  children,
  rail,
  lead,
}: {
  children: React.ReactNode;
  rail?: React.ReactNode;
  /**
   * The opening paragraph. Rendered HERE rather than in the header so its first
   * line is level with the top of the rail beside it.
   */
  lead?: string;
}) {
  const body = (
    <>
      {lead !== undefined && (
        <p className="mb-6 max-w-[68ch] text-[var(--color-text-primary)]">{lead}</p>
      )}
      {children}
    </>
  );

  if (rail === undefined) {
    return <div className="max-w-[68ch]">{body}</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">{body}</div>
      {/*
        Sticky, so the status stays visible while somebody scrolls a long form.
        `self-start` is what makes that work in a grid — without it the item
        stretches to the row height and has nothing to stick within.
      */}
      <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">{rail}</aside>
    </div>
  );
}

export function Panel({
  title,
  children,
  tone = 'default',
}: {
  title?: string;
  children: React.ReactNode;
  tone?: 'default' | 'warning';
}) {
  return (
    <section
      className={`rounded-lg border p-5 ${
        tone === 'warning'
          ? 'border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)]'
          : 'border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]'
      }`}
    >
      {title !== undefined && (
        <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
          {title}
        </h2>
      )}
      <div className={title === undefined ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

/** A titled block in the primary column. Wider and airier than a rail Panel. */
export function Section({
  title,
  description,
  children,
  fill = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /**
   * Stretch to the height of the tallest sibling in a grid row.
   *
   * ★ WHY THIS IS OPT-IN ★
   *
   * Down a single column a section should be exactly as tall as its content —
   * stretching there would only add dead space. It matters only where two sit
   * SIDE BY SIDE and their bottom rules land at different heights, which reads
   * as a rendering fault rather than as two panels of different length.
   *
   * The child of a `fill` section becomes a flex column, so a footer marked
   * `mt-auto` is pushed to the bottom and lines up with its neighbour's.
   */
  fill?: boolean;
}) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <section aria-labelledby={id} className={`mb-12 ${fill ? 'flex h-full flex-col' : ''}`}>
      <h2
        id={id}
        className="text-xl text-[var(--color-brand-orange)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {title.toUpperCase()}
      </h2>
      {description !== undefined && (
        <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {description}
        </p>
      )}
      <div className={`mt-5 ${fill ? 'flex flex-1 flex-col' : ''}`}>{children}</div>
    </section>
  );
}

/** One fact in the rail: a label and a value. */
export function RailStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'warn';
}) {
  const colour =
    tone === 'good'
      ? 'text-[var(--color-semantic-success)]'
      : tone === 'warn'
        ? 'text-[var(--color-semantic-warning)]'
        : 'text-[var(--color-text-primary)]';

  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border-hairline)] py-2 last:border-0">
      <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
      <span className={`text-right font-mono text-sm ${colour}`}>{value}</span>
    </div>
  );
}

/**
 * What to show when the API could not be reached.
 *
 * ★ NOT "SIGN IN" ★
 *
 * Every one of these pages used to render a sign-in prompt when its data came
 * back null. That branch is now unreachable — the (hub) layout redirects a
 * signed-out visitor before any page renders — so the only way to see it was
 * for the API to be down, and it told the member to do the one thing that could
 * not possibly help.
 */
export function CouldNotLoad({ what }: { what: string }) {
  return (
    <Panel tone="warning">
      <p className="text-[var(--color-text-primary)]">We could not load {what} just now.</p>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        You are still signed in — this is our end, not yours. Refreshing in a moment usually does
        it.
      </p>
    </Panel>
  );
}

/**
 * A band of headline figures.
 *
 * ★ WHERE A RAIL IS WRONG ★
 *
 * PageBody's two-column split suits a form: a readable measure beside its
 * context. It is wrong for a page whose subject is a WIDE TABLE — an activity
 * roster or an audit log wants every pixel of width, and squeezing it into
 * two-thirds to make room for a rail makes the page worse, not fuller.
 *
 * Those pages get this instead: figures across the top in a grid, table
 * full-bleed beneath. Same principle — fill the width with different content
 * rather than stretched content — applied to a different shape of page.
 */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="mb-10 grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</div>;
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'accent' | 'warn';
}) {
  const colour =
    tone === 'accent'
      ? 'text-[var(--color-brand-cyan-bright)]'
      : tone === 'warn'
        ? 'text-[var(--color-semantic-warning)]'
        : 'text-[var(--color-text-primary)]';

  return (
    <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl leading-none ${colour}`}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </p>
      {hint !== undefined && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">{hint}</p>
      )}
    </div>
  );
}
