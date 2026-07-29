'use client';

import { createContext, useContext, useRef, useState } from 'react';
import type { InaraStatus } from '../../../../lib/api';

/**
 * The one copy of "where this member's verification stands".
 *
 * ★ THERE WERE TWO, AND THEY DISAGREED ★
 *
 * `SquadronStatus` and `InaraForm` each did `useState(initial)`. Pasting a key
 * into the form proved the commander name and updated the FORM — while the
 * panel directly above it, which is the one that announces the verification
 * state in letters an inch high, went on saying "Not verified" until the page
 * was reloaded by hand.
 *
 * Two components holding private copies of one fact is the bug. There is one
 * copy now, and whichever panel learns something tells the other.
 *
 * ★ AND IT RE-SYNCS FROM THE SERVER ★
 *
 * `useState(initial)` takes its argument ONCE. Every later render is ignored —
 * which meant that even after `LiveRefresh` re-ran the server component and
 * handed down a freshly verified status, the browser kept rendering the stale
 * snapshot it captured on mount. The live stream was wired up and could not
 * possibly have had any visible effect.
 *
 * So a changed `initial` is adopted. This is React's documented way to adjust
 * state when a prop changes — setting during render, which React handles by
 * re-rendering this component immediately rather than committing the first
 * pass. It is not an effect: an effect would paint the stale value first, and
 * "Not verified" flashing over a verified account is exactly the moment a
 * member reaches for the refresh button.
 *
 * Compared by VALUE, not identity. The server sends a new object on every
 * refresh, so comparing references would reset local state — and any error
 * message with it — several times a minute.
 */

interface Verification {
  readonly status: InaraStatus;
  /** Called by whichever panel just learned something from the server. */
  readonly setStatus: (next: InaraStatus) => void;
}

const VerificationContext = createContext<Verification | null>(null);

export function VerificationProvider({
  initial,
  children,
}: {
  initial: InaraStatus;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState(initial);

  /*
   * The server snapshot this component last adopted.
   *
   * Held as the SERIALISED form so a re-render with an equal-but-new object is
   * a no-op. `InaraStatus` is a flat bag of strings, booleans and nulls — it
   * has no cycles and no undefined-vs-missing subtleties that would make this
   * comparison lie.
   */
  const adopted = useRef(JSON.stringify(initial));
  const incoming = JSON.stringify(initial);

  if (adopted.current !== incoming) {
    /*
     * ★ THE SERVER WINS ★
     *
     * A background sweep confirming the squadron, an officer verifying by hand,
     * or this member's own action in another tab — all arrive this way, and all
     * of them know more than the snapshot taken when this tab loaded.
     *
     * The window where this could discard a local edit does not exist: every
     * mutation here goes to the server and comes back as the new status, so the
     * local copy is never ahead of what the server would send.
     */
    adopted.current = incoming;
    setStatus(initial);
  }

  return (
    <VerificationContext.Provider value={{ status, setStatus }}>
      {children}
    </VerificationContext.Provider>
  );
}

/**
 * Reads the shared status.
 *
 * Throws rather than falling back to a default. A panel rendered outside the
 * provider would silently show one member's verification as unverified forever,
 * and a blank "Not verified" that never changes is far harder to notice in
 * review than a component that refuses to render at all.
 */
export function useVerification(): Verification {
  const ctx = useContext(VerificationContext);
  if (ctx === null) {
    throw new Error('useVerification must be used inside <VerificationProvider>.');
  }
  return ctx;
}
