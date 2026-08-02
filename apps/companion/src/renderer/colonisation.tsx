import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  RosterEntry,
  ColonyHauler,
  ColonyNeed,
  ColonyProject,
  ColonyRights,
  ColonyShoppingRow,
} from '../hub-colony.js';
import { projectTitleFrom } from '../docked.js';
import {
  DeliveryChart,
  HaulerChart,
  type DeliveryBucket,
  type HaulerStack,
} from './delivery-chart.js';
import {
  Bar,
  Button,
  C,
  Card,
  Empty,
  Field,
  Problem,
  Section,
  Stat,
  credits,
  inputStyle,
  tonnes,
} from './ui.js';

/**
 * Colonisation, in the companion app.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we want the entire colonization module to be visible in the companion app! people should be able
 * to have full interaction with colonization either from the website or from the app."
 *
 * So this is not a summary of the website — it is the same thing: both boards, a project's needs,
 * who has hauled to it, and where to buy the rest. Everything comes from the same endpoints the
 * site's own pages use, so the two cannot disagree.
 */

declare global {
  interface Window {
    readonly colony: {
      projects(): Promise<Answer<{ projects: ColonyProject[]; can: ColonyRights }>>;
      project(id: string): Promise<Answer<ProjectDetailData>>;
      at(marketId: string): Promise<Answer<{ project: ColonyProject | null; needs: ColonyNeed[] }>>;
      post(body: unknown): Promise<Answer<{ id: string }>>;
      roster(id: string): Promise<Answer<{ roster: RosterEntry[] }>>;
      join(id: string): Promise<Answer<{ ok: true }>>;
      leave(id: string): Promise<Answer<{ ok: true }>>;
      assign(
        id: string,
        body: { commodity: string; tonnes?: number; userId?: string },
      ): Promise<Answer<{ ok: true }>>;
      unassign(
        id: string,
        body: { commodity: string; userId?: string },
      ): Promise<Answer<{ ok: true }>>;
    };
  }
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/** One delivery, straight off the append-only ledger. */
export interface Delivery {
  readonly at: string;
  readonly commander: string;
  readonly commodity: string;
  readonly amount: number;
}

export interface ProjectDetailData {
  project: ColonyProject;
  needs: ColonyNeed[];
  haulers: ColonyHauler[];
  shopping: ColonyShoppingRow[];
  deliveries: Delivery[];
  chart: {
    bucket: 'hour' | 'day';
    byCommodity: DeliveryBucket[];
    byCommander: DeliveryBucket[];
    haulers: HaulerStack[];
  };
}

/** Where the commander is docked, handed down from the app's state. */
export interface DockedAt {
  readonly marketId: string;
  readonly stationName: string;
  readonly systemName: string;
  /** Present when this dock is a construction site, straight from the depot heartbeat. */
  readonly site: {
    readonly progress: number;
    readonly complete: boolean;
    readonly failed: boolean;
    readonly resources: ReadonlyArray<{
      readonly commodity: string;
      readonly required: number;
      readonly provided: number;
    }>;
  } | null;
}

/**
 * One board — squadron or members — as its own page.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "lets break this up, create in the sidebar a colonization category, collapsable, New project
 * should be its own page please. then Member Projects and Squadron projects should be their own
 * pages too."
 *
 * The projects themselves are fetched once by the shell and handed down, because the sidebar needs
 * the counts anyway — a second fetch per page would be the same data arriving twice and two chances
 * for the badge and the list to disagree.
 */
export function ColonyBoardPage({
  owner,
  projects,
  error,
  onReload,
}: {
  owner: 'squadron' | 'personal';
  projects: readonly ColonyProject[];
  error: string | null;
  onReload: () => void;
}): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId !== null) {
    return <ProjectDetail id={openId} onBack={() => { setOpenId(null); onReload(); }} />;
  }

  const mine = projects.filter((p) => p.owner === owner);

  return (
    <div>
      {error === null ? null : (
        <div style={{ marginBottom: '14px' }}>
          <Problem>{error}</Problem>
        </div>
      )}
      <Section title={owner === 'squadron' ? 'Squadron projects' : 'Members’ projects'}>
        <Board
          projects={mine}
          onOpen={setOpenId}
          empty={
            owner === 'squadron'
              ? 'No squadron projects yet. An officer can post one from New project.'
              : 'Nobody has posted a project yet.'
          }
        />
      </Section>
    </div>
  );
}

