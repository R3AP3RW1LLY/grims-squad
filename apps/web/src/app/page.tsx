import { DIVISIONS } from '../components/site-chrome';

/**
 * The public landing page.
 *
 * Still no invented data. There is no "47 COMMANDERS ONLINE" ticker here,
 * because a fake number is exactly the kind of placeholder that survives to
 * production and quietly becomes a lie the site tells every visitor. The live
 * stat band, GalNet feed and influence chart land in P1.9 against real data.
 *
 * Everything stated below is TRUE today: the home system, the seven divisions,
 * and what the hub is being built to do.
 *
 * Colour usage is constrained by ssot/07-design/accessibility.md and verified by
 * `pnpm contrast:check`. `brand.orange` is used for LARGE text only; body copy
 * uses `orangeBright` or `text.secondary`.
 */

const CAPABILITIES = [
  {
    title: 'Situation Board',
    accent: 'var(--color-brand-cyan-bright)',
    body: 'Live influence tracking with tick markers, and officer orders telling you what actually needs doing tonight — not a wall of numbers you have to interpret yourself.',
  },
  {
    title: 'Commodities Market',
    accent: 'var(--color-brand-cyan-bright)',
    body: 'Route finding against our own market mirror. Every price carries its age, because we would rather show you stale data honestly than pretend it is fresh.',
  },
  {
    title: 'Shipyard',
    accent: 'var(--color-brand-cyan-bright)',
    body: 'Self-hosted outfitting, a squadron build locker, and doctrine loadouts approved for each role so you know what to fly before you undock.',
  },
] as const;

