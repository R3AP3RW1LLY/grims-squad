import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { catalogueFrom, computeStats, moduleFacts, slotCategory } from '@grims/ed-clients/builds';
import type { CatalogueModule, OutfitPayload } from '@grims/ed-clients/builds';
import type { FittedModule, ShipBuild, SlotGroup } from '@grims/shared/ship-build';
import type { BoardRow, OpenedBuild, ShelfRow } from '../hub-shipyard.js';
import { Button, C, Card, Empty, Problem, Section, credits } from './ui.js';
import { useLive } from './use-live.js';

/**
 * The build boards, in the app — and the reader behind every card.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "we need to add the Shipyard and Logistics and Trade categories to the companion app, and they
 * must work in full mirror with the website please!"
 *
 * ★ ONE COMPONENT, TWO PAGES — THE WEBSITE'S OWN RULE ★
 *
 * The squadron board and the public board differ in exactly one thing — which rows the hub
 * returns — so they are the same component, exactly as they are on the website. Two copies would
 * drift the moment somebody added a figure to one of them, and the difference between "shared with
 * the squadron" and "shared with the world" is not a difference in how a build should be presented.
 *
 * ★ THE READER RECOMPUTES ITS FIGURES ★
 *
 * The board cards quote the snapshot stored when each build was saved, because a card has no module
 * catalogue in hand and a skimmed list does not need one. The moment a build is OPENED the app holds
 * the hull's full module data, so every figure is recomputed with `computeStats` — the identical
 * engine the outfitter and the hub run, over a catalogue built from the identical payload. That is
 * the contract written on `OpenedBuild`, and it is what makes it impossible for this page and the
 * outfitter one nav entry up to quote two different ships.
 */

/*
 * The hub's answer envelope, restated locally the way every renderer page restates it. The
 * `window.shipyard` bridge itself is declared once, beside the outfitter — the page that owns the
 * rest of its surface — and a second declaration here would be a second contract free to drift.
 */
type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/** What each board says about itself. Passed per scope because the two boards are one component. */
const COPY = {
  squadron: {
    title: 'Squadron builds',
    lead: 'Every build a member has shared. Open one to see the whole loadout and what it does — and to take it into the outfitter and change it for yourself.',
    board: 'Shared with the squadron',
    empty:
      'Nobody has shared a build yet. Fit one in the outfitter and choose who may see it — yours would be the first.',
  },
  public: {
    title: 'Public builds',
    lead: 'These builds are shared openly by the commanders who fly them. Open one to see the full loadout, what it costs, and what it does.',
    board: 'Published by the squadron',
    empty: 'No builds have been published publicly yet.',
  },
} as const;

const ROLE_LABELS: Readonly<Record<string, string>> = {
  mining: 'Mining',
  combat: 'Combat',
  exploration: 'Exploration',
  trading: 'Trading',
  multipurpose: 'Multipurpose',
};

/** A snapshot figure off a board card, or a dash. The card never recomputes — see the header. */
const num = (stats: Record<string, unknown> | null, key: string): string => {
  const value = stats?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
};

/** "3 days ago" beats a timestamp for a board somebody skims. */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  return months < 12 ? `${months} month${months === 1 ? '' : 's'} ago` : 'over a year ago';
}

/*
 * ★ THE SHARED SCOPES ONLY EVER ANSWER BOARD ROWS ★
 *
 * The builds endpoint also serves the member's own shelf, so its answer type admits rows with no
 * author and no share token. This page asks only for the shared scopes, where every row is
 * published under a token — the predicate restates that fact to the compiler rather than asserting
 * it, so a row that somehow arrived without a token is dropped instead of rendered unopenable.
 */
const boardRows = (rows: ReadonlyArray<BoardRow | ShelfRow>): BoardRow[] =>
  rows.filter((r): r is BoardRow => typeof r.shareToken === 'string' && 'author' in r);

