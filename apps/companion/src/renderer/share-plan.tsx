import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, C, Problem } from './ui.js';

/**
 * Sharing a personal plan with the squadron — the app's half of the pair.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "we want to add a feature that allows users to make their plans available for the entire squadron
 * to view without it being a squadron plan etc."
 *
 * ★ THE CONSEQUENCE IS ON THE CONTROL ★
 *
 * Every member can read it and haul to any project it has spawned. Nobody else can change it. That
 * distinction is the whole feature, and a button labelled "Share" without it invites the wrong
 * assumption in either direction — that the plan is being handed over, or that sharing shows less
 * than it does.
 *
 * The hub refuses anybody who is not the author, so showing this at all is a rendering decision.
 * Offering a control that will be refused is how somebody concludes the app is broken.
 */
export function SharePlan({
  planId,
  shared,
  onChanged,
}: {
  planId: string;
  shared: boolean;
  /** Re-read the plan, so the header stops or starts saying it is shared. */
  onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (): void => {
    setBusy(true);
    setError(null);
    void window.colony.planSetVisibility(planId, !shared).then((a) => {
      setBusy(false);
      if (a.ok) onChanged();
      else setError(a.error);
    });
  };

  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
        <Button disabled={busy} onClick={toggle}>
          {busy ? 'Saving…' : shared ? 'Stop sharing with the squadron' : 'Share with the squadron'}
        </Button>
        {/*
          Present tense, next to the button. "Others can read this" is what somebody needs to weigh;
          "sharing is enabled" describes a setting rather than what it does.
        */}
        <span style={{ fontSize: '11px', color: C.faint }}>
          {shared
            ? 'Every member can read this plan and haul to its builds. Only you can change it.'
            : 'Only you can see this plan.'}
        </span>
      </div>

      {error === null ? null : (
        <div style={{ marginTop: '6px' }}>
          <Problem>{error}</Problem>
        </div>
      )}
    </div>
  );
}
