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

export function Location({ profile }: { profile: CommanderProfile }) {
  return (
    <Section
      title="Where you are"
      description="Read from your game journal — the newer of your last hyperspace jump and your last load-in."
    >
      {profile.currentSystem === null ? (
        <p className="max-w-[68ch] rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          No position reported yet. This arrives with the companion app the next time you jump or
          load in — and it can be switched off, with everything else, on the{' '}
          <a href="/settings/devices" className="text-[var(--color-brand-cyan-bright)]">
            companion app page
          </a>
          .
        </p>
      ) : (
        <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-5 py-4">
          <p
            className="text-2xl text-[var(--color-brand-cyan-bright)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {profile.currentSystem}
          </p>
          {/*
            The timestamp travels with it, deliberately. A system name on its own
            is a claim about NOW, and it might be three weeks old — which for
            somebody deciding whether to ask you for a wing is the whole
            question.
          */}
          {profile.systemSeenAt !== null && (
            <p className="mt-1 font-mono text-[11px] text-[var(--color-text-secondary)]">
              Seen {new Date(profile.systemSeenAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
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
    <Section
      title="Balance"
      description="From your last game start. Collected with your ranks and standing, and switched off with them."
    >
      {profile.credits === null ? (
        /*
          ★ SAYS WHY, RATHER THAN SHOWING A HOLE ★

          Two reasons it can be empty, and they need different actions from the
          member: no session reported since the balance started being collected,
          or they have switched off the category that carries it. A blank tile
          would read as broken; naming the reason makes it actionable.
        */
        <div className="max-w-[68ch] rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-6">
          <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">Not reported yet.</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            It arrives with your next game start, if the companion app is running. If you have
            switched off <strong>Ranks and standing</strong> on the{' '}
            <a href="/settings/devices" className="text-[var(--color-brand-cyan-bright)]">
              companion app page
            </a>
            , that is why — the balance travels with it.
          </p>
        </div>
      ) : (
        <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-5 py-4">
          <p
            className="text-3xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {credits(profile.credits)}
          </p>
        </div>
      )}
    </Section>
  );
}