export function BuildBoardsPage({ scope }: { scope: 'squadron' | 'public' }): JSX.Element {
  const copy = COPY[scope];
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  /*
   * ★ THE GUARD READS A REF, NOT THE STATE ★
   *
   * `useLive` captures the loader once and fires it every minute and on window focus, so the
   * closure's view of `open` is frozen at its first value — a state check here would never see the
   * reader. The ref is written in the same breath as the state, and the loader reads it at call
   * time, which is exactly the pattern use-live.ts asks its callers for.
   */
  const openRef = useRef<string | null>(null);

  const load = (): void => {
    // Never refresh the list under an open reader. The member's place on the board — which card
    // they came from, where it sat — must be exactly where they left it when they press Back.
    if (openRef.current !== null) return;
    void window.shipyard.builds(scope).then((answer: Answer<{ builds: (BoardRow | ShelfRow)[] }>) => {
      if (answer.ok) {
        setRows(boardRows(answer.data.builds));
        setError(null);
      } else {
        setError(answer.error);
      }
    });
  };

  useEffect(load, [scope]);
  // A build a wingmate shared a minute ago belongs on this screen without anybody pressing
  // anything — the board re-reads itself every minute and on window focus, reader permitting.
  useLive(load);

  if (open !== null) {
    return (
      <BuildReaderPage
        token={open}
        onBack={() => {
          openRef.current = null;
          setOpen(null);
          // The board catches up immediately on whatever it declined to fetch while holding still.
          load();
        }}
      />
    );
  }

  return (
    <div>
      <Section title={copy.title}>
        <Card>
          <p style={{ margin: 0, fontSize: '13px', color: C.dim, lineHeight: 1.6 }}>{copy.lead}</p>
        </Card>
      </Section>

      {error !== null ? (
        <div style={{ marginBottom: '16px' }}>
          <Problem>{error}</Problem>
        </div>
      ) : null}

      <Section title={copy.board}>
        {rows === null ? (
          <Empty>Loading the board…</Empty>
        ) : rows.length === 0 ? (
          <Empty>{copy.empty}</Empty>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '12px',
            }}
          >
            {rows.map((build) => (
              <li key={build.shareToken} style={{ display: 'flex' }}>
                <BuildCard
                  build={build}
                  scope={scope}
                  onOpen={() => {
                    openRef.current = build.shareToken;
                    setOpen(build.shareToken);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** One card on a board: who built what, and the four figures somebody skims for. */
function BuildCard({
  build,
  scope,
  onOpen,
}: {
  build: BoardRow;
  scope: 'squadron' | 'public';
  onOpen: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      // The website's card is a link; this app has no router, so it is a button styled by the same
      // `panel` class every other glass card wears — the visual is shared, not restated inline.
      class="panel"
      style={{
        display: 'block',
        width: '100%',
        padding: '14px 16px',
        textAlign: 'left',
        cursor: 'pointer',
        color: C.text,
        fontFamily: 'inherit',
        fontSize: '13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
        <span style={{ fontSize: '13px', color: C.text }}>{build.buildName ?? build.shipName}</span>
        {/*
          The public marker appears on the SQUADRON board, where it is news — this build is also
          outside. On the public board every row is public and a badge on all of them would be
          decoration. The website wrote that rule down; this component can enforce it, because
          unlike the shared web component it knows which board it is drawing.
        */}
        {scope === 'squadron' && build.visibility === 'public' ? (
          <span
            style={{
              flexShrink: 0,
              border: `1px solid ${C.cyan}`,
              borderRadius: '3px',
              padding: '1px 5px',
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              color: C.cyan,
            }}
          >
            Public
          </span>
        ) : null}
      </div>

      <p style={{ margin: '2px 0 0', fontSize: '11px', color: C.dim }}>
        {build.shipName}
        {build.role === null ? '' : ` · ${ROLE_LABELS[build.role] ?? build.role}`}
      </p>

      <dl
        style={{
          margin: '10px 0 0',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '8px',
          borderTop: `1px solid ${C.hairline}`,
          paddingTop: '9px',
        }}
      >
        {(
          [
            ['Jump', num(build.stats, 'jumpRange'), 'ly'],
            ['Cargo', num(build.stats, 'cargoCapacity'), 't'],
            ['Shields', num(build.stats, 'shields'), 'MJ'],
            ['DPS', num(build.stats, 'dps'), ''],
          ] as const
        ).map(([label, value, unit]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <dt
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: C.faint,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {label}
            </dt>
            <dd
              style={{
                margin: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontVariantNumeric: 'tabular-nums',
                color: C.text,
              }}
            >
              {value}
              {unit === '' ? '' : <span style={{ fontSize: '9px', color: C.faint }}> {unit}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <p style={{ margin: '9px 0 0', fontFamily: 'var(--font-mono)', fontSize: '10px', color: C.faint }}>
        {/*
          Credited by name. The owner's rule for the build corpus was "real answers with names",
          and a board of anonymous builds is a board nobody can ask about.
        */}
        {build.author ?? 'the squadron'} · {ago(build.updatedAt)}
      </p>
    </button>
  );
}

/* ========================================================================== */
/*  The reader — one shared build, read-only                                  */
/* ========================================================================== */

const SLOT_GROUPS: readonly SlotGroup[] = ['standard', 'hardpoint', 'internal', 'utility'];

/**
 * One stored module row, narrowed from the loose record the hub sends.
 *
 * The hub types an opened build's loadout as a plain record — the shape is owned by the maths
 * package, and restating it at the transport would be a second definition free to drift. So the
 * narrowing happens here, at the edge of the arithmetic, and a malformed row is dropped rather
 * than fed to `computeStats` as a lie.
 */
function fittedFrom(entry: unknown): FittedModule | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;

  const group = SLOT_GROUPS.find((g) => g === record['group']);
  const index = record['index'];
  if (group === undefined || typeof index !== 'number') return null;

  return {
    group,
    index,
    moduleId: typeof record['moduleId'] === 'string' ? record['moduleId'] : null,
    slotSize: typeof record['slotSize'] === 'number' ? record['slotSize'] : 0,
    /*
     * Absent reads as switched ON. The maths counts disabled modules out of the power budget, so
     * defaulting the other way would zero the draw of every module in a build stored before the
     * flag existed — and report a power surplus the ship does not have.
     */
    enabled: record['enabled'] !== false,
    priority: typeof record['priority'] === 'number' ? record['priority'] : 1,
    // The stats engine reads none of the engineering, so nothing is gained by resurrecting it —
    // and a half-decoded blueprint would be worse than an honest null.
    engineering: null,
  };
}

/** The stored loadout as the maths expects it. Provenance fields it never reads are defaulted. */
function shipBuildFrom(opened: OpenedBuild): ShipBuild {
  const stored = opened.build;
  const modules = Array.isArray(stored['modules'])
    ? stored['modules'].map(fittedFrom).filter((m): m is FittedModule => m !== null)
    : [];

  return {
    shipId: opened.shipId,
    shipName: opened.shipName,
    buildName: opened.buildName,
    // `computeStats` reads neither field; they exist so the canonical shape holds together.
    source: 'coriolis',
    sourceUrl: '',
    // An empty id falls through to the hull's first bulkhead inside the maths — the stock choice,
    // which is what an unrecorded bulkhead means.
    bulkheadId: typeof stored['bulkheadId'] === 'string' ? stored['bulkheadId'] : '',
    modules,
  };
}

const show = (n: number | null, dp = 0): string => (n === null ? '—' : n.toFixed(dp));

/** A labelled figure in the readout grid. Smaller than `Stat` — there are twelve of these. */
function Figure({ label, value, unit }: { label: string; value: string; unit?: string }): JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          textTransform: 'uppercase',
          letterSpacing: '0.16em',
          color: C.faint,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          fontVariantNumeric: 'tabular-nums',
          color: C.text,
        }}
      >
        {value}
        {unit === undefined ? null : (
          <span style={{ marginLeft: '3px', fontSize: '10px', color: C.faint }}>{unit}</span>
        )}
      </div>
    </div>
  );
}

/** One shared build, opened from a board card. Read-only: the outfitter is where changes happen. */
function BuildReaderPage({ token, onBack }: { token: string; onBack: () => void }): JSX.Element {
  const [opened, setOpened] = useState<OpenedBuild | null>(null);
  const [payload, setPayload] = useState<OutfitPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpened(null);
    setPayload(null);
    setError(null);
    void (async () => {
      const build: Answer<OpenedBuild> = await window.shipyard.build(token);
      if (!build.ok) {
        setError(build.error);
        return;
      }
      setOpened(build.data);

      // The hull's module data, fetched second because the build says which hull to ask for.
      const outfit: Answer<OutfitPayload> = await window.shipyard.outfit(build.data.shipId);
      if (!outfit.ok) {
        setError(outfit.error);
        return;
      }
      setPayload(outfit.data);
    })();
  }, [token]);

  const shipBuild = useMemo(() => (opened === null ? null : shipBuildFrom(opened)), [opened]);
  const catalogue = useMemo(() => (payload === null ? null : catalogueFrom(payload)), [payload]);
  const stats = useMemo(
    () => (shipBuild === null || catalogue === null ? null : computeStats(shipBuild, catalogue)),
    [shipBuild, catalogue],
  );

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

  if (opened === null || payload === null || shipBuild === null || catalogue === null) {
    return (
      <div>
        <Button onClick={onBack}>← Back</Button>
        <div style={{ marginTop: '14px' }}>
          <Empty>Opening the build…</Empty>
        </div>
      </div>
    );
  }

  const fitted = new Map<string, string | null>();
  for (const module of shipBuild.modules) {
    fitted.set(`${module.group}:${module.index}`, module.moduleId);
  }

  const bulkhead = payload.ship.bulkheads.find((b) => b.id === shipBuild.bulkheadId) ?? null;

  /*
   * The price is summed from the modules rather than read from anywhere, because it is the one
   * figure a reader acts on — they are deciding what to save for — and module prices are the part
   * of the catalogue that genuinely changes. Same rule as the website's reader.
   */
  let totalCost = payload.ship.hullCost + (bulkhead?.cost ?? 0);
  for (const slot of payload.ship.slots) {
    const id = fitted.get(`${slot.group}:${slot.index}`) ?? null;
    if (id === null) continue;
    totalCost += catalogue.module(slotCategory(slot), id)?.cost ?? 0;
  }

  /*
   * The website's four sections, in the website's order. Utility mounts live in the hardpoint
   * array at size 0 on both sides — coriolis's own division, and the game's.
   */
  const groups: Array<{ title: string; slots: typeof payload.ship.slots }> = [
    { title: 'Core internals', slots: payload.ship.slots.filter((s) => s.group === 'standard') },
    { title: 'Hardpoints', slots: payload.ship.slots.filter((s) => s.group === 'hardpoint' && s.size > 0) },
    { title: 'Utility mounts', slots: payload.ship.slots.filter((s) => s.group === 'hardpoint' && s.size === 0) },
    { title: 'Optional internals', slots: payload.ship.slots.filter((s) => s.group === 'internal') },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <Button onClick={onBack}>← Back</Button>
        <span style={{ fontSize: '15px' }}>{opened.buildName ?? opened.shipName}</span>
        <span style={{ fontSize: '11px', color: C.faint }}>
          {opened.shipName} · shared by {opened.author ?? 'the squadron'} · {ago(opened.updatedAt)}
        </span>
      </div>

      <Card hud>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '6px 24px',
          }}
        >
          <span style={{ fontSize: '15px', color: C.text }}>{payload.ship.name}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', fontVariantNumeric: 'tabular-nums', color: C.cyan }}>
            {credits(totalCost)}
          </span>
        </div>

        {stats === null ? (
          <p style={{ margin: '12px 0 0', borderTop: `1px solid ${C.hairline}`, paddingTop: '10px', fontSize: '12px', color: C.warn }}>
            The hub&rsquo;s module data does not cover this loadout&rsquo;s hull, so its figures
            cannot be computed. The fitted modules are listed below.
          </p>
        ) : (
          <div
            style={{
              marginTop: '12px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
              gap: '10px 14px',
              borderTop: `1px solid ${C.hairline}`,
              paddingTop: '12px',
            }}
          >
            <Figure label="Speed" value={show(stats.speed)} unit="m/s" />
            <Figure label="Boost" value={show(stats.boostSpeed)} unit="m/s" />
            <Figure label="Jump" value={show(stats.jumpRange, 2)} unit="ly" />
            <Figure label="Laden jump" value={show(stats.ladenJumpRange, 2)} unit="ly" />
            <Figure label="Shields" value={show(stats.shields)} unit="MJ" />
            <Figure label="Armour" value={show(stats.armour)} />
            <Figure label="DPS" value={show(stats.dps, 1)} />
            <Figure label="Cargo" value={show(stats.cargoCapacity)} unit="t" />
            <Figure label="Fuel" value={show(stats.fuelCapacity)} unit="t" />
            <Figure label="Unladen" value={show(stats.unladenMass, 1)} unit="t" />
            <Figure label="Laden" value={show(stats.ladenMass, 1)} unit="t" />
            <Figure
              label="Power"
              value={`${show(stats.powerDrawn, 2)}/${show(stats.powerGenerated, 2)}`}
              unit="MW"
            />
          </div>
        )}

        <p style={{ margin: '12px 0 0', borderTop: `1px solid ${C.hairline}`, paddingTop: '8px', fontSize: '10px', color: C.faint }}>
          {/*
            Said out loud, because a reader comparing this against the card they opened deserves to
            know why the two can differ: the card quotes the snapshot saved with the build, and
            this readout is computed fresh from today's catalogue.
          */}
          Every figure and the price are computed from the current module catalogue — the same
          arithmetic the outfitter runs — so this readout can differ from the snapshot on the
          board card.
        </p>
      </Card>

      <div style={{ marginTop: '20px' }}>
        {bulkhead !== null ? (
          <Section title="Bulkheads">
            <Card>
              <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '12px', color: C.text }}>
                {bulkhead.name}
                {bulkhead.cost !== null && bulkhead.cost > 0 ? (
                  <span style={{ color: C.faint }}> · {credits(bulkhead.cost)}</span>
                ) : null}
              </p>
            </Card>
          </Section>
        ) : null}

        {groups.map((group) => {
          const rows = group.slots
            .map((slot) => {
              const id = fitted.get(`${slot.group}:${slot.index}`) ?? null;
              return { slot, module: id === null ? null : catalogue.module(slotCategory(slot), id) };
            })
            /*
             * Empty slots are dropped from a READ-ONLY view. In the outfitter an empty slot is
             * something you act on; here it is a row of dashes, and on a large hull there can be
             * fifteen of them between the reader and what they came to see.
             */
            /*
             * A type PREDICATE, not a plain `!== null` filter. TypeScript cannot narrow an array
             * through `filter` without one, and the alternative is a non-null assertion on every
             * use below — which lint forbids, correctly.
             */
            .filter((r): r is { slot: (typeof group.slots)[number]; module: CatalogueModule } =>
              r.module !== null,
            );

          if (rows.length === 0) return null;

          return (
            <Section key={group.title} title={group.title}>
              <Card>
                {rows.map(({ slot, module }) => (
                  <div
                    key={`${slot.group}:${slot.index}`}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'baseline',
                      gap: '2px 12px',
                      padding: '7px 0',
                      borderTop: `1px solid ${C.hairline}`,
                    }}
                  >
                    <span
                      style={{
                        width: '24px',
                        flexShrink: 0,
                        border: `1px solid ${C.hairline}`,
                        borderRadius: '3px',
                        textAlign: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        lineHeight: '20px',
                        color: C.dim,
                      }}
                    >
                      {slot.size}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: C.text }}>
                      {module.class}
                      {module.rating ?? ''} {module.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: C.faint }}>
                      {moduleFacts(module)
                        .slice(0, 4)
                        .map((f) => `${f.label} ${f.value}`)
                        .join(' · ')}
                    </span>
                    {module.cost !== null && module.cost > 0 ? (
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '11px',
                          fontVariantNumeric: 'tabular-nums',
                          color: C.dim,
                        }}
                      >
                        {credits(module.cost)}
                      </span>
                    ) : null}
                  </div>
                ))}
              </Card>
            </Section>
          );
        })}
      </div>
    </div>
  );
}
