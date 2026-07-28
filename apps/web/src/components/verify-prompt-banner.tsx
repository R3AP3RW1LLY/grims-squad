import { getMe } from '../lib/api';

/**
 * "Get yourself verified" — for admins only, and it does not block them.
 *
 * ★ WHY ADMINS ARE ASKED BUT NOT STOPPED ★
 *
 * Verification needs an officer to approve it. If officers were themselves held
 * pending verification, a fresh install has nobody able to approve anybody —
 * including themselves — and the queue jams on its first day with no way out
 * that does not involve the database.
 *
 * So they get a banner instead of a wall. They already hold the permissions
 * verification would confirm they deserve, so stopping them protects nothing
 * and only stops the person who has to clear everybody else's queue.
 *
 * ★ WHO NEVER SEES IT ★
 *
 * An ordinary member. They are stopped by the wall, on a page that exists to
 * explain the wait — a banner would be a second instruction competing with the
 * first. The server decides this (`promptForVerification`), so the rule lives
 * in one place rather than being re-derived here.
 */
export async function VerifyPromptBanner() {
  const me = await getMe();
  if (!me.onboarding.promptForVerification) return null;

  return (
    <div className="border-b border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_10%,transparent)]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <p className="text-sm text-[var(--color-text-primary)]">
          <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)]">
            Not verified
          </span>{' '}
          {/*
            Says why it matters to THEM rather than restating the rule. "You are
            not verified" is a status; "your own activity will not count" is a
            reason, and people act on reasons.
          */}
          Nobody has confirmed which commander you fly as, so your own months will not count toward
          a rank. Ask a colleague to verify you, or link an Inara key.
        </p>
        <a
          href="/settings/commander?tab=verification"
          className="ml-auto shrink-0 rounded border border-[var(--color-brand-orange)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)]"
        >
          Sort it out
        </a>
      </div>
    </div>
  );
}
