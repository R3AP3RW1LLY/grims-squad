import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { CompanionStanding } from '../hub-bgs.js';
import { C, Card, Empty, Problem, Section } from './ui.js';

/**
 * The standing orders, in the app.
 *
 * ★ THE ONE THING THE GAME WILL NOT TELL YOU ★
 *
 * A mission board shows every faction identically. Only the squadron knows which of them the
 * officers asked for — so this puts that in front of the member at the moment they are choosing
 * what to take, rather than in a Discord message they read yesterday.
 *
 * The overlay shows the orders for the system you are IN. This page shows all of them, which is
 * what you want when deciding where to go rather than what to take once you are there.
 */

declare global {
  interface Window {
    readonly bgs: { orders(): Promise<CompanionStanding[]> };
  }
}

/**
 * What each stance looks like, and what it is called.
 *
 * The word is always drawn, never colour alone: push and suppress are opposite instructions, about
 * one man in twelve cannot reliably tell this green from this red, and getting them the wrong way
 * round means working all evening against your own squadron.
 */
const STANCE: Record<string, { text: string; colour: string; means: string }> = {
  push: { text: 'PUSH', colour: C.good, means: 'Hand missions in for them — every pip you move scores.' },
  hold: { text: 'HOLD', colour: C.warn, means: 'Keep them steady. Pushing higher can trigger an expansion. Scores at half rate.' },
  suppress: { text: 'SUPPRESS', colour: C.bad, means: 'Work against them. Influence taken OFF them is the job; helping them costs you.' },
  ignore: { text: 'IGNORE', colour: C.faint, means: 'Not a target. Nothing done either way scores.' },
};

export function BgsPage(): JSX.Element {
  const [orders, setOrders] = useState<CompanionStanding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.bgs.orders().then(
      (o) => setOrders(o),
      () => setError('Could not reach the hub.'),
    );
  }, []);

  if (error !== null) return <Problem>{error}</Problem>;
  if (orders === null) return <Empty>Reading the squadron's orders…</Empty>;

  if (orders.length === 0) {
    return (
      <Empty>
        No standing orders right now. Nothing is being pushed, held or suppressed — so mission
        hand-ins score nothing on Faction Hands until an officer sets one.
      </Empty>
    );
  }

  // Most important first, which is the order an officer set them in.
  const sorted = [...orders].sort((a, b) => a.priority - b.priority);

  return (
    <Section title="Standing orders">
      <div style={{ display: 'grid', gap: '8px' }}>
        {sorted.map((o, i) => {
          const look = STANCE[o.stance] ?? { text: o.stance.toUpperCase(), colour: C.dim, means: '' };
          return (
            <Card key={`${o.faction}:${o.systemName ?? ''}:${i}`}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{
                  color: look.colour, border: `1px solid ${look.colour}`, borderRadius: '3px',
                  padding: '1px 6px', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em',
                }}>
                  {look.text}
                </span>
                <strong style={{ color: C.text, fontSize: '14px', flex: 1 }}>
                  {o.faction}
                  {o.isOurs ? <span style={{ color: C.orangeBright, fontSize: '10px', marginLeft: '6px' }}>OURS</span> : null}
                </strong>
                {o.systemName === null ? null : (
                  <span style={{ color: C.dim, fontSize: '12px' }}>in {o.systemName}</span>
                )}
              </div>

              <p style={{ margin: '6px 0 0', color: C.dim, fontSize: '12px' }}>{look.means}</p>

              {o.guidance === null || o.guidance.trim() === '' ? null : (
                <p style={{
                  margin: '6px 0 0', paddingLeft: '8px', borderLeft: `2px solid ${C.orange}`,
                  color: C.text, fontSize: '12px',
                }}>
                  {o.guidance}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
