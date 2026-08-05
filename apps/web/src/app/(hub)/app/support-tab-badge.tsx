'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../../../lib/api-client';
import { useLiveEvent } from '../../../components/use-live-event';

/**
 * The waiting count on the Support TAB itself.
 *
 * ★ WHY THE TAB LABEL AND NOT JUST THE LINE INSIDE ★
 *
 * Officers get NO per-message notifications — the console badge is their entire bell. A count
 * that only exists once the tab is open is a bell you can only hear from inside the belfry: an
 * officer working the moderation queue would never know a guest had been waiting an hour. The
 * pill on the label is what makes "somebody answers" true without anybody camping the tab.
 *
 * The bell's own rules: capped at 99+ (three digits on a pill this size stop being a number and
 * start being noise), hidden entirely at zero, and updated live — the `support` SSE event fires
 * on every new message AND whenever a conversation is first opened, so one officer taking a
 * conversation clears it from every other officer's pill.
 *
 * Errors render as no pill, silently: a viewer without SUPPORT_AGENT is refused the count, and
 * an admin console tab must not decorate itself with somebody's error.
 */
export function SupportTabBadge() {
  const [waiting, setWaiting] = useState(0);

  const load = useCallback(() => {
    apiGet<{ waiting: number }>('/v1/support/console/badge')
      .then((r) => setWaiting(r.waiting))
      .catch(() => {
        // Refused or unreachable — either way there is nothing honest to show.
        setWaiting(0);
      });
  }, []);

  useEffect(load, [load]);
  useLiveEvent('support', load);

  if (waiting === 0) return null;

  return (
    <span
      aria-label={`${waiting} waiting`}
      className="ml-2 inline-block min-w-4 rounded-full bg-[var(--color-brand-orange)] px-1.5 text-center font-mono text-[9px] leading-4 tracking-normal text-[var(--color-text-on-accent)]"
    >
      {waiting > 99 ? '99+' : waiting}
    </span>
  );
}
