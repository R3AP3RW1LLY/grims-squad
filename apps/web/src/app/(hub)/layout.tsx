import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { HubShell } from '../../components/hub-shell';
import { UpdateBanner } from '../../components/update-banner';
import { SecureAccountBanner } from '../../components/secure-account-banner';
import { VerifyPromptBanner } from '../../components/verify-prompt-banner';
import { getMe, getMyPrivacy } from '../../lib/api';

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
/**
 * Paths under this layout that a visitor may reach with no session.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "make the builder public please and accessible to signed out users", and "the public page must
 * also be visible along with the builds in them to anyone not signed in from the homepage."
 *
 * ★ WHY A LIST HERE, AND NOT A SEPARATE ROUTE GROUP ★
 *
 * A `(public)/shipyard` would have been the tidier file tree and the worse product: the same URL
 * would render with the sidebar for a member and without it for a visitor only if both copies were
 * kept in step, and two copies of an outfitter is exactly the kind of duplication that ends with
 * one of them a version behind.
 *
 * So one route, and the layout decides how much chrome to draw. The API agrees with it — these are
 * the routes marked `@Public()` in `ai.controller.ts`, and both are gated on the same
 * SHIPYARD_VIEW bit, which guests hold.
 *
 * ★ NAMED, NOT A BLANKET PREFIX ★
 *
 * `/shipyard` alone as a prefix would have carried `/shipyard/squadron` with it. The API would
 * still have refused to put a squadron-only build in front of a stranger — the ACL sees to that —
 * so nothing would have leaked. A visitor would simply have been shown an empty page headed
 * "Squadron builds", which is a worse thing to publish than a sign-in redirect.
 *
 * `/shipyard/build/` keeps its trailing slash and its prefix match, because a shared link is the
 * main thing a visitor arrives on and the token varies.
 */
const PUBLIC_PATHS: readonly string[] = [
  '/shipyard',
  '/shipyard/public',
  /*
   * Squadron owner, 2026-08-01: the public navbar's Forum link must take people "to the forum page
   * and only show them publically viewable forum categories".
   *
   * `/forum` is the board INDEX, and what appears on it is decided by each category's `viewPerm`
   * against the reader's mask — the guest mask holds FORUM_VIEW_PUBLIC and nothing else. So a
   * visitor sees the public categories and a member sees theirs, from one page.
   *
   * Only the index. A THREAD lives at `/forum/<category>/<thread>` and is not listed here, so
   * reading one still requires a session unless it is in a public category, which the ACL decides
   * on its own terms rather than by this list.
   */
  '/forum',
  /*
   * ★ LOGISTICS & TRADE — SQUADRON OWNER, 2026-08-02 ★
   *
   * "this will also be available to the public for use." The API agrees: both routes are `@Public()`
   * in `market.controller.ts` and both are gated on TRADE_QUERY, which the guest mask now holds.
   *
   * Listed, not prefixed, for the same reason as the Shipyard above — a blanket `/logistics` would
   * silently carry whatever is added under it next, and colonisation is coming under exactly that
   * path. A squadron project board shown to a stranger as an empty page headed "Colonisation" is a
   * worse thing to publish than a sign-in redirect.
   */
  '/logistics/commodities',
  '/logistics/freight-office',
];
/*
 * `/logistics/commodities/` carries the trailing slash and matches by prefix, because the detail
 * page for one commodity is the thing a member actually pastes into Discord — and a link that
 * bounces a visitor to Discord OAuth is not a price link.
 */
const PUBLIC_PREFIXES: readonly string[] = ['/shipyard/build/', '/logistics/commodities/'];

function isPublicPath(path: string): boolean {
  // The query string is not part of the decision — `/shipyard?tab=assisted` is the same page.
  const clean = path.split('?')[0] ?? path;

  return PUBLIC_PATHS.includes(clean) || PUBLIC_PREFIXES.some((p) => clean.startsWith(p));
}

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const path = await currentPath();

  if (me.user === null && !isPublicPath(path)) {
    /*
     * Carries the destination through the sign-in, so a member who followed a
     * link to their devices page lands on their devices page rather than on a
     * dashboard, having forgotten what they came for.
     */
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
  if (me.user !== null && me.onboarding.path !== null) {
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
