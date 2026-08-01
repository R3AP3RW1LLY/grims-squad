import type { Metadata } from 'next';
import { PageHeader, PageBody } from '../../../components/hub-page';
import { describeDeviceLink } from '../../../lib/api';
import { ApproveDevice } from './approve';

export const metadata: Metadata = {
  title: "Connect the companion app — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Where the companion app sends a member to sign in.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "COMPANION Discord login; remove key generator"
 *
 * The app opens this in the member's own browser. If they are not signed in, the ordinary Discord
 * sign-in happens first and returns them here — which is what "Discord login in the companion"
 * actually means in practice: the app never sees a password, never handles the OAuth exchange, and
 * never holds a client secret it has nowhere safe to keep.
 *
 * ★ THIS PAGE IS INSIDE THE HUB, WHICH IS THE POINT ★
 *
 * Being under the authenticated shell means the existing sign-in requirement does all the work. A
 * public page would have to invent its own way of getting a member signed in and back again, and
 * that is precisely the machinery this flow exists to avoid writing twice.
 */
export default async function LinkDevicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params['code'];
  const code = typeof raw === 'string' ? raw : '';

  /*
   * Looked up on the SERVER so the machine's name is on screen in the first paint. Fetching it in
   * the browser would render "Approve this?" with a blank where the device should be, for exactly
   * as long as it takes somebody to click the button without reading it.
   */
  const link = code === '' ? null : await describeDeviceLink(code);

  return (
    <>
      <PageHeader
        eyebrow="Companion app"
        title="CONNECT THE APP"
        subtitle="Signed in as you — the app never sees your password"
      />
      <PageBody lead="The companion app reads your Elite Dangerous journals and uploads them to your account, which is what puts your commander name, ships and activity on the site. Approving here is what connects it.">
        <div className="mt-2 max-w-[34rem]">
          <ApproveDevice code={code} label={link?.label ?? null} />
        </div>
      </PageBody>
    </>
  );
}
