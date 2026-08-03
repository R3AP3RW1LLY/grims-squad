'use client';

import { useState } from 'react';

/**
 * Copies a system name to the clipboard.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "can we add copy buttons that are size appropriate so that we can copy the system the locations
 * are in so its easier to drop them into the galaxy / system maps please will make it easier to
 * just copy them out and paste into the game."
 *
 * ★ THE SYSTEM, NOT THE STATION ★
 *
 * The galaxy map searches for systems. A station name pasted into it finds nothing, and the two sit
 * next to each other everywhere on this site — so this takes the system deliberately, and the
 * button lives beside the system rather than beside the pair.
 *
 * ★ WHY IT SAYS "COPIED" RATHER THAN JUST DOING IT ★
 *
 * A clipboard write has no visible effect. Without feedback the only way to find out whether a
 * click registered is to alt-tab into the game and paste — which is the exact round trip this
 * exists to save. Two seconds is long enough to see and short enough not to linger.
 */
export function CopySystem({
  system,
  size = 'normal',
}: {
  system: string;
  /** `small` for inside a dense table row, where a full-size control would push the layout around. */
  size?: 'small' | 'normal';
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(system);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /*
       * Silent, and deliberately so. A clipboard write fails when the page is not the active
       * document or permission was refused, neither of which a member can act on — and an error
       * banner over a copy button would be louder than the feature.
       */
    }
  };

  const scale =
    size === 'small' ? 'px-1.5 py-0.5 text-[9px] tracking-[0.14em]' : 'px-2 py-1 text-[10px] tracking-[0.18em]';

  return (
    <button
      type="button"
      onClick={() => void copy()}
      // Named for a screen reader, which cannot see the icon or the tooltip.
      aria-label={`Copy ${system} to the clipboard`}
      title={copied ? 'Copied' : `Copy "${system}"`}
      className={
        `${scale} ml-2 shrink-0 rounded border font-mono uppercase align-middle transition-colors ` +
        (copied
          ? 'border-[var(--color-semantic-success)] text-[var(--color-semantic-success)]'
          : 'border-[var(--color-border-hairline)] text-[var(--color-text-dim)] ' +
            'hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]')
      }
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
