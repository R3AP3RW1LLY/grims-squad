'use client';

import { useState } from 'react';
import { apiDelete } from '../lib/api-client';

/**
 * Says, on every page, that the site is being previewed as another rank.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "a way for the webmaster and officers to visually spoof a rank and physically see what they see
 * in the web app so we can verify that everything is working on that front"
 *
 * ★ WITHOUT THIS, A PREVIEW IS INDISTINGUISHABLE FROM AN OUTAGE ★
 *
 * The whole point is that the site behaves as a Cadet's does: the admin section leaves the sidebar,
 * pages start refusing, buttons disappear. That is correct, and it is EXACTLY what somebody would
 * report as "I have lost all my permissions" if nothing on screen accounted for it.
 *
 * So it is loud, it is on every page, and it carries its own way out. It sits above the top bar
 * rather than inside it, because a preview is a state the whole page is in, not a control.
 *
 * ★ THE EXIT NEEDS NO PERMISSION ★
 *
 * Deliberate, and the reason the API keeps `/v1/admin/view-as` outside its permission gate: while
 * previewing as a Cadet you do not hold ROLE_MANAGE, so a gated exit would refuse the one button
 * that gets you out.
 */
export function ViewAsBanner({ roleName }: { roleName: string }) {
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function leave() {
    setLeaving(true);
    setProblem(null);
    try {
      await apiDelete('/v1/admin/view-as');
      /*
       * A full reload, not a router refresh. The preview changes what the SERVER renders — nav,
       * page gating, every permission check — so the whole document has to come back. A client-side
       * refresh would leave half the page previewing.
       */
      window.location.reload();
    } catch (e) {
      setLeaving(false);
      setProblem(e instanceof Error ? e.message : 'Could not leave the preview.');
    }
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_22%,var(--color-surface-void))] px-4 py-2 text-center"
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-orange-bright)]">
        Viewing as {roleName}
      </span>
      <span className="text-xs text-[var(--color-text-secondary)]">
        Read only — nothing can be changed until you leave.
      </span>
      <button
        type="button"
        onClick={() => void leave()}
        disabled={leaving}
        className="rounded border border-[var(--color-brand-orange)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_20%,transparent)] disabled:opacity-50"
      >
        {leaving ? 'Leaving…' : 'Leave preview'}
      </button>
      {problem !== null && (
        <span className="text-xs text-[var(--color-semantic-hostile-bright)]">{problem}</span>
      )}
    </div>
  );
}
