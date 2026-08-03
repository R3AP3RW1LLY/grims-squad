import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { BuildTypeDetail, BuildTypeRow } from '../hub-colony.js';
import { Button, C, Card, Empty, Problem, Section, Stat, credits, inputStyle, tonnes } from './ui.js';

/**
 * The build catalogue, in the app.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "ensure the Companion app matches and has all the same pages in colonization that the website has
 * please! must be a mirror!"
 *
 * This was the one page the website had and the app did not — so a member reading the boards on
 * their desktop could answer "what does a Coriolis cost" and the same member in the app could not.
 * Same endpoints as the website, so the two cannot give different numbers for the same build.
 *
 * ★ WHY THE APP IS THE BETTER PLACE FOR THIS ★
 *
 * It knows where you are docked. Pricing a build against the system you are actually sitting in is
 * one press here and a typed system name on the website.
 */

/**
 * Tonnage, banded by what it means for an evening.
 *
 * A number alone does not say whether a build is one member's night or the squadron's fortnight.
 * The colour does, at a glance, which is the whole reason somebody scans this list.
 */
function haulTone(t: number): string {
  if (t < 4_000) return C.good;
  if (t < 20_000) return C.cyan;
  if (t < 60_000) return C.warn;
  return C.bad;
}

export function BuildTypesPage({ dockedSystem }: { dockedSystem: string | null }): JSX.Element {
  const [rows, setRows] = useState<BuildTypeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    void (async () => {
      const answer = await window.colony.buildTypes();
      if (answer.ok) setRows(answer.data.buildTypes);
      else setError(answer.error);
    })();
  }, []);

  if (error !== null) return <Problem>{error}</Problem>;
  if (rows === null) return <Empty>Loading…</Empty>;

  if (open !== null) {
    return <BuildTypeDetailPage id={open} dockedSystem={dockedSystem} onBack={() => setOpen(null)} />;
  }

  const needle = text.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      needle === '' ||
      r.displayName.toLowerCase().includes(needle) ||
      r.category.toLowerCase().includes(needle),
  );
  const measured = rows.filter((r) => r.source === 'observed').length;

  return (
    <div>
      <Section
        title="Build types"
        aside={
          <input
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            placeholder="find a build"
            style={{ ...inputStyle, width: '180px' }}
          />
        }
      >
        {shown.length === 0 ? (
          <Empty>Nothing matches that.</Empty>
        ) : (
          <Card>
            {shown.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpen(r.id)}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '7px 0',
                  border: 'none',
                  borderTop: `1px solid ${C.hairline}`,
                  background: 'transparent',
                  color: C.text,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  fontSize: '13px',
                }}
              >
                <span>
                  {r.displayName}
                  <span style={{ marginLeft: '8px', fontSize: '11px', color: C.faint }}>
                    T{r.tier} · {r.location}
                    {r.padSize === 'none' ? '' : ` · ${r.padSize} pad`}
                  </span>
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    color: haulTone(r.totalTonnes),
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tonnes(r.totalTonnes)}
                </span>
              </button>
            ))}
          </Card>
        )}
      </Section>

      {/*
        Where the numbers come from, said out loud. Frontier publishes none of this — every figure
        was gathered by players — and the counter moves on its own every time somebody docks at a
        site we have not seen before.
      */}
      <Section title="How much of this is measured">
        <Card>
          <p style={{ margin: 0, fontSize: '12px', color: C.dim, lineHeight: 1.6 }}>
            Frontier publishes none of these figures, so every row says where its numbers came from.{' '}
            <strong style={{ color: C.text }}>
              {measured} of {rows.length}
            </strong>{' '}
            have been confirmed against one of the squadron&rsquo;s own construction sites — the
            whole bill of materials matching, commodity for commodity.
          </p>
        </Card>
      </Section>
    </div>
  );
}

