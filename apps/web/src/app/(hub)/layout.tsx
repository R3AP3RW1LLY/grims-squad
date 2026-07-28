import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { HubShell } from '../../components/hub-shell';
import { SecureAccountBanner } from '../../components/secure-account-banner';
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

  return (
    <HubShell me={me} current={await currentPath()}>
      {/*
        ★ HERE AS WELL AS ON THE PUBLIC SITE ★
        
        This is where an unsecured admin actually LANDS after signing in, so if
        the prompt only lived on the public pages it would be missing from the
        one place it matters. In the layout rather than on the dashboard, so it
        follows them across every settings page too.
      */}
      <SecureAccountBanner />
      {children}
    </HubShell>
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
