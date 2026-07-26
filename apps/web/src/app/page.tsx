/**
 * P0.5 — the public landing page. Static, no data.
 *
 * The live stat ticker, GalNet feed and division CTAs land in P1.9 once there is
 * a database to read and an API to read it from. Deliberately NOT stubbed with
 * invented numbers: a fake "47 COMMANDERS" is exactly the kind of placeholder
 * that survives to production (AGENTS.md §4).
 *
 * Colour usage here is constrained by ssot/07-design/accessibility.md and
 * verified by `pnpm contrast:check`. In particular `brand.orange` is used for
 * LARGE text only, and body copy uses `orangeBright` or `text.secondary`.
 */

const DIVISIONS = [
  { name: 'Iron Legion', role: 'Combat · Conflict Zones · Bounty Hunting' },
  { name: 'Xeno Interdiction Corps', role: 'Anti-Xeno Operations' },
  { name: 'Sable Directorate', role: 'Background Simulation · Influence' },
  { name: 'Vanguard Survey', role: 'Exploration · Exobiology' },
  { name: 'Void Logistics', role: 'Trade · Hauling · Community Goals' },
  { name: 'Deepcore Prospectors', role: 'Mining' },
  { name: 'Carrier Command', role: 'Fleet Carrier Operations' },
] as const;

function CornerPanel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`panel draw-in p-6 ${className}`}>{children}</div>;
}

export default function HomePage() {
  return (
    <>
      <header className="border-b border-[var(--color-border-hairline)]">
        <nav
          aria-label="Primary"
          className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-4"
        >
          <span
            className="text-lg tracking-[0.2em] text-[var(--color-brand-orange-bright)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            GRIM&rsquo;S SQUAD
          </span>
          <span className="text-sm text-[var(--color-text-secondary)]">
            Hyades Sector AV-W b2-4
          </span>
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-[1440px] px-6">
        {/* ---------------------------------------------------------- hero */}
        <section className="py-20 sm:py-28" aria-labelledby="hero-heading">
          <p className="mb-4 text-sm uppercase tracking-[0.35em] text-[var(--color-brand-cyan-bright)]">
            Elite Dangerous Squadron
          </p>

          {/* Large text, so pure brand.orange is compliant here (7.31:1 on void). */}
          <h1
            id="hero-heading"
            className="text-5xl leading-tight text-[var(--color-brand-orange)] sm:text-7xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            No Quarter
            <br />
            in the Void
          </h1>

          <p className="mt-8 max-w-[60ch] text-lg text-[var(--color-text-primary)]">
            We run a player minor faction, operate fleet carriers, and fly everything from
            conflict zones to the black. Combat and AX, trade, mining, exploration &mdash; and
            the background simulation that decides who actually holds a system.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <a
              href="/apply"
              className="bg-[var(--color-brand-orange)] px-6 py-3 text-[var(--color-text-on-accent)] transition-opacity hover:opacity-90"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              APPLY TO JOIN
            </a>
            <a
              href="/forum"
              className="border border-[var(--color-border-active)] px-6 py-3 text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[var(--color-surface-panel-hover)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              OPEN COMMS
            </a>
          </div>
        </section>

        {/* ----------------------------------------------------- divisions */}
        <section className="pb-20" aria-labelledby="divisions-heading">
          <h2
            id="divisions-heading"
            className="mb-2 text-3xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            DIVISIONS
          </h2>
          <p className="mb-8 max-w-[60ch] text-[var(--color-text-secondary)]">
            Seven divisions covering every loop we fly. Join one, or several.
          </p>

          <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {DIVISIONS.map((d) => (
              <li key={d.name}>
                <CornerPanel className="h-full">
                  <h3
                    className="text-lg text-[var(--color-brand-orange-bright)]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {d.name}
                  </h3>
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{d.role}</p>
                </CornerPanel>
              </li>
            ))}
          </ul>
        </section>

        {/* --------------------------------------------------- what we run */}
        <section className="pb-20" aria-labelledby="capability-heading">
          <h2
            id="capability-heading"
            className="mb-8 text-3xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            THE HUB
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <CornerPanel>
              <h3 className="text-[var(--color-brand-cyan-bright)]">Situation Board</h3>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                Live influence tracking with tick markers, and officer orders telling you what
                actually needs doing tonight.
              </p>
            </CornerPanel>
            <CornerPanel>
              <h3 className="text-[var(--color-brand-cyan-bright)]">Commodities Market</h3>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                Route finding against our own market mirror. Every price carries its age &mdash;
                we would rather show you stale data honestly than pretend it is fresh.
              </p>
            </CornerPanel>
            <CornerPanel>
              <h3 className="text-[var(--color-brand-cyan-bright)]">Shipyard</h3>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                Self-hosted outfitting, a squadron build locker, and doctrine loadouts approved
                for each role.
              </p>
            </CornerPanel>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------ footer */}
      <footer className="border-t border-[var(--color-border-hairline)]">
        <div className="mx-auto max-w-[1440px] px-6 py-10">
          <p className="max-w-[70ch] text-sm text-[var(--color-text-secondary)]">
            Created using assets and imagery from Elite: Dangerous, with the permission of
            Frontier Developments plc, for non-commercial purposes. Not endorsed by Frontier
            Developments; no Frontier Developments employee was involved in the making of this
            site.
          </p>
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
            Ship-fit mathematics ported from Coriolis (MIT) with attribution.
          </p>
          <p className="mt-6 text-sm text-[var(--color-brand-orange-bright)]">
            Fly safe, CMDR. o7
          </p>
        </div>
      </footer>
    </>
  );
}
