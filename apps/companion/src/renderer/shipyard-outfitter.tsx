import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  catalogueFrom,
  computeStats,
  fitShip,
  moduleDescription,
  moduleFacts,
  moduleSummary,
  optionsFor,
  slotCategory,
  type CatalogueModule,
  type FitResult,
  type FitRole,
  type OutfitPayload,
} from '@grims/ed-clients/builds';
import {
  BUILD_VISIBILITIES,
  BUILD_VISIBILITY_LABELS,
  BUILD_VISIBILITY_NOTES,
  type BuildVisibility,
  type FittedModule,
  type ShipBuild,
} from '@grims/shared/ship-build';
import type { ShipListEntry } from '../hub-shipyard.js';
import { Button, C, Card, Copy, Empty, Field, Problem, R, Section, Tabs, credits, inputStyle } from './ui.js';
import { useLive } from './use-live.js';

/**
 * The Shipyard Outfitter, in the app.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "we need to add the Shipyard and Logistics and Trade categories to the companion app, and they
 * must work in full mirror with the website please!"
 *
 * This is the website's outfitter — the Coriolis-shaped editor, the ship picker, the save panel and
 * the assisted stepper — carried over screen for screen. The MATHS is not carried over at all: it is
 * literally the same module, `@grims/ed-clients/builds`, that the website and the API run. The app
 * cannot quote a different jump range than the site because there is no second implementation to
 * disagree; every figure on this page comes out of `computeStats` over the same catalogue adapter.
 *
 * What did have to change is the plumbing, not the behaviour: reads go through `window.shipyard`
 * (the device door, credential attached in the main process) instead of `apiCall`, the two tabs are
 * this component's own rather than routes, and the picker selects a hull instead of navigating.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };
declare global {
  interface Window {
    readonly shipyard: {
      ships(): Promise<Answer<{ ships: import('../hub-shipyard.js').ShipListEntry[] }>>;
      outfit(shipId: string): Promise<Answer<import('@grims/ed-clients/builds').OutfitPayload>>;
      fit(body: unknown): Promise<Answer<import('@grims/ed-clients/builds').FitResult>>;
      builds(
        scope: string,
      ): Promise<
        Answer<{
          builds: (import('../hub-shipyard.js').BoardRow | import('../hub-shipyard.js').ShelfRow)[];
        }>
      >;
      build(token: string): Promise<Answer<import('../hub-shipyard.js').OpenedBuild>>;
      save(body: unknown): Promise<Answer<{ id: string; shareToken: string | null; visibility: string }>>;
    };
  }
}

/** Every module group the website's outfitter searches for an unrestricted slot. Same list. */
const SLOT_GROUPS: readonly string[] = [
  'cr', 'sg', 'bsg', 'psg', 'hr', 'mrp', 'scb', 'fs', 'am', 'rf', 'cc', 'pc', 'dtl', 'fx',
  'rpl', 'rsl', 'mlc', 'hb', 'pce', 'pci', 'pcm', 'pcq', 'fh', 'pas', 'gsc', 'sua', 'dc', 'sc',
  'mc', 'pl', 'bl', 'c', 'rg', 'pa', 'ml', 'abl', 'sdm', 'mr', 'tp', 'nl', 'axmc', 'rfl',
  'sb', 'ch', 'hs', 'ecm', 'pwa', 'xs', 'kw', 'ws', 'sfn',
];

/**
 * Abbreviated credits, for the one place there is no room: `<option>` labels and the bulkhead
 * list. Everywhere a figure is something to save towards it is printed in full, grouped — the
 * website's own rule, and the reason `credits` from the UI kit does the rest of the page.
 */
const short = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);

const num = (n: number | null | undefined, dp = 0): string =>
  n === null || n === undefined ? '—' : n.toFixed(dp);

/** The presets. Factory stock first, because it is the ship as Frontier sells it. */
const PRESETS: ReadonlyArray<{ key: 'stock' | FitRole; label: string; hint: string }> = [
  { key: 'stock', label: 'Factory stock', hint: 'The loadout the ship is sold with.' },
  { key: 'combat', label: 'Combat', hint: 'Weapons, shields and hull, fitted for a fight.' },
  { key: 'mining', label: 'Mining', hint: 'Lasers, limpets and somewhere to put the ore.' },
  { key: 'explorer', label: 'Explorer', hint: 'Light, long-ranged, and able to repair itself.' },
  { key: 'trader', label: 'Trader', hint: 'As much cargo as the hull and the shields allow.' },
];

const SELECT: JSX.CSSProperties = {
  ...inputStyle,
  padding: '4px 6px',
  fontSize: '11px',
};

const TH: JSX.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px 6px 0',
  fontSize: '9px',
  fontWeight: 'normal',
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  fontFamily: 'var(--font-mono)',
  color: C.faint,
  whiteSpace: 'nowrap',
};

const TD: JSX.CSSProperties = {
  padding: '6px 10px 6px 0',
  borderTop: `1px solid ${C.hairline}`,
  fontSize: '11px',
  color: C.dim,
  verticalAlign: 'middle',
};

const NUMCELL: JSX.CSSProperties = {
  ...TD,
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

/** The small tracked uppercase heading used inside panels — the site's own label treatment. */
const LABEL: JSX.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: C.dim,
};

/**
 * Landing pad, read from either dialect the hub has spoken.
 *
 * ★ THE TYPE SAYS `padSize`, THE SERVER HAS SENT `pad` ★
 *
 * `ShipListEntry` declares `padSize: string`; the shipyard service's own list writes `pad: 1|2|3`.
 * A mirror page that trusted one spelling would blank the pad filter the day it met the other —
 * silently, as an "Unknown pad" on every card — so both are read, the way the boards read older
 * hub shapes. Numbers are the game's pad classes; words are taken as themselves.
 */
