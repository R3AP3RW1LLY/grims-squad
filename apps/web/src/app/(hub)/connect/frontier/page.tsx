import type { Metadata } from 'next';
import { StartFrontier } from './start-frontier';

/**
 * The one link that takes a member from the app to Frontier.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * "whe i click connect with frontier in the companion app it sends me to the suqadron website not
 * frontier! ... I CAN NOT USE THE APP AT ALL"
 *
 * ★ WHY THE APP CANNOT JUST OPEN FRONTIER ITSELF ★
 *
 * The authorisation URL is built per member — it carries a PKCE challenge the hub has to remember,
 * so it can only come from `POST /v1/me/capi/start`, which is session-authenticated. The companion
 * deliberately holds no session; its whole identity is a device token, which is a far smaller
 * credential than a cookie that can act as the member anywhere on the site.
 *
 * So the app opened the website and left the member there to find a button. There was no button.
 * `capiStart` had no caller anywhere in the web app at all — the route existed and nothing on the
 * site ever called it. The member landed on a settings page, found nothing, and was stuck behind a
 * step the app makes MANDATORY.
 *
 * This page is the missing link: the browser already holds the session, so it starts the handshake
 * on arrival and sends the member straight on to Frontier. One click in the app, one destination.
 */
export const metadata: Metadata = {
  title: 'Connecting to Frontier — Grim’s Squad',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function ConnectFrontierPage() {
  return <StartFrontier />;
}
