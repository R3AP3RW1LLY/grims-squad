'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../../../lib/api-client';
import { useLiveEvent } from '../../../components/use-live-event';

/**
 * The waiting count on the Suggestions TAB itself — the Support pill's shape, one tier up.
 *
 * ★ WHY THE TAB LABEL AND NOT JUST THE LIST INSIDE ★
 *
 * The webmaster gets no per-suggestion notifications — this pill is their entire bell. A count
 * that only exists once the tab is open is a bell audible only from inside the belfry: a
 * member's idea would sit unread until the webmaster happened to wander in. The pill on the
 * label is what makes "the webmaster reviews it" true without anybody camping the tab.
 *
 * The bell's own rules: capped at 99+ (three digits on a pill this size stop being a number and
 * start being noise), hidden entirely at zero, and updated live — the `suggestions` SSE event
 * fires on every new submission AND on every verdict, so one webmaster clearing the queue
 * clears it from every other webmaster's pill.
 *
 * Errors render as no pill, silently: a viewer without SITE_CONFIG — or without a fresh second
 * factor — is refused the count, and a console tab must not decorate itself with somebody's
 * error.
 */
export function SuggestionsTabBadge() {
  const [waiting, setWaiting] = useState(0);

  const load = useCallback(() => {
    apiGet<{ waiting: number }>('/v1/suggestions/inbox/badge')
      .then((r) => setWaiting(r.waiting))
      .catch(() => {
        // Refused or unreachable — either way there is nothing honest to show.
        setWaiting(0);
      });
  }, []);

  useEffect(load, [load]);
  useLiveEvent('suggestions', load);

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
