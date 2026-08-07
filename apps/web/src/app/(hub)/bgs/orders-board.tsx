import type { BgsFactionRow, BgsOrderRow } from '../../../lib/api';

/**
 * What the officers have asked for, and what each instruction actually means.
 *
 * ★ THE STANCE IS THE WHOLE MESSAGE ★
 *
 * A member reads this before choosing which faction to hand a mission to. Push and suppress are
 * opposite instructions, and getting them the wrong way round means spending an evening working
 * against your own squadron — so every order says the word, in full, alongside a sentence
 * explaining what the word asks of you. Colour is a shortcut for people who can use it, never the
 * message itself.
 */

const STANCE: Record<
  string,
  { label: string; tone: string; means: string }
> = {
  push: {
    label: 'PUSH',
    tone: 'text-[var(--color-semantic-success)] border-[var(--color-semantic-success)]',
    means: 'Hand missions in for them. Every pip of influence you move scores.',
  },
  hold: {
    label: 'HOLD',
    tone: 'text-[var(--color-semantic-warning)] border-[var(--color-semantic-warning)]',
    means:
      'Keep them steady — pushing influence higher can trigger an expansion nobody wants. Scores at half rate.',
  },
  suppress: {
    label: 'SUPPRESS',
    tone: 'text-[var(--color-semantic-hostile-bright)] border-[var(--color-semantic-hostile-bright)]',
    means:
      'Work against them. Influence you take OFF them is the job, and helping them costs you points.',
  },
  ignore: {
    label: 'IGNORE',
    tone: 'text-[var(--color-text-secondary)] border-[var(--color-border-hairline)]',
    means: 'Not a target. Nothing done for or against them scores either way.',
  },
};

function live(o: BgsOrderRow): boolean {
  return o.activeUntil === null || new Date(o.activeUntil).getTime() > Date.now();
}

export function OrdersBoard({ factions }: { factions: BgsFactionRow[] }) {
  /*
   * Flattened and sorted by priority. The API groups orders under their faction, which is right for
   * an officer editing them and wrong for a member acting on them — what a member wants is "the
   * most important thing first", and an order's importance has nothing to do with which faction it
   * happens to belong to.
   */
  const orders = factions
    .flatMap((f) => f.orders.filter(live).map((o) => ({ ...o, faction: f.name, isOurs: f.isOurs })))
    .sort((a, b) => a.priority - b.priority);

  if (orders.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        {/*
          Nothing ordered is a real state, not an error — and saying it plainly is what prompts an
          officer to set one. It also warns members that mission hand-ins score nothing right now,
          which is the part they would otherwise discover by not being paid.
        */}
        No standing orders right now. Nothing is being pushed, held or suppressed, so mission
        hand-ins score nothing on Faction Hands until an officer sets one.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {orders.map((o) => {
        const look = STANCE[o.stance] ?? {
          label: o.stance.toUpperCase(),
          tone: 'text-[var(--color-text-secondary)] border-[var(--color-border-hairline)]',
          means: '',
        };

        return (
          <article
            key={`${o.id}`}
            className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4"
          >
            <header className="mb-2 flex flex-wrap items-center gap-3">
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.1em] ${look.tone}`}
              >
                {look.label}
              </span>
              <h3 className="m-0 flex-1 text-base text-[var(--color-text-primary)]">
                {o.faction}
                {o.isOurs ? (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-brand-orange-bright)]">
                    ours
                  </span>
                ) : null}
              </h3>
              {o.systemName === null ? null : (
                <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                  in {o.systemName}
                </span>
              )}
            </header>

            <p className="m-0 text-sm text-[var(--color-text-secondary)]">{look.means}</p>

            {/* The officer's own words, when they left any. */}
            {o.guidance === null || o.guidance.trim() === '' ? null : (
              <p className="m-0 mt-2 border-l-2 border-[var(--color-brand-orange)] pl-3 text-sm text-[var(--color-text-primary)]">
                {o.guidance}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
