import Image from 'next/image';
import { GalnetAdapter } from '@grims/ed-clients';
import { GalnetTicker } from '../../components/galnet-ticker';
import { DIVISIONS } from '../../components/site-chrome';
import { GalaxyMap } from '../../components/galaxy-map';
import { SquadronStatsBand } from '../../components/squadron-stats';
import { getSquadronStats } from '../../lib/api';

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

/**
 * The four facts in the hero card. Two of them link out.
 *
 * ★ INARA, ON THE SQUADRON OWNER'S INSTRUCTION — 2026-07-29 ★
 *
 * The home system pointed at EDSM. Inara is where this squadron's own records
 * live, so both links now go there: one destination for a visitor following
 * either, rather than two sites with two different pictures of the same space.
 *
 * The ids came from the squadron owner directly. They could not be confirmed by
 * fetching them — Inara answers 503 to any automated request, whatever headers
 * it carries — so they are recorded as given rather than as verified.
 */
/**
 * The site a hero link points at, for the screen-reader hint.
 *
 * Announcing the destination matters more here than usual: these open in a new
 * tab, and somebody who cannot see the arrow icon gets no other warning that
 * their focus is about to land somewhere else entirely.
 *
 * Falls back to "an external site" rather than throwing. An unparseable href is
 * a bug worth fixing, but it is not worth blanking the home page over.
 */
function linkSite(href: string): string {
  try {
    const host = new URL(href).hostname.replace(/^www\./, '');
    if (host.endsWith('inara.cz')) return 'Inara';
    if (host.endsWith('elitedangerous.com')) return 'the Frontier store';
    return host;
  } catch {
    return 'an external site';
  }
}

const INSTRUMENTS: ReadonlyArray<{
  label: string;
  value: string;
  href?: string;
}> = [
  {
    label: 'HOME SYSTEM',
    // NON-BREAKING HYPHENS. With ordinary ones the cell broke after "b2-" and
    // orphaned the "4" on its own line, which reads as a typo, not a wrap.
    value: 'Hyades Sector AV‑W b2‑4',
    href: 'https://inara.cz/elite/starsystem/778467/',
  },
  { label: 'DIVISIONS', value: 'Seven' },
  {
    label: 'ALLEGIANCE',
    /*
     * The faction BY NAME, not by category.
     *
     * "Player Minor Faction" described what kind of thing the squadron is
     * aligned to and never said which one — so the single most identifying fact
     * about this squadron in the BGS was the one the hero card withheld.
     *
     * Non-breaking space in "from Alrai" for the same reason as the hyphens
     * above: the cell is narrow, and a wrap that orphans "Alrai" reads as two
     * separate facts rather than one faction's name.
     */
    value: 'Blood Brothers from Alrai',
    href: 'https://inara.cz/elite/minorfaction/5469/',
  },
  {
    label: 'PLATFORM',
    value: 'PC · Odyssey',
    /*
     * Where somebody who does not own the game goes next.
     *
     * This card told a visitor which platform the squadron flies on and left
     * them nowhere to go with it. Squadron owner, 2026-07-29 — and it is the
     * one instrument in the hero that a person who is NOT already a commander
     * can act on.
     */
    href: 'https://www.elitedangerous.com/buy/elite-dangerous-deluxe-edition/steam',
  },
];

