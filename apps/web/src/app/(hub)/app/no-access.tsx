/**
 * "You do not have this permission" — which is NOT a two-factor problem.
 *
 * ★ WHY THIS COMPONENT HAD TO EXIST ★
 *
 * 2026-07-30, production. An officer holding MEMBER_MANAGE but not ROLE_MANAGE opened
 * /app/roles and was shown the authenticator code box. They typed a valid code. It was
 * accepted — the API recorded seven successful verifications — and the page came back to
 * the code box every time.
 *
 * The admin pages read `if (data === null) return <StepUp />`, and `null` meant any
 * failure at all. So a missing PERMISSION was rendered as a missing SECOND FACTOR, which
 * is a loop with no exit: no code can grant a permission, and the screen offered nothing
 * else to try. It was reported, entirely reasonably, as "2FA has stopped working".
 *
 * ★ WHAT THIS SCREEN DOES DIFFERENTLY ★
 *
 * It names the actual problem, and it offers no code box — because there is nothing a code
 * could fix. It says who can change it, so the reader's next step is a conversation rather
 * than another six digits.
 *
 * A locked door should look like a locked door. A door that is not yours should not look
 * like a door you have the wrong key for.
 */
export function NoAccess({
  what,
  permission,
}: {
  /** What they tried to open, in plain words. */
  readonly what: string;
  /** The permission that governs it, named so an admin can grant exactly that. */
  readonly permission?: string;
}) {
  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[52ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-text-secondary)]">
          Not yours
        </p>
        <h1
          className="mt-3 text-[clamp(1.75rem,4vw,2.5rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          NO ACCESS
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        <p className="mt-6 leading-relaxed text-[var(--color-text-primary)]">
          Your account cannot open {what}.
        </p>

        <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {/*
            Said explicitly, because the screen this replaced implied the opposite and cost
            somebody a long evening of typing correct codes into a box that could never
            have helped.
          */}
          This is not a two-factor problem — your authenticator is fine, and entering
          another code will not change it. The account simply does not hold the permission
          this page needs
          {permission === undefined ? '' : ` (${permission})`}.
        </p>

        <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          If you should have it, ask a commander to grant it on the roles screen. If you
          reached this by following a link, that link was not meant for your account.
        </p>

        <p className="mt-8">
          <a
            href="/dashboard"
            className="font-mono text-xs tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            &larr; BACK TO THE DASHBOARD
          </a>
        </p>
      </div>
    </main>
  );
}

/**
 * "We could not reach the admin API."
 *
 * The third thing `null` used to mean. Distinguished because telling somebody their
 * permissions are wrong when the API is simply down sends them to argue with an officer
 * about a problem neither of them has.
 */
export function AdminUnavailable() {
  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[52ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-text-secondary)]">
          Unavailable
        </p>
        <h1
          className="mt-3 text-[clamp(1.75rem,4vw,2.5rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          CANNOT REACH THE CONSOLE
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />
        <p className="mt-6 leading-relaxed text-[var(--color-text-primary)]">
          The admin API did not answer.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Your account and your authenticator are not the problem. Try again in a moment,
          and if it persists say so in Discord — this one is our end.
        </p>
      </div>
    </main>
  );
}