/** Posting a project, as its own page. */
export function ColonyNewPage({
  dockedAt,
  can,
  projects,
  onPosted,
}: {
  dockedAt: DockedAt | null;
  can: ColonyRights | null;
  projects: readonly ColonyProject[];
  onPosted: () => void;
}): JSX.Element {
  const [posting, setPosting] = useState(false);

  if (can !== null && !can.post) {
    return (
      <Section title="New project">
        <Empty>Your rank cannot post colonisation projects.</Empty>
      </Section>
    );
  }

  // Already on the board: the member is looking at it, not creating it. Offering the form would end
  // in the server answering "already posted as X", which is a worse way to find out.
  const alreadyPosted =
    dockedAt !== null && projects.some((p) => p.marketId === dockedAt.marketId);

  return (
    <div>
      <Section title="Where you are">
        {dockedAt === null ? (
          <Empty>Dock at a construction site and everything about it appears here.</Empty>
        ) : alreadyPosted ? (
          <Card accent={C.cyan}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              {projectTitleFrom(dockedAt.stationName)}{' '}
              <span style={{ fontSize: '11px', color: C.faint }}>(Market {dockedAt.marketId})</span>
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: C.dim }}>
              This site is already posted. Open it from Squadron or Members’ projects.
            </p>
          </Card>
        ) : (
          <HereNow dockedAt={dockedAt} />
        )}
      </Section>

      {dockedAt === null || alreadyPosted ? null : (
        <Section
          title="Post it"
          aside={
            <Button tone={posting ? 'default' : 'primary'} onClick={() => setPosting((x) => !x)}>
              {posting ? 'Cancel' : 'New project'}
            </Button>
          }
        >
          {posting ? (
            <PostForm
              canPostSquadron={can?.manage === true}
              dockedAt={dockedAt}
              onPosted={() => {
                setPosting(false);
                onPosted();
              }}
            />
          ) : (
            <Empty>Everything is filled in already — press New project to check it and post.</Empty>
          )}
        </Section>
      )}
    </div>
  );
}

/**
 * What we already know about the site the member is standing on.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "it should read all data about the site and populate the new project window."
 *
 * So this is not a hint that the form will be pre-filled — it is the site itself, read from the
 * depot heartbeat the game emits every fifteen seconds. Progress, and every commodity still
 * outstanding, before anything has been posted to the squadron at all.
 */
