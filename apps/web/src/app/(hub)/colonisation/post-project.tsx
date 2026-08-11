'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '../../../lib/api-client';
import { SystemPicker } from '../../../components/system-picker';

/**
 * Posting a colonisation project.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * Asked where a project should come from, given the companion app sees every construction site a
 * member docks at: "Member posts it; journal then tracks it". So this form is the whole ceremony —
 * after it, nobody touches the project again and the journal keeps it current.
 *
 * ★ apiPost, NOT fetch ★
 *
 * `api-client.spec.ts` refuses a raw `fetch` in this directory, and it is right to: `apiPost`
 * attaches the CSRF token, retries once on a 401 after refreshing the session, and surfaces the
 * server's own error message instead of a generic failure. A hand-rolled call skips all three, and
 * the third is what turns "that site is already posted as X" into "something went wrong".
 */

const FIELD =
  'w-full rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] ' +
  'px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-subtle)]';

const LABEL =
  'font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]';

export function PostProject({
  canPostSquadron = false,
  from,
}: {
  canPostSquadron?: boolean;
  /**
   * The planned site this project realises, when the member came here from a plan.
   *
   * ★ WHY THE PLAN CANNOT JUST CREATE THE PROJECT — SQUADRON OWNER, 2026-08-10 ★
   *
   * A project needs the construction site's market id: it is how a depot event finds the project
   * again, and it does not exist until somebody places the site in the game. So a plan can prefill
   * the name and the system — everything it genuinely knows — and the market id is the one field
   * only the member can supply, which is why they are standing here at all.
   *
   * `planId`/`planSiteId` ride along so the server can point the planned site at the project it
   * became. That link is bookkeeping: if it fails the project is still posted.
   */
  from?: { planId: string; planSiteId: string; title: string; systemName: string } | undefined;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(form: FormData): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/v1/logistics/colony/projects', {
        owner: form.get('owner') === 'squadron' ? 'squadron' : 'personal',
        marketId: String(form.get('marketId') ?? '').trim(),
        systemName: String(form.get('systemName') ?? '').trim(),
        stationName: String(form.get('stationName') ?? '').trim(),
        title: String(form.get('title') ?? '').trim(),
        notes: String(form.get('notes') ?? '').trim(),
        ...(from === undefined ? {} : { planId: from.planId, planSiteId: from.planSiteId }),
      });
      // Refreshes the server component above rather than pushing a route: the new project belongs
      // on the board the member is already looking at.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The project could not be posted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="grid max-w-[720px] gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>What to call it</span>
          <input
            name="title"
            required
            placeholder="Ambrose Dock"
            defaultValue={from?.title ?? ''}
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>System</span>
          <SystemPicker
            name="systemName"
            required
            placeholder="HIP 58832"
            defaultValue={from?.systemName ?? ''}
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Station (if it has a name yet)</span>
          <input name="stationName" placeholder="Construction Site" className={FIELD} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Market id</span>
          <input
            name="marketId"
            required
            inputMode="numeric"
            placeholder="3706117632"
            className={FIELD}
          />
          {/*
            The join to reality: it is how the journal finds this project again. Said plainly,
            because a member who types the wrong one gets a project that silently never updates —
            which looks like the site being broken rather than a typo.
          */}
          <span className="text-[11px] text-[var(--color-text-secondary)]">
            Dock at the construction site and copy the id your companion app shows. Everything else
            fills itself in from there.
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Anything the squadron should know</span>
        <textarea
          name="notes"
          rows={2}
          placeholder="Short on steel, happy to refund fuel"
          className={FIELD}
        />
      </label>

      {canPostSquadron ? (
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <input type="checkbox" name="owner" value="squadron" />
          Post as a squadron project — the whole squadron hauls for it
        </label>
      ) : null}

      {error === null ? null : (
        <p className="m-0 rounded-md border border-[var(--color-semantic-hostile)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-[var(--color-semantic-hostile)]">
          {error}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] px-5 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)] disabled:opacity-60"
        >
          {busy ? 'Posting…' : 'Post the project'}
        </button>
      </div>
    </form>
  );
}
