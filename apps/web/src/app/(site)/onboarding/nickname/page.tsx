import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getMyNickname } from '../../../../lib/api';
import { NicknameStep } from './nickname-step';

export const metadata: Metadata = {
  title: "Your name in Discord — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The nickname step in onboarding.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "if they are an officer their names should match the same convention please, but add a step to
 * onboarding that allows them to overide their discord server nickname."
 *
 * ★ ONLY THE PEOPLE WITH A CHOICE SEE IT ★
 *
 * The gate already decides that — `mayChooseNickname` is officers plus anybody an officer granted
 * the exception to. This page checks again rather than trusting the redirect, because a step
 * reachable by typing the URL should not offer somebody a control that will refuse them.
 *
 * ★ IT DOES NOT SAY WHAT IS OPTIONAL ★
 *
 * Standing instruction from the owner. So the page says what the squadron's naming convention IS
 * and what choosing differently does, and the buttons say what happens next. Keeping your Inara
 * name is presented as a decision rather than as skipping something.
 */
export default async function OnboardingNicknamePage() {
  const state = await getMyNickname();

  /*
   * No state means signed out or the API is down. Sending them to the dashboard lets the hub layout
   * make that decision, which it already does properly — guessing here would risk a redirect loop
   * between two pages that each think the other should handle it.
   */
  if (state === null) redirect('/dashboard');

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-16">
      <div className="mx-auto max-w-[46rem]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          Setting up
        </p>
        <h1
          className="mt-3 text-3xl text-[var(--color-text-primary)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          YOUR NAME IN DISCORD
        </h1>

        <p className="mt-5 leading-relaxed text-[var(--color-text-secondary)]">
          Everyone in the squadron wears their verified Inara commander name in Discord, so the
          member list reads the same way here as it does in game. Names are tidied to a house style —
          each word capitalised, and anything in &ldquo;quotes&rdquo; treated as a callsign in
          capitals.
        </p>

        <p className="mt-4 leading-relaxed text-[var(--color-text-secondary)]">
          {/*
            The consequence stated up front. An officer who picks a name and later wonders why their
            corrected Inara profile never reached Discord should have been told here, once.
          */}
          As an officer you can wear something different. If you do, that name stays until you change
          it — the nightly check will leave it alone, even if your Inara name changes later.
        </p>

        <div className="mt-8 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-6">
          <NicknameStep initial={state} />
        </div>
      </div>
    </main>
  );
}