function HereNow({ dockedAt }: { dockedAt: DockedAt }): JSX.Element {
  const site = dockedAt.site;
  const outstanding =
    site === null
      ? []
      : site.resources
          .filter((r) => r.required > r.provided)
          .sort((a, b) => b.required - b.provided - (a.required - a.provided));

  const totalNeeded = outstanding.reduce((sum, r) => sum + (r.required - r.provided), 0);
  // Across EVERY commodity, including the ones already finished — otherwise a site whose remaining
  // work is one commodity would report a delivery total that shrank as it neared completion.
  const totalDelivered =
    site === null ? 0 : site.resources.reduce((sum, r) => sum + r.provided, 0);
  const totalRequired =
    site === null ? 0 : site.resources.reduce((sum, r) => sum + r.required, 0);

  return (
    <Card accent={C.cyan}>
      {/*
        ★ THE SITE NAME, WITH THE MARKET ID IN BRACKETS — SQUADRON OWNER, 2026-08-02 ★

        "this should also give the name of the site docked at with the Market xxx in brackets".

        The id is shown alongside rather than instead of the name, because it is the thing a member
        can check against the game and against a project already on the board. It was standing in
        for the name only when we did not have one, which was itself the bug.
      */}
      <p style={{ margin: 0, fontSize: '14px' }}>
        {dockedAt.stationName === ''
          ? 'The construction site you are docked at'
          : projectTitleFrom(dockedAt.stationName)}{' '}
        <span style={{ fontSize: '11px', color: C.faint, fontVariantNumeric: 'tabular-nums' }}>
          (Market {dockedAt.marketId})
        </span>
      </p>
      <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
        {dockedAt.systemName === '' ? 'System not known yet' : dockedAt.systemName} · docked now
      </p>

      {site === null ? (
        /*
         * Docked, but no depot heartbeat — so this is an ordinary station, not a build site. Said
         * plainly rather than offering a form that would create a project pointing at a shipyard.
         */
        <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.dim }}>
          This is not a construction site. Dock at one and its needs appear here.
        </p>
      ) : (
        <div style={{ marginTop: '12px' }}>
          <Bar done={Math.round(site.progress * 1000)} total={1000} />
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: C.dim }}>
            {(site.progress * 100).toFixed(1)}% built · {tonnes(totalDelivered)} of{' '}
            {totalRequired.toLocaleString()} already delivered
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: C.dim }}>
            {outstanding.length === 0
              ? 'Everything this site asked for has been delivered.'
              : `${tonnes(totalNeeded)} still needed across ${outstanding.length} commodit${outstanding.length === 1 ? 'y' : 'ies'}`}
          </p>

          {outstanding.length === 0 ? null : (
            <div style={{ marginTop: '10px' }}>
              {/*
                ★ WHAT HAS ALREADY BEEN DELIVERED, TOO — SQUADRON OWNER, 2026-08-02 ★

                "if we can see the historical data on all materials that have been delivered, can we
                please include that when we create the new project, so we have full data visibilty."

                We can, and it costs nothing: the depot event carries `ProvidedAmount` for every
                commodity, which is the site's ENTIRE delivery history — everyone's, not just this
                commander's. A site half built by strangers shows as half built.
              */}
              {outstanding.slice(0, 6).map((r) => (
                <div key={r.commodity} style={{ padding: '4px 0', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                    <span>{r.commodity}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: C.dim }}>
                      {(r.required - r.provided).toLocaleString()} still needed
                    </span>
                  </div>
                  <div style={{ marginTop: '3px' }}>
                    <Bar done={r.provided} total={r.required} />
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: '10px', color: C.faint }}>
                    {r.provided.toLocaleString()} of {r.required.toLocaleString()} delivered
                  </p>
                </div>
              ))}
              {outstanding.length > 6 ? (
                <p style={{ margin: '5px 0 0', fontSize: '11px', color: C.faint }}>
                  and {outstanding.length - 6} more
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}

      <p style={{ margin: '12px 0 0', fontSize: '11px', color: C.faint }}>
        Press New project — the name, system, station and market id are already filled in, and
        everything delivered so far is posted with it.
      </p>
    </Card>
  );
}

