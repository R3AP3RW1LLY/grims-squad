'use client';

import { useEffect } from 'react';
import { apiCall } from '../../../../lib/api-client';
import { NicknameChooser, type NicknameState } from '../../../../components/nickname-chooser';

/**
 * The onboarding wrapper around the shared chooser.
 *
 * ★ MARKED SEEN ON ARRIVAL, NOT ON A BUTTON ★
 *
 * Same as the companion step. The gate holds anybody who has not been shown this, so marking it
 * only when they press something would trap an officer who closed the tab — they would meet the
 * same page on every sign-in, forever, which is how an offer becomes an obstacle.
 *
 * Seeing it IS the step. What they decide is their own business and is recorded separately.
 */
export function NicknameStep({ initial }: { readonly initial: NicknameState }) {
  useEffect(() => {
    // Best effort. Failing to record that somebody saw a page must never stop them using it — the
    // worst case is being offered the choice once more.
    void apiCall('POST', '/v1/me/onboarding/nickname').catch(() => undefined);
  }, []);

  return <NicknameChooser initial={initial} onDone="/dashboard" />;
}