export default function HomePage() {
  return (
    <main id="main">
      {/* ============================================================= hero */}
      <section
        className="relative overflow-hidden border-b border-[var(--color-border-hairline)]"
        aria-labelledby="hero-heading"
      >
        <div className="ecliptic" aria-hidden="true" />
        <OrbitOrnament />

        <div className="relative mx-auto max-w-[1440px] px-6 py-24 sm:py-32">
          <div className="max-w-[46rem]">
            <p className="mb-5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.35em] text-[var(--color-brand-cyan-bright)]">
              <span className="inline-block h-px w-8 bg-[var(--color-brand-cyan)]" aria-hidden="true" />
              Elite Dangerous Squadron
            </p>

            {/* Large text, so pure brand.orange is compliant here (7.31:1 on void). */}
            <h1
              id="hero-heading"
              className="text-[clamp(2.75rem,8vw,5.5rem)] leading-[0.95] text-[var(--color-brand-orange)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              NO QUARTER
              <br />
              IN THE VOID
            </h1>

            <p className="mt-8 max-w-[58ch] text-lg leading-relaxed text-[var(--color-text-primary)]">
              We run a player minor faction, operate fleet carriers, and fly everything from
              conflict zones to the black. Combat and AX, trade, mining, exploration &mdash; and the
              background simulation that decides who actually holds a system.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <a
                href="/apply"
                className="bg-[var(--color-brand-orange)] px-7 py-3.5 text-[var(--color-text-on-accent)] shadow-[var(--glow-orange)] transition-opacity hover:opacity-90"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                APPLY TO JOIN
              </a>
              <a
                href="/forum"
                className="border border-[var(--color-border-active)] px-7 py-3.5 text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[var(--color-surface-panel-hover)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                OPEN COMMS
              </a>
            </div>
          </div>

          {/* Instrument strip — real, static facts only. */}
          <dl className="mt-20 grid max-w-3xl grid-cols-2 gap-px border border-[var(--color-border-hairline)] bg-[var(--color-border-hairline)] sm:grid-cols-4">
            {[
              ['HOME SYSTEM', 'Hyades Sector AV-W b2-4'],
              ['DIVISIONS', 'Seven'],
              ['ALLEGIANCE', 'Player Minor Faction'],
              ['PLATFORM', 'PC · Odyssey'],
            ].map(([label, value]) => (
              <div key={label} className="bg-[var(--color-surface-panel-sunken)] px-4 py-4">
                <dt className="font-mono text-[10px] tracking-[0.24em] text-[var(--color-text-secondary)]">
                  {label}
                </dt>
                <dd
                  className="mt-2 text-sm text-[var(--color-brand-orange-bright)]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ======================================================== divisions */}
      <section className="mx-auto max-w-[1440px] px-6 py-24" aria-labelledby="divisions-heading">
        <SectionHeading
          id="divisions-heading"
          eyebrow="Structure"
          title="DIVISIONS"
          lede="Seven divisions covering every loop we fly. Join one, or several — nobody is locked into a single career."
        />

        <ul className="mt-12 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 xl:grid-cols-3">
          {DIVISIONS.map((d, i) => (
            <li key={d.name}>
              <article
                className="hud panel panel-interactive draw-in h-full p-6"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-start gap-4">
                  <span
                    className="mt-0.5 shrink-0 border border-[var(--color-border-hairline)] p-2"
                    aria-hidden="true"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path
                        d={d.glyph}
                        stroke="var(--color-brand-orange)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div>
                    <h3
                      className="text-lg leading-tight text-[var(--color-brand-orange-bright)]"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {d.name}
                    </h3>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)]">
                      {d.role}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  {d.blurb}
                </p>
              </article>
            </li>
          ))}
        </ul>
      </section>

      {/* ============================================================== hub */}
      <section
        className="relative border-y border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-panel-sunken)_60%,transparent)]"
        aria-labelledby="hub-heading"
      >
        <div className="mx-auto max-w-[1440px] px-6 py-24">
          <SectionHeading
            id="hub-heading"
            eyebrow="The Platform"
            title="THE HUB"
            lede="One place for everything the squadron needs, built so the answer to “what should I do tonight?” takes ten seconds rather than ten minutes of cross-referencing."
          />

          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {CAPABILITIES.map((c, i) => (
              <article
                key={c.title}
                className="hud panel draw-in p-7"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="font-mono text-[10px] tracking-[0.24em] text-[var(--color-text-secondary)]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3
                  className="mt-3 text-xl"
                  style={{ fontFamily: 'var(--font-display)', color: c.accent }}
                >
                  {c.title}
                </h3>
                <div className="rule-glow mt-4" aria-hidden="true" />
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  {c.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================== cta */}
      <section className="mx-auto max-w-[1440px] px-6 py-28" aria-labelledby="cta-heading">
        <div className="hud panel sweep relative overflow-hidden p-10 text-center sm:p-16">
          <h2
            id="cta-heading"
            className="text-[clamp(1.75rem,4vw,3rem)] leading-tight text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            THE BUBBLE IS CONTESTED
          </h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-[var(--color-text-primary)]">
            Bring your ship and your time zone. We will find you a wing, a role and something worth
            flying for.
          </p>
          <a
            href="/apply"
            className="mt-9 inline-block bg-[var(--color-brand-orange)] px-9 py-4 text-[var(--color-text-on-accent)] shadow-[var(--glow-orange)] transition-opacity hover:opacity-90"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            APPLY TO JOIN
          </a>
          <p className="mt-5 font-mono text-[11px] tracking-[0.2em] text-[var(--color-text-secondary)]">
            DISCORD MEMBERSHIP REQUIRED
          </p>
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------- primitives */

function SectionHeading({
  id,
  eyebrow,
  title,
  lede,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <div className="max-w-[62ch]">
      <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight text-[var(--color-brand-orange)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {title}
      </h2>
      <div className="rule-glow mt-5 max-w-sm" aria-hidden="true" />
      <p className="mt-5 text-[var(--color-text-secondary)]">{lede}</p>
    </div>
  );
}

/**
 * The hero ornament: a star with three orbital tracks.
 *
 * Sized in vw and clipped by the section, so it never introduces a horizontal
 * scrollbar on a narrow viewport — an ornament that breaks the layout on a
 * phone is a bug wearing a costume.
 */
function OrbitOrnament() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute right-[-18vw] top-1/2 hidden h-[46vw] w-[46vw] -translate-y-1/2 lg:block"
    >
      <div className="stellar-core absolute left-1/2 top-1/2 h-[9vw] w-[9vw] -translate-x-1/2 -translate-y-1/2" />
      <div className="orbit-ring orbit-spin-slow inset-[6%]" />
      <div className="orbit-ring orbit-spin-mid inset-[20%]" />
      <div className="orbit-ring orbit-spin-fast inset-[34%]" />
    </div>
  );
}
