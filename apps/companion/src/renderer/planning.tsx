import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { BuildTypeRow, ColonyPlan, PlanBody } from '../hub-colony.js';
import { Button, C, Card, Copy, Empty, Field, Problem, Section, Stat, inputStyle } from './ui.js';

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

// ---------------------------------------------------------------------------- the page

export function PlanningPage(): JSX.Element {
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

  const squadron = (plans ?? []).filter((p) => p.owner === 'squadron');
  const personal = (plans ?? []).filter((p) => p.owner === 'personal');

  return (
    <div>
      {error === null ? null : (
        <div style={{ marginBottom: '14px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      <Section title="Start a plan">
        <NewPlan onMade={setOpenId} />
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
function NewPlan({ onMade }: { onMade: (id: string) => void }): JSX.Element {
  const [title, setTitle] = useState('');
  const [systemName, setSystemName] = useState('');
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
            <input
              value={systemName}
              onInput={(e) => setSystemName((e.target as HTMLInputElement).value)}
              placeholder="the system you are claiming"
              style={inputStyle}
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
  const [buildTypes, setBuildTypes] = useState<readonly BuildTypeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    void window.colony.plan(id).then((a) => {
      if (a.ok) {
        setPlan(a.data.plan);
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

      <Section title="The system">
        <SystemTree plan={plan} buildTypes={buildTypes} busy={busy} act={act} />
      </Section>

      <Section title="Build order">
        <BuildOrder plan={plan} busy={busy} act={act} />
      </Section>
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
  act,
}: {
  plan: ColonyPlan;
  buildTypes: readonly BuildTypeRow[];
  busy: boolean;
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

  return (
    <div>
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

            <Slots body={body} plan={plan} act={act} />

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
                    <div
                      key={s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: '10px',
                        fontSize: '12px',
                        color: C.dim,
                        marginTop: '3px',
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
                        {s.totalTonnes === null ? null : (
                          <span style={{ ...MONO, marginLeft: '7px', color: C.faint }}>
                            {s.totalTonnes.toLocaleString()} t
                          </span>
                        )}
                      </span>
                      <Button
                        tone="danger"
                        disabled={busy}
                        onClick={() =>
                          act(() => window.colony.planRemoveSite(plan.id, s.id, plan.version))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}

                  {cap === null || list.length < cap ? (
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
  act,
}: {
  body: PlanBody;
  plan: ColonyPlan;
  act: (fn: () => Promise<Answer<unknown>>) => void;
}): JSX.Element {
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

  if (!open) {
    return (
      <div style={{ marginTop: '4px' }}>
        <Button onClick={() => setOpen(true)}>+ add a build</Button>
      </div>
    );
  }

  // Filtered by where it can actually go. An orbital list offering surface settlements is a list
  // somebody has to know the game to read — and the point of this page is that they should not.
  const usable = buildTypes.filter((b) => b.location === where);

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
            {b.displayName} · T{b.tier} · {b.totalTonnes.toLocaleString()} t
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
 * The order things get built in, with the running total.
 *
 * ★ THE ORDER IS PART OF THE PLAN, NOT A PRESENTATION CHOICE ★
 *
 * The game earns and spends construction points in sequence, so the same set of builds in a
 * different order is a different plan — one that works and one that stalls halfway.
 *
 * Up and down buttons rather than drag and drop: a drag library would be a dependency for a control
 * that does not work with a keyboard, and the buttons send the same whole-order save a drag would.
 */
function BuildOrder({
  plan,
  busy,
  act,
}: {
  plan: ColonyPlan;
  busy: boolean;
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

  const move = (from: number, to: number): void => {
    const ids = plan.sites.map((s) => s.id);
    const moved = ids[from];
    if (moved === undefined || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, moved);
    act(() => window.colony.planReorder(plan.id, { version: plan.version, siteIds: ids }));
  };

  /*
   * Accumulated down the list, so each row says what the plan costs UP TO AND INCLUDING it. That is
   * the number somebody uses to draw a line — "we can fund the first four" — which a per-row figure
   * alone cannot answer without adding them up by eye.
   */
  let running = 0;

  return (
    <div>
      {plan.sites.map((s, i) => {
        running += s.totalTonnes ?? 0;
        const body = plan.bodies.find((b) => b.bodyId === s.bodyId);

        return (
          <div
            key={s.id}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '10px',
              borderTop: `1px solid ${C.subtle}`,
              padding: '8px 0',
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
              <span style={{ ...MONO, fontSize: '11px', color: C.dim }}>
                {s.totalTonnes === null ? '—' : `${s.totalTonnes.toLocaleString()} t`}
                <span style={{ marginLeft: '8px', color: C.faint }}>Σ {running.toLocaleString()}</span>
              </span>
              <Button disabled={busy || i === 0} onClick={() => move(i, i - 1)}>
                ↑
              </Button>
              <Button disabled={busy || i === plan.sites.length - 1} onClick={() => move(i, i + 1)}>
                ↓
              </Button>
            </span>
          </div>
        );
      })}

      <p style={{ ...MONO, margin: '10px 0 0', fontSize: '11px', color: C.dim }}>
        {/* Said out loud, because moving the top row moves the primary with it — and that changes
            what the game charges, not just the reading order. */}
        {plan.sites.length} site{plan.sites.length === 1 ? '' : 's'} · {running.toLocaleString()} t in
        total · the first is the primary port, and moving it changes which build that is
      </p>
    </div>
  );
}
