import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ScoutResult, SystemSurvey } from '../hub-scout.js';
import { Button, C, Card, Empty, Problem, Section, inputStyle } from './ui.js';

/**
 * Finding the next system worth claiming, from the cockpit.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "can we build a tool into our web and companion app that literally does what we just did here for
 * this planning and research and system selection?"
 *
 * ★ THE TWO FACTS THAT DECIDE IT ★
 *
 * Whether a system can be claimed at all — which needs a station in range — and whose power that
 * claim extends. Both sit on the row rather than behind a tap, because a commander reading this in
 * the cockpit is deciding whether to fly somewhere, and finding out afterwards that a system was
 * unclaimable is the whole failure this page exists to prevent.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    readonly scout: {
      search(anchor: string, range?: string, prefer?: string): Promise<Answer<ScoutResult>>;
      survey(system: string): Promise<Answer<SystemSurvey>>;
    };
  }
}

function ls(v: number | null): string {
  if (v === null) return '—';
  return v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M Ls`
    : `${Math.round(v).toLocaleString()} Ls`;
}

/** Arrival distance, coloured by what it costs on every visit for the life of the colony. */
function reachColour(v: number | null): string {
  if (v === null) return C.dim;
  return v < 5_000 ? C.good : v < 50_000 ? C.warn : C.bad;
}

