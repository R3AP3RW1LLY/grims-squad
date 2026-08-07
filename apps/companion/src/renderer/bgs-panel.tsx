import type preact from 'preact';
import { C } from './ui.js';
import type { OverlayData } from './overlay.js';

/**
 * The faction orders overlay.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "for the BGS system, create an overlay in the companion app with settings etc like the mining
 * overlay please!"
 *
 * ★ IT IS READ AT A MISSION BOARD, IN UNDER A SECOND ★
 *
 * The member is standing at a board with two dozen offers from six factions, deciding which to
 * take. The game presents all six identically; only the squadron knows which ones the officers
 * asked for. So the stance is the loudest thing in each row — colour AND word, never colour alone —
 * and the orders for THIS system come first, because an order for somewhere else cannot be acted on
 * from here.
 */

const ROW: preact.JSX.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '10px',
  padding: '1px 0',
};

function Waiting({ what }: { what: string }): preact.JSX.Element {
  return <p style={{ margin: 0, fontSize: '0.85em', color: C.dim }}>{what}</p>;
}

/**
 * What each stance looks like, and what it is called.
 *
 * ★ THE WORD CARRIES IT, NOT THE COLOUR ★
 *
 * Push and suppress are opposite instructions, and about one man in twelve cannot reliably tell
 * this green from this red. Getting them the wrong way round means working all evening against
 * your own squadron, so the word is always drawn — the colour only makes it faster for people who
 * can use it.
 */
const STANCE: Record<string, { text: string; colour: string }> = {
  push: { text: 'PUSH', colour: C.good },
  hold: { text: 'HOLD', colour: C.warn },
  suppress: { text: 'SUPPRESS', colour: C.bad },
  ignore: { text: 'IGNORE', colour: C.faint },
};

export function BgsPanel({
  data,
  accent,
  show,
}: {
  data: OverlayData['bgs'];
  accent: string;
  show: (f: string) => boolean;
}): preact.JSX.Element {
  if (data === null) return <Waiting what="Waiting for the squadron's orders." />;

  const top = data.here[0];

  return (
    <div style={{ display: 'grid', gap: '2px', fontSize: '0.9em' }}>
      {show('orders') ? (
        data.here.length > 0 ? (
          <>
            {/*
              The system is named rather than assumed. Two members reading the same panel in
              different places see different orders, and neither should have to work out why.
            */}
            <p style={{ margin: '0 0 3px', fontSize: '0.8em', color: C.dim }}>
              In {data.system ?? 'this system'}
            </p>
            {data.here.map((o) => {
              const look = STANCE[o.stance] ?? { text: o.stance.toUpperCase(), colour: C.dim };
              return (
                <div key={`${o.faction}:${o.stance}`} style={ROW}>
                  <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.faction}
                    {/*
                      Our own faction marked, because "push" means something different for the
                      squadron's own than for an ally: one is home, the other is a favour.
                    */}
                    {o.isOurs ? <span style={{ color: accent }}> ·ours</span> : null}
                  </span>
                  <span
                    style={{
                      color: look.colour,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      fontSize: '0.85em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {look.text}
                  </span>
                </div>
              );
            })}
          </>
        ) : (
          /*
           * Not "no orders" — that would be false, and would send a member who wants to help off to
           * do something else. The squadron has work; it is not here.
           */
          <Waiting
            what={
              data.elsewhere > 0
                ? `Nothing ordered in ${data.system ?? 'this system'}.`
                : 'No standing orders yet.'
            }
          />
        )
      ) : null}

      {/* The officer's own words, for the top order only. A panel is not a briefing document. */}
      {show('guidance') && top?.guidance != null && top.guidance.trim() !== '' ? (
        <p
          style={{
            margin: '3px 0 0',
            fontSize: '0.8em',
            color: C.dim,
            borderLeft: `2px solid ${accent}`,
            paddingLeft: '6px',
          }}
        >
          {top.guidance}
        </p>
      ) : null}

      {show('elsewhere') && data.elsewhere > 0 ? (
        <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.faint }}>
          {data.elsewhere} order{data.elsewhere === 1 ? '' : 's'} elsewhere
        </p>
      ) : null}

      {/* Hidden until the first mission lands: a session of zeroes belongs to somebody who has not
          started, and telling them they have moved nothing is not information. */}
      {show('session') && data.missions > 0 ? (
        <div style={{ ...ROW, marginTop: '3px' }}>
          <span style={{ color: C.dim }}>
            {data.missions} mission{data.missions === 1 ? '' : 's'}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: C.text }}>
            {data.pips > 0 ? '+' : ''}
            {data.pips} inf
          </span>
        </div>
      ) : null}

      {show('points') && data.missions > 0 ? (
        <div style={ROW}>
          <span style={{ color: C.dim }}>Faction Hands</span>
          <span
            style={{
              fontVariantNumeric: 'tabular-nums',
              // Negative is real and worth seeing: it means helping somebody we were told to hold
              // back. Drawing it in the ordinary text colour would hide the one number a member
              // most needs to notice.
              color: data.points > 0 ? C.good : data.points < 0 ? C.bad : C.dim,
            }}
          >
            {data.points > 0 ? '+' : ''}
            {data.points.toLocaleString()}
          </span>
        </div>
      ) : null}
    </div>
  );
}
