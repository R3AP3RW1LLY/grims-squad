import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { C, Card, Empty, Problem, Section, Stat, Tabs, inputStyle } from './ui.js';
import type { MiningRing, MiningSession } from '../hub-mining.js';

/**
 * Mining, in the app.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "this should be available in our companion app ... the theme, brand and styles must also match
 * our exsiting!"
 *
 * ★ WHAT THIS PAGE IS FOR, GIVEN THE OVERLAYS EXIST ★
 *
 * The overlays answer "is this rock worth shooting" while the member is flying. This page answers
 * the two questions that come before and after: where should I go tonight, and what did last night
 * come to. Neither can be worked out on this machine — one needs every member's limpets, the other
 * needs the sessions the hub has banked.
 *
 * Mirrors the website's /mining page, entry for entry, because a member reading the ring survey in
 * one place and not the other is exactly the split the owner has objected to before.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    readonly mining: {
      rings(material?: string, days?: number): Promise<Answer<{ rings: MiningRing[] }>>;
      sessions(): Promise<Answer<{ sessions: MiningSession[] }>>;
    };
  }
}

function when(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ROW: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 7rem 5rem 5rem 5rem',
  gap: '10px',
  padding: '7px 0',
  borderTop: `1px solid ${C.subtle}`,
  alignItems: 'center',
};

const HEAD: JSX.CSSProperties = {
  ...ROW,
  borderTop: 'none',
  fontSize: '10px',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: C.dim,
  fontFamily: 'var(--font-mono)',
};

const NUM: JSX.CSSProperties = {
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
};

function Rings(): JSX.Element {
  const [material, setMaterial] = useState('');
  const [answer, setAnswer] = useState<Answer<{ rings: MiningRing[] }> | null>(null);

  useEffect(() => {
    let live = true;
    /*
     * Debounced, because this is a text box and the query behind it groups the largest table on
     * the platform. Firing per keystroke would ask the hub to re-aggregate every rock in a
     * fortnight for "P", "Pa", "Pai" and so on, all of them thrown away.
     */
    const timer = setTimeout(() => {
      void window.mining.rings(material.trim() === '' ? undefined : material.trim()).then((a) => {
        if (live) setAnswer(a);
      });
    }, 300);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [material]);

  return (
    <div>
      <Card>
        <p style={{ margin: '0 0 10px', fontSize: '12px', color: C.dim }}>
          Measured from rocks squadron members actually prospected in the last fortnight — not from
          a wiki, and not from one commander&rsquo;s good night. Turn on mining telemetry and your
          own rocks join the survey.
        </p>
        <input
          type="text"
          placeholder="Any material — or name one"
          value={material}
          onInput={(e) => setMaterial((e.target as HTMLInputElement).value)}
          style={inputStyle}
          aria-label="Filter rings by material"
        />
      </Card>

      {answer === null ? null : !answer.ok ? (
        <Problem>{answer.error}</Problem>
      ) : answer.data.rings.length === 0 ? (
        <Empty>
          No rings measured yet
          {material.trim() === '' ? '' : ` for ${material.trim()}`}. This table is built from
          members&rsquo; own limpets, so it fills as the squadron flies.
        </Empty>
      ) : (
        <Card>
          <div style={HEAD}>
            <span>Ring</span>
            <span>Running</span>
            <span style={NUM}>Worth it</span>
            <span style={NUM}>Best</span>
            <span style={NUM}>Rocks</span>
          </div>
          {answer.data.rings.map((r) => (
            <div key={`${r.system}/${r.body}`} style={ROW}>
              <span>
                {r.body}
                <span style={{ display: 'block', fontSize: '11px', color: C.dim }}>{r.system}</span>
              </span>
              <span style={{ fontSize: '12px' }}>{r.topMaterial}</span>
              <span style={{ ...NUM, color: C.orange }}>{r.hitRate.toFixed(0)}%</span>
              <span style={NUM}>{r.bestPercent.toFixed(1)}%</span>
              <span style={NUM}>{r.rocks.toLocaleString()}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Sessions(): JSX.Element {
  const [answer, setAnswer] = useState<Answer<{ sessions: MiningSession[] }> | null>(null);

  useEffect(() => {
    let live = true;
    void window.mining.sessions().then((a) => {
      if (live) setAnswer(a);
    });
    return () => {
      live = false;
    };
  }, []);

  if (answer === null) return <div />;
  if (!answer.ok) return <Problem>{answer.error}</Problem>;
  if (answer.data.sessions.length === 0) {
    return (
      <Empty>
        No mining evenings recorded yet. Turn on mining telemetry in Settings and your rocks and
        refined tonnes are banked here as you fly them.
      </Empty>
    );
  }

  const total = answer.data.sessions.reduce((sum, s) => sum + s.points, 0);
  const tonnes = answer.data.sessions.reduce((sum, s) => sum + s.tonnes, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        <Stat label="Evenings" value={String(answer.data.sessions.length)} />
        <Stat label="Refined" value={`${tonnes.toLocaleString()} t`} />
        <Stat label="Deep Core" value={total.toLocaleString()} />
      </div>

      <Card>
        <div style={HEAD}>
          <span>Ring</span>
          <span>Evening</span>
          <span style={NUM}>Rocks</span>
          <span style={NUM}>Refined</span>
          <span style={NUM}>Points</span>
        </div>
        {answer.data.sessions.map((s) => (
          <div key={s.id} style={ROW}>
            <span>
              {s.ring ?? '—'}
              {s.system === null ? null : (
                <span style={{ display: 'block', fontSize: '11px', color: C.dim }}>{s.system}</span>
              )}
            </span>
            <span style={{ fontSize: '12px' }}>{when(s.startedAt)}</span>
            <span style={NUM}>
              {s.rocks.toLocaleString()}
              {/*
                The share needs rocks to divide by. A dash rather than "0%" for a session with
                none: zero reads as "you mined badly", where the truth is "nothing to measure".
              */}
              <span style={{ display: 'block', fontSize: '11px', color: C.dim }}>
                {s.rocks === 0 ? '—' : `${Math.round((s.hits / s.rocks) * 100)}% worth it`}
              </span>
            </span>
            <span style={NUM}>{s.tonnes.toLocaleString()} t</span>
            <span style={{ ...NUM, color: C.orange }}>{s.points.toLocaleString()}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

export function MiningPage(): JSX.Element {
  const [tab, setTab] = useState<'rings' | 'sessions'>('rings');

  return (
    <Section title="Mining">
      <Tabs
        current={tab}
        onChange={setTab}
        label="Mining sections"
        tabs={[
          { key: 'rings', label: 'Rings' },
          { key: 'sessions', label: 'Your evenings' },
        ]}
      />
      <div style={{ marginTop: '16px' }}>
        {tab === 'rings' ? <Rings /> : null}
        {tab === 'sessions' ? <Sessions /> : null}
      </div>
    </Section>
  );
}
