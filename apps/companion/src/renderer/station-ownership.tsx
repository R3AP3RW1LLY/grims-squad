import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, C, Card, Empty, Problem, Section, inputStyle } from './ui.js';
import { SystemPicker } from './system-picker.js';
import type { StationClaim } from '../hub-colony.js';

/**
 * Which stations the squadron holds, said by an officer.
 *
 * ★ THE MIRROR IS THE OWNER'S RULE — SQUADRON OWNER, 2026-08-03 ★
 *
 * "ensure the Companion app matches and has all the same pages in colonization that the website has
 * please! must be a mirror!"
 *
 * `colonisation-mirror.spec.ts` compares the two menus label for label and fails the build when one
 * grows a page the other has not. Adding the website's ownership page without this screen broke it,
 * and weakening that spec was the tempting fix and the wrong one: it exists because the owner has
 * objected to the two menus drifting twice.
 *
 * ★ THE HUB DECIDES WHO MAY, NOT THIS ★
 *
 * Officer-only, enforced on COLONY_MANAGE at the hub on all three routes. This screen shows the
 * hub's own refusal rather than pre-judging it from a rights flag — the app can be holding a stale
 * copy of that flag, and a page that hides itself wrongly is indistinguishable from one that is
 * broken.
 */


export function StationOwnershipPage(): JSX.Element {
  const [claims, setClaims] = useState<readonly StationClaim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stationName, setStationName] = useState('');
  const [systemName, setSystemName] = useState('');
  const [ownership, setOwnership] = useState<'squadron' | 'member'>('squadron');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    const answer = await window.colony.stationClaims();
    if (answer.ok) {
      setClaims(answer.data.claims);
      setError(null);
    } else {
      setError(answer.error);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async (): Promise<void> => {
    setBusy(true);
    const answer = await window.colony.claimStation({
      stationName,
      systemName,
      ownership,
      ...(note.trim() === '' ? {} : { note }),
    });
    setBusy(false);
    if (answer.ok) {
      setStationName('');
      setNote('');
      setError(null);
      await load();
    } else {
      setError(answer.error);
    }
  };

  const withdraw = async (key: string): Promise<void> => {
    setBusy(true);
    const answer = await window.colony.withdrawStationClaim(key);
    setBusy(false);
    if (answer.ok) await load();
    else setError(answer.error);
  };

  // A failed first load must not sit on nothing for ever — the hub's own sentence is shown, which
  // for a member without COLONY_MANAGE is the refusal that explains why this page is empty.
  if (error !== null && claims === null) {
    return (
      <Section title="Station ownership">
        <Problem>{error}</Problem>
      </Section>
    );
  }

  const live = (claims ?? []).filter((c) => c.withdrawnAt === null);
  const past = (claims ?? []).filter((c) => c.withdrawnAt !== null);

  return (
    <Section title="Station ownership">
      <p style={{ margin: '0 0 14px', maxWidth: '70ch', fontSize: '12px', color: C.dim }}>
        Which stations count as ours when the platform picks where to send somebody shopping.
        Stations the squadron built through colonisation already count without a claim — this is for
        the ones we hold but did not build here, and for correcting the automatic answer when it is
        wrong.
      </p>

      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: C.dim }}>
              Station
            </span>
            <input
              value={stationName}
              onInput={(e) => setStationName((e.target as HTMLInputElement).value)}
              placeholder="Wescott Platform"
              style={{ ...inputStyle, width: '200px' }}
            />
          </label>

          {/*
            A picker, not a text box, for the same reason the purchase declaration uses one: system
            names are procedurally generated, and a typo produces a claim against a station that
            does not exist — which stores cleanly, lists cleanly, and changes no ordering at all.
          */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: C.dim }}>
              System
            </span>
            <SystemPicker value={systemName} onValueChange={setSystemName} placeholder="its system" />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: C.dim }}>
              Whose
            </span>
            <select
              value={ownership}
              onChange={(e) =>
                setOwnership((e.target as HTMLSelectElement).value === 'member' ? 'member' : 'squadron')
              }
              style={inputStyle}
            >
              <option value="squadron">The squadron’s</option>
              <option value="member">A member’s</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: C.dim }}>
              Why (optional)
            </span>
            <input
              value={note}
              onInput={(e) => setNote((e.target as HTMLInputElement).value)}
              placeholder="held since the war"
              style={{ ...inputStyle, width: '200px' }}
            />
          </label>

          <Button
            tone="primary"
            onClick={() => void submit()}
            disabled={busy || stationName.trim() === '' || systemName.trim() === ''}
          >
            {busy ? 'Saving…' : 'Claim it'}
          </Button>
        </div>
      </Card>

      {error !== null ? <Problem>{error}</Problem> : null}

      <div style={{ marginTop: '18px' }}>
        {live.length === 0 ? (
          <Empty>
            No claims yet. Stations the squadron built through colonisation already count as ours
            without one.
          </Empty>
        ) : (
          live.map((c) => (
            <Card key={c.stationKey}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '4px 16px',
                }}
              >
                <span style={{ fontSize: '13px', color: C.text }}>
                  {c.stationName}
                  <span style={{ marginLeft: '8px', fontSize: '11px', color: C.dim }}>
                    {c.ownership === 'squadron' ? 'the squadron’s' : 'a member’s'}
                    {c.note === null ? '' : ` — ${c.note}`}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: C.faint }}>
                  {c.claimedBy ?? 'an officer'}
                  <Button onClick={() => void withdraw(c.stationKey)} disabled={busy}>
                    Withdraw
                  </Button>
                </span>
              </div>
            </Card>
          ))
        )}
      </div>

      {/*
        ★ WITHDRAWN CLAIMS ARE SHOWN, NOT HIDDEN ★

        The schema keeps them deliberately: "A deleted row would lose the argument; a dated one
        settles it." Hiding them here would lose the argument by another route — this is the one
        screen where "who said this was ours, and who took it back" is the question being asked.
      */}
      {past.length === 0 ? null : (
        <div style={{ marginTop: '18px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: C.dim }}>
            Withdrawn
          </p>
          {past.map((c) => (
            <p key={c.stationKey} style={{ margin: '0 0 4px', fontSize: '11px', color: C.faint }}>
              {c.stationName} — claimed by {c.claimedBy ?? 'an officer'}, withdrawn
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}
