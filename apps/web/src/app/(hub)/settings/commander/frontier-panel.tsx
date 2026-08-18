import Link from 'next/link';
import type { FrontierLinkStatus } from '../../../../lib/api';
import { Section } from '../../../../components/hub-page';

/**
 * The Frontier connection, and the way back to it.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * "i just got an error on my pc saying frontier failed to authenticate ... we need the ability to
 * re connect from the companion app and website settings pages please!"
 *
 * ★ THE WEBSITE OWNED THIS FLOW AND NEVER MENTIONED IT ★
 *
 * Frontier's callback lands on this site. It has always landed on this site — on
 * `/settings/privacy?frontier=connected`, a page with no Frontier content of any kind. A member
 * who had just authorised at Frontier was returned to a screen of privacy switches with a query
 * string nothing read, and no way to tell whether it had worked.
 *
 * The callback now lands here, on the tab about how this account is verified, next to Inara — the
 * other thing that proves who somebody is. And this panel reads the outcome, so finishing at
 * Frontier ends with a sentence about what happened rather than with silence.
 *
 * ★ THE BUTTON IS NEVER HIDDEN ★
 *
 * Not conditional on the link looking broken, for the reason written out in the companion's
 * `frontierAccount`: for a fortnight this platform reported seven healthy Frontier links that did
 * not work, because a token was being decoded wrong on the way out of the database. Every one of
 * those days, this panel would have said "Connected — 22 days left" and hidden the one control
 * that fixes it. Reconnecting costs one sign-in and is never harmful; hiding it has a track record.
 */

export type FrontierOutcome = 'connected' | 'cancelled' | 'failed' | null;

export function readFrontierOutcome(value: string | string[] | undefined): FrontierOutcome {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'connected' || raw === 'cancelled' || raw === 'failed' ? raw : null;
}

export function FrontierPanel({
  status,
  outcome,
}: {
  /**
   * Three states, all different. A `FrontierLinkStatus` is an answer about a link; `null` is an
   * answer that there has never been one; `undefined` is the API not answering, which must never
   * be rendered as either of the others.
   */
  status: FrontierLinkStatus | null | undefined;
  outcome: FrontierOutcome;
}) {
  const never = status === null;
  const unknown = status === undefined;
  const dead = status != null && !status.linked;

  const heading = unknown
    ? 'We could not check your Frontier connection'
    : never
      ? 'Not connected to Frontier'
      : dead
        ? 'Your Frontier connection has run out'
        : 'Connected to Frontier';

  const tone = unknown
    ? 'text-[var(--color-text-secondary)]'
    : never || dead
      ? 'text-[var(--color-semantic-warning)]'
      : 'text-[var(--color-semantic-success)]';

  return (
    <Section title="Frontier account">
      {/*
        The result of a round trip to Frontier, when there was one. Above the state rather than
        below it, because it is the newer fact — somebody who just pressed cancel wants to see that
        acknowledged before they read what their link looks like.
      */}
      {outcome !== null && (
        <p
          className="mb-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel-raised)] px-4 py-3 text-sm"
          role="status"
        >
          {outcome === 'connected'
            ? 'Frontier sign-in complete. Your connection is set up below.'
            : outcome === 'cancelled'
              ? 'You cancelled the Frontier sign-in. Nothing changed.'
              : 'Frontier could not complete that sign-in. Trying again usually clears it.'}
        </p>
      )}

      <p className={`text-sm font-medium ${tone}`}>{heading}</p>

      {/*
        The API's own sentence about its own clock, where it has one. This page deliberately does
        not compute "days left" from a date it holds — two opinions about one deadline is how the
        site and the companion app end up telling a member different things about the same link.
      */}
      {status != null && status.sentence !== '' && (
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{status.sentence}</p>
      )}

      <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Connecting your Frontier account is how the squadron sees your ships, your cargo and your
        fleet carrier when the companion app cannot read your journals — which is every commander
        playing on GeForce Now or another cloud service. Frontier asks you to sign in again about
        every 25 days.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href="/connect/frontier"
          className="inline-flex items-center rounded-md bg-[var(--color-brand-orange)] px-4 py-2 text-sm font-medium text-[var(--color-text-on-accent)] transition hover:opacity-90"
          prefetch={false}
        >
          {never ? 'Connect with Frontier' : 'Reconnect with Frontier'}
        </Link>
        <span className="text-xs text-[var(--color-text-dim)]">
          Opens Frontier&rsquo;s sign-in page. Your Frontier password never reaches us.
        </span>
      </div>

      {/*
        Said out loud on the panel that offers the button, because the alternative is a member
        working out from the absence of an error that reconnecting was safe. It is the sentence
        somebody needs before they press a button on an account that currently works.
      */}
      <p className="mt-3 max-w-[65ch] text-xs text-[var(--color-text-secondary)]">
        Reconnecting is safe at any time — it replaces the permission we hold and nothing else. If
        your ships or carrier cargo have stopped updating, it is the first thing to try.
      </p>
    </Section>
  );
}
