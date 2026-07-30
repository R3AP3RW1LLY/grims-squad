'use client';

import { useState } from 'react';
import { apiCall } from '../../../../../lib/api-client';

/**
 * The "notify me" button.
 *
 * Squadron owner, 2026-07-30: "we do want to add is a notify me button, and give people the option
 * to get notified via Discord DM to them when the post is commented on."
 *
 * ★ TWO SEPARATE THINGS, AND CONFLATING THEM IS THE TRAP ★
 *
 * Pressing this creates a SUBSCRIPTION — you will hear about replies. WHERE you hear about them is
 * a different question, answered once in settings: in-app always, Discord DM only if you asked for
 * that separately.
 *
 * Building it as one control would mean either silently opting somebody into DMs by pressing a
 * button that does not say so, or making them configure Discord every time they follow a thread.
 * So the button follows the thread and says plainly where the result will appear.
 */
export function NotifyMe({
  threadId,
  initialLevel,
  dmEnabled,
}: {
  readonly threadId: string;
  readonly initialLevel: 'watching' | 'muted' | 'none';
  /** Whether this member has opted into Discord DMs for watched threads. Presentation only. */
  readonly dmEnabled: boolean;
}) {
  const [level, setLevel] = useState(initialLevel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watching = level === 'watching';

  async function set(next: 'watching' | 'none') {
    setBusy(true);
    setError(null);
    /*
     * Optimistic. Following a thread is trivially reversible and the round trip is otherwise the
     * whole interaction — a button that sits still for 300ms reads as broken. Reverted on failure.
     */
    const previous = level;
    setLevel(next);
    try {
      await apiCall('PUT', `/v1/forum/threads/${encodeURIComponent(threadId)}/subscription`, {
        body: { level: next },
      });
    } catch (e) {
      setLevel(previous);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void set(watching ? 'none' : 'watching')}
        disabled={busy}
        aria-pressed={watching}
        className={`w-full rounded border px-3 py-2 text-sm transition-colors disabled:opacity-60 ${
          watching
            ? 'border-[var(--color-border-active)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
            : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        {busy ? 'Saving…' : watching ? 'Notifying you' : 'Notify me'}
      </button>

      <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
        {watching ? (
          dmEnabled ? (
            <>You will get a Discord DM when somebody replies here.</>
          ) : (
            <>
              {/*
                Says WHERE the notification will appear, and offers the other option rather than
                assuming. Somebody who pressed this expecting a DM should find out now, not by not
                receiving one.
              */}
              New replies will appear in your notifications.{' '}
              <a
                href="/settings/notifications"
                className="text-[var(--color-brand-cyan-bright)] underline underline-offset-2"
              >
                Turn on Discord DMs
              </a>{' '}
              if you would rather have them there.
            </>
          )
        ) : (
          <>You are not following this thread.</>
        )}
      </p>

      {error !== null && (
        <p role="alert" className="text-xs text-[var(--color-brand-orange-bright)]">
          {error}
        </p>
      )}
    </div>
  );
}