function Board({
  projects,
  onOpen,
  empty,
}: {
  projects: readonly ColonyProject[];
  onOpen: (id: string) => void;
  empty: string;
}): JSX.Element {
  if (projects.length === 0) return <Empty>{empty}</Empty>;

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {projects.map((p) => (
        <div
          key={p.id}
          onClick={() => onOpen(p.id)}
          style={{
            cursor: 'pointer',
            border: `1px solid ${p.isPriority ? C.orange : C.hairline}`,
            background: C.panel,
            borderRadius: '10px',
            padding: '12px 14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '10px',
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: '14px' }}>
              {p.title}
              {p.isPriority ? (
                <span style={{ marginLeft: '8px', fontSize: '9px', letterSpacing: '0.18em', color: C.orange }}>
                  CURRENT EFFORT
                </span>
              ) : null}
              {p.completedAt !== null ? (
                <span style={{ marginLeft: '8px', fontSize: '9px', letterSpacing: '0.18em', color: C.good }}>
                  COMPLETE
                </span>
              ) : null}
            </span>
            <span style={{ fontSize: '11px', color: C.faint }}>{p.systemName}</span>
          </div>

          <div style={{ marginTop: '8px' }}>
            {/*
              A project nobody has docked at holds no needs — which is NOT the same as needing
              nothing, and a full bar would say exactly the wrong thing.
            */}
            {p.needCount === 0 ? (
              <p style={{ margin: 0, fontSize: '11px', color: C.faint }}>
                Waiting for somebody to dock there.
              </p>
            ) : (
              <>
                <Bar done={p.required - p.remaining} total={p.required} />
                <p style={{ margin: '5px 0 0', fontSize: '11px', color: C.dim }}>
                  {tonnes(p.remaining)} still needed
                  {p.required > 0 ? ` of ${p.required.toLocaleString()}` : ''} · {p.needCount}{' '}
                  commodit{p.needCount === 1 ? 'y' : 'ies'}
                </p>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * ★ WHICH WAY THE TIME CHART IS STACKED — SQUADRON OWNER, 2026-08-02 ★
   *
   * Both cuts of the same bars, and they answer different questions. By commodity: what went in on
   * Tuesday. By commander: who was flying on Tuesday. Held in state and switched locally rather
   * than refetched, because both stackings arrive in the same payload — a toggle that waits on the
   * network to redraw bars it already has reads as broken.
   */
  const [stackBy, setStackBy] = useState<'commodity' | 'commander'>('commodity');

  /*
   * Re-read after a roster change, so the delivered totals and the needs the roster is offering
   * stay in step with what was just claimed. Deliberately silent on failure: the roster has already
   * reported its own error, and a second message about the same action reads as two problems.
   */
  const reloadDetail = async (): Promise<void> => {
    const answer = await window.colony.project(id);
    if (answer.ok) setData(answer.data);
  };

  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      const answer = await window.colony.project(id);
      if (!live) return;
      if (answer.ok) setData(answer.data);
      else setError(answer.error);
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    // Cleared on unmount AND guarded with `live`: a slow request that resolves after the member has
    // gone back would otherwise set state on a component that is no longer there.
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id]);

  if (error !== null) {
    return (
      <div>
        <Button onClick={onBack}>← Back</Button>
        <div style={{ marginTop: '14px' }}>
          <Problem>{error}</Problem>
        </div>
      </div>
    );
  }

  if (data === null) return <Empty>Loading…</Empty>;

  const { project, needs, haulers, shopping, deliveries, chart } = data;
  const outstanding = needs.filter((n) => n.remaining > 0);
  const done = needs.filter((n) => n.remaining <= 0);
  const total = shopping.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const unsourced = shopping.filter((r) => r.price === null).length;
  const delivered = project.required - project.remaining;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <Button onClick={onBack}>← Back</Button>
        <span style={{ fontSize: '15px' }}>{project.title}</span>
        <span style={{ fontSize: '11px', color: C.faint }}>
          {project.systemName}
          {project.stationName === null ? '' : ` · ${project.stationName}`}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '20px' }}>
        <Stat
          label="Still needed"
          value={project.needCount === 0 ? '—' : tonnes(project.remaining)}
          tone={project.remaining > 0 ? C.warn : C.good}
        />
        <Stat
          label="Delivered"
          value={project.required > 0 ? tonnes(delivered) : '—'}
          tone={C.good}
        />
        <Stat label="Commodities" value={String(project.needCount)} />
      </div>

      {/*
        ★ EVERY COMMODITY, WITH WHAT HAS BEEN DELIVERED — SQUADRON OWNER, 2026-08-02 ★

        "this should show me all comodites required for the build incluiding everythign delivered".

        Outstanding first, because that is what somebody is about to go and haul. The finished ones
        are kept below rather than dropped: a build's shopping list is not the same as its
        specification, and a member checking whether the titanium is done needs to find it.
      */}
      <Section title="What it still needs">
        {needs.length === 0 ? (
          <Empty>
            Nothing recorded yet. The needs appear the first time somebody with the companion app
            docks at the site.
          </Empty>
        ) : (
          <Card>
            {outstanding.map((n) => (
              <CommodityRow key={n.commodity} need={n} />
            ))}
            {done.length === 0 ? null : (
              <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.faint }}>
                {done.length} commodit{done.length === 1 ? 'y' : 'ies'} fully delivered:{' '}
                {done.map((n) => n.commodity).join(', ')}
              </p>
            )}
          </Card>
        )}
      </Section>

      {/* "a stacked bar chart that shows commoditied selivered per hour per day like raven colonial" */}
      <Section
        title="Deliveries over time"
        aside={<Toggle value={stackBy} onChange={setStackBy} />}
      >
        <Card>
          <DeliveryChart
            buckets={stackBy === 'commodity' ? chart.byCommodity : chart.byCommander}
            bucket={chart.bucket}
            by={stackBy}
          />
        </Card>
      </Section>

      {/* "whos delivered what and when" — the literal ledger, newest first. */}
      <Section title="Every delivery">
        {deliveries.length === 0 ? (
          <Empty>No deliveries recorded yet.</Empty>
        ) : (
          <Card>
            {deliveries.slice(0, 25).map((d, i) => (
              <Row
                key={`${d.at}-${d.commodity}-${i}`}
                left={d.commodity}
                sub={`${d.commander} · ${new Date(d.at).toLocaleString()}`}
                right={tonnes(d.amount)}
              />
            ))}
            {deliveries.length > 25 ? (
              <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.faint }}>
                Showing the 25 most recent of {deliveries.length}.
              </p>
            ) : null}
          </Card>
        )}
      </Section>

      <Section title="Where to buy it">
        {shopping.length === 0 ? (
          <Empty>Nothing to buy.</Empty>
        ) : (
          <Card>
            {shopping.map((r) => (
              <Row
                key={r.commodity}
                left={r.commodity}
                sub={
                  r.stationName === null
                    ? 'nobody in range sells this'
                    : `${r.stationName} · ${r.systemName}`
                }
                subTone={r.stationName === null ? C.warn : C.faint}
                right={r.cost === null ? '—' : credits(r.cost)}
              />
            ))}
            <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.dim }}>
              {/*
                Qualified whenever it is incomplete. A confident total that silently omits four
                commodities nobody sells is worse than no total.
              */}
              {unsourced === 0
                ? `About ${credits(total)} in cargo to finish.`
                : `About ${credits(total)} for what can be bought — ${unsourced} not sold in range, so the real total is higher.`}
            </p>
          </Card>
        )}
      </Section>

      {/*
        ★ WHO IS ON THIS, AND WHO IS COVERING WHAT — SQUADRON OWNER, 2026-08-02 ★

        "a way for people to join the project ahead of time, and a way that we can assign people who
        do join what materials we want them to haul."

        Above the delivery history on purpose: this is what is GOING to happen and the history is
        what already did. Somebody opening a build in order to help wants the first.
      */}
      <Section title="Who is on this build">
        <Roster projectId={project.id} needs={needs} onChanged={() => void reloadDetail()} />
      </Section>

      {/*
        ★ THE CHART AND THE LIST, BOTH — SQUADRON OWNER, 2026-08-02 ★

        "we want the who has hauled to be a stacked bar chart."

        The chart is what was asked for and it is the better picture: it says whether somebody's
        forty thousand tonnes was all steel or a share of everything. The ranked list stays under
        it because a chart cannot be read to the tonne, and "am I third or fourth" is a question
        people genuinely have about their own name.
      */}
      <Section title="Who has hauled">
        {haulers.length === 0 ? (
          <Empty>No deliveries recorded yet.</Empty>
        ) : (
          <>
            <Card>
              <HaulerChart haulers={chart.haulers} />
            </Card>
            <div style={{ marginTop: '12px' }}>
              <Card>
                {haulers.map((h, i) => (
                  <Row
                    key={`${h.name}-${i}`}
                    left={`${i + 1}. ${h.name}`}
                    right={tonnes(h.tonnes)}
                  />
                ))}
              </Card>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

/**
 * The stacking switch above the time chart.
 *
 * Two words rather than a dropdown: there are exactly two answers, and a select box that has to be
 * opened to find out what the alternative is hides half the feature.
 */
function Toggle({
  value,
  onChange,
}: {
  value: 'commodity' | 'commander';
  onChange: (next: 'commodity' | 'commander') => void;
}): JSX.Element {
  const options: ReadonlyArray<'commodity' | 'commander'> = ['commodity', 'commander'];

  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          style={{
            border: `1px solid ${value === option ? C.subtle : 'transparent'}`,
            background: value === option ? C.raised : 'transparent',
            color: value === option ? C.text : C.faint,
            borderRadius: '6px',
            padding: '3px 9px',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          by {option}
        </button>
      ))}
    </div>
  );
}

