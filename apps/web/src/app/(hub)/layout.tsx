import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { HubShell } from '../../components/hub-shell';
import { getMyPrivacy } from '../../lib/api';
import { UpdateBanner } from '../../components/update-banner';
import { SecureAccountBanner } from '../../components/secure-account-banner';
import { VerifyPromptBanner } from '../../components/verify-prompt-banner';
import { getMe } from '../../lib/api';

/**
 * The members' area.
 *
 * Sidebar, compact top bar, no footer — a signed-in member here is working
 * rather than browsing, and a page of legal links at the bottom of every
 * settings screen is furniture.
 *
 * ★ SIGNED OUT MEANS SIGNED OUT ★
 *
 * Everything under this layout needs a session, so the check happens once here
 * rather than being repeated (and eventually forgotten) in each page. It is NOT
 * the security boundary — every API call behind these pages authenticates on
 * its own, and must, because a layout is a rendering decision. It is what stops
 * somebody landing on an empty shell with a sidebar full of links that will all
 * refuse them.
 */
export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();

  if (me.user === null) {
    /*
     * Carries the destination through the sign-in, so a member who followed a
     * link to their devices page lands on their devices page rather than on a
     * dashboard, having forgotten what they came for.
     */
    const path = await currentPath();
    redirect(`/v1/auth/discord?redirect=${encodeURIComponent(path)}`);
  }

  /*
   * ★ ONBOARDING IS A WALL, NOT A NUDGE ★
   *
   * A redirect on every page under this layout until the member owes nothing.
   * Three obligations in a specific order — second factor for privileged
   * accounts, then commander settings for everybody, then verification for
   * everybody except admins — and the ORDER is decided by the server, in
   * onboarding-gate.ts, rather than re-derived here.
   *
   * That matters: two copies of an ordering this fiddly drift, and the symptom
   * is a member bounced between two pages that each think the other should
   * have run first.
   *
   * None of it is the security boundary — the API refuses these accounts
   * regardless. It is what stops somebody wandering a members area that
   * half-works, wondering why everything 403s.
   *
   * The onboarding pages live in (site), so this cannot loop.
   */
  if (me.onboarding.path !== null) {
    redirect(me.onboarding.path);
  }

  /*
   * ★ THE READER'S FONT OVERRIDE ★
   *
   * `plainFonts` is a READING setting, so it is applied here — around everything a member sees —
   * rather than by each component that renders a post. One class, and `globals.css` collapses every
   * author-chosen face to the site one.
   *
   * Fetched with the layout so it is right in the first paint: applying it after hydration would
   * show a wall of display faces to the very person who asked not to see them.
   */
  const privacy = await getMyPrivacy();

  return (
    <div className={privacy?.plainFonts === true ? 'plain-fonts' : undefined}>
    <HubShell me={me} current={await currentPath()}>
      {/*
        ★ HERE AS WELL AS ON THE PUBLIC SITE ★
        
        This is where an unsecured admin actually LANDS after signing in, so if
        the prompt only lived on the public pages it would be missing from the
        one place it matters. In the layout rather than on the dashboard, so it
        follows them across every settings page too.
      */}
      <SecureAccountBanner />
      <VerifyPromptBanner />
      {/*
        LAST of the three, deliberately.

        A member who owes a second factor or a verification has something to do
        that matters more than installing an update, and three bars stacked
        across the top is how people learn to scroll past all of them. This one
        also expires on its own, which neither of the others does.
      */}
      <UpdateBanner />
      {children}
    </HubShell>
    </div>
  );
}

/**
 * Which page we are on.
 *
 * ★ FROM A HEADER, BECAUSE A SERVER LAYOUT HAS NO usePathname ★
 *
 * Next sets `x-invoke-path` on some versions and not others, so the middleware
 * sets one we control. Falling back to the dashboard means the worst case is a
 * sidebar with nothing highlighted — which looks unfinished but misleads
 * nobody, unlike highlighting the wrong entry.
 */
async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get('x-pathname') ?? h.get('x-invoke-path') ?? '/dashboard';
}
