import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { OpRow } from '../hub-ops.js';
import { Button, C, Card, Empty, Problem, Section } from './ui.js';

/**
 * The operations board, in the app.
 *
 * ★ STANDBY IS NOT A REJECTION ★
 *
 * The rule the whole page is arranged around, mirroring the website. A full op does not turn
 * anybody away — it puts them behind whoever committed first, and a drop-out promotes the next in
 * order. So the button says what will actually happen: committing to a full op reads "Join the
 * standby queue", because being told you are on standby AFTER pressing "I'm in" feels like a
 * refusal even though it is precisely not one.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    readonly ops: {
      board(): Promise<Answer<{ ops: OpRow[] }>>;
      signUp(id: string, state: string): Promise<Answer<{ ok: true }>>;
      withdraw(id: string): Promise<Answer<{ ok: true }>>;
    };
  }
}

const TYPE_TEXT: Record<string, string> = {
  bgs: 'BGS', combat: 'Combat', mining: 'Mining', trade: 'Trade',
  exploration: 'Exploration', rescue: 'Rescue', social: 'Social', training: 'Training',
};

const STATE_TEXT: Record<string, string> = {
  yes: 'You are in',
  standby: 'You are on standby',
  maybe: 'You said maybe',
  no: 'You said no',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function OpsPage(): JSX.Element {
  const [ops, setOps] = useState<OpRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = (): void => {
    void window.ops.board().then((a) => {
      if (a.ok) { setOps(a.data.ops); setError(null); } else { setError(a.error); }
    });
  };

  useEffect(load, []);

  const act = (id: string, work: () => Promise<Answer<unknown>>): void => {
    setBusy(id);
    void work().then((a) => {
      setBusy(null);
      if (a.ok) load();
      else setError(a.error);
    });
  };

  if (error !== null) return <Problem>{error}</Problem>;
  if (ops === null) return <Empty>Reading the board…</Empty>;
  if (ops.length === 0) {
    return (
      <Empty>
        Nothing on the board. Wing leads post ops from the website's admin area and they appear here
        the moment they do.
      </Empty>
    );
  }

  return (
    <Section title="What is on">
      <div style={{ display: 'grid', gap: '8px' }}>
        {ops.map((op) => {
          /*
           * Whether committing NOW would seat them or queue them. Worked out here so the button can
           * say it rather than reporting it afterwards.
           */
          const full = op.capacity !== null && op.going >= op.capacity;

          return (
            <Card key={op.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                <strong style={{ color: C.text, fontSize: '14px' }}>
                  {op.title}
                  <span style={{ color: C.orangeBright, fontSize: '10px', letterSpacing: '0.12em', marginLeft: '8px' }}>
                    {(TYPE_TEXT[op.opType] ?? op.opType).toUpperCase()}
                  </span>
                </strong>
                <span style={{ color: C.dim, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                  {when(op.startsAt)}
                </span>
              </div>

              <p style={{ margin: '6px 0', color: C.dim, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: C.good }}>{op.going} going</span>
                {op.capacity === null ? ' · no limit' : ` of ${op.capacity}`}
                {/*
                  Shown even at zero when the op is full: an empty standby queue on a full op is the
                  most encouraging thing the row can say — you would be first.
                */}
                {op.standby > 0 || full ? ` · ${op.standby} on standby` : ''}
                {' · posted by '}{op.createdBy}
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <Button disabled={busy === op.id} onClick={() => act(op.id, () => window.ops.signUp(op.id, 'yes'))}>
                  {full && op.mine !== 'yes' ? 'Join the standby queue' : "I'm in"}
                </Button>
                <Button disabled={busy === op.id} onClick={() => act(op.id, () => window.ops.signUp(op.id, 'maybe'))}>
                  Maybe
                </Button>
                {op.mine !== null ? (
                  <Button disabled={busy === op.id} onClick={() => act(op.id, () => window.ops.withdraw(op.id))}>
                    Withdraw
                  </Button>
                ) : null}
                {op.mine !== null ? (
                  <span style={{
                    marginLeft: 'auto', fontSize: '12px',
                    color: op.mine === 'yes' ? C.good : op.mine === 'standby' ? C.warn : C.dim,
                  }}>
                    {STATE_TEXT[op.mine] ?? op.mine}
                  </span>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