export function ScoutPage(): JSX.Element {
  const [anchor, setAnchor] = useState('');
  const [range, setRange] = useState('15');
  const [prefer, setPrefer] = useState('');
  const [result, setResult] = useState<ScoutResult | null>(null);
  const [survey, setSurvey] = useState<SystemSurvey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (): void => {
    if (anchor.trim() === '') return;
    setBusy(true);
    setSurvey(null);
    void window.scout.search(anchor.trim(), range, prefer).then((a) => {
      setBusy(false);
      if (a.ok) {
        setResult(a.data);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  const look = (system: string): void => {
    setBusy(true);
    void window.scout.survey(system).then((a) => {
      setBusy(false);
      if (a.ok) {
        setSurvey(a.data);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <Section title="Search">
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end' }}>
            <label style={{ flex: 1, minWidth: '200px', display: 'grid', gap: '4px' }}>
              <span style={{ color: C.dim, fontSize: '11px' }}>Search around</span>
              <input
                value={anchor}
                onChange={(e) => setAnchor((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter') run(); }}
                placeholder="the station you buy claims from"
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: '4px' }}>
              <span style={{ color: C.dim, fontSize: '11px' }}>Range</span>
              <select value={range} onChange={(e) => setRange((e.target as HTMLSelectElement).value)} style={inputStyle}>
                {['10', '15', '20', '30', '40'].map((ly) => (
                  <option key={ly} value={ly}>{ly} ly</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: '4px' }}>
              {/*
                The claim extends the power that sells it, permanently. Preferring one makes a
                matching station win even when a closer one exists.
              */}
              <span style={{ color: C.dim, fontSize: '11px' }}>Extend</span>
              <select value={prefer} onChange={(e) => setPrefer((e.target as HTMLSelectElement).value)} style={inputStyle}>
                <option value="">any power</option>
                <option value="Federation">Federation</option>
                <option value="Empire">Empire</option>
                <option value="Alliance">Alliance</option>
              </select>
            </label>

            <Button onClick={run} disabled={busy || anchor.trim() === ''}>
              {busy ? 'Searching…' : 'Scout'}
            </Button>
          </div>
        </Card>
      </Section>

      {error !== null ? <Problem>{error}</Problem> : null}

      {survey !== null ? (
        <Section title={`${survey.system} — survey`} aside={
          <Button onClick={() => setSurvey(null)}>Back to results</Button>
        }>
          {survey.notFound !== undefined ? (
            <Empty>
              Nothing is held for {survey.notFound}. Either the name is wrong, or no commander has
              scanned it and shared the result.
            </Empty>
          ) : (
            <Card>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '13px' }}>
                <span style={{ color: C.dim }}>
                  Bodies <strong style={{ color: C.text }}>{survey.bodyCount ?? '?'}</strong>
                </span>
                <span style={{ color: C.dim }}>
                  Landable <strong style={{ color: C.text }}>{survey.landableCount}</strong>
                </span>
                <span style={{ color: C.dim }}>
                  Nearest{' '}
                  <strong style={{ color: reachColour(survey.nearestLandableLs) }}>
                    {ls(survey.nearestLandableLs)}
                  </strong>
                </span>
                <span style={{ color: C.dim }}>
                  Ringed <strong style={{ color: C.text }}>{survey.ringedCount}</strong>
                </span>
              </div>

              {survey.nearestLandableLs !== null && survey.nearestLandableLs > 50_000 ? (
                <p style={{ margin: '10px 0 0', color: C.warn, fontSize: '12px' }}>
                  The closest landable body is {ls(survey.nearestLandableLs)} out — roughly a quarter
                  of an hour of supercruise each way, on every visit, for the life of the colony.
                </p>
              ) : null}

              <div style={{ marginTop: '10px', display: 'grid', gap: '2px', fontSize: '12px' }}>
                {survey.bodies.filter((b) => b.landable || b.hasRings).slice(0, 24).map((b) => (
                  <div key={b.bodyId} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                    <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name}
                      <span style={{ color: C.faint }}>
                        {b.landable ? ' · landable' : ''}{b.hasRings ? ' · rings' : ''}
                      </span>
                    </span>
                    <span style={{ color: C.dim, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {ls(b.distanceLs)}
                      {b.orbitalSlots !== null || b.surfaceSlots !== null
                        ? ` · ${b.orbitalSlots ?? 0}o/${b.surfaceSlots ?? 0}s`
                        : ''}
                    </span>
                  </div>
                ))}
              </div>

              {!survey.hasSlotData ? (
                <p style={{ margin: '10px 0 0', color: C.dim, fontSize: '12px' }}>
                  No build slot counts recorded. They cannot be fetched from anywhere — read them off
                  the colonisation UI and enter them on the website's planning page.
                </p>
              ) : null}
            </Card>
          )}
        </Section>
      ) : result === null ? (
        <Empty>Name a system above to find what can be claimed near it.</Empty>
      ) : result.unknownAnchor !== null ? (
        <Empty>
          We hold no coordinates for {result.unknownAnchor}. Check the spelling — it has to match the
          game.
        </Empty>
      ) : result.candidates.length === 0 ? (
        <Empty>
          Nothing claimable inside that range. Everything nearby is already colonised, inhabited or
          permit-locked.
        </Empty>
      ) : (
        <Section
          title={`${result.candidates.length} claimable near ${result.anchor?.system ?? anchor}`}
        >
          <div style={{ display: 'grid', gap: '8px' }}>
            {result.candidates.map((c) => (
              <Card key={c.system}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                  <strong style={{ color: C.text, fontSize: '14px' }}>{c.system}</strong>
                  <Button onClick={() => look(c.system)} disabled={busy}>Survey</Button>
                </div>

                <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '12px', color: C.dim }}>
                  <span>{c.bodyCount > 0 ? `${c.bodyCount} bodies` : 'bodies unknown'}</span>
                  {c.surveyed ? (
                    <span>
                      nearest{' '}
                      <span style={{ color: reachColour(c.nearestLandableLs) }}>
                        {ls(c.nearestLandableLs)}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: C.faint }}>not surveyed</span>
                  )}
                  {c.pristine ? <span style={{ color: C.good }}>Pristine</span> : null}
                </div>

                {/*
                  ★ NO PERMIT SOURCE MEANS IT CANNOT BE TAKEN AT ALL ★

                  Said here rather than discovered after flying out to look at it.
                */}
                {c.permit === null ? (
                  <p style={{ margin: '6px 0 0', color: C.bad, fontSize: '12px' }}>
                    No station in claim range — this system cannot be claimed from anywhere nearby.
                  </p>
                ) : (
                  <p style={{ margin: '6px 0 0', color: C.dim, fontSize: '12px' }}>
                    Claim at <span style={{ color: C.text }}>{c.permit.system}</span>
                    {c.permitLy === null ? '' : ` — ${c.permitLy.toFixed(1)} ly`}
                    {c.permit.allegiance === null ? '' : ' · '}
                    {c.permit.allegiance === null ? null : (
                      <span
                        style={{
                          color:
                            result.anchor?.allegiance !== null &&
                            c.permit.allegiance === result.anchor?.allegiance
                              ? C.good
                              : C.warn,
                        }}
                      >
                        {c.permit.allegiance}
                      </span>
                    )}
                  </p>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
