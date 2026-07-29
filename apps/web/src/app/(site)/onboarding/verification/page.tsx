import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ClockIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { getMe, getInaraStatus, getMyClaim } from '../../../../lib/api';
import { VerificationProvider } from '../../../(hub)/settings/commander/verification-state';
import { InaraForm } from '../../../(hub)/settings/commander/inara-form';
import { LiveRefresh } from '../../../../components/live-refresh';

export const metadata: Metadata = {
  title: "Waiting on verification — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Where a member waits until somebody confirms which commander they are.
 *
 * ★ A WAITING ROOM, NOT A DEAD END ★
 *
 * The member cannot verify themselves — that is the entire point of
 * verification — so this page cannot be a form that finishes the job. What it
 * CAN do is make the wait comprehensible: say what happens next, who does it,
 * roughly how long, and offer the one route that does not need anybody else.
 *
 * A page that just said "pending approval" would leave somebody with no idea
 * whether they had done something wrong, whether anyone knew they were waiting,
 * or whether to ask.
 *
 * ★ IT DESCRIBED THE INARA ROUTE AND GAVE NO WAY TO TAKE IT — AND THAT WAS A LOOP ★
 *
 * Reported from production, 2026-07-29: a non-admin reaches this page and has
 * nothing to paste a key into.
 *
 * The page listed "Link an Inara key" as one of two ways through. The only form
 * that does it lives at `/settings/commander?tab=verification`, which is inside
 * the hub — and the hub layout redirects anybody still owing onboarding straight
 * back to THIS page. So the member was told to link a key, and every route to
 * the form bounced them here. There was no way out that did not involve finding
 * an officer, which makes the second "way through" fictional.
 *
 * The form is on the page now. `InaraForm` and `VerificationProvider` are the
 * same components the settings page uses — the alternative was a second form
 * against the same endpoint, and two forms for one job drift.
 */
export default async function VerificationWaitPage() {
  const [me, inara, claim] = await Promise.all([getMe(), getInaraStatus(), getMyClaim()]);

  if (me.user === null) redirect('/v1/auth/discord?redirect=%2Fonboarding%2Fverification');

  // Not their step any more — either they owe something earlier, or they are
  // verified and this page has nothing to say. Bouncing on both keeps the wall
  // from becoming a loop.
  if (me.onboarding.step !== 'verification') {
    redirect(me.onboarding.path ?? '/dashboard');
  }

  const pending = claim?.pending ?? null;

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      {/*
        The API publishes `verification` to this member's own tabs the moment a
        key is accepted. That re-runs this server component, `me.onboarding.step`
        is no longer `verification`, and the redirect at the top of this function
        lets them through — so linking a key moves them on by itself rather than
        leaving them on a page that has just stopped applying to them.
      */}
      <LiveRefresh types={['verification']} />
      <div className="mx-auto max-w-[62ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-orange)]">
          Almost there
        </p>
        <h1
          className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          WAITING ON VERIFICATION
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        <div className="mt-8 flex items-start gap-4 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
          {pending === null ? (
            <ExclamationCircleIcon
              aria-hidden="true"
              className="size-8 shrink-0 text-[var(--color-semantic-warning)]"
            />
          ) : (
            <ClockIcon
              aria-hidden="true"
              className="size-8 shrink-0 text-[var(--color-brand-cyan-bright)]"
            />
          )}
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
              {pending === null ? 'Nothing claimed yet' : `Claimed as CMDR ${pending.cmdrName}`}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-primary)]">
              {pending === null
                ? 'Nobody has confirmed which commander you fly as. Until somebody does, your activity cannot be counted toward a rank, because we would not know whose it was.'
                : 'An officer has your claim and will confirm it. This is a person rather than a queue, so it usually happens the same evening.'}
            </p>
          </div>
        </div>

        <section aria-labelledby="how" className="mt-12">
          <h2
            id="how"
            className="text-xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            TWO WAYS THROUGH
          </h2>

          <div className="mt-6 space-y-6">
            <div className="rounded-lg border border-[var(--color-border-hairline)] p-5">
              <h3 className="text-[var(--color-text-primary)]">Ask an officer</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                Say hello in Discord and tell them your commander name. Any officer can confirm it,
                and it takes them about ten seconds. This is how most people do it.
              </p>
            </div>

            <div className="rounded-lg border border-[var(--color-brand-cyan-bright)] bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_6%,transparent)] p-5">
              <h3 className="text-[var(--color-text-primary)]">Link an Inara key</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                Automatic, immediate, and needs nobody else. We ask Inara who the key belongs to and
                verify you from their answer — you never type your own commander name, which is what
                makes it proof rather than a claim.
              </p>

              {/*
                ★ THE FORM ITSELF, NOT A LINK TO IT ★

                A link would go to `/settings/commander`, which is inside the hub,
                and the hub bounces anybody still owing onboarding back here. That
                is the loop this page shipped with.

                Rendered only when we could read the status: `InaraForm` needs one
                to know whether a key is already stored, and inventing a default
                would show "add a key" to somebody who has one.
              */}
              {inara === null ? (
                <p className="mt-4 rounded border border-dashed border-[var(--color-border-hairline)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                  We could not reach your commander details just now. Nothing is wrong with your
                  account — refresh in a moment, or ask an officer to verify you meanwhile.
                </p>
              ) : (
                <VerificationProvider initial={inara}>
                  <InaraForm />
                </VerificationProvider>
              )}
            </div>
          </div>
        </section>

        {/*
          Deliberately not a dead end. Somebody stuck here should be able to
          reach the people who can unstick them, and to leave without feeling
          they have been thrown out.
        */}
        <p className="mt-12 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          The public side of the site is still open to you —{' '}
          <a href="/roster" className="text-[var(--color-brand-cyan-bright)]">
            the roster
          </a>
          ,{' '}
          <a href="/companion" className="text-[var(--color-brand-cyan-bright)]">
            the companion app
          </a>{' '}
          and everything a visitor can see. This page will let you through the moment somebody
          confirms you.
        </p>
      </div>
    </main>
  );
}
