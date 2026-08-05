'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../../../lib/api-client';

/**
 * How many training images are waiting, on the tab itself.
 *
 * ★ THE QUEUE HAD NO DOOR, SO IT CERTAINLY HAD NO BELL ★
 *
 * Members submit screenshots and the uploader tells them an officer will look. Until now nothing
 * on the platform could list what they sent, so "an officer will look" was true only in the sense
 * that nobody had ruled it out. A tab alone would fix that and still leave reviewing as something
 * you have to remember to go and do — which is how a queue silently grows to a hundred.
 *
 * Same shape as the support badge deliberately: an officer already reads that pill as "there is
 * work here", and a second kind of indicator for the same idea would just be a thing to learn.
 *
 * ★ NO LIVE EVENT, AND THAT IS THE HONEST CHOICE ★
 *
 * Support refreshes on an SSE `support` event because a guest waiting on a reply is measured in
 * minutes. A training image is not: it waits days, it is reviewed in batches, and publishing a
 * server event per upload would add a channel to keep correct for a number nobody is watching
 * second by second. It loads when the console loads. That is the right resolution for this queue.
 *
 * Errors render as no pill, silently — a viewer without AI_TRAINING is refused the count, and a
 * console tab must never decorate itself with somebody's error.
 */
export function TrainingImagesTabBadge() {
  const [waiting, setWaiting] = useState(0);

  const load = useCallback(() => {
    apiGet<{ waiting: number }>('/v1/ai/corpus/queue/badge')
      .then((r) => setWaiting(r.waiting))
      .catch(() => {
        // Refused or unreachable — either way there is nothing honest to show.
        setWaiting(0);
      });
  }, []);

  useEffect(load, [load]);

  if (waiting === 0) return null;

  return (
    <span
      aria-label={`${waiting} waiting for review`}
      className="ml-2 inline-block min-w-4 rounded-full bg-[var(--color-brand-orange)] px-1.5 text-center font-mono text-[9px] leading-4 tracking-normal text-[var(--color-text-on-accent)]"
    >
      {waiting > 99 ? '99+' : waiting}
    </span>
  );
}
