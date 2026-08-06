import type preact from 'preact';
import { C } from './ui.js';
import type { OverlayData } from './overlay.js';

/**
 * The two mining overlays.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "our own version of EDminer ... its own overlays too please! the theme, brand and styles must
 * also match our exsiting!"
 *
 * Their own file rather than more of `overlay.tsx`, which was already five hundred lines of four
 * unrelated panels. Same primitives, same tokens, same accent — matching the existing look is a
 * matter of using the same pieces, not of copying numbers.
 */

const ROW: preact.JSX.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '1px 0',
};

/** Every panel says this rather than drawing an empty frame that reads as broken. */
function Waiting({ what }: { what: string }): preact.JSX.Element {
  return <p style={{ margin: 0, fontSize: '0.85em', color: C.dim }}>{what}</p>;
}

/** A percentage that cannot overflow its track, whatever the game reported. */
function barWidth(percent: number): string {
  return `${Math.min(100, Math.max(0, percent))}%`;
}

/**
 * The rock in front of you, right now.
 *
 * ★ THE TWO-SECOND DECISION, DRAWN ★
 *
 * A prospected rock drifts past in a couple of seconds. Everything here exists so that "shoot it or
 * not" is readable in one glance: the best material at the top, its share as a bar, and clear
 * marking when it beats the bar the member set for THAT material.
 *
 * ★ VISUAL ONLY, WHICH RAISES THE BAR ON THE HIGHLIGHT ★
 *
 * The owner chose no sound. So the highlight carries the entire signal, and it is deliberately
 * redundant — a rule above the list, the accent on the bar, and the accent on the number. A single
 * subtle cue is one a member misses while looking at the rock, which is where they should be
 * looking.
 */
export function ProspectorPanel({
  data,
  accent,
  show,
}: {
  data: OverlayData['prospector'];
  accent: string;
  show: (f: string) => boolean;
}): preact.JSX.Element {
  if (data === null) return <Waiting what="Waiting for a prospector limpet." />;

  const top = data.materials[0];

  return (
    <div>
      {/*
        A rule that appears only on a hit. The eye catches a line ARRIVING far more reliably than a
        colour changing, and with no sound this is the fastest signal the panel has.
      */}
      {data.isHit ? (
        <div
          style={{ height: '2px', background: accent, borderRadius: '1px', marginBottom: '5px' }}
        />
      ) : null}

      {show('materials')
        ? data.materials.slice(0, 5).map((m) => {
            const best = m.name === top?.name;
            /*
             * Only the BEST material carries the hit colour. Tinting every row would say the whole
             * rock is good when one mineral in it is — and the decision is about that one mineral.
             */
            const colour = best && data.isHit ? accent : C.text;
            return (
              <div key={m.name} style={{ marginBottom: '3px' }}>
                <div style={ROW}>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: best ? colour : C.dim,
                    }}
                  >
                    {m.name}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: colour }}>
                    {m.percent.toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: '3px', background: C.subtle, borderRadius: '2px' }}>
                  <div
                    style={{
                      height: '100%',
                      width: barWidth(m.percent),
                      background: best && data.isHit ? accent : C.dim,
                      borderRadius: '2px',
                    }}
                  />
                </div>
              </div>
            );
          })
        : null}

      {/*
        The loudest thing on the panel, because it changes what a member does next more than any
        percentage does: it is the rock a core miner is hunting.
      */}
      {show('motherlode') && data.motherlode !== null ? (
        <p style={{ margin: '5px 0 0', fontSize: '0.85em', color: accent, fontWeight: 600 }}>
          MOTHERLODE · {data.motherlode}
        </p>
      ) : null}

      {show('content') && data.content !== null ? (
        <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.dim }}>Content: {data.content}</p>
      ) : null}

      {/*
        Hit rate is how a miner knows whether to stay in this ring, and it is the number no in-game
        screen shows. Null before the first rock — see `hitRate` in the fold.
      */}
      {show('hitRate') && data.hitRate !== null ? (
        <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.dim }}>
          Rock {data.prospected} · {data.hitRate.toFixed(0)}% worth shooting
          {show('best') && data.bestMaterial !== null
            ? ` · best ${data.bestPercent.toFixed(1)}% ${data.bestMaterial}`
            : ''}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The session: what came out, how fast, what it scores, and what it is worth.
 *
 * ★ THE PART NO OTHER MINING TOOL CAN DO ★
 *
 * `value` and `bestSale` come from the squadron's own market table — eighteen million rows and
 * working route-finding. EDMiner and its kind can show what you mined; none of them can tell you
 * what it is worth or where to take it, because none of them own a market database.
 *
 * The points are the hub's own arithmetic rather than an estimate: same weights, same function. A
 * number a member watches all evening has to be the number that lands on the board.
 */
export function RefineryPanel({
  data,
  accent,
  show,
}: {
  data: OverlayData['refinery'];
  accent: string;
  show: (f: string) => boolean;
}): preact.JSX.Element {
  if (data === null || data.tonnes === 0) return <Waiting what="Nothing refined yet." />;

  /*
   * Bars are relative to the BIGGEST material rather than to a hold capacity. Mid-session the
   * interesting comparison is between minerals; how full the hold is lives on the cargo panel, for
   * anybody who wants both.
   *
   * Floored at 1 so the first tonne cannot divide by zero.
   */
  const most = Math.max(...data.materials.map((m) => m.tonnes), 1);

  return (
    <div>
      {show('materials')
        ? data.materials.slice(0, 5).map((m) => (
            <div key={m.name} style={{ marginBottom: '3px' }}>
              <div style={ROW}>
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {m.name}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: accent }}>
                  {m.tonnes} t
                </span>
              </div>
              <div style={{ height: '3px', background: C.subtle, borderRadius: '2px' }}>
                <div
                  style={{
                    height: '100%',
                    width: barWidth((m.tonnes / most) * 100),
                    background: accent,
                    borderRadius: '2px',
                  }}
                />
              </div>
            </div>
          ))
        : null}

      {show('session') ? (
        <p style={{ margin: '5px 0 0', fontSize: '0.8em', color: C.dim }}>
          {data.tonnes} t
          {data.minutes === null
            ? ''
            : ` · ${Math.floor(data.minutes / 60)}h ${Math.round(data.minutes % 60)}m`}
          {show('rate') && data.rate !== null ? ` · ${data.rate.toFixed(0)} t/h` : ''}
        </p>
      ) : null}

      {show('points') ? (
        <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: accent }}>
          +{data.points.toLocaleString()} Deep Core
        </p>
      ) : null}

      {show('value') && data.value !== null ? (
        <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.dim }}>
          Hold worth {data.value.toLocaleString()} cr
        </p>
      ) : null}

      {show('bestSale') && data.bestSale !== null ? (
        <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.dim }}>
          Best sale {data.bestSale.station}
          {data.bestSale.distanceLy === null ? '' : ` · ${data.bestSale.distanceLy.toFixed(0)} ly`}
          {' · '}
          {data.bestSale.perTonne.toLocaleString()}/t
        </p>
      ) : null}
    </div>
  );
}