function padLabelOf(entry: ShipListEntry): string {
  const raw = entry as unknown as Record<string, unknown>;
  const numeric =
    typeof raw['pad'] === 'number'
      ? raw['pad']
      : typeof raw['padSize'] === 'number'
        ? raw['padSize']
        : Number.parseInt(String(raw['padSize'] ?? ''), 10);
  if (numeric === 1) return 'Small';
  if (numeric === 2) return 'Medium';
  if (numeric === 3) return 'Large';

  const word = String(raw['padSize'] ?? '').toLowerCase();
  if (word === 'small' || word === 'medium' || word === 'large') {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return 'Unknown';
}

/**
 * One figure in the summary bar.
 *
 * `emphasis` is what Coriolis does not have: speed, jump, shields and power decide whether a ship
 * suits a job, and the other nine are how you tune it once it does. Giving all fourteen the same
 * weight is why Coriolis's readout takes a moment to parse every time.
 */
function Figure({
  label,
  value,
  unit,
  tone = 'normal',
  emphasis = false,
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  tone?: 'normal' | 'good' | 'bad';
  emphasis?: boolean;
}): JSX.Element {
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
          fontVariantNumeric: 'tabular-nums',
          fontSize: emphasis ? '16px' : '13px',
          color: tone === 'bad' ? C.bad : tone === 'good' ? C.cyan : C.text,
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

/** Everything the fitted module does, opened under its row. */
function ModuleDetail({ module }: { module: CatalogueModule }): JSX.Element {
  const facts = moduleFacts(module);
  const description = moduleDescription(module);

  return (
    <div
      style={{
        borderTop: `1px solid ${C.hairline}`,
        background: C.sunken,
        padding: '10px 12px',
        marginTop: '2px',
      }}
    >
      {description !== null && (
        <p style={{ margin: '0 0 8px', fontSize: '11px', lineHeight: 1.6, color: C.dim }}>
          {description}
        </p>
      )}
      {facts.length === 0 ? (
        <p style={{ margin: 0, fontSize: '11px', color: C.faint }}>
          Coriolis records no figures for this module beyond its size and rating.
        </p>
      ) : (
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '4px 16px',
          }}
        >
          {facts.map((fact) => (
            <div key={fact.label} style={{ minWidth: 0 }}>
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
                {fact.label}
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
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Choosing a hull — the website's picker, with the rows selecting rather than navigating.
 *
 * ★ PAD SIZE FIRST, THEN PRICE ★
 *
 * A ship you cannot dock is not a ship you can fly, so the pad is the filter that rules things out
 * fastest — an outpost only takes small and medium, and somebody based at one has no use for the
 * large list at all. Price is the second question and it is on every card.
 */
function ShipPicker({
  ships,
  onPick,
}: {
  ships: readonly ShipListEntry[];
  onPick: (shipId: string) => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [pad, setPad] = useState<string | null>(null);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return ships
      .filter(
        (s) =>
          (term === '' || s.name.toLowerCase().includes(term)) &&
          (pad === null || padLabelOf(s) === pad),
      )
      .sort((a, b) => a.hullCost - b.hullCost);
  }, [ships, search, pad]);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px', marginBottom: '14px' }}>
        <label style={{ flex: 1, minWidth: '200px' }}>
          <span style={{ ...LABEL, display: 'block', marginBottom: '5px' }}>Ship</span>
          <input
            type="search"
            style={inputStyle}
            placeholder="Anaconda, Mandalay…"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
        </label>

        <div style={{ display: 'flex', gap: '5px' }}>
          {[null, 'Small', 'Medium', 'Large'].map((p) => (
            <button
              key={String(p)}
              type="button"
              onClick={() => setPad(p)}
              aria-pressed={pad === p}
              style={{
                border: `1px solid ${pad === p ? C.cyan : C.hairline}`,
                background: pad === p ? C.cyanTint : 'transparent',
                color: pad === p ? C.cyan : C.dim,
                borderRadius: R.control,
                padding: '7px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                cursor: 'pointer',
              }}
            >
              {p === null ? 'Any pad' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Stretched, so a two-line ship name does not leave its neighbours short. */}
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          alignItems: 'stretch',
          gap: '8px',
        }}
      >
        {shown.map((s) => (
          <li key={s.id} style={{ height: '100%' }}>
            {/*
              A real <button>, not a link dressed as one. This one does not go anywhere — it answers
              "which hull" — and the app has no router to give it a URL anyway.
            */}
            <button
              type="button"
              onClick={() => onPick(s.id)}
              style={{
                display: 'flex',
                height: '100%',
                width: '100%',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                border: `1px solid ${C.hairline}`,
                background: C.panelGlass,
                borderRadius: R.control,
                padding: '10px 12px',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: C.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.name}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: C.faint }}>
                  {padLabelOf(s)} pad
                </span>
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: C.cyan,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {short(s.hullCost)} cr
              </span>
            </button>
          </li>
        ))}
      </ul>

      {shown.length === 0 && (
        <p style={{ margin: '14px 0 0', fontSize: '13px', color: C.dim }}>
          No hull matches. Clear the filters to see all {ships.length}.
        </p>
      )}
    </div>
  );
}

/**
 * Save this build, and choose who may see it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "also include shareable links, and the ability for our users to share their builds and make them
 * visible to the squadron and public if they choose to."
 *
 * ★ THE CHOICE IS MADE BEFORE SAVING, NOT AFTER ★
 *
 * The obvious design is Save, then a Share button on the result. That makes "private" the thing
 * that happens by default and sharing a second, deliberate act — which sounds safe and produces a
 * board nobody ever posts to, because the moment of wanting to show somebody is the moment of
 * finishing the build. So the visibility is part of saving, spelled out in the same three
 * sentences the website uses, with `private` pre-selected.
 *
 * The website's "sign in with Discord" branch has no counterpart here: a paired device IS a
 * member, and if that member's rank cannot save or share, the hub refuses in its own words —
 * which are shown verbatim, because "you cannot publish builds outside the squadron" is a
 * sentence somebody can take to an officer and "something went wrong" is not.
 */
const ORIGIN_NOTE = 'Anyone with this link can open the build.';

function SaveBuildPanel({ build, shipName }: { build: ShipBuild; shipName: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<BuildVisibility>('private');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ token: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = (): void => {
    setSaving(true);
    setError(null);
    void window.shipyard
      .save({ build, buildName: name.trim() === '' ? null : name.trim(), visibility })
      .then((answer) => {
        if (answer.ok) setSaved({ token: answer.data.shareToken });
        else setError(answer.error);
        setSaving(false);
      });
  };

  if (saved !== null) {
    /*
     * ★ A PATH, NOT A URL — THE RENDERER DOES NOT KNOW THE HUB'S ORIGIN ★
     *
     * The website builds the share link from `window.location.origin`; this window's origin is the
     * app's own bundle, and the hub's address lives in the main process where the device token
     * does. Inventing an origin here would mint links that break the day the hub moves. So the
     * PATH is what is shown and copied — it is stable, it is what the hub's own share links end in
     * — and the button alongside opens the hub, where the same build sits under the member's saved
     * builds with the full link on it.
     */
    const sharePath = saved.token === null ? null : `/shipyard/build/${saved.token}`;

    return (
      <Card accent={C.cyan}>
        <p style={{ margin: 0, fontSize: '13px', color: C.text }}>
          Saved{name.trim() === '' ? '' : ` as “${name.trim()}”`}.
        </p>

        {sharePath === null ? (
          <p style={{ margin: '5px 0 0', fontSize: '11px', color: C.dim }}>
            Only you can see it. You can share it later from your saved builds.
          </p>
        ) : (
          <>
            <p style={{ margin: '5px 0 0', fontSize: '11px', color: C.dim }}>{ORIGIN_NOTE}</p>
            <p
              style={{
                margin: '8px 0 0',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: C.text,
                overflowWrap: 'anywhere',
              }}
            >
              {sharePath} <Copy value={sharePath} />
            </p>
            <p style={{ margin: '8px 0 0', fontSize: '11px', color: C.faint }}>
              The link opens on the hub, on the squadron&rsquo;s own address.
            </p>
            <div style={{ marginTop: '10px' }}>
              <Button onClick={() => void window.companion.openHub()}>Open the hub</Button>
            </div>
          </>
        )}
      </Card>
    );
  }

  if (!open) {
    return (
      <Button tone="primary" onClick={() => setOpen(true)}>
        Save this build
      </Button>
    );
  }

  return (
    <Card>
      <Field label="Call it something">
        <input
          value={name}
          maxLength={80}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder={`${shipName} — my build`}
          style={inputStyle}
        />
      </Field>

      <fieldset style={{ margin: '16px 0 0', border: 0, padding: 0 }}>
        <legend style={{ ...LABEL, marginBottom: '7px', padding: 0 }}>Who can see it</legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {BUILD_VISIBILITIES.map((option) => (
            <label key={option} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="build-visibility"
                value={option}
                checked={visibility === option}
                onChange={() => setVisibility(option)}
                style={{ marginTop: '2px' }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '12px', color: C.text }}>
                  {BUILD_VISIBILITY_LABELS[option]}
                </span>
                <span style={{ display: 'block', fontSize: '11px', color: C.dim }}>
                  {BUILD_VISIBILITY_NOTES[option]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error !== null && (
        <div style={{ marginTop: '12px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
        <Button tone="primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/**
 * Build my own — the outfitting screen, ported from the website's Coriolis-shaped editor.
 *
 * The SHAPE is Coriolis's: a summary bar you watch, over slot tables you edit — a column per
 * figure, so twelve hardpoints can be compared down a column instead of read one at a time. The
 * hierarchy is ours: the summary leads with the four figures that decide a ship and demotes the
 * rest, the tables carry their own totals, and each module's full statistics are one click away.
 *
 * The arithmetic is the server's own `computeStats`, over a catalogue built from the payload. A
 * second implementation here would drift from the one that stores builds, quietly.
 */
function Loadout({
  payload,
  initial,
}: {
  payload: OutfitPayload;
  /** A build handed over by the assisted tab, with the preset button it genuinely equals. */
  initial: { build: ShipBuild; preset: 'stock' | FitRole | 'custom' } | null;
}): JSX.Element {
  const catalogue = useMemo(() => catalogueFrom(payload), [payload]);

  /**
   * The factory loadout, resolved to module ids.
   *
   * Standard defaults are written as class+rating (`"6E"`), everything else as an id (`"4j"`).
   * Both dialects live in the same array, so both are tried.
   */
  const stock = useMemo<Record<string, string | null>>(() => {
    const start: Record<string, string | null> = {};
    for (const slot of payload.ship.slots) {
      const key = `${slot.group}:${slot.index}`;
      const entry = payload.ship.defaults[slot.group]?.[slot.index] ?? null;
      if (entry === null) {
        start[key] = null;
        continue;
      }

      const byId = catalogue.module(slotCategory(slot), entry);
      if (byId !== null) {
        start[key] = byId.id;
        continue;
      }

      if (slot.fixedGroup !== null) {
        const cls = Number.parseInt(entry.slice(0, -1), 10);
        start[key] = Number.isNaN(cls)
          ? null
          : (catalogue.standardByRating(slot.fixedGroup, cls, entry.slice(-1))?.id ?? null);
        continue;
      }

      start[key] = null;
    }
    return start;
  }, [payload, catalogue]);

  /**
   * A complete loadout for a role, from the same fitting engine the assisted builder uses.
   *
   * ★ WHY THE PRESETS ARE NOT HAND-WRITTEN LISTS ★
   *
   * Because a hand-written "combat loadout" is a guess that goes stale, and because the assisted
   * builder already has to answer this question properly — it respects the power budget, the slot
   * sizes and the hull's own strengths. Two answers to "what goes on this ship for fighting" would
   * be two answers, and the one on this page would be the worse of them.
   */
  const presetFor = useMemo(
    () =>
      (role: FitRole): Record<string, string | null> => {
        const ship = catalogue.ship(payload.ship.id);
        if (ship === null) return stock;

        const result = fitShip(ship, { role }, catalogue);
        const next: Record<string, string | null> = {};
        for (const slot of payload.ship.slots) next[`${slot.group}:${slot.index}`] = null;
        for (const module of result.build.modules) {
          next[`${module.group}:${module.index}`] = module.moduleId;
        }
        return next;
      },
    [catalogue, payload, stock],
  );

  /*
   * ★ OPENS FULLY OUTFITTED ★
   *
   * Squadron owner: "in the ship builder, it needs to actually fully outfit the ships".
   *
   * Coriolis's factory data genuinely leaves 46% of slots empty — most hulls ship with no utility
   * mounts and half their internals bare — so "factory stock" alone is not a ship anybody would
   * fly. The screen opens on a COMPLETE loadout and says which one it is; factory stock is one
   * click away and clearly labelled.
   *
   * When the assisted tab hands a build over, that build is the starting point instead, and the
   * preset chip tells the truth about it: a hull fitted for a role with no budget IS that role's
   * preset, and a budget-squeezed fit is nobody's preset, so it arrives as "Edited".
   */
  const [preset, setPreset] = useState<'stock' | FitRole | 'custom'>(
    initial === null ? 'trader' : initial.preset,
  );
  const [fitted, setFitted] = useState<Record<string, string | null>>(() => {
    if (initial === null) return presetFor('trader');
    const next: Record<string, string | null> = {};
    for (const slot of payload.ship.slots) next[`${slot.group}:${slot.index}`] = null;
    for (const module of initial.build.modules) {
      next[`${module.group}:${module.index}`] = module.moduleId;
    }
    return next;
  });
  const [bulkheadId, setBulkheadId] = useState(
    initial?.build.bulkheadId ?? payload.ship.bulkheads[0]?.id ?? 'Bs',
  );
  const [openSlot, setOpenSlot] = useState<string | null>(null);

  const applyPreset = (key: 'stock' | FitRole): void => {
    setPreset(key);
    setFitted(key === 'stock' ? stock : presetFor(key));
  };

  const build: ShipBuild = useMemo(() => {
    const modules: FittedModule[] = payload.ship.slots.map((slot) => ({
      group: slot.group as FittedModule['group'],
      index: slot.index,
      moduleId: fitted[`${slot.group}:${slot.index}`] ?? null,
      slotSize: slot.size,
      enabled: true,
      priority: 1,
      engineering: null,
    }));

    return {
      shipId: payload.ship.id,
      shipName: payload.ship.name,
      buildName: null,
      source: 'coriolis',
      sourceUrl: `https://coriolis.io/outfit/${payload.ship.id}`,
      bulkheadId,
      modules,
    };
  }, [payload, fitted, bulkheadId]);

  const stats = useMemo(() => computeStats(build, catalogue), [build, catalogue]);

  const bulkhead = payload.ship.bulkheads.find((b) => b.id === bulkheadId) ?? null;

  /*
   * Hull, armour and every fitted module. Recomputed with the build rather than tracked alongside
   * it, so it cannot fall out of step with what the slots actually hold.
   */
  const totalCost = useMemo(() => {
    let sum = payload.ship.hullCost + (bulkhead?.cost ?? 0);
    for (const slot of payload.ship.slots) {
      const id = fitted[`${slot.group}:${slot.index}`];
      if (id === null || id === undefined) continue;
      sum += catalogue.module(slotCategory(slot), id)?.cost ?? 0;
    }
    return sum;
  }, [payload, fitted, bulkhead, catalogue]);

  const setSlot = (key: string, id: string | null): void => {
    setFitted((current) => ({ ...current, [key]: id }));
    // Once a slot is changed by hand it is no longer the preset, and saying so avoids a
    // highlighted "Combat" button describing a build that has been edited away from it.
    setPreset('custom');
  };

  const groups: Array<{ title: string; slots: OutfitPayload['ship']['slots'] }> = [
    { title: 'Core internals', slots: payload.ship.slots.filter((s) => s.group === 'standard') },
    {
      title: 'Hardpoints',
      slots: payload.ship.slots.filter((s) => s.group === 'hardpoint' && s.size > 0),
    },
    {
      title: 'Utility mounts',
      slots: payload.ship.slots.filter((s) => s.group === 'hardpoint' && s.size === 0),
    },
    { title: 'Optional internals', slots: payload.ship.slots.filter((s) => s.group === 'internal') },
  ];

  const emptySlots = payload.ship.slots.filter(
    (s) => (fitted[`${s.group}:${s.index}`] ?? null) === null,
  ).length;

  return (
    <div>
      {/*
        ★ THE SUMMARY LEADS, AS IT DOES ON CORIOLIS AND ON THE WEBSITE ★

        Above the tables and sticky, because the whole activity is watching these change. The glass
        panel keeps the tables readable through it as they scroll underneath.
      */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, marginBottom: '18px' }}>
        <Card hud>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '4px 20px',
            }}
          >
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '16px', color: C.text }}>
              {payload.ship.name}
            </h2>
            <div style={{ textAlign: 'right' }}>
              {/*
                ★ NOT ABBREVIATED ★

                Outfitting is a saving target — the difference between "412.7M" and 412,748,190 is
                nine million credits, which is a week of someone's flying. The one number this
                screen exists to produce is never the least precise thing on it.
              */}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '15px',
                  color: C.cyan,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {credits(totalCost)}
              </span>
              <span style={{ marginLeft: '12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: C.faint }}>
                hull {credits(payload.ship.hullCost)} · fitted{' '}
                {credits(Math.max(0, totalCost - payload.ship.hullCost))}
              </span>
            </div>
          </div>

          <div
            style={{
              marginTop: '10px',
              paddingTop: '10px',
              borderTop: `1px solid ${C.hairline}`,
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: '10px 14px',
            }}
          >
            <Figure label="Speed" value={num(stats?.speed)} unit="m/s" emphasis />
            <Figure label="Boost" value={num(stats?.boostSpeed)} unit="m/s" emphasis />
            <Figure label="Jump" value={num(stats?.jumpRange, 2)} unit="ly" emphasis />
            <Figure
              label="Power"
              value={stats === null ? '—' : `${stats.powerDrawn}/${stats.powerGenerated}`}
              unit="MW"
              tone={stats?.powerDeficit === true ? 'bad' : 'good'}
              emphasis
            />
            <Figure label="Shields" value={num(stats?.shields)} unit="MJ" />
            <Figure label="Armour" value={num(stats?.armour)} />
            <Figure label="DPS" value={num(stats?.dps, 1)} />
            <Figure label="Laden jump" value={num(stats?.ladenJumpRange, 2)} unit="ly" />
            <Figure label="Cargo" value={num(stats?.cargoCapacity)} unit="t" />
            <Figure label="Fuel" value={num(stats?.fuelCapacity)} unit="t" />
            <Figure label="Unladen" value={num(stats?.unladenMass, 1)} unit="t" />
            <Figure label="Laden" value={num(stats?.ladenMass, 1)} unit="t" />
            <Figure label="Hull mass" value={num(stats?.hullMass, 1)} unit="t" />
            <Figure label="Modules" value={num(stats?.moduleMass, 1)} unit="t" />
          </div>

          {stats?.powerDeficit === true && (
            <p
              style={{
                margin: '10px 0 0',
                border: `1px solid ${C.bad}`,
                background: C.badTint,
                borderRadius: R.control,
                padding: '8px 10px',
                fontSize: '12px',
                color: C.bad,
              }}
            >
              This draws more power than the plant makes. Fit a larger plant, or power something
              down.
            </p>
          )}

          {stats !== null && stats.damageByType !== null && (
            <p style={{ margin: '8px 0 0', fontFamily: 'var(--font-mono)', fontSize: '10px', color: C.dim }}>
              <span style={{ color: C.faint }}>damage · </span>
              {Object.entries(stats.damageByType)
                .map(([type, value]) => `${type} ${value}`)
                .join(' · ')}
            </p>
          )}
        </Card>
      </div>

      {/* ---- presets ------------------------------------------------------ */}
      <div style={{ marginBottom: '18px' }}>
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
            <span style={{ ...LABEL, color: C.orange }}>Starting point</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {PRESETS.map((option) => {
                const active = preset === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    title={option.hint}
                    onClick={() => applyPreset(option.key)}
                    aria-pressed={active}
                    style={{
                      border: `1px solid ${active ? C.orange : C.hairline}`,
                      background: active ? C.orangeTint : 'transparent',
                      color: active ? C.orangeBright : C.dim,
                      borderRadius: R.control,
                      padding: '5px 10px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
              {preset === 'custom' && (
                <span
                  style={{
                    border: `1px solid ${C.subtle}`,
                    borderRadius: R.control,
                    padding: '5px 10px',
                    fontSize: '11px',
                    color: C.faint,
                  }}
                >
                  Edited
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: C.dim }}>
              Each fits the whole ship from the game&rsquo;s own module list.
            </p>
          </div>

          {/*
            ★ THE BULKHEAD IS A SLOT, EVEN THOUGH THE GAME HIDES IT ★

            Armour is bought like a module and changes mass and hull integrity more than most
            modules do. Leaving it out would make the armour figure look fixed and unexplainable.
          */}
          <div
            style={{
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: `1px solid ${C.hairline}`,
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <span style={LABEL}>Bulkheads</span>
            <select
              style={{ ...SELECT, width: 'auto', maxWidth: '320px' }}
              value={bulkheadId}
              aria-label="Bulkheads"
              onChange={(e) => setBulkheadId((e.target as HTMLSelectElement).value)}
            >
              {payload.ship.bulkheads.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.cost !== null && b.cost > 0 ? ` — ${short(b.cost)} cr` : ''}
                </option>
              ))}
            </select>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: C.faint, fontVariantNumeric: 'tabular-nums' }}>
              {bulkhead?.mass != null && bulkhead.mass > 0 ? `${bulkhead.mass} t` : ''}
            </span>
          </div>
        </Card>
      </div>

      {/* ---- slot tables --------------------------------------------------- */}
      {groups.map((group) => {
        if (group.slots.length === 0) return null;

        const rows = group.slots.map((slot) => {
          const key = `${slot.group}:${slot.index}`;
          const id = fitted[key] ?? null;
          return { slot, key, module: id === null ? null : catalogue.module(slotCategory(slot), id) };
        });

        const sectionMass = rows.reduce((sum, r) => sum + (r.module?.mass ?? 0), 0);
        const sectionPower = rows.reduce((sum, r) => sum + (r.module?.power ?? 0), 0);
        const sectionCost = rows.reduce((sum, r) => sum + (r.module?.cost ?? 0), 0);

        return (
          <Section
            key={group.title}
            title={group.title}
            aside={
              /*
                Per-section totals. Coriolis makes you add a column up in your head to answer "what
                are my hardpoints costing me in mass" — which is the question that decides whether
                to downsize one.
              */
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: C.faint,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {sectionMass.toFixed(1)} t · {sectionPower.toFixed(2)} MW · {credits(sectionCost)}
              </span>
            }
          >
            <Card>
              {/*
                Scrolls inside itself on a narrow window rather than widening the page. A stat
                column that pushes the body sideways is worse than one you scroll to.
              */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ ...TH, width: '36px', textAlign: 'center' }}>
                        Sz
                      </th>
                      <th scope="col" style={TH}>
                        Module
                      </th>
                      <th scope="col" style={{ ...TH, width: '72px', textAlign: 'right' }}>
                        Mass
                      </th>
                      <th scope="col" style={{ ...TH, width: '72px', textAlign: 'right' }}>
                        Power
                      </th>
                      <th scope="col" style={{ ...TH, width: '110px', textAlign: 'right' }}>
                        Cost
                      </th>
                      <th scope="col" style={{ ...TH, width: '36px' }} aria-label="Statistics" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ slot, key, module }) => {
                      const options = optionsFor(catalogue, slot, SLOT_GROUPS);
                      const isOpen = openSlot === key;

                      return (
                        <tr key={key}>
                          <td style={{ ...TD, textAlign: 'center' }}>
                            {/*
                              The slot SIZE is the constraint that decides everything else, and an
                              outfitter that hides it makes people guess why a module is missing
                              from a list.
                            */}
                            <span
                              style={{
                                display: 'inline-block',
                                width: '22px',
                                border: `1px solid ${C.hairline}`,
                                borderRadius: R.control,
                                fontFamily: 'var(--font-mono)',
                                fontSize: '10px',
                                lineHeight: '18px',
                                textAlign: 'center',
                                color: C.dim,
                              }}
                            >
                              {slot.size}
                            </span>
                          </td>
                          <td style={TD}>
                            <select
                              style={SELECT}
                              value={module?.id ?? ''}
                              aria-label={`${group.title} slot ${slot.index + 1}, size ${slot.size}`}
                              onChange={(e) => {
                                const value = (e.target as HTMLSelectElement).value;
                                setSlot(key, value === '' ? null : value);
                              }}
                            >
                              <option value="">— empty —</option>
                              {options.map((m) => {
                                const summary = moduleSummary(m);
                                return (
                                  <option key={m.id} value={m.id}>
                                    {m.class}
                                    {m.rating ?? ''} {m.name}
                                    {summary === '' ? '' : ` — ${summary}`}
                                  </option>
                                );
                              })}
                            </select>
                          </td>
                          <td style={NUMCELL}>{module?.mass == null ? '—' : `${module.mass} t`}</td>
                          <td style={NUMCELL}>
                            {module?.power == null ? '—' : module.power.toFixed(2)}
                          </td>
                          <td style={NUMCELL}>{module?.cost == null ? '—' : credits(module.cost)}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>
                            <button
                              type="button"
                              disabled={module === null}
                              onClick={() => setOpenSlot(isOpen ? null : key)}
                              aria-expanded={isOpen}
                              aria-label={
                                module === null
                                  ? 'No module fitted'
                                  : `${isOpen ? 'Hide' : 'Show'} statistics for ${module.name}`
                              }
                              style={{
                                width: '22px',
                                border: `1px solid ${C.hairline}`,
                                borderRadius: R.control,
                                background: 'transparent',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '11px',
                                lineHeight: '18px',
                                color: C.dim,
                                cursor: module === null ? 'default' : 'pointer',
                                opacity: module === null ? 0.25 : 1,
                              }}
                            >
                              {isOpen ? '−' : 'i'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/*
                The detail panel sits OUTSIDE the table rather than in a spanning row: a
                `<td colspan>` holding a grid fights the table's own column widths, and the panel
                is about one module rather than about the columns.
              */}
              {rows.map(({ key, module }) =>
                openSlot === key && module !== null ? (
                  <ModuleDetail key={`${key}-detail`} module={module} />
                ) : null,
              )}
            </Card>
          </Section>
        );
      })}

      {/*
        Saving sits at the BOTTOM, after the slots. It is the end of the activity, and putting it
        at the top would make the first thing on an outfitting screen a form about visibility — a
        decision nobody can make about a ship they have not fitted yet.
      */}
      <div style={{ marginTop: '4px' }}>
        <SaveBuildPanel build={build} shipName={payload.ship.name} />
      </div>

      {emptySlots > 0 && (
        <p style={{ margin: '14px 0 0', fontSize: '11px', color: C.faint }}>
          {emptySlots} {emptySlots === 1 ? 'slot is' : 'slots are'} empty. An empty slot costs
          nothing and weighs nothing, which is often the right answer on a long-range build.
        </p>
      )}
    </div>
  );
}

/** One hull's editor: fetches the outfit payload, then hands it to the loadout screen. */
function Editor({
  shipId,
  initial,
  onBack,
}: {
  shipId: string;
  initial: { build: ShipBuild; preset: 'stock' | FitRole | 'custom' } | null;
  onBack: () => void;
}): JSX.Element {
  const [payload, setPayload] = useState<OutfitPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPayload(null);
    setError(null);
    void window.shipyard.outfit(shipId).then((answer) => {
      if (answer.ok) setPayload(answer.data);
      else setError(answer.error);
    });
  }, [shipId]);

  return (
    <div>
      <div style={{ marginBottom: '14px' }}>
        <Button onClick={onBack}>← All ships</Button>
      </div>
      {error !== null ? (
        <Problem>{error}</Problem>
      ) : payload === null ? (
        <Empty>Reading the catalogue…</Empty>
      ) : (
        <Loadout payload={payload} initial={initial} />
      )}
    </div>
  );
}

/**
 * AI assisted — a few questions, then a real build.
 *
 * ★ THE ANSWER IS COMPUTED, NOT WRITTEN ★
 *
 * The stepper collects a role and a hull or a budget and hands them to the fitting engine, which
 * searches every hull and every module Frontier ships. Nothing here asks a language model what to
 * fit: a model asked for a loadout produces modules that do not exist and jump ranges it invented,
 * confidently, in the same prose as a correct answer — and somebody would go and spend two hundred
 * million credits on it.
 */
type Step = 'role' | 'how' | 'ship' | 'budget' | 'result';

/** The four stages shown in the progress bar. `ship` and `budget` are one stage with two faces. */
const STAGES: ReadonlyArray<{ key: Step | 'choice'; label: string }> = [
  { key: 'role', label: 'What for' },
  { key: 'how', label: 'How' },
  { key: 'choice', label: 'Details' },
  { key: 'result', label: 'Your ship' },
];

const stageOf = (step: Step): number =>
  step === 'ship' || step === 'budget' ? 2 : STAGES.findIndex((s) => s.key === step);

/**
 * The jobs somebody actually asks for. Written as the question a member would ask rather than as a
 * category, and the description says what the fitter will optimise for, so the choice is informed
 * rather than a guess at our vocabulary.
 */
const ROLES: ReadonlyArray<{ key: FitRole; label: string; blurb: string }> = [
  {
    key: 'mining',
    label: 'Mining',
    blurb: 'Lasers, a refinery, limpets and as much hold as fits around them.',
  },
  {
    key: 'combat',
    label: 'Combat',
    blurb: 'Damage and the ability to survive delivering it — A-rated throughout.',
  },
  {
    key: 'explorer',
    label: 'Exploration',
    blurb: 'The longest jump the hull can carry. Light everywhere except the drive.',
  },
  {
    key: 'trader',
    label: 'Trading',
    blurb: 'Every tonne of module is a tonne of cargo not carried.',
  },
];

/**
 * Budgets offered as bands rather than a free number. A slider invites precision nobody has —
 * "about fifty million" is how people think about this. Somebody who wants an exact number can
 * still type one.
 */
const BUDGETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '10 million', value: 10_000_000 },
  { label: '50 million', value: 50_000_000 },
  { label: '150 million', value: 150_000_000 },
  { label: '400 million', value: 400_000_000 },
  { label: '1 billion', value: 1_000_000_000 },
];

const creditsWord = (n: number): string =>
  n >= 1_000_000_000
    ? `${(n / 1_000_000_000).toFixed(2)} billion`
    : `${(n / 1_000_000).toFixed(1)} million`;

/** The stepper's choice-card, shared by the role and how steps so the two rows cannot drift. */
const CHOICE: JSX.CSSProperties = {
  height: '100%',
  width: '100%',
  border: `1px solid ${C.hairline}`,
  background: C.panelGlass,
  borderRadius: R.control,
  padding: '14px 16px',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const BACKLINK: JSX.CSSProperties = {
  marginTop: '16px',
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
  color: C.dim,
  cursor: 'pointer',
};

function AiTab({
  ships,
  onOpen,
}: {
  ships: readonly ShipListEntry[];
  /** "Open in the builder": the returned build lands in the editor, preset chip told the truth. */
  onOpen: (build: ShipBuild, preset: FitRole | 'custom') => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<FitRole | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [shipId, setShipId] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fit, setFit] = useState<FitResult | null>(null);

  const build = (opts: { budget?: number; shipId?: string }): void => {
    if (role === null) return;

    setBusy(true);
    setProblem(null);

    /*
     * Both fields are optional and either may be sent alone. A named hull with no budget fits the
     * best the role can afford on it; a budget with no hull searches every one. The hub's refusal
     * — "nothing can be fitted for that within N million" — is shown verbatim, because it is the
     * sentence the member needs.
     */
    void window.shipyard
      .fit({
        role,
        ...(opts.budget === undefined ? {} : { budget: opts.budget }),
        ...(opts.shipId === undefined ? {} : { shipId: opts.shipId }),
      })
      .then((answer) => {
        if (answer.ok) {
          setFit(answer.data);
          setStep('result');
        } else {
          setProblem(answer.error);
        }
        setBusy(false);
      });
  };

  const restart = (): void => {
    setStep('role');
    setRole(null);
    setBudget(null);
    setShipId(null);
    setCustom('');
    setFit(null);
    setProblem(null);
  };

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto' }}>
      {/* Where you are, and how far there is to go. Four stages is short enough to show them all. */}
      <ol style={{ margin: '0 0 24px', padding: 0, listStyle: 'none', display: 'flex', gap: '8px' }}>
        {STAGES.map((stage, i) => (
          <li key={stage.key} style={{ flex: 1 }}>
            <div
              style={{
                height: '3px',
                borderRadius: '999px',
                background: stageOf(step) >= i ? C.cyan : C.subtle,
              }}
            />
            <span
              style={{
                display: 'block',
                marginTop: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                textTransform: 'uppercase',
                letterSpacing: '0.16em',
                color: C.faint,
              }}
            >
              {/*
                "Details" rather than "Budget", because that stage is one of two questions and a
                label naming only one of them would be wrong half the time.
              */}
              {stage.label}
            </span>
          </li>
        ))}
      </ol>

      {step === 'role' && (
        <>
          <h2 style={{ margin: 0, fontSize: '16px', color: C.text }}>What is the ship for?</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: C.dim }}>
            This decides what gets fitted and what gets sacrificed for it.
          </p>

          {/*
            ★ SQUADRON OWNER, 2026-08-01: "always make sure cards are the same height" ★

            `alignItems: stretch` on the grid and `height: 100%` on the button inside. The blurbs
            are different lengths, and without both, each card shrinks to its own text and the row
            comes out ragged — four options of different importance rather than four of one kind.
          */}
          <ul
            style={{
              margin: '16px 0 0',
              padding: 0,
              listStyle: 'none',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              alignItems: 'stretch',
              gap: '10px',
            }}
          >
            {ROLES.map((r) => (
              <li key={r.key} style={{ height: '100%' }}>
                <button
                  type="button"
                  style={CHOICE}
                  onClick={() => {
                    setRole(r.key);
                    setStep('how');
                  }}
                >
                  <span style={{ display: 'block', fontSize: '13px', color: C.text }}>{r.label}</span>
                  <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', lineHeight: 1.6, color: C.dim }}>
                    {r.blurb}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {step === 'how' && (
        <>
          <h2 style={{ margin: 0, fontSize: '16px', color: C.text }}>Do you know which ship?</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: C.dim }}>
            Either answer gets you a full loadout. This only decides whether we pick the hull or
            you do.
          </p>

          {/*
            ★ TWO WAYS TO ANSWER — SQUADRON OWNER, 2026-08-01 ★

            "once they pick the [role] they want to build for, then it should ask if they want to
            pick a specific ship to build or build based on budget."

            They answer genuinely different questions. "I have 50 million" is somebody who does not
            know what to buy. "Fit my Python" is somebody who already owns one — and for them a
            budget prompt is a question about a decision they have already made.
          */}
          <ul
            style={{
              margin: '16px 0 0',
              padding: 0,
              listStyle: 'none',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              alignItems: 'stretch',
              gap: '10px',
            }}
          >
            <li style={{ height: '100%' }}>
              <button type="button" style={CHOICE} onClick={() => setStep('ship')}>
                <span style={{ display: 'block', fontSize: '13px', color: C.text }}>
                  I have a ship in mind
                </span>
                <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', lineHeight: 1.6, color: C.dim }}>
                  Pick the hull and we will fit it for this job as well as it can be fitted. Best
                  if you already own one, or you have decided what you are saving for.
                </span>
              </button>
            </li>
            <li style={{ height: '100%' }}>
              <button type="button" style={CHOICE} onClick={() => setStep('budget')}>
                <span style={{ display: 'block', fontSize: '13px', color: C.text }}>
                  Tell me what to buy
                </span>
                <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', lineHeight: 1.6, color: C.dim }}>
                  Give us a figure and we will search every hull in the game for the best one at
                  this job that you can actually afford, hull and modules together.
                </span>
              </button>
            </li>
          </ul>

          <button type="button" style={BACKLINK} onClick={() => setStep('role')}>
            ← Back
          </button>
        </>
      )}

      {step === 'ship' && (
        <>
          <h2 style={{ margin: 0, fontSize: '16px', color: C.text }}>Which hull?</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: C.dim }}>
            Prices are the hull alone, before anything is fitted. We will fit the rest for{' '}
            {ROLES.find((r) => r.key === role)?.label.toLowerCase() ?? 'the job'} without a
            spending limit — change anything you cannot afford afterwards in the builder.
          </p>

          <div style={{ marginTop: '16px' }}>
            {ships.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
                The ship list could not be loaded. Choose a budget instead — the list fills in when
                the hub answers.
              </p>
            ) : (
              <ShipPicker
                ships={ships}
                onPick={(id) => {
                  setShipId(id);
                  setBudget(null);
                  build({ shipId: id });
                }}
              />
            )}
          </div>

          <button type="button" style={BACKLINK} onClick={() => setStep('how')}>
            ← Back
          </button>

          {busy && (
            <p style={{ margin: '14px 0 0', fontFamily: 'var(--font-mono)', fontSize: '11px', color: C.faint }}>
              Fitting…
            </p>
          )}

          {problem !== null && (
            <div style={{ marginTop: '14px' }}>
              <Problem>{problem}</Problem>
            </div>
          )}
        </>
      )}

      {step === 'budget' && (
        <>
          <h2 style={{ margin: 0, fontSize: '16px', color: C.text }}>How much can you spend?</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: C.dim }}>
            Hull and modules together. Nothing over this will be suggested — a recommendation you
            cannot afford is worse than none, because you find out at the shipyard.
          </p>

          <ul
            style={{
              margin: '16px 0 0',
              padding: 0,
              listStyle: 'none',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '8px',
            }}
          >
            {BUDGETS.map((b) => (
              <li key={b.value}>
                <button
                  type="button"
                  disabled={busy}
                  style={{
                    ...CHOICE,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    color: C.text,
                    opacity: busy ? 0.5 : 1,
                  }}
                  onClick={() => {
                    setBudget(b.value);
                    setShipId(null);
                    build({ budget: b.value });
                  }}
                >
                  {b.label}
                </button>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: '16px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '8px' }}>
            <label style={{ flex: 1, minWidth: '220px' }}>
              <span style={{ ...LABEL, display: 'block', marginBottom: '5px' }}>
                Or an exact figure, in credits
              </span>
              <input
                type="number"
                min={0}
                style={inputStyle}
                placeholder="e.g. 85000000"
                value={custom}
                onInput={(e) => setCustom((e.target as HTMLInputElement).value)}
              />
            </label>
            <Button
              tone="primary"
              disabled={busy || custom.trim() === ''}
              onClick={() => {
                const n = Number(custom);
                if (Number.isFinite(n) && n > 0) {
                  setBudget(n);
                  setShipId(null);
                  build({ budget: n });
                }
              }}
            >
              {busy ? 'Fitting…' : 'Build it'}
            </Button>
          </div>

          <button type="button" style={BACKLINK} onClick={() => setStep('how')}>
            ← Back
          </button>

          {problem !== null && (
            <div style={{ marginTop: '14px' }}>
              <Problem>{problem}</Problem>
            </div>
          )}
        </>
      )}

      {step === 'result' && fit !== null && (
        <>
          <h2 style={{ margin: 0, fontSize: '16px', color: C.text }}>{fit.build.shipName}</h2>
          <p style={{ margin: '4px 0 0', fontFamily: 'var(--font-mono)', fontSize: '12px', color: C.cyan }}>
            {creditsWord(fit.totalCost)} credits
            {budget !== null && (
              <span style={{ marginLeft: '8px', color: C.faint }}>
                of {creditsWord(budget)} budgeted
              </span>
            )}
            {/*
              No budget was set on the named-hull path, so there is nothing to compare against.
              Said out loud rather than left blank, because a bare figure invites "is that within
              what I asked for?" — and here nothing was asked for.
            */}
            {budget === null && shipId !== null && (
              <span style={{ marginLeft: '8px', color: C.faint }}>no spending limit set</span>
            )}
          </p>

          <div style={{ marginTop: '16px' }}>
            <Card>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '10px 14px',
                }}
              >
                <Figure label="Jump" value={num(fit.stats?.jumpRange, 2)} unit="ly" emphasis />
                <Figure label="Laden jump" value={num(fit.stats?.ladenJumpRange, 2)} unit="ly" emphasis />
                <Figure label="Cargo" value={num(fit.stats?.cargoCapacity)} unit="t" emphasis />
                <Figure label="Mass" value={num(fit.stats?.unladenMass, 1)} unit="t" emphasis />
                <Figure label="Shields" value={num(fit.stats?.shields)} unit="MJ" />
                <Figure label="Armour" value={num(fit.stats?.armour)} />
                <Figure label="DPS" value={num(fit.stats?.dps, 1)} />
                <Figure
                  label="Power"
                  value={fit.stats === null ? '—' : `${fit.stats.powerDrawn}/${fit.stats.powerGenerated}`}
                  unit="MW"
                  tone={fit.stats?.powerDeficit === true ? 'bad' : 'good'}
                />
              </div>
            </Card>
          </div>

          <p style={{ margin: '16px 0 0', fontSize: '13px', lineHeight: 1.7, color: C.dim }}>
            {fit.whyThisShip}
          </p>

          {fit.compromises.length > 0 && (
            /*
              Said plainly. A fit that could not afford something, or that draws more power than it
              makes, is still the best answer available — but presenting it without saying so would
              be presenting a compromise as a recommendation.
            */
            <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {fit.compromises.map((c) => (
                <li key={c} style={{ fontSize: '12px', color: C.warn }}>
                  {c}
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: '22px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {/*
              ★ THE RESULT LANDS IN THE EDITOR, MODULES AND ALL ★

              The website links to the builder and lets it open on its default preset; this app can
              do better because the two tabs share a window — the exact build the fitter returned
              becomes the editor's starting point, so what was recommended is what is on screen.
            */}
            <Button
              tone="primary"
              onClick={() => onOpen(fit.build, budget === null && role !== null ? role : 'custom')}
            >
              Open in the builder
            </Button>
            <Button onClick={restart}>Start again</Button>
          </div>

          <p style={{ margin: '18px 0 0', fontSize: '12px', lineHeight: 1.7, color: C.faint }}>
            Every module here comes from the game&rsquo;s own data and every figure is computed from
            what is fitted. Nothing was guessed at.
          </p>
        </>
      )}
    </div>
  );
}

const TABS = [
  { key: 'build', label: 'Build my own' },
  { key: 'ai', label: 'AI assisted' },
] as const;

export function OutfitterPage(): JSX.Element {
  const [tab, setTab] = useState<'build' | 'ai'>('build');
  const [ships, setShips] = useState<ShipListEntry[] | null>(null);
  const [shipsError, setShipsError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  /*
   * A build handed from the assisted tab to the editor. The sequence number is the editor's key:
   * applying a second recommendation for the same hull must remount the editor, or the new build
   * would be silently ignored by state that initialised from the first one.
   */
  const [handoff, setHandoff] = useState<{
    seq: number;
    build: ShipBuild;
    preset: FitRole | 'custom';
  } | null>(null);

  const loadShips = (): void => {
    void window.shipyard.ships().then((answer) => {
      if (answer.ok) {
        setShips(answer.data.ships);
        setShipsError(null);
      } else {
        setShipsError(answer.error);
      }
    });
  };

  useEffect(loadShips, []);
  /*
   * ★ SQUADRON OWNER, 2026-08-04: "with all data updated in realtime please!" ★
   *
   * Two minutes, because the catalogue moves on the pace of Frontier's releases, not the EDDN
   * relay. Only the PICKER list refreshes — a loaded outfit is somebody's ten minutes of choices,
   * and no timer may touch it. The editor fetches its payload once per hull, on purpose.
   */
  useLive(loadShips, 120_000);

  const openInBuilder = (build: ShipBuild, preset: FitRole | 'custom'): void => {
    setHandoff((prev) => ({ seq: (prev?.seq ?? 0) + 1, build, preset }));
    setChosen(build.shipId);
    setTab('build');
  };

  const applied = handoff !== null && handoff.build.shipId === chosen ? handoff : null;

  return (
    <div>
      <Tabs tabs={TABS} current={tab} onChange={setTab} label="Outfitter sections" />

      {/*
        ★ BOTH PANELS STAY MOUNTED, ONE IS HIDDEN ★

        The website's tabs are routes and forget the outfitter on navigation. Here a member flips
        to the assisted tab mid-edit and back — and unmounting the editor on every flip would throw
        away a half-fitted ship each time. Hidden with `display: none` rather than removed, so both
        tabs keep their state and the editor only remounts when a hull or a handed-over build
        actually changes (that is what the key is for).
      */}
      <div
        id="panel-build"
        role="tabpanel"
        aria-labelledby="tab-build"
        tabIndex={0}
        style={{ marginTop: '18px', display: tab === 'build' ? 'block' : 'none' }}
      >
        {chosen !== null ? (
          <Editor
            key={`${chosen}#${applied?.seq ?? 0}`}
            shipId={chosen}
            initial={applied === null ? null : { build: applied.build, preset: applied.preset }}
            onBack={() => {
              setChosen(null);
              setHandoff(null);
            }}
          />
        ) : shipsError !== null ? (
          <Problem>{shipsError}</Problem>
        ) : ships === null ? (
          <Empty>Loading the shipyard…</Empty>
        ) : (
          <Section title="Pick a hull">
            <ShipPicker ships={ships} onPick={setChosen} />
          </Section>
        )}
      </div>

      <div
        id="panel-ai"
        role="tabpanel"
        aria-labelledby="tab-ai"
        tabIndex={0}
        style={{ marginTop: '18px', display: tab === 'ai' ? 'block' : 'none' }}
      >
        <AiTab ships={ships ?? []} onOpen={openInBuilder} />
      </div>
    </div>
  );
}
