'use client';

import { useState } from 'react';
import { apiCall } from '../../../../lib/api-client';
import type { InaraStatus } from './inara-form';

/**
 * Where a member stands: name, squadron, or both.
 *
 * ★ THREE STATES, BECAUSE THERE ARE GENUINELY THREE ★
 *
 *   unverified   no proven commander name
 *   partial      name proven, squadron not confirmed
 *   verified     both
 *
 * `partial` is the one that matters. It is the honest description of somebody
 * who has done everything asked and is waiting on Inara — folding it into
 * "unverified" would tell them their proof had failed when it had not, and
 * folding it into "verified" would admit people who are not in the squadron.
 *
 * ★ THE CHECKBOX GRANTS NOTHING ★
 *
 * Ticking it records a CLAIM and asks Inara again. Inara is what confirms
 * membership; the claim only decides whether it is worth spending a request
 * from a budget of two a minute asking about this member at all. Somebody who
 * ticks it without joining stays exactly where they were.
 */

function Badge({ tone, children }: { tone: 'ok' | 'wait' | 'no'; children: React.ReactNode }) {
  const styles = {
    ok: 'border-[var(--color-semantic-success)] text-[var(--color-semantic-success)]',
    wait: 'border-[var(--color-semantic-warning)] text-[var(--color-semantic-warning)]',
    no: 'border-[var(--color-text-secondary)] text-[var(--color-text-secondary)]',
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] ${styles}`}
    >
      {/*
        A glyph as well as a colour. A coloured border alone is nothing to
        anybody who cannot distinguish it, and this is the single most important
        piece of state on the page.
      */}
      <span aria-hidden="true">{tone === 'ok' ? '✓' : tone === 'wait' ? '◐' : '○'}</span>
      {children}
    </span>
  );
}

export function SquadronStatus({ initial }: { initial: InaraStatus }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = status.squadronStatus ?? 'unverified';
  const expected = status.expectedSquadron ?? "Grim's Squad";

  async function claim(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      /*
       * The server returns the full STATUS, not just an acknowledgement, so the
       * page reflects the immediate re-check without a reload. A member who
       * joined a moment ago sees "verified" the instant they tick the box.
       */
      const next = await apiCall<InaraStatus>('POST', '/v1/me/inara/squadron-claim');
      setStatus(next);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not reach the server. Your answer was not recorded — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    /*
      ★ THE ONLY BOX ON THIS PAGE THAT REPORTS VERIFICATION STATE ★

      There were three: a `VerificationBadge`, this panel, and a block inside
      the key form — all announcing "Verified commander / CMDR X". Worse than
      repetitive: the badge called somebody VERIFIED on the strength of their
      NAME alone, while this panel, which also knows about the squadron, said
      partially verified. Two boxes, one page, contradicting each other about
      the single most important fact on it.

      Every state lives here now, unverified through to verified. The key form
      below owns the KEY and nothing else.

      The border takes the state's colour, so the answer is legible before a
      word is read — and it is a border rather than a fill, because a solid
      green panel would shout at somebody whose account is simply fine.
    */
    <section
      className={`mb-8 rounded border p-5 ${
        state === 'verified'
          ? 'border-[var(--color-semantic-success)] bg-[color-mix(in_srgb,var(--color-semantic-success)_7%,transparent)]'
          : state === 'partial'
            ? 'border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_6%,transparent)]'
            : 'border-[var(--color-border-hairline)]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">
          Commander verification
        </p>
        {state === 'verified' && <Badge tone="ok">Verified commander</Badge>}
        {state === 'partial' && <Badge tone="wait">Partially verified</Badge>}
        {state === 'unverified' && <Badge tone="no">Not verified</Badge>}
      </div>

      {/*
        The commander name, large, as soon as there is one to show. This is what
        the removed badge existed for and it is the thing a member came to see —
        it belongs at the top of the one box that owns the state, not in a
        second box below it.
      */}
      {status.cmdrName !== null && (
        <p
          className="mt-3 text-2xl text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          CMDR {status.cmdrName.toUpperCase()}
        </p>
      )}

      {/* ------------------------------------------------------- unverified */}
      {state === 'unverified' && (
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Nobody has confirmed which commander is yours yet. Add an Inara key below and we read
          your commander name AND your squadron from Inara in one step — you never type either of
          them here. An officer can also verify you by hand; both end in the same place.
        </p>
      )}

      {/* ----------------------------------------------------------- partial */}
      {state === 'partial' && (
        <>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-primary)]">
            <span className="text-[var(--color-semantic-success)]">Your name is proven.</span>{' '}
            {/*
              ★ THREE DIFFERENT THINGS, NOT ONE MESSAGE ★

              This said "Inara does not show you in Grim's Squad yet" in every
              case — including when we had NEVER ASKED. A member who is plainly
              in the squadron was told Inara disagreed, which is a claim about
              Inara we had no basis for, and it sent them looking for a problem
              on Inara's side that did not exist.

              Naming the squadron they ARE in matters for the same reason:
              somebody in the wrong squadron and somebody in none need different
              things from this page, and only one of them is about to apply.
            */}
            {status.squadronCheckedAt == null ? (
              <>
                We have not checked your squadron yet. Use <strong>Re-check now</strong> below, or
                tick the box if you have applied to <strong>{expected}</strong>.
              </>
            ) : status.inaraSquadron != null && status.inaraSquadron !== '' ? (
              <>
                Inara has you in <strong>{status.inaraSquadron}</strong>, which is not{' '}
                <strong>{expected}</strong>.
              </>
            ) : (
              <>
                Inara does not show you in <strong>{expected}</strong> yet.
              </>
            )}
          </p>

          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            <li>
              Open{' '}
              <a
                href="https://inara.cz/elite/squadrons-search/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-brand-cyan-bright)] underline"
              >
                Inara&rsquo;s squadron search
              </a>{' '}
              and apply to join <strong>{expected}</strong>.
            </li>
            <li>Wait for an officer to accept your application on Inara.</li>
            <li>Tick the box below. We will check straight away, and keep checking.</li>
          </ol>

          <div className="mt-5 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={status.squadronClaimed === true}
                disabled={busy || status.squadronClaimed === true}
                onChange={() => void claim()}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-cyan-bright)]"
              />
              <span className="text-[var(--color-text-primary)]">
                I have applied to join {expected} on Inara.
                <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
                  This does not verify you — Inara does. It tells us to start checking.
                </span>
              </span>
            </label>

            {status.squadronClaimed === true && (
              <p className="mt-3 border-t border-[var(--color-border-hairline)] pt-3 text-xs text-[var(--color-text-secondary)]">
                {/*
                  Says what happens NEXT and when. "We are checking" with no
                  interval is the sort of message that makes somebody reload a
                  page for an hour.
                */}
                We are re-checking Inara every 20 minutes. You do not need to stay on this page —
                you will be verified automatically once Inara shows you in {expected}.
                {status.squadronCheckedAt != null && (
                  <>
                    {' '}
                    Last checked{' '}
                    {new Date(status.squadronCheckedAt).toLocaleString('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    .
                  </>
                )}
              </p>
            )}

            {busy && (
              <p className="mt-3 text-xs text-[var(--color-brand-cyan-bright)]">
                Asking Inara now&hellip;
              </p>
            )}
            {error !== null && (
              <p className="mt-3 text-xs text-[var(--color-semantic-warning)]">{error}</p>
            )}
          </div>
        </>
      )}

      {/* ---------------------------------------------------------- verified */}
      {state === 'verified' && (
        // The name is already above. Repeating it here is what made the old
        // layout read as two boxes saying one thing.
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Confirmed in <strong className="text-[var(--color-semantic-success)]">
            {status.inaraSquadron ?? expected}
          </strong>{' '}
          on Inara.
          {status.discordNickname != null && (
            <>
              {' '}Your Discord nickname is kept as{' '}
              {/*
                The ACTUAL nickname, computed by the same function that sets it
                (composeNickname) rather than described as a template. "RANK -
                COMMANDER" told a member the shape and not the result — and the
                shape is a half-truth, because a long name drops the rank
                entirely to fit Discord's 32 characters. Showing the real string
                is the only version that cannot be wrong.
              */}
              <span className="font-mono text-[var(--color-text-primary)]">
                {status.discordNickname}
              </span>
              {' '}automatically.
            </>
          )}
        </p>
      )}
    </section>
  );
}
