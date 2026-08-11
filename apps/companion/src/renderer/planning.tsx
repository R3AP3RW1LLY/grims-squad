import { useEffect, useState } from 'preact/hooks';
import { compareBodyNames } from '@grims/shared/body-order';
import type { JSX } from 'preact';
import type {
  BuildTypeRow,
  ColonyPlan,
  PlanBody,
  PlanProblem,
  PlanSimStep,
  PlanSite,
  PredictedSiteMarket,
  SiteEconomy,
} from '../hub-colony.js';
import {
  Button,
  C,
  Card,
  Copy,
  Empty,
  Field,
  Problem,
  Section,
  Stat,
  Tabs,
  inputStyle,
} from './ui.js';
import { SystemPicker } from './system-picker.js';

/**
 * Colonisation planning, in the companion app.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "a layout of the system, with spots on each planet that we can settle etc" and then "ensure the
 * Companion app matches and has all the same pages in colonization that the website has please!
 * must be a mirror!"
 *
 * So this is the website's Planning page, not a summary of it. Same routes, same rules, same shape
 * on screen: a vertical indented tree of the system, and the build order with running totals.
 *
 * ★ WHY THE APP IS THE BETTER PLACE FOR THIS, NOT THE WORSE ONE ★
 *
 * Slot counts can only be read off the in-game architect panel. A member doing that is at their PC
 * with the game running — which is exactly where this app already is, on the second monitor. The
 * website can take the same numbers, but it cannot be next to the screen they are copied from.
 */

/*
 * `Answer` and the `window.colony` bridge are declared once, in colonisation.tsx. A second
 * `declare global` for the same object is a conflicting declaration rather than an addition, which
 * that file says at the point it matters.
 */
type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Nests bodies under their parents.
 *
 * The same walk the website does, and the same cap for the same reason: a cycle in bad data would
 * otherwise recurse for ever, and real systems nest three deep — star, planet, moon.
 */
function tree(bodies: readonly PlanBody[]): Array<{ body: PlanBody; depth: number }> {
  const byParent = new Map<number | null, PlanBody[]>();
  const known = new Set(bodies.map((b) => b.bodyId));

  for (const b of bodies) {
    // A parent we do not hold — an unscanned barycentre, say — would orphan the whole branch, so
    // the body is promoted to a root rather than vanishing off the diagram.
    const key = b.parentBodyId !== null && known.has(b.parentBodyId) ? b.parentBodyId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), b]);
  }

  /*
   * ★ SQUADRON OWNER, 2026-08-07 ★
   *
   * "all the sub planets are not appearing alphabetically, and it looks really bad!"
   *
   * The same fault the website's planner had, from the same cause: siblings kept whatever order the
   * query returned, and a gas giant's moons all sit within a few light seconds of each other, so
   * that order was effectively arbitrary. Sorted by name, and NATURALLY — a plain string sort puts
   * `B 10` above `B 2`.
   *
   * Shared with the website deliberately. Two surfaces drawing the same system map in two different
   * orders is worse than either order being wrong.
   */
  for (const [key, kids] of byParent) {
    byParent.set(key, [...kids].sort((x, y) => compareBodyNames(x.name, y.name)));
  }

  const out: Array<{ body: PlanBody; depth: number }> = [];
  const walk = (parent: number | null, depth: number): void => {
    for (const body of byParent.get(parent) ?? []) {
      out.push({ body, depth });
      if (depth < 4) walk(body.bodyId, depth + 1);
    }
  };
  walk(null, 0);

  return out;
}

/** What a body is, in the words a system map uses. */
function describe(b: PlanBody): string {
  const bits = [b.subType ?? b.kind];
  if (b.isLandable) bits.push('landable');
  if (b.gravity !== null) bits.push(`${b.gravity.toFixed(2)}g`);
  if (b.temperature !== null) bits.push(`${Math.round(b.temperature)}K`);
  if (b.hasRings) bits.push('rings');
  if (b.terraformable) bits.push('terraformable');
  return bits.join(' · ');
}

/** The system prefix on every body name says nothing. "Nervi 2 b" beats "Nervi Nervi 2 b". */
const shortName = (name: string, system: string): string =>
  name.startsWith(system) ? name.slice(system.length).trim() || name : name;

const MONO: JSX.CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };

/**
 * The plan page's two halves, as tabs.
 *
 * ★ THE SAME TREATMENT THE PROJECT PAGE ALREADY HAS ★
 *
 * "tab this out please so the project pages are nice and clean and crisp and clear" was said about
 * the project page, and the reason applies here at least as strongly: THE SYSTEM is a tree of every
 * body in a system — Nervi is twenty-two rows, a large system is over a hundred — and BUILD ORDER
 * sits underneath it, which on any real plan means scrolling past the whole galaxy to reach it.
 *
 * They also answer different questions. The system answers "where can this go"; the build order
 * answers "in what order, and can we afford it". Nobody is reading both at once.
 */
const PLAN_TABS = [
  { key: 'system', label: 'The system' },
  { key: 'order', label: 'Build order' },
  /*
   * ★ ITS OWN TAB — SQUADRON OWNER, 2026-08-10 ★
   *
   * Same split as the website, decided together: the economy and the system effects were rendered
   * under an eighty-one row editable list, and they are not an ordering question — the economy is
   * decided by WHICH builds are in the plan, not by their sequence.
   */
  { key: 'economy', label: 'Economy & markets' },
] as const;

type PlanTab = (typeof PLAN_TABS)[number]['key'];

// ---------------------------------------------------------------------------- the page

