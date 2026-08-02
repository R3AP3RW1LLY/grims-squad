import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  ColonyHauler,
  ColonyNeed,
  ColonyProject,
  ColonyRights,
  ColonyShoppingRow,
} from '../hub-colony.js';
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
      project(id: string): Promise<
        Answer<{
          project: ColonyProject;
          needs: ColonyNeed[];
          haulers: ColonyHauler[];
          shopping: ColonyShoppingRow[];
        }>
      >;
      at(marketId: string): Promise<Answer<{ project: ColonyProject | null; needs: ColonyNeed[] }>>;
      post(body: unknown): Promise<Answer<{ id: string }>>;
    };
  }
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

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

export function Colonisation({ dockedAt }: { dockedAt: DockedAt | null }): JSX.Element {
  const [boards, setBoards] = useState<{ projects: ColonyProject[]; can: ColonyRights } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  async function reload(): Promise<void> {
    const answer = await window.colony.projects();
    if (answer.ok) {
      setBoards(answer.data);
      setError(null);
    } else {
      setError(answer.error);
    }
  }

  useEffect(() => {
    void reload();
    /*
     * Refreshed while the panel is open. Needs change when ANY member hauls, not just this one, so a
     * board that only updated on click would show a member a shortfall their wingmate filled twenty
     * minutes ago — and they would fly out for it.
     */
    const timer = setInterval(() => void reload(), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (openId !== null) {
    return <ProjectDetail id={openId} onBack={() => setOpenId(null)} />;
  }

  if (error !== null && boards === null) {
    return (
      <Section title="Colonisation">
        <Problem>{error}</Problem>
      </Section>
    );
  }

  if (boards === null) return <Empty>Asking the hub…</Empty>;

  const squadron = boards.projects.filter((p) => p.owner === 'squadron');
  const personal = boards.projects.filter((p) => p.owner === 'personal');

  return (
    <div>
      {error === null ? null : (
        <div style={{ marginBottom: '14px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      <Section
        title="Squadron projects"
        aside={
          <span style={{ fontSize: '11px', color: C.faint }}>
            {squadron.length === 0 ? '' : `${squadron.length}`}
          </span>
        }
      >
        <Board
          projects={squadron}
          onOpen={setOpenId}
          empty="No squadron projects yet."
        />
      </Section>

      <Section title="Members’ projects">
        <Board
          projects={personal}
          onOpen={setOpenId}
          empty="Nobody has posted a project yet."
        />
      </Section>

      {boards.can.post ? (
        <Section
          title="Post a project"
          aside={
            <Button onClick={() => setPosting((p) => !p)}>
              {posting ? 'Cancel' : 'New project'}
            </Button>
          }
        >
          {posting ? (
            <PostForm
              canPostSquadron={boards.can.manage}
              /*
               * The site they are standing on, unless it is already posted. Somebody docked at a
               * project that exists is looking at the board, not filling in a form — offering to
               * create a duplicate would be answered by the server with "already posted as X",
               * which is a worse way to learn it.
               */
              dockedAt={
                dockedAt !== null &&
                !boards.projects.some((p) => p.marketId === dockedAt.marketId)
                  ? dockedAt
                  : null
              }
              onPosted={() => {
                setPosting(false);
                void reload();
              }}
            />
          ) : dockedAt === null ? (
            <Empty>
              Dock at a construction site and the details fill themselves in here.
            </Empty>
          ) : (
            <HereNow dockedAt={dockedAt} />
          )}
        </Section>
      ) : null}
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

  return (
    <Card accent={C.cyan}>
      <p style={{ margin: 0, fontSize: '14px' }}>
        {dockedAt.stationName === '' ? 'The construction site you are docked at' : dockedAt.stationName}
      </p>
      <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
        {dockedAt.systemName === '' ? `Market ${dockedAt.marketId}` : dockedAt.systemName} · docked now
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
            {(site.progress * 100).toFixed(1)}% built ·{' '}
            {outstanding.length === 0
              ? 'everything delivered'
              : `${tonnes(totalNeeded)} still needed across ${outstanding.length} commodit${outstanding.length === 1 ? 'y' : 'ies'}`}
          </p>

          {outstanding.length === 0 ? null : (
            <div style={{ marginTop: '10px' }}>
              {outstanding.slice(0, 6).map((r) => (
                <div
                  key={r.commodity}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '3px 0',
                    fontSize: '12px',
                  }}
                >
                  <span>{r.commodity}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: C.dim }}>
                    {(r.required - r.provided).toLocaleString()} of {r.required.toLocaleString()}
                  </span>
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
        Press New project — the name, system, station and market id are already filled in.
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
  const [data, setData] = useState<{
    project: ColonyProject;
    needs: ColonyNeed[];
    haulers: ColonyHauler[];
    shopping: ColonyShoppingRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const { project, needs, haulers, shopping } = data;
  const outstanding = needs.filter((n) => n.remaining > 0);
  const total = shopping.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const unsourced = shopping.filter((r) => r.price === null).length;

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
          value={project.required > 0 ? tonnes(project.required - project.remaining) : '—'}
        />
        <Stat label="Commodities" value={String(project.needCount)} />
      </div>

      <Section title="What it still needs">
        {outstanding.length === 0 ? (
          <Empty>Nothing outstanding.</Empty>
        ) : (
          <Card>
            {outstanding.map((n) => (
              <Row key={n.commodity} left={n.commodity} right={tonnes(n.remaining)} />
            ))}
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

      <Section title="Who has hauled">
        {haulers.length === 0 ? (
          <Empty>No deliveries recorded yet.</Empty>
        ) : (
          <Card>
            {haulers.map((h, i) => (
              <Row key={`${h.name}-${i}`} left={`${i + 1}. ${h.name}`} right={tonnes(h.tonnes)} />
            ))}
          </Card>
        )}
      </Section>
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
    title: dockedAt?.stationName ?? '',
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
    const answer = await window.colony.post(form);
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