/** One build type, priced against wherever the member happens to be. */
function BuildTypeDetailPage({
  id,
  dockedSystem,
  onBack,
}: {
  id: string;
  dockedSystem: string | null;
  onBack: () => void;
}): JSX.Element {
  /*
   * Defaults to where they are docked. The app knows, so making somebody type the name of the
   * system they are sitting in would be asking for something already on screen.
   */
  const [near, setNear] = useState(dockedSystem ?? '');
  const [asked, setAsked] = useState(dockedSystem ?? '');
  const [data, setData] = useState<{
    buildType: BuildTypeDetail;
    origin: { system: string } | null;
    unknownSystem: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    void (async () => {
      const answer = await window.colony.buildType(id, asked);
      if (answer.ok) setData(answer.data);
      else setError(answer.error);
    })();
  }, [id, asked]);

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

  if (data === null) {
    return (
      <div>
        <Button onClick={onBack}>← Back</Button>
        <div style={{ marginTop: '14px' }}>
          <Empty>Pricing it…</Empty>
        </div>
      </div>
    );
  }

  const b = data.buildType;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <Button onClick={onBack}>← Back</Button>
        <span style={{ fontSize: '15px' }}>{b.displayName}</span>
        <span style={{ fontSize: '11px', color: C.faint }}>
          T{b.tier} · {b.location}
          {b.padSize === 'none' ? '' : ` · ${b.padSize} pad`}
        </span>
      </div>

      <Card hud>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
          <Stat label="To haul" value={tonnes(b.totalTonnes)} />
          <Stat
            label="Cost near you"
            value={data.origin === null ? '—' : credits(Math.round(b.total))}
            tone={data.origin === null ? C.dim : C.cyan}
          />
          <Stat
            label="Figures"
            value={b.source === 'observed' ? 'Measured' : 'Unchecked'}
            tone={b.source === 'observed' ? C.good : C.dim}
          />
        </div>
      </Card>

      <div style={{ marginTop: '20px' }}>
        <Section title="Price it from">
          <Card>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                value={near}
                onInput={(e) => setNear((e.target as HTMLInputElement).value)}
                placeholder="a system you can reach"
                style={{ ...inputStyle, flex: 1 }}
              />
              <Button tone="primary" onClick={() => setAsked(near)}>
                Price it
              </Button>
            </div>

            {data.unknownSystem === null ? null : (
              <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.warn }}>
                We hold no system called &ldquo;{data.unknownSystem}&rdquo;, so nothing below is
                priced.
              </p>
            )}

            {data.origin === null && data.unknownSystem === null ? (
              <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.dim, lineHeight: 1.6 }}>
                {/*
                  No origin means no prices, deliberately. A cheapest-anywhere total is a number
                  nobody can act on and, worse, looks like a real quote.
                */}
                Name a system and every line below is priced against the nearest place that sells it.
              </p>
            ) : null}
          </Card>
        </Section>

        <Section title="What it asks for">
          <Card>
            {b.costs.map((c) => (
              <div
                key={c.commodity}
                style={{ padding: '6px 0', borderTop: `1px solid ${C.hairline}` }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <span style={{ fontSize: '13px' }}>{c.commodity}</span>
                  <span
                    style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                  >
                    {tonnes(c.tonnes)}
                  </span>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
                  {c.stationName === null
                    ? data.origin === null
                      ? 'not priced'
                      : 'nobody in range sells this'
                    : `${c.stationName} · ${c.systemName}` +
                      (c.distance === null ? '' : ` · ${Math.round(c.distance)} ly`) +
                      (c.cost === null ? '' : ` · ${credits(Math.round(c.cost))}`)}
                </p>
              </div>
            ))}

            {data.origin === null ? null : (
              <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.dim }}>
                {/*
                  Qualified whenever it is incomplete. A confident total that silently omits three
                  commodities nobody sells is worse than no total.
                */}
                {b.unsourced === 0
                  ? `About ${credits(Math.round(b.total))} in cargo, bought near ${data.origin.system}.`
                  : `About ${credits(Math.round(b.total))} for what can be bought near ${data.origin.system} — ${b.unsourced} not sold in range, so the real total is higher.`}
              </p>
            )}
          </Card>
        </Section>
      </div>
    </div>
  );
}