export function PlanningPage({ system }: { system?: string | undefined } = {}): JSX.Element {
  const [plans, setPlans] = useState<ColonyPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = (): void => {
    void window.colony.plans().then((a) => {
      if (a.ok) {
        setPlans(a.data.plans);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  useEffect(load, []);

  if (openId !== null) {
    /*
     * Keyed, for the reason the project board learned the hard way: without it, opening plan B
     * while A's instance is alive keeps A's bodies, A's error banner and A's open editors on screen
     * until the fetch lands. The key changes the identity, which resets all of it together.
     */
    return (
      <PlanDetail
        key={openId}
        id={openId}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  /*
   * ★ NOT YET READ IS NOT THE SAME AS EMPTY ★
   *
   * `plans` starts null and was coerced straight to `[]`, so both boards announced "The squadron
   * has not planned a system yet" before the request had returned — a confident wrong answer in the
   * window where the right one was still on its way.
   */
  if (plans === null) return <Empty>Reading the plans…</Empty>;

  const squadron = plans.filter((p) => p.owner === 'squadron');
  const personal = plans.filter((p) => p.owner === 'personal');

  return (
    <div>
      {error === null ? null : (
        <div style={{ marginBottom: '14px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      <Section title="Start a plan">
        <NewPlan onMade={setOpenId} system={system} />
      </Section>

      <Section title="Squadron plans">
        <PlanList
          plans={squadron}
          onOpen={setOpenId}
          empty="The squadron has not planned a system yet."
        />
      </Section>

      <Section title="Your plans">
        <PlanList
          plans={personal}
          onOpen={setOpenId}
          empty="You have not planned a system yet. Name one above and its bodies are fetched for you."
        />
      </Section>
    </div>
  );
}

/**
 * A list of plans.
 *
 * ★ THE TONNAGE IS THE HEADLINE ★
 *
 * Not the number of sites. "Nine sites" says nothing about whether this is an evening or a
 * fortnight; four hundred thousand tonnes says it immediately, and it is the figure somebody is
 * deciding by when they look at a list of plans they might join.
 */
function PlanList({
  plans,
  onOpen,
  empty,
}: {
  plans: readonly ColonyPlan[];
  onOpen: (id: string) => void;
  empty: string;
}): JSX.Element {
  if (plans.length === 0) return <Empty>{empty}</Empty>;

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {plans.map((p) => {
        // Summed from the sites the plan already holds. A plan with no build types chosen yet is a
        // real state — somebody sketching slots before deciding — and it reads as "nothing costed
        // yet" rather than as zero.
        const costed = p.sites.filter((s) => s.totalTonnes !== null);
        const total = costed.reduce((sum, s) => sum + (s.totalTonnes ?? 0), 0);

        return (
          <Card key={p.id}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <button
                type="button"
                onClick={() => onOpen(p.id)}
                class="linkish"
                style={{ fontSize: '15px', textAlign: 'left' }}
              >
                {p.title}
              </button>
              <span style={{ ...MONO, fontSize: '12px', color: C.dim }}>
                {p.sites.length === 0
                  ? 'nothing planned yet'
                  : costed.length === 0
                    ? `${p.sites.length} site${p.sites.length === 1 ? '' : 's'} · nothing costed yet`
                    : `${p.sites.length} site${p.sites.length === 1 ? '' : 's'} · ${total.toLocaleString()} t`}
              </span>
            </div>

            <p
              style={{
                margin: '5px 0 0',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                color: C.dim,
              }}
            >
              <span>{p.systemName}</span>
              <Copy value={p.systemName} />
              {p.postedBy === null ? null : <span>· by {p.postedBy}</span>}
              {/* The revision, said out loud. Two officers editing one plan is the case this exists
                  for, and a version nobody can see is a conflict nobody can explain. */}
              <span>· revision {p.version}</span>
            </p>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Starting a plan.
 *
 * Two fields, and the system is the one that matters: its bodies are fetched on save, which is why
 * the button says what it is about to do — a form that pauses with no explanation reads as one that
 * hung.
 */
function NewPlan({
  onMade,
  system,
}: {
  onMade: (id: string) => void;
  /**
   * ★ SCOUT → PLAN, IN ONE CLICK — SQUADRON OWNER, 2026-08-10 ★
   *
   * Arrives from the Scout tab. Scouting and planning were strangers: a member found a claimable
   * system, wrote the name down, walked to another tab and typed it back in — a procedural name
   * like "Col 285 Sector GL-W c2-12", which is exactly the string a person mistypes.
   *
   * The title is prefilled with it too, because a plan needs one and the system is the answer nine
   * times in ten. Both stay editable; neither is a decision taken away.
   */
  system?: string | undefined;
}): JSX.Element {
  const [title, setTitle] = useState(system ?? '');
  const [systemName, setSystemName] = useState(system ?? '');
  const [owner, setOwner] = useState<'personal' | 'squadron'>('personal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = (): void => {
    setBusy(true);
    setError(null);
    void window.colony.planCreate({ owner, title, systemName }).then((a) => {
      setBusy(false);
      if (a.ok) onMade(a.data.id);
      // The hub's own sentence. "Only officers can plan on the squadron's behalf" is a real
      // explanation, and replacing it with "something went wrong" throws away the useful part.
      else setError(a.error);
    });
  };

  return (
    <Card>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px' }}>
        <div style={{ minWidth: '190px', flex: 1 }}>
          <Field label="System">
            <SystemPicker
              value={systemName}
              onValueChange={setSystemName}
              placeholder="the system you are claiming"
              
            />
          </Field>
        </div>
        <div style={{ minWidth: '170px', flex: 1 }}>
          <Field label="Call it">
            <input
              value={title}
              onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              placeholder="a name for this plan"
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ minWidth: '140px' }}>
          <Field label="Whose">
            <select
              value={owner}
              onChange={(e) =>
                setOwner((e.target as HTMLSelectElement).value === 'squadron' ? 'squadron' : 'personal')
              }
              style={inputStyle}
            >
              <option value="personal">Mine</option>
              <option value="squadron">The squadron’s</option>
            </select>
          </Field>
        </div>
        <Button
          tone="primary"
          disabled={busy || systemName.trim() === '' || title.trim() === ''}
          onClick={create}
        >
          {busy ? 'Reading the system…' : 'Start planning'}
        </Button>
      </div>

      <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.faint }}>
        The bodies come from what commanders have scanned and shared. A system nobody has surveyed
        yet still gets a plan — it simply has nothing to draw until somebody scans it.
      </p>

      {error === null ? null : (
        <div style={{ marginTop: '10px' }}>
          <Problem>{error}</Problem>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- one plan

function PlanDetail({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const [plan, setPlan] = useState<ColonyPlan | null>(null);
  /*
   * ★ THE APP OFFERED EVERY EDITING CONTROL TO EVERYBODY ★
   *
   * Remove, "+ add a build", the orb/surf slot fields and the reorder arrows were all rendered
   * unconditionally, so a member looking at a squadron plan they cannot change was given a full
   * editor whose every click came back "Only officers can change a squadron plan."
   *
   * Nothing was at risk — the hub refuses each write — but a control that cannot work reads as a
   * broken app rather than as a rank you do not hold. The answer comes from the hub, computed from
   * the same predicate the refusal uses, so the two cannot disagree.
   */
  const [canEdit, setCanEdit] = useState(false);
  const [tab, setTab] = useState<PlanTab>('system');
  const [buildTypes, setBuildTypes] = useState<readonly BuildTypeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    void window.colony.plan(id).then((a) => {
      if (a.ok) {
        setPlan(a.data.plan);
        setCanEdit(a.data.can.edit);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  useEffect(() => {
    load();
    // The catalogue fills the "add a build" lists. Fetched once for the whole page rather than per
    // body, because it is the same fifty-five rows every time.
    void window.colony.buildTypes().then((a) => {
      if (a.ok) setBuildTypes(a.data.buildTypes);
    });
  }, [id]);

  /*
   * Every write goes through here so the failure path is one path. A stale save is the interesting
   * case: the hub refuses it and names BOTH revisions, and that sentence is shown rather than
   * paraphrased — it is the only thing that explains what just happened.
   */
  const act = (fn: () => Promise<Answer<unknown>>): void => {
    setBusy(true);
    void fn().then((a) => {
      setBusy(false);
      if (a.ok) {
        setError(null);
        load();
      } else {
        setError(a.error);
      }
    });
  };

  if (plan === null) {
    return (
      <div>
        <Button onClick={onBack}>← Back to plans</Button>
        <div style={{ marginTop: '14px' }}>
          {error === null ? <Empty>Reading the plan…</Empty> : <Problem>{error}</Problem>}
        </div>
      </div>
    );
  }

  const costed = plan.sites.filter((s) => s.totalTonnes !== null);
  const total = costed.reduce((sum, s) => sum + (s.totalTonnes ?? 0), 0);
  const withSlots = plan.bodies.filter(
    (b) => b.orbitalSlots !== null || b.surfaceSlots !== null,
  ).length;

  return (
    <div>
      <Button onClick={onBack}>← Back to plans</Button>

      <div style={{ margin: '14px 0 4px' }}>
        {/* Whose plan it is, as the website says it. Opening one from either board otherwise
            leaves nothing on screen telling a squadron plan from a personal one. */}
        <p
          style={{
            ...MONO,
            margin: 0,
            fontSize: '10px',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: C.dim,
          }}
        >
          {plan.owner === 'squadron' ? 'Squadron plan' : 'Your plan'}
        </p>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '22px', color: C.text }}>
          {plan.title.toUpperCase()}
        </h2>
        <p
          style={{
            margin: '4px 0 0',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: C.dim,
          }}
        >
          <span style={{ color: C.text }}>{plan.systemName}</span>
          <Copy value={plan.systemName} />
          <span>· revision {plan.version}</span>
          {plan.postedBy === null ? null : <span>· started by {plan.postedBy}</span>}
        </p>
      </div>

      {error === null ? null : (
        <div style={{ margin: '12px 0' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '14px',
          margin: '16px 0',
        }}
      >
        <Stat label="Bodies" value={String(plan.bodies.length)} />
        <Stat label="Sites planned" value={String(plan.sites.length)} />
        {/* Spread rather than `tone={cond ? x : undefined}`: with exactOptionalPropertyTypes an
            absent prop and a prop explicitly set to undefined are different types, and only the
            absent one means "use the default". */}
        <Stat
          label="To haul"
          value={costed.length === 0 ? '—' : `${total.toLocaleString()} t`}
          {...(total > 0 ? { tone: C.orangeBright } : {})}
        />
        <Stat
          label="Slots recorded"
          value={`${withSlots} of ${plan.bodies.length}`}
          {...(withSlots === 0 ? { tone: C.warn } : {})}
        />
      </div>

      {/*
        ★ WHERE THE BODIES CAME FROM, AND WHEN ★

        Every figure here rests on a body list somebody else scanned and shared. A page that cannot
        date its own foundation is asking to be trusted blindly.
      */}
      {plan.bodiesFetchedAt === null ? null : (
        <p style={{ ...MONO, margin: '0 0 14px', fontSize: '11px', color: C.dim }}>
          Bodies read from what commanders have scanned, on{' '}
          {new Date(plan.bodiesFetchedAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          . Slot counts are read off the game by members and are not predicted.
        </p>
      )}

      {/*
        The strip sits below the stats and the provenance line, both of which are true whichever tab
        is open — the same placement the project page uses, and for the same reason.
      */}
      <div style={{ margin: '4px 0 16px' }}>
        <Tabs tabs={PLAN_TABS} current={tab} onChange={setTab} label="Plan sections" />
      </div>

      {tab !== 'system' ? null : (
        <Section title="The system">
          <SystemTree
            plan={plan}
            buildTypes={buildTypes}
            busy={busy}
            canEdit={canEdit}
            act={act}
          />
        </Section>
      )}

      {tab !== 'order' ? null : (
        <Section title="Build order">
          <BuildOrder plan={plan} busy={busy} canEdit={canEdit} act={act} />
        </Section>
      )}

      {tab !== 'economy' ? null : (
        <Section title="Economy & markets">
          <EconomyAndMarkets plan={plan} />
        </Section>
      )}
    </div>
  );
}

/**
 * What a planned site's economy would resolve to.
 *
 * ★ A PORT HAS AN ECONOMY. AN INSTALLATION FEEDS ONE. ★
 *
 * Only starports and outposts trade, so only they get a verdict. Everything else says what it
 * contributes instead — printing "industrial" beside a satellite would claim it has a market to be
 * industrial about, and it has none. It makes the port on its body more industrial.
 */
function SiteEconomyLine({
  economy,
  site,
}: {
  economy: SiteEconomy | undefined;
  site: PlanSite;
}): JSX.Element | null {
  if (economy === undefined) return null;

  if (!economy.receivesLinks) {
    // Plenty contribute nothing, and saying "feeds none" would be noise on two thirds of the rows.
    if (site.economyInfluence === null || site.economyInfluence === 'none') return null;
    return (
      <span style={{ ...MONO, marginLeft: '7px', fontSize: '10px', color: C.faint }}>
        feeds {site.economyInfluence}
      </span>
    );
  }

  if (economy.leading === null) {
    return (
      <span style={{ ...MONO, marginLeft: '7px', fontSize: '10px', color: C.faint }}>
        no economy yet — nothing on this body feeds it
      </span>
    );
  }

  const ranked = Object.entries(economy.scores)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const fed = economy.strongLinks.length + economy.weakLinks.length;

  return (
    <span
      style={{ ...MONO, marginLeft: '7px', fontSize: '10px', color: C.cyan }}
      title={
        `${ranked.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}` +
        `\n\n${economy.audit.map((a) => `${a.delta > 0 ? '+' : ''}${a.delta} ${a.economy} — ${a.reason}`).join('\n')}`
      }
    >
      {economy.leading}
      {fed > 0 ? ` · fed by ${fed}` : ''}
    </span>
  );
}

/**
 * What the planned station's market would buy and sell.
 *
 * ★ THE COMMODITY LIST, NOT THE ADJECTIVE — SAME NUMBERS AS THE WEBSITE ★
 *
 * The economy line says "industrial"; nobody hauls tonnes for an adjective. This is the slate the
 * mix implies, computed once on the hub by the shared predictMarket and rendered here verbatim.
 * Majors are bold: they are the lines the driving economy stands behind.
 */
function SiteMarketLine({ market }: { market: PredictedSiteMarket | undefined }): JSX.Element | null {
  if (market === undefined) return null;
  if (market.exports.length === 0 && market.imports.length === 0) return null;

  const chips = (lines: PredictedSiteMarket['exports']): JSX.Element[] =>
    lines.map((line) => (
      <span
        key={line.commodity}
        title={`${line.strength} — from its ${line.fromEconomy} economy`}
        style={
          line.strength === 'major' ? { color: C.text, fontWeight: 600 } : { color: C.dim }
        }
      >
        {line.commodity}
      </span>
    ));

  const label: JSX.CSSProperties = {
    ...MONO,
    fontSize: '9px',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: C.faint,
  };

  return (
    <div style={{ marginTop: '3px', paddingLeft: '18px', fontSize: '11px' }}>
      {market.exports.length === 0 ? null : (
        <p style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
          <span style={label}>sells</span>
          {chips(market.exports)}
        </p>
      )}
      {market.imports.length === 0 ? null : (
        <p style={{ margin: '2px 0 0', display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
          <span style={label}>buys</span>
          {chips(market.imports)}
        </p>
      )}
    </div>
  );
}

/**
 * The system, laid out.
 *
 * ★ A VERTICAL INDENTED TREE, NOT AN ORRERY ★
 *
 * The same decision the website made, and it holds harder in a 900-pixel app window: ordinary
 * document flow does the layout, so a 173-body system needs no geometry engine, and nothing has to
 * change when the window narrows except how far each row is indented.
 */
function SystemTree({
  plan,
  buildTypes,
  busy,
  canEdit,
  act,
}: {
  plan: ColonyPlan;
  buildTypes: readonly BuildTypeRow[];
  busy: boolean;
  canEdit: boolean;
  act: (fn: () => Promise<Answer<unknown>>) => void;
}): JSX.Element {
  if (plan.bodies.length === 0) {
    return (
      <Empty>
        {/* Honest about which of two very different things happened. A system nobody has scanned
            and a system that does not exist look identical from here, and neither is our failure. */}
        Nothing has been scanned in {plan.systemName} yet, or the name does not match a system
        anybody has visited. Bodies appear here once somebody surveys it.
      </Empty>
    );
  }

  /*
   * The market prediction's epistemics, ONCE for the page rather than under every port — the same
   * single rendering the website does. Distinct notes because a micro-market carries an extra
   * clause about trimmed lines.
   */
  const marketNotes = [
    ...new Set(
      (plan.markets ?? [])
        .filter((m) => m.market.exports.length + m.market.imports.length > 0)
        .map((m) => m.market.note),
    ),
  ];

  return (
    <div>
      {/*
        ★ WHAT THE MODEL CANNOT SEE ★

        Three inputs the game uses are not in the body data anybody publishes. A prediction that
        quietly omitted them would be wrong in a way nobody could check, so they are printed.
      */}
      <p style={{ margin: '0 0 10px', fontSize: '11px', color: C.faint }}>
        Economies are predicted from the body and from what stands on it. Not taken into account:{' '}
        {plan.economies.blindSpots.join('; ')}.
      </p>

      {tree(plan.bodies).map(({ body, depth }) => {
        const here = plan.sites.filter((s) => s.bodyId === body.bodyId);

        return (
          <div
            key={body.bodyId}
            style={{
              // Indentation IS the nesting. The left rule makes it readable at a glance where
              // padding alone reads as an accident in a narrow window.
              marginLeft: `${depth * 16}px`,
              borderTop: `1px solid ${C.subtle}`,
              padding: '10px 0',
              // The left rule makes the nesting readable at a glance where indentation alone reads
              // as an accident in a narrow window. Roots have nothing to hang off, so they get none.
              ...(depth === 0
                ? {}
                : { borderLeft: `1px solid ${C.subtle}`, paddingLeft: '10px' }),
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '13px', color: C.text }}>
                {shortName(body.name, plan.systemName)}
                <span style={{ marginLeft: '8px', fontSize: '11px', color: C.faint }}>
                  {describe(body)}
                </span>
              </span>
              {body.distanceLs === null ? null : (
                <span style={{ ...MONO, fontSize: '11px', color: C.dim }}>
                  {Math.round(body.distanceLs).toLocaleString()} ls
                </span>
              )}
            </div>

            <Slots body={body} plan={plan} canEdit={canEdit} act={act} />

            {(['orbital', 'surface'] as const).map((where) => {
              const list = here.filter((s) => s.location === where);
              const cap = where === 'orbital' ? body.orbitalSlots : body.surfaceSlots;

              return (
                <div key={where} style={{ marginTop: '7px' }}>
                  <p
                    style={{
                      ...MONO,
                      margin: 0,
                      fontSize: '10px',
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: C.faint,
                    }}
                  >
                    {where}
                    {cap === null ? '' : ` · ${list.length} of ${cap}`}
                  </p>

                  {list.map((s) => (
                    <div key={s.id} style={{ marginTop: '3px' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: '10px',
                          fontSize: '12px',
                          color: C.dim,
                        }}
                      >
                        <span>
                          <span style={{ ...MONO, fontSize: '10px', color: C.faint }}>
                            #{s.position + 1}
                          </span>{' '}
                          {s.buildTypeName ?? 'nothing chosen yet'}
                          {s.isPrimary ? (
                            <span
                              style={{
                                ...MONO,
                                marginLeft: '7px',
                                fontSize: '9px',
                                letterSpacing: '0.16em',
                                textTransform: 'uppercase',
                                color: C.orangeBright,
                              }}
                            >
                              primary
                            </span>
                          ) : null}
                          {/*
                            ★ A PLANNED SITE THAT GOT BUILT SAYS SO — SQUADRON OWNER, 2026-08-10 ★

                            `colony_plan_sites.project_id` has been read out by the planner since it
                            shipped and written by nothing at all. The website now writes it when a
                            member posts a planned site as a project.

                            The APP does not offer "post as project" and that is deliberate rather
                            than missing: this app posts the site you are DOCKED at, which is the
                            only moment the construction site's market id exists — and the market id
                            is precisely why a plan cannot create a project by itself. The app
                            already solves the harder half; it just needed to show the answer.
                          */}
                          {s.projectId === null ? null : (
                            <span
                              style={{
                                ...MONO,
                                marginLeft: '7px',
                                fontSize: '9px',
                                letterSpacing: '0.16em',
                                textTransform: 'uppercase',
                                color: C.good,
                              }}
                              title="This planned site has been posted as a project and is being hauled to."
                            >
                              built
                            </span>
                          )}
                          {s.totalTonnes === null ? null : (
                            <span style={{ ...MONO, marginLeft: '7px', color: C.faint }}>
                              {s.totalTonnes.toLocaleString()} t
                            </span>
                          )}
                          <SiteEconomyLine
                            site={s}
                            economy={plan.economies.sites.find((e) => e.siteId === s.id)}
                          />
                        </span>
                        {canEdit ? (
                          <Button
                            tone="danger"
                            disabled={busy}
                            onClick={() =>
                              act(() => window.colony.planRemoveSite(plan.id, s.id, plan.version))
                            }
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      <SiteMarketLine
                        market={(plan.markets ?? []).find((m) => m.siteId === s.id)?.market}
                      />
                    </div>
                  ))}

                  {canEdit && (cap === null || list.length < cap) ? (
                    <AddSite
                      buildTypes={buildTypes}
                      where={where}
                      busy={busy}
                      onAdd={(buildTypeId) =>
                        act(() =>
                          window.colony.planAddSite(plan.id, {
                            version: plan.version,
                            bodyId: body.bodyId,
                            location: where,
                            buildTypeId,
                          }),
                        )
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}

      {marketNotes.length === 0 ? null : (
        <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.faint }}>
          {marketNotes.join(' ')}
        </p>
      )}
    </div>
  );
}

/**
 * The slot counts, entered rather than predicted.
 *
 * ★ THE OWNER CHOSE TO ASK FOR BOTH ★
 *
 * A community formula exists for surface slots and none exists at all for orbital — RavenColonial
 * predicts the first and asks for the second. Asking for both is stricter and more honest: every
 * number on this page is then something somebody read off their own screen, with their name on it.
 */
function Slots({
  body,
  plan,
  canEdit,
  act,
}: {
  body: PlanBody;
  plan: ColonyPlan;
  canEdit: boolean;
  act: (fn: () => Promise<Answer<unknown>>) => void;
}): JSX.Element | null {
  const [orbital, setOrbital] = useState(body.orbitalSlots?.toString() ?? '');
  const [surface, setSurface] = useState(body.surfaceSlots?.toString() ?? '');

  /*
   * ★ THESE TWO FIELDS ARE NOT DISABLED WHILE SAVING, AND THAT IS DELIBERATE ★
   *
   * Every other control here goes dead mid-save. These cannot: they save on blur, and tabbing from
   * orb to surf fires that blur — so disabling would take focus off the field the member just moved
   * into, mid-keystroke. Nothing is at risk by leaving them live, because a slot count is a fact
   * about the galaxy keyed on the body itself, carries no plan revision, and the second write
   * simply lands after the first.
   */
  const save = (): void => {
    if (plan.systemId64 === null) return;
    const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));
    act(() =>
      window.colony.planSlots(plan.systemId64 as string, body.bodyId, {
        orbital: num(orbital),
        surface: num(surface),
      }),
    );
  };

  /*
   * Read-only when the member cannot edit, and NOTHING at all when there is also nothing to read —
   * the same three states the website has. Two dead input boxes on a plan somebody is only looking
   * at invite a change that will be refused.
   */
  if (!canEdit) {
    if (body.orbitalSlots === null && body.surfaceSlots === null) return null;
    return (
      <p style={{ ...MONO, margin: '5px 0 0', fontSize: '10px', color: C.faint }}>
        {body.orbitalSlots ?? '?'} orbital · {body.surfaceSlots ?? '?'} surface
        {body.slotsBy === null ? '' : ` · read by ${body.slotsBy}`}
      </p>
    );
  }

  const box: JSX.CSSProperties = { ...inputStyle, width: '46px', padding: '4px 6px', textAlign: 'center' };

  return (
    <div
      style={{
        marginTop: '5px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '7px',
      }}
    >
      <span
        style={{
          ...MONO,
          fontSize: '10px',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: C.faint,
        }}
      >
        slots
      </span>
      {[
        { label: 'orb', value: orbital, set: setOrbital },
        { label: 'surf', value: surface, set: setSurface },
      ].map((f) => (
        <label key={f.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ ...MONO, fontSize: '10px', color: C.faint }}>{f.label}</span>
          <input
            value={f.value}
            onInput={(e) => f.set((e.target as HTMLInputElement).value)}
            onBlur={save}
            inputMode="numeric"
            placeholder="?"
            style={box}
          />
        </label>
      ))}
      {/*
        Attribution belongs to a NUMBER, not to a row. Clearing both boxes leaves the name behind in
        the database, and printing it next to two empty fields would credit somebody with a reading
        that is no longer there.
      */}
      {body.slotsBy === null || (body.orbitalSlots === null && body.surfaceSlots === null) ? (
        <span style={{ fontSize: '10px', color: C.faint }}>read these off the game</span>
      ) : (
        <span style={{ fontSize: '10px', color: C.faint }}>by {body.slotsBy}</span>
      )}
    </div>
  );
}

/**
 * Puts a build in a slot.
 *
 * ★ THE PICKER IS BUILT WHEN IT IS OPENED, NOT WHEN THE PAGE IS ★
 *
 * Every body has two of these and the catalogue is fifty-five builds. Rendering them all up front
 * puts the whole catalogue on the page forty-four times over for a twenty-two body system — the
 * website measured that at 337 KB of markup, and this app has less room to waste, not more.
 */
function AddSite({
  buildTypes,
  where,
  busy,
  onAdd,
}: {
  buildTypes: readonly BuildTypeRow[];
  where: 'orbital' | 'surface';
  busy: boolean;
  onAdd: (buildTypeId: string) => void;
}): JSX.Element {
  const [choice, setChoice] = useState('');
  const [open, setOpen] = useState(false);
  // The catalogue facets, mirrored from the build-types page: same values, same 'all' default.
  const [tier, setTier] = useState('all');
  const [pad, setPad] = useState('all');

  if (!open) {
    return (
      <div style={{ marginTop: '4px' }}>
        <Button onClick={() => setOpen(true)}>+ add a build</Button>
      </div>
    );
  }

  // Filtered by where it can actually go. An orbital list offering surface settlements is a list
  // somebody has to know the game to read — and the point of this page is that they should not.
  // Tier and pad narrow it further: "a tier-2 with a large pad" is how people think about the pick.
  const usable = buildTypes.filter(
    (b) =>
      b.location === where &&
      (tier === 'all' || String(b.tier) === tier) &&
      (pad === 'all' || b.padSize === pad),
  );

  return (
    <div
      style={{
        marginTop: '4px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '7px',
      }}
    >
      {(
        [
          { label: 'tier', value: tier, set: setTier, options: ['1', '2', '3'] },
          { label: 'pad', value: pad, set: setPad, options: ['none', 'small', 'medium', 'large'] },
        ] as const
      ).map((f) => (
        <select
          key={f.label}
          value={f.value}
          onChange={(e) => f.set((e.target as HTMLSelectElement).value)}
          aria-label={`Filter builds by ${f.label}`}
          style={{ ...inputStyle, width: 'auto', padding: '5px 8px' }}
        >
          <option value="all">any {f.label}</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ))}
      <select
        value={choice}
        onChange={(e) => setChoice((e.target as HTMLSelectElement).value)}
        // Focused on open, because the click that opened this was a click ON the control it
        // replaced — leaving focus on a button that no longer exists strands a keyboard entirely.
        autofocus
        style={{ ...inputStyle, width: 'auto', maxWidth: '260px', padding: '5px 8px' }}
      >
        <option value="">add a build…</option>
        {usable.map((b) => (
          <option key={b.id} value={b.id}>
            {b.displayName} · T{b.tier}
            {b.padSize === 'none' ? '' : ` · ${b.padSize} pad`} · {b.totalTonnes.toLocaleString()} t
          </option>
        ))}
      </select>
      <Button
        tone="primary"
        disabled={busy || choice === ''}
        onClick={() => {
          onAdd(choice);
          setChoice('');
          setOpen(false);
        }}
      >
        Add
      </Button>
      <Button onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

/**
 * A better build order, when there is one.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "you have an editable order, but nothing suggests the feeder→hub pairing that would get your
 * economy producing after ~50k t instead of ~257k t. That's a real gap inside a feature that exists."
 *
 * ★ THE NUMBER IS THE WHOLE ARGUMENT ★
 *
 * "A better order" persuades nobody. "Your economy opens 240,000 tonnes earlier" is a decision
 * somebody can make, so the tonnage is the headline.
 *
 * The suggestion itself is computed by the hub, so this app and the website propose the SAME order —
 * two implementations of a rule this fiddly would drift, and the half that drifted would be the one
 * telling somebody how to spend a fortnight. It stays silent unless the saving is real, and it never
 * applies itself: one button, pressed on purpose, sending the same whole-order save the arrows send.
 */
function Suggestion({
  plan,
  canEdit,
  busy,
  onApply,
}: {
  plan: ColonyPlan;
  canEdit: boolean;
  busy: boolean;
  onApply: (ids: readonly string[]) => void;
}): JSX.Element | null {
  const s = plan.suggestion;
  if (s === undefined || !s.worthIt) return null;

  const at = s.firstEconomyAt.suggested;
  if (at === null) return null;
  const saved = s.tonnesBefore.current - s.tonnesBefore.suggested;

  return (
    <div
      style={{
        border: `1px solid ${C.cyanCore}`,
        background: C.cyanTint,
        borderRadius: '4px',
        padding: '8px 12px',
        marginBottom: '12px',
      }}
    >
      <p style={{ margin: 0, fontSize: '13px', color: C.text }}>
        Your economy could open{' '}
        <span style={{ color: C.cyan, fontVariantNumeric: 'tabular-nums' }}>
          {saved.toLocaleString()} t
        </span>{' '}
        earlier.
      </p>
      <p style={{ margin: '4px 0 0', fontSize: '11px', color: C.dim }}>
        {/* Both figures, because the saving alone is a claim and the pair is a comparison somebody
            can check against the list right below. */}
        The first economy build currently lands at step{' '}
        {(s.firstEconomyAt.current ?? plan.sites.length) + 1} after{' '}
        {s.tonnesBefore.current.toLocaleString()} t of hauling. Pairing each feeder with the hub it
        pays for puts one at step {at + 1}, after {s.tonnesBefore.suggested.toLocaleString()} t — so
        the system starts producing what the rest of the build has to buy. The primary port stays
        where you put it.
      </p>

      {canEdit ? (
        <div style={{ marginTop: '8px' }}>
          <Button disabled={busy} onClick={() => onApply(s.order)}>
            {busy ? 'Reordering…' : 'Reorder the plan this way'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Everything wrong with the plan, at the top where it cannot be missed.
 *
 * Silence when there is nothing wrong. A permanent "0 problems" banner trains people to ignore the
 * space, which is the one place a real problem has to appear.
 */
function Verdict({ problems }: { problems: readonly PlanProblem[] }): JSX.Element | null {
  if (problems.length === 0) return null;

  return (
    <div
      style={{
        marginBottom: '14px',
        border: `1px solid ${C.bad}`,
        borderRadius: '4px',
        background: C.badTint,
        padding: '10px 14px',
      }}
    >
      <p
        style={{
          ...MONO,
          margin: 0,
          fontSize: '10px',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: C.bad,
        }}
      >
        This plan cannot be built in this order
      </p>
      <ul style={{ margin: '7px 0 0', paddingLeft: '18px', fontSize: '13px', color: C.text }}>
        {problems.map((p) => (
          <li key={p.message} style={{ marginTop: '3px' }}>
            {p.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What one step costs and earns in construction points. */
function Cost({ step }: { step: PlanSimStep | undefined }): JSX.Element | null {
  if (step === undefined || (step.spend === null && step.earn === null)) return null;

  return (
    <span style={{ ...MONO, fontSize: '10px', color: C.faint }}>
      {step.spend === null ? null : (
        <span
          style={{ color: C.warn }}
          title={
            step.surcharge > 0
              ? `${step.surcharge} of this is the surcharge the game adds to every starport after the second.`
              : undefined
          }
        >
          −{step.spend.points} T{step.spend.tier}
          {step.surcharge > 0 ? '*' : ''}
        </span>
      )}
      {step.spend !== null && step.earn !== null ? ' ' : null}
      {step.earn === null ? null : (
        <span style={{ color: C.cyan }}>
          +{step.earn.points} T{step.earn.tier}
        </span>
      )}
    </span>
  );
}

/** The running balance, in the two currencies the game keeps. */
function Balance({ step }: { step: PlanSimStep | undefined }): JSX.Element | null {
  if (step === undefined) return null;

  const cell = (label: string, value: number): JSX.Element => (
    <span style={{ color: value < 0 ? C.bad : C.dim }}>
      {label} {value > 0 ? '+' : ''}
      {value}
    </span>
  );

  return (
    <span style={{ ...MONO, display: 'flex', gap: '7px', fontSize: '10px' }}>
      {cell('T2', step.tier2)}
      {cell('T3', step.tier3)}
    </span>
  );
}

/** Catalogue economies are stored lowercase and single-word. Members read them as words. */
const ECONOMY_NAMES: Readonly<Record<string, string>> = {
  agriculture: 'Agriculture',
  colony: 'Colony',
  extraction: 'Extraction',
  hightech: 'High Tech',
  industrial: 'Industrial',
  military: 'Military',
  refinery: 'Refinery',
  service: 'Service',
  terraforming: 'Terraforming',
  tourism: 'Tourism',
};

const economyName = (key: string): string => ECONOMY_NAMES[key] ?? key;

/**
 * What the system BECOMES — the answer the build books lead with.
 *
 * ★ THE MOST CONSEQUENTIAL LINE ON THE PAGE, AND IT WAS NOT HERE ★
 *
 * The panel below says how good the system gets. This one says what it IS, which is the question a
 * member is really answering when they choose a build order: two plans with identical tonnage and
 * identical effect totals produce a refinery or an extraction site depending only on which
 * influences outnumber which.
 *
 * It is also the only decision here that cannot be undone. A build carrying a fixed economy, placed
 * FIRST, sets the system permanently — eight high-tech installations lose to one industrial opener.
 *
 * Word for word the website's panel, because a member reading the plan on the second monitor and
 * the same plan in the browser must not be told two different things.
 */
function Economy({ plan }: { plan: ColonyPlan }): JSX.Element | null {
  const { counts, primary, secondary, locked, lockedBy } = plan.simulation.economy;
  if (primary === null) return null;

  const votes = Object.entries(counts);

  return (
    <div
      style={{
        marginTop: '18px',
        border: `1px solid ${C.subtle}`,
        borderRadius: '4px',
        padding: '10px 14px',
      }}
    >
      <p
        style={{
          ...MONO,
          margin: 0,
          fontSize: '10px',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: C.dim,
        }}
      >
        What this system becomes
      </p>

      <div
        style={{
          marginTop: '6px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: '4px 14px',
        }}
      >
        <span style={{ fontSize: '17px', color: C.orangeBright }}>{economyName(primary)}</span>
        {secondary === null ? null : (
          <span style={{ fontSize: '11px', color: C.dim }}>
            with {economyName(secondary)} second
          </span>
        )}
      </div>

      {votes.length === 0 ? null : (
        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px 22px' }}>
          {votes.map(([key, n]) => (
            <span key={key} style={{ fontSize: '11px', color: C.dim }}>
              {economyName(key)}{' '}
              <span
                style={{ ...MONO, color: C.text }}
                title={`${n} build${n === 1 ? '' : 's'} in this order push the system towards ${economyName(key)}.`}
              >
                &times;{n}
              </span>
            </span>
          ))}
        </div>
      )}

      {locked ? (
        <p
          style={{
            margin: '10px 0 0',
            borderLeft: `2px solid ${C.warn}`,
            paddingLeft: '10px',
            fontSize: '11px',
            color: C.dim,
          }}
        >
          <strong style={{ color: C.text }}>This economy is locked.</strong>{' '}
          <span style={MONO}>{lockedBy}</span> opens the order and permanently fixes the system to{' '}
          {economyName(primary)}. Nothing built later can change it, whatever the counts above say.
          To keep the choice open, start with a build that carries no economy of its own — a colony
          port such as <span style={MONO}>plutus</span>, <span style={MONO}>vesta</span> or{' '}
          <span style={MONO}>hestia</span>.
        </p>
      ) : (
        <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.faint }}>
          The economy with the most builds behind it becomes the system&rsquo;s primary; the
          runner-up becomes its secondary. Reordering the list above does not change this — only
          adding or removing builds does. One exception: a build that fixes an economy decides it
          outright if it is placed first.
        </p>
      )}
    </div>
  );
}

/**
 * What the system becomes if the whole order is built.
 *
 * ★ LABELLED AS GATHERED, BECAUSE THAT IS WHAT IT IS ★
 *
 * Frontier publishes none of these figures. Every one was measured by players comparing a system
 * before and after a build, and they are the least corroborated numbers on this page — unlike the
 * construction-point costs, which two independent sources agree on. A member deciding how to spend
 * a fortnight is owed that distinction, so it is written next to the numbers rather than buried.
 */
function Effects({ plan }: { plan: ColonyPlan }): JSX.Element | null {
  const e = plan.simulation.effects;
  if (!Object.values(e).some((v) => v !== 0)) return null;

  const rows: Array<[string, number]> = [
    ['Population', e.population],
    ['Max population', e.maxPopulation],
    ['Security', e.security],
    ['Technology', e.technology],
    ['Wealth', e.wealth],
    ['Standard of living', e.standardOfLiving],
    ['Development', e.development],
  ];

  return (
    <div
      style={{
        marginTop: '18px',
        border: `1px solid ${C.subtle}`,
        borderRadius: '4px',
        padding: '10px 14px',
      }}
    >
      {/*
        "Dropping this plan into the system", not "the plan's effects" — the website's wording,
        verbatim: the deltas are before → after statements about the system the plan lands in,
        accrued across the whole build order above.
      */}
      <p
        style={{
          ...MONO,
          margin: 0,
          fontSize: '10px',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: C.dim,
        }}
      >
        What dropping this plan into the system does
      </p>
      <div style={{ marginTop: '7px', display: 'flex', flexWrap: 'wrap', gap: '6px 22px' }}>
        {rows.map(([label, value]) => (
          <span key={label} style={{ fontSize: '11px', color: C.dim }}>
            {label}{' '}
            <span
              style={{ ...MONO, color: value < 0 ? C.warn : C.text }}
              title={`The system's ${label.toLowerCase()} after this plan = what it is now ${value >= 0 ? '+' : '−'} ${Math.abs(value)}.`}
            >
              {value > 0 ? '+' : ''}
              {value}
            </span>
          </span>
        ))}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.faint }}>
        Each figure is a shift against whatever the system is today, counted cumulatively across
        every step of the build order above. These seven are gathered by players, not published by
        Frontier, and are the least confirmed numbers here — unlike the construction points, which
        two independent sources agree on. A large starport really does cost the system security;
        that is the game, not a mistake.
      </p>
    </div>
  );
}

/**
 * The order things get built in, what each step costs, and whether it can be paid for.
 *
 * ★ THE ORDER IS PART OF THE PLAN, NOT A PRESENTATION CHOICE ★
 *
 * The game earns and spends construction points in sequence, so the same set of builds in a
 * different order is a different plan — one that works and one that stalls halfway.
 *
 * ★ THE DEFICIT IS SHOWN AT THE STEP IT HAPPENS ★
 *
 * A total that balances hides a plan that cannot be built: step four runs out of tier-2 points and
 * step nine pays them back, so the sum looks fine and the squadron gets stuck at step four with a
 * fortnight of hauling behind them.
 *
 * Up and down buttons rather than drag and drop: a drag library would be a dependency for a control
 * that does not work with a keyboard, and the buttons send the same whole-order save a drag would.
 */
function BuildOrder({
  plan,
  busy,
  canEdit,
  act,
}: {
  plan: ColonyPlan;
  busy: boolean;
  canEdit: boolean;
  act: (fn: () => Promise<Answer<unknown>>) => void;
}): JSX.Element {
  if (plan.sites.length === 0) {
    return (
      <Empty>
        Nothing planned yet. Add builds to bodies above and they appear here in the order they would
        be constructed.
      </Empty>
    );
  }

  /** Every order change goes through one save, so the arrows and the suggestion cannot diverge. */
  const saveOrder = (ids: readonly string[]): void => {
    // Copied rather than passed through: the bridge takes a mutable array, and handing it one that
    // the suggestion still holds a reference to is how a caller's data quietly changes underneath it.
    act(() => window.colony.planReorder(plan.id, { version: plan.version, siteIds: [...ids] }));
  };

  const move = (from: number, to: number): void => {
    const ids = plan.sites.map((s) => s.id);
    const moved = ids[from];
    if (moved === undefined || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, moved);
    saveOrder(ids);
  };

  /*
   * Accumulated down the list, so each row says what the plan costs UP TO AND INCLUDING it. That is
   * the number somebody uses to draw a line — "we can fund the first four" — which a per-row figure
   * alone cannot answer without adding them up by eye.
   */
  let running = 0;
  const sim = plan.simulation;

  return (
    <div>
      <Verdict problems={sim.problems} />

      <Suggestion plan={plan} canEdit={canEdit} busy={busy} onApply={saveOrder} />

      {plan.sites.map((s, i) => {
        running += s.totalTonnes ?? 0;
        const body = plan.bodies.find((b) => b.bodyId === s.bodyId);
        const step = sim.steps[i];
        const broken = (step?.problems.length ?? 0) > 0;

        return (
          <div
            key={s.id}
            style={{
              borderTop: `1px solid ${broken ? C.bad : C.subtle}`,
              padding: '8px 0',
              ...(broken ? { background: C.badTint, paddingLeft: '8px' } : {}),
            }}
          >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '13px' }}>
              <span style={{ ...MONO, fontSize: '11px', color: C.faint }}>
                {String(i + 1).padStart(2, '0')}
              </span>{' '}
              <span style={{ color: C.text }}>{s.buildTypeName ?? 'nothing chosen yet'}</span>
              <span style={{ marginLeft: '8px', fontSize: '11px', color: C.dim }}>
                {body === undefined ? 'not placed' : shortName(body.name, plan.systemName)} ·{' '}
                {s.location}
                {s.tier === null ? '' : ` · T${s.tier}`}
              </span>
              {s.isPrimary ? (
                <span
                  style={{
                    ...MONO,
                    marginLeft: '8px',
                    fontSize: '9px',
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: C.orangeBright,
                  }}
                  title="The first station in a system. The game charges no construction points for it."
                >
                  primary
                </span>
              ) : null}
            </span>

            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Cost step={step} />
              <span style={{ ...MONO, fontSize: '11px', color: C.dim }}>
                {s.totalTonnes === null ? '—' : `${s.totalTonnes.toLocaleString()} t`}
                <span style={{ marginLeft: '8px', color: C.faint }}>Σ {running.toLocaleString()}</span>
              </span>
              <Balance step={step} />
              {canEdit ? (
                <>
                  <Button disabled={busy || i === 0} onClick={() => move(i, i - 1)}>
                    ↑
                  </Button>
                  <Button
                    disabled={busy || i === plan.sites.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </Button>
                </>
              ) : null}
            </span>
          </div>

          {(step?.problems ?? []).map((p) => (
            <p key={p.message} style={{ margin: '4px 0 0', fontSize: '11px', color: C.bad }}>
              {p.message}
            </p>
          ))}
          </div>
        );
      })}

      <p style={{ ...MONO, margin: '10px 0 0', fontSize: '11px', color: C.dim }}>
        {/* Said out loud, because moving the top row moves the primary with it — and that changes
            what the game charges, not just the reading order. */}
        {plan.sites.length} site{plan.sites.length === 1 ? '' : 's'} · {running.toLocaleString()} t in
        total · the first is the primary port, and moving it changes which build that is
      </p>

      {/*
        The economy and the system effects used to render here, below the whole editable list. They
        moved to their own tab — see EconomyAndMarkets — because they answer a question this tab
        cannot ask: the economy follows WHICH builds are planned, not the order of them.
      */}
    </div>
  );
}

/**
 * What the system becomes, and what its markets would then trade.
 *
 * Both panels, in the order that matters: what it becomes before how good it gets — the economy is
 * the decision, the scalars grade it.
 */
function EconomyAndMarkets({ plan }: { plan: ColonyPlan }): JSX.Element {
  const nothingYet =
    plan.simulation.economy.primary === null &&
    !Object.values(plan.simulation.effects).some((v) => v !== 0);

  if (nothingYet) {
    return (
      <Empty>
        Nothing to work out yet. Choose builds for the bodies on the system tab and what the system
        becomes is worked out from them.
      </Empty>
    );
  }

  return (
    <div>
      <Economy plan={plan} />
      <Effects plan={plan} />
    </div>
  );
}
