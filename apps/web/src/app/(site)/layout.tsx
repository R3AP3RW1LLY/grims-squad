import { SecureAccountBanner } from '../../components/secure-account-banner';
import { VerifyPromptBanner } from '../../components/verify-prompt-banner';
import { SiteNav, SiteFooter } from '../../components/site-chrome';
import { AuthedNav } from '../../components/authed-nav';
import { getMe } from '../../lib/api';

/**
 * The public squadron.
 *
 * The landing page, the roster, the recruitment pages, the legal pages — things
 * anybody can read, and things a member reads while browsing rather than while
 * working.
 *
 * ★ THE NAVBAR STILL SWAPS FOR A SIGNED-IN MEMBER ★
 *
 * They keep their avatar, their menu and their way back to the hub, but the
 * page around it stays the public one. Sending somebody to the sidebar shell
 * just because they are signed in would mean they could never look at their own
 * own public pages the way a visitor sees them.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();

  return (
    <>
      {me.user === null ? <SiteNav /> : <AuthedNav me={me} />}
      {/* Directly under the navbar, per the human decision. In the LAYOUT so it
          follows the member everywhere rather than being remembered per page. */}
      <SecureAccountBanner />
      <VerifyPromptBanner />

      <div className="flex-1">{children}</div>

      {/* Rendered here so INV-029's attribution cannot be omitted by a page. */}
      <SiteFooter />
    </>
  );
}