export default async function HomePage() {
  // Fetched on the SERVER and cached for an hour. No key, no client request, and
  // no headline invented if Frontier's CMS is down — the adapter returns an
  // empty list and the ticker renders nothing at all.
  //
  // Both fetched concurrently: the stats query is one round trip to our own
  // database and the GalNet fetch is cached, but serialising them would still
  // add the slower one's latency to the faster one for nothing.
  const [galnet, stats] = await Promise.all([
    new GalnetAdapter().latest(12),
    getSquadronStats(),
  ]);

  return (
    <main id="main">
      {/* ============================================================= hero */}
      <section
        // Exactly one screen, minus the navbar, with the whole grid centred in
        // it. `min-h` rather than `h` so a short viewport scrolls instead of
        // clipping content — a hero that hides its own text is worse than one
        // that scrolls.
        className="relative flex min-h-[calc(100dvh-var(--nav-h))] items-center overflow-hidden border-b border-[var(--color-border-hairline)]"
        aria-labelledby="hero-heading"
      >
        {/* The in-game galaxy map, with traffic. Replaces the earlier orbital
            ornament: this is the view every CMDR already knows. */}
        <GalaxyMap />

        <div className="relative mx-auto grid w-full max-w-[1440px] items-center gap-y-10 px-4 pb-24 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-x-16 lg:gap-y-12 lg:pb-28 lg:pt-10">
          {/* ---- left: the mark ---- */}
          {/*
            The lockup IS the h1. `alt` carries the wordmark, so the page's main
            heading has a real text equivalent for search engines and screen
            readers rather than being an unlabelled image. `priority` because it
            is the largest element above the fold.
          */}
          <h1 id="hero-heading" className="m-0 flex items-center justify-center">
            <Image
              src="/brand/lockup-1200.png"
              alt="Grim's Squad"
              width={1200}
              height={800}
              priority
              sizes="(max-width: 1024px) 88vw, 46vw"
              className="h-auto w-full max-w-[min(620px,86vw)] drop-shadow-[0_0_70px_rgba(255,113,0,0.2)]"
            />
          </h1>

          {/* ---- right: everything else ---- */}
          {/* Centred both ways within its own column: the copy block is
              narrower than the column, so left-aligning it against a centred
              logo left an uneven gutter down the middle. */}
          <div className="flex flex-col items-center justify-center text-center">
            <p className="flex items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.35em] text-[var(--color-brand-cyan-bright)]">
              <span className="inline-block h-px w-8 bg-[var(--color-brand-cyan)]" aria-hidden="true" />
              Elite Dangerous Squadron
            </p>

            {/* Large text, so pure brand.orange stays compliant (7.31:1 on void). */}
            <p
              className="mt-4 text-[clamp(1.4rem,4.2vw,2.6rem)] leading-[1.05] tracking-[0.14em] text-[var(--color-brand-orange)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              NO QUARTER
              <br className="hidden sm:inline" /> IN THE VOID
            </p>

            <p className="mx-auto mt-6 max-w-[58ch] text-base leading-relaxed text-[var(--color-text-primary)] sm:text-lg">
              Every system has a story. We intend to write ours across the galaxy. From conflict
              zones to the deepest black, Grim&rsquo;s Squad fights, explores, builds, and expands
              with one goal: leave our mark on the Milky Way.
            </p>

          </div>

          {/*
            Spans both columns and centres itself, so it sits over the galaxy
            map's plane grid rather than off to one side of it. The grid runs
            across the lower third of the map, so a card anchored to the right
            column had the grid passing behind only half of it.

            Four across at `sm` and up now that it has the full width back —
            2x2 was a concession to the narrow column it used to live in.

            The top margin drops it further down the map. Because the grid is
            vertically centred in the section, adding height at the bottom
            pushes the card down and the wordmark up, which opens the gap
            between them as well as lowering the card. The ticker is absolutely
            positioned and is not in this flow at all, so it does not move.
          */}
          <dl className="mx-auto mt-16 grid w-full max-w-3xl grid-cols-2 gap-px lg:mt-24 border border-[var(--color-border-hairline)] bg-[var(--color-border-hairline)] text-left shadow-[0_0_40px_rgba(0,0,0,0.5)] backdrop-blur-sm sm:grid-cols-[1.5fr_1fr_1.4fr_1fr] lg:col-span-2">
              {INSTRUMENTS.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col justify-between bg-[var(--color-surface-panel-sunken)] px-3 py-3 sm:px-4 sm:py-4"
                >
                  <dt className="font-mono text-[9px] tracking-[0.2em] text-[var(--color-text-secondary)] sm:text-[10px] sm:tracking-[0.24em]">
                    {item.label}
                  </dt>
                  <dd
                    className="mt-1.5 text-[13px] leading-snug text-[var(--color-brand-orange-bright)] sm:mt-2 sm:text-sm"
                    style={{ fontFamily: 'var(--font-display)', textWrap: 'balance' }}
                  >
                    {item.href === undefined ? (
                      item.value
                    ) : (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-baseline gap-1 no-underline transition-colors hover:text-[var(--color-brand-orange)]"
                      >
                        {item.value}
                        {/*
                          ★ DERIVED, NOT WRITTEN OUT ★

                          This said "opens EDSM in a new tab" as a literal
                          string. The moment the links moved to Inara it was
                          announcing the wrong destination to exactly the people
                          who cannot see where the link goes — and it would have
                          kept doing so silently, because no test can tell that
                          a sentence has become untrue.

                          Taken from the href, so it cannot disagree with it.
                        */}
                        <span className="sr-only"> (opens {linkSite(item.href)} in a new tab)</span>
                        <svg
                          width="9"
                          height="9"
                          viewBox="0 0 12 12"
                          fill="none"
                          aria-hidden="true"
                          className="shrink-0 self-center opacity-70"
                        >
                          <path
                            d="M4 2h6v6M10 2 3 9"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </a>
                    )}
                  </dd>
                </div>
              ))}
          </dl>

        </div>

        {/*
          OUTSIDE the grid, pinned to the foot of the hero. As a grid row it
          added height that pushed the info card off the map's plane grid — the
          exact position it was moved there to occupy. Taking it out of the flow
          means the card centres as though the ticker were not there, and the
          ticker gets the strip of space below it.

          Lifted clear of the very bottom edge: sitting flush against it made
          the strip read as browser furniture rather than part of the scene.
          The grid's bottom padding is sized to match, so the card keeps its
          place on the map's plane grid and the two never meet.
        */}
        <div className="pointer-events-auto absolute inset-x-0 bottom-12 z-10 sm:bottom-14">
          <GalnetTicker articles={galnet} />
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

      {/* ============================================================ stats */}
      {/* Renders NOTHING when the API is unreachable. A row of zeros would be a
          claim — "nobody was active this month" — made on no evidence. */}
      <SquadronStatsBand stats={stats} />

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
        <div className="hud panel relative overflow-hidden p-10 text-center sm:p-16">
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
          {/* Points at /join, not /apply. There IS no application process —
              joining happens through Discord, which is what /join does. A
              button promising a form that does not exist is a dead end. */}
          <a
            href="/join"
            className="mt-9 inline-block bg-[var(--color-brand-orange)] px-9 py-4 text-[var(--color-text-on-accent)] shadow-[var(--glow-orange)] transition-opacity hover:opacity-90"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            JOIN GRIM&rsquo;S SQUAD
          </a>
          <p className="mt-5 font-mono text-[11px] tracking-[0.2em] text-[var(--color-text-secondary)]">
            VIA DISCORD &middot; TAKES A MINUTE
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
