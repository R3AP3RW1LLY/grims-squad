import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { C, Card, Empty, Problem, Section } from './ui.js';
import type { MergedNeeds } from '@grims/shared/colony-all-needs';

/**
 * One shopping list across every build the member is on — the app's half of the pair.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "SrvSurvey will then show cargo items needed only for the primary or all projects" — under the
 * standing rule, "we need all of this in full parity on the website and the companion app".
 *
 * ★ NOTHING IS COMPUTED HERE ★
 *
 * The merge happens on the hub, by the same `mergeNeeds` the website's page calls. This screen holds
 * the shape and none of the arithmetic, so the two surfaces cannot disagree about what is
 * outstanding or the order to buy it in — the rule the whole `hub-colony` module already follows.
 *
 * ★ AND THE OVERLAY DOES NOT COME THROUGH HERE ★
 *
 * The build overlay draws the same list from the main process's own ten-second poll. Opening this
 * screen is a separate, deliberate read, so a member browsing it never competes with the panel they
 * are flying by.
 */
export function ColonyOwedPage(): JSX.Element {
  const [owed, setOwed] = useState<MergedNeeds | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const answer = await window.colony.owed();
    if (answer.ok) {
      setOwed(answer.data);
      setError(null);
    } else {
      setError(answer.error);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error !== null) return <Problem>{error}</Problem>;

  /*
   * Null is "we have not asked yet" and renders as waiting; an empty list is a real answer and
   * renders as good news. Merging the two would tell a member on a broken connection that they owe
   * nothing — the same distinction the overlay keeps for the hold and the standing orders.
   */
  if (owed === null) return <Empty>Reading what you owe…</Empty>;

  return (
    <Section title="What you owe">
      {owed.rows.length === 0 ? (
        <Empty>
          {owed.projects === 0
            ? 'You have not joined a build yet. Join one from the squadron or members’ boards and what it needs will appear here.'
            : 'Every build you are on has everything it asked for.'}
        </Empty>
      ) : (
        <Card>
          <p style={{ margin: '0 0 8px', fontSize: '12px', color: C.dim }}>
            {owed.rows.length} commodities · {owed.totalTonnes.toLocaleString('en-GB')} t to buy,
            across {owed.projects} build{owed.projects === 1 ? '' : 's'}. A commodity more than one
            build wants is marked — buy it in bulk and split the hold on arrival.
          </p>

          {owed.rows.map((row) => (
            <div
              key={row.commodity}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '8px',
                alignItems: 'baseline',
                padding: '5px 0',
                borderTop: `1px solid ${C.hairline}`,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span>
                <span style={{ color: C.text }}>{row.commodity}</span>
                {row.shared ? (
                  <span
                    style={{
                      marginLeft: '6px',
                      padding: '1px 5px',
                      border: `1px solid ${C.hairline}`,
                      borderRadius: '3px',
                      fontSize: '10px',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: C.dim,
                    }}
                  >
                    Shared
                  </span>
                ) : null}
                {/*
                  ★ THE SPLIT, NAMED ★

                  800 t across two builds is 800 t to BUY and not 800 t to hand to either of them.
                  A member who cannot see the breakdown fills a hold for one site and finds half of
                  it unwanted when they land — a wasted trip this screen caused.
                */}
                <div style={{ fontSize: '11px', color: C.faint, marginTop: '1px' }}>
                  {row.wantedBy
                    .map((w) => `${w.title} · ${w.tonnes.toLocaleString('en-GB')} t`)
                    .join('   ')}
                </div>
              </span>
              <span style={{ color: C.text }}>{row.tonnes.toLocaleString('en-GB')} t</span>
            </div>
          ))}
        </Card>
      )}
    </Section>
  );
}