/**
 * One commodity: what is left, what has gone in, and how far along it is.
 *
 * The bar matters more than the numbers for scanning a list of twenty-three — a member looking for
 * what to haul next wants the short one, and finding it by reading pairs of five-digit numbers is
 * slower than seeing it.
 */
function CommodityRow({ need }: { need: ColonyNeed }): JSX.Element {
  const required = need.required ?? 0;
  const provided = Math.max(0, required - need.remaining);

  return (
    <div style={{ padding: '6px 0', borderTop: `1px solid ${C.hairline}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <span style={{ fontSize: '13px' }}>{need.commodity}</span>
        <span style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {tonnes(need.remaining)} left
        </span>
      </div>
      {required <= 0 ? null : (
        <>
          <div style={{ marginTop: '4px' }}>
            <Bar done={provided} total={required} />
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
            {provided.toLocaleString()} of {required.toLocaleString()} delivered
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The roster: who has joined, what they have taken on, and what nobody is covering.
 *
 * ★ THE UNCOVERED LIST IS THE POINT ★
 *
 * A roster that only shows who has claimed something answers "who is helping" and leaves the more
 * useful question — what is nobody bringing — to be worked out by comparing two lists by eye. The
 * gap is computed here and named, because it is what somebody arriving to help actually needs.
 */
function Roster({
  projectId,
  needs,
  onChanged,
}: {
  projectId: string;
  needs: readonly ColonyNeed[];
  onChanged: () => void;
}): JSX.Element {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    const answer = await window.colony.roster(projectId);
    if (answer.ok) {
      setRoster(answer.data.roster);
      setError(null);
    } else {
      setError(answer.error);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  /*
   * Every action goes through here so the failure path is one path. The hub is where the rules
   * live — whether this member may assign to that one — so a refusal is a SENTENCE to show rather
   * than something the app should have predicted and hidden.
   */
  const act = async (fn: () => Promise<Answer<unknown>>): Promise<void> => {
    setBusy(true);
    const answer = await fn();
    setBusy(false);
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    setError(null);
    await load();
    onChanged();
  };

  if (roster === null) return <Empty>Loading…</Empty>;

  const claimed = new Set(roster.flatMap((m) => m.assignments.map((a) => a.commodity)));
  const uncovered = needs.filter((n) => n.remaining > 0 && !claimed.has(n.commodity));

  return (
    <div>
      {error === null ? null : (
        <div style={{ marginBottom: '12px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      <Card>
        {roster.length === 0 ? (
          <Empty>Nobody has joined yet.</Empty>
        ) : (
          roster.map((m) => (
            <div key={m.userId} style={{ padding: '7px 0', borderTop: `1px solid ${C.hairline}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ fontSize: '13px' }}>{m.name}</span>
                <span style={{ fontSize: '12px', color: C.dim, fontVariantNumeric: 'tabular-nums' }}>
                  {m.delivered > 0 ? `${tonnes(m.delivered)} delivered` : 'nothing yet'}
                </span>
              </div>
              {m.assignments.length === 0 ? (
                <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
                  not carrying anything in particular
                </p>
              ) : (
                <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.dim }}>
                  {m.assignments
                    .map(
                      (a) =>
                        `${a.commodity}${a.tonnes === null ? '' : ` ${a.tonnes.toLocaleString()} t`}` +
                        // Said out loud: "you took this on" and "somebody asked you to" are
                        // different things to read about yourself.
                        (a.assigned ? ' (assigned)' : ''),
                    )
                    .join(' \u00b7 ')}
                </p>
              )}
            </div>
          ))
        )}

        <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
          <Button
            tone="primary"
            disabled={busy}
            onClick={() => void act(() => window.colony.join(projectId))}
          >
            Join this build
          </Button>
          <Button disabled={busy} onClick={() => void act(() => window.colony.leave(projectId))}>
            Leave
          </Button>
        </div>
      </Card>

      {uncovered.length === 0 ? null : (
        <div style={{ marginTop: '12px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '11px', color: C.faint }}>
            Nobody is covering these yet — take one and it shows against your name.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
            {uncovered.slice(0, 12).map((n) => (
              <button
                key={n.commodity}
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    window.colony.assign(projectId, {
                      commodity: n.commodity,
                      // The whole outstanding amount, as the obvious default. It is a starting
                      // figure on a claim, not a promise — nothing measures somebody against it.
                      tonnes: n.remaining,
                    }),
                  )
                }
                style={{
                  border: `1px solid ${C.subtle}`,
                  background: C.raised,
                  color: C.text,
                  borderRadius: '7px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  cursor: busy ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {n.commodity}
                <span style={{ color: C.faint, marginLeft: '6px' }}>{tonnes(n.remaining)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  left,
  right,
  sub,
  subTone,
}: {
  left: string;
  right: string;
  sub?: string;
  subTone?: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '5px 0',
        borderTop: `1px solid ${C.hairline}`,
      }}
    >
      <span style={{ fontSize: '13px', minWidth: 0 }}>
        {left}
        {sub === undefined ? null : (
          <span style={{ display: 'block', fontSize: '11px', color: subTone ?? C.faint }}>{sub}</span>
        )}
      </span>
      <span style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {right}
      </span>
    </div>
  );
}

function PostForm({
  canPostSquadron,
  dockedAt,
  onPosted,
}: {
  canPostSquadron: boolean;
  dockedAt: DockedAt | null;
  onPosted: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * ★ FILLED IN FROM THE JOURNAL — SQUADRON OWNER, 2026-08-02 ★
   *
   * "it should appear automatically in the companion app on the new project page if it is not being
   * used please!"
   *
   * The form used to ask for a market id and point at a Status screen that did not show one. The
   * app is already reading the journal that contains the answer, so asking a member to find and
   * retype a ten-digit number was asking them to redo work the machine had done — and a typo in it
   * produces a project that silently never updates.
   *
   * The station name seeds the title too, because "Ambrose Dock" is what almost everybody would
   * type. It is an ordinary editable field, not a locked one: a member naming their build something
   * else is the point of having a title at all.
   */
  const [form, setForm] = useState({
    /*
     * The cleaned name, not the raw one. Frontier prefixes every site with its class — "Planetary
     * Construction Site: " — which is noise on a board where every entry is a construction site.
     */
    title: projectTitleFrom(dockedAt?.stationName ?? ''),
    systemName: dockedAt?.systemName ?? '',
    stationName: dockedAt?.stationName ?? '',
    marketId: dockedAt?.marketId ?? '',
    notes: '',
    owner: 'personal' as 'personal' | 'squadron',
  });

  const set = (k: keyof typeof form) => (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    setForm((f) => ({ ...f, [k]: target.value }));
  };

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    /*
     * ★ THE SNAPSHOT GOES WITH IT ★
     *
     * Without this a newly posted project sits on the board reading "waiting for somebody to dock
     * there" — while the member who posted it is standing on the pad, looking at the needs. The
     * depot reading they can already see is the same one the sync would fetch later, so sending it
     * now removes a wait that exists for no reason.
     *
     * The hub still treats it as one reading among many: the next sync REPLACES it wholesale from
     * whatever the newest journal says, so a stale or hand-edited snapshot cannot poison anything.
     */
    const answer = await window.colony.post({
      ...form,
      ...(dockedAt?.site == null
        ? {}
        : {
            snapshot: {
              progress: dockedAt.site.progress,
              complete: dockedAt.site.complete,
              failed: dockedAt.site.failed,
              resources: dockedAt.site.resources,
            },
          }),
    });
    setBusy(false);
    if (answer.ok) onPosted();
    else setError(answer.error);
  }

  return (
    <Card>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <Field label="What to call it">
          <input style={inputStyle} value={form.title} onInput={set('title')} placeholder="Ambrose Dock" />
        </Field>
        <Field label="System">
          <input style={inputStyle} value={form.systemName} onInput={set('systemName')} placeholder="HIP 58832" />
        </Field>
        <Field label="Station">
          <input style={inputStyle} value={form.stationName} onInput={set('stationName')} placeholder="Construction Site" />
        </Field>
        <Field
          label="Market id"
          hint={
            dockedAt === null
              ? 'Dock at the construction site and this fills itself in.'
              : 'Read from your journal — you are docked there now.'
          }
        >
          <input style={inputStyle} value={form.marketId} onInput={set('marketId')} placeholder="3706117632" />
        </Field>
      </div>

      <div style={{ marginTop: '12px' }}>
        <Field label="Anything the squadron should know">
          <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={2} value={form.notes} onInput={set('notes')} />
        </Field>
      </div>

      {canPostSquadron ? (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', color: C.dim }}
        >
          <input
            type="checkbox"
            checked={form.owner === 'squadron'}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                owner: (e.target as HTMLInputElement).checked ? 'squadron' : 'personal',
              }))
            }
          />
          Post as a squadron project — the whole squadron hauls for it
        </label>
      ) : null}

      {error === null ? null : (
        <div style={{ marginTop: '12px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      <div style={{ marginTop: '14px' }}>
        <Button tone="primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Posting…' : 'Post the project'}
        </Button>
      </div>
    </Card>
  );
}
