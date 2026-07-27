import { cookies } from 'next/headers';
import { getAccountStatus } from '../lib/api';

/**
 * The "secure your account" banner, directly under the navbar.
 *
 * Shown only to a member who HOLDS privileged permissions and has NOT enrolled
 * a second factor. Three deliberate consequences of that rule:
 *
 *  - An ordinary member never sees it. Nagging 108 people about an obligation
 *    only nine of them have is how a banner becomes wallpaper.
 *  - A signed-out visitor never sees it. Telling someone to secure an account
 *    they do not have is noise that makes the site look broken.
 *  - It disappears the moment they enrol, with nothing to dismiss. A dismiss
 *    button on a security prompt is a button that turns the prompt off.
 *
 * Not dismissible on purpose. The obligation does not go away, so neither does
 * the banner — and because it is scoped to the few people it applies to, that
 * is a reasonable thing to insist on rather than a tax on everybody.
 */
export async function SecureAccountBanner() {
  /*
   * ★ ARCH-ADV, caught on my own change ★
   *
   * This component is in the ROOT LAYOUT, so it renders on every page —
   * including the public landing page, which is the highest-traffic surface we
   * have and is served to people who are not signed in at all.
   *
   * Calling the API unconditionally would add a round trip to every one of
   * those renders to be told "no session", which is a cost paid by exactly the
   * visitors it can never apply to. A session cookie is a cheap local check and
   * a strict precondition: no cookie means no member, means nothing to prompt.
   *
   * NOT a security check — the cookie's mere presence proves nothing and is not
   * treated as proof. It only decides whether asking is worthwhile; the API
   * still authenticates the request that follows.
   */
  const jar = await cookies();
  const hasSession = jar.getAll().some((c) => c.name.endsWith('gs_at') || c.name.endsWith('gs_rt'));
  if (!hasSession) return null;

  const status = await getAccountStatus();
  if (status === null || !status.needsSecuring) return null;

  return (
    <div
      // `role="alert"` would interrupt whatever a screen-reader user is doing
      // on every page load. This is important and not urgent — a region they
      // meet in the normal reading order says so without hijacking.
      role="region"
      aria-label="Account security"
      className="border-b border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)]"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
        <span
          aria-hidden="true"
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)]"
        >
          Action needed
        </span>
        <p className="text-sm text-[var(--color-text-primary)]">
          Your account can affect other members. Add a second factor to use the admin tools.
        </p>
        <a
          href="/onboarding/security"
          className="ml-auto shrink-0 rounded border border-[var(--color-brand-orange)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)] no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_20%,transparent)]"
        >
          Secure my account
        </a>
      </div>
    </div>
  );
}
