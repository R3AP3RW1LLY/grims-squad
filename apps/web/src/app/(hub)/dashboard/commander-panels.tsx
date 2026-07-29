import type { CommanderProfile } from '../../../lib/api';
import { Section } from '../../../components/hub-page';

/**
 * The commander's own data: ranks, hangar, balance.
 *
 * ★ THIS IS THEIR PAGE, SO IT LEADS WITH THEM ★
 *
 * The dashboard used to open with squadron counts and put the member's own
 * standing in a rail. That is backwards for the page somebody lands on after
 * signing in — they know how many people are in the squadron, and they came to
 * see how THEY are doing.
 */

/** `1234567` -> `1,234,567 CR`. */
function credits(n: number): string {
  return `${n.toLocaleString('en-GB')} CR`;
}

export function PilotRanks({ profile }: { profile: CommanderProfile }) {
  const reported = profile.ranks.filter((r) => r.name !== null).length;

  return (
    <Section
      title="Pilot ranks"
      description={
        profile.rankSource === 'inara'
          ? 'Read from your Inara profile, refreshed every fifteen minutes.'
          : profile.rankSource === 'journal'
            ? 'Read from your game journal by the companion app.'
            : 'Nothing reported yet. Link an Inara key, or run the companion app.'
      }
    >
      {/*
        All six, always — including the ones with nothing behind them. Showing
        only the ladders somebody has a rank in makes "never flown combat" and
        "we have no data" look identical, and a member cannot tell which.
      */}
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {profile.ranks.map((r) => (
          <li
            key={r.key}
            className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
              {r.label}
            </p>
            <p
              className={`mt-1 text-lg ${
                r.name === null
                  ? 'text-[var(--color-text-dim)]'
                  : 'text-[var(--color-brand-cyan-bright)]'
              }`}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {r.name ?? 'None'}
            </p>
          </li>
        ))}
      </ul>

      {reported === 0 && (
        <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Ranks arrive from Inara once your API key is validated, or from the companion app if you
          run it. Both work; the app is live and Inara is refreshed on a schedule.
        </p>
      )}
    </Section>
  );
}

export function Fleet({ profile }: { profile: CommanderProfile }) {
  return (
    <Section
      title="Your fleet"
      description="Every ship you own, read from your game journal. Inara's API returns only your main ship, so this comes from the companion app and nowhere else."
    >
      {profile.fleet.length === 0 ? (
        <p className="max-w-[68ch] rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          No hangar reported yet. The companion app sends this when the game writes it — usually
          the first time you dock after starting it.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {profile.fleet.map((s, i) => (
            <li
              key={`${s.shipType}-${s.name ?? i}`}
              className={`rounded border px-4 py-3 ${
                s.current
                  ? 'border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_8%,transparent)]'
                  : 'border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm text-[var(--color-text-primary)]">{s.shipType}</p>
                {/*
                  The ship they are flying is MARKED, not listed twice. It is
                  already in the hangar, and a duplicate row reads as owning two.
                */}
                {s.current && (
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]">
                    Flying
                  </span>
                )}
              </div>
              {s.name !== null && (
                <p className="mt-0.5 truncate text-xs italic text-[var(--color-text-secondary)]">
                  {s.name}
                </p>
              )}
              {s.location !== null && (
                <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-dim)]">
                  {s.location}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function Balance({ profile }: { profile: CommanderProfile }) {
  return (
    <Section title="Balance">
      {profile.credits === null ? (
        /*
          ★ SAYS WHY, RATHER THAN SHOWING A HOLE ★

          The companion app strips Credits from LoadGame before anything leaves
          the member's machine — a deliberate line in the allowlist, not an
          oversight — and Inara's API does not return a balance either. A blank
          tile would read as broken; naming the reason makes it a choice
          somebody can change.
        */
        <div className="max-w-[68ch] rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-6">
          <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">
            Not collected.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            The companion app removes your balance from the journal before sending anything —
            it never reaches us — and Inara&rsquo;s API does not report it either. Turning this on
            would widen what leaves every member&rsquo;s machine, so it is a squadron decision
            rather than a setting.
          </p>
        </div>
      ) : (
        <p
          className="text-3xl text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {credits(profile.credits)}
        </p>
      )}
    </Section>
  );
}
