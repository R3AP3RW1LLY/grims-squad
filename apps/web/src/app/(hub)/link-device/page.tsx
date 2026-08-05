import type { Metadata } from 'next';
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
 * ★ NOT A DOCUMENT, SO NOT LAID OUT LIKE ONE ★
 *
 * This first used PageHeader and PageBody like every other hub page. Reported as "all smashed to
 * the left side and looks really bad", and that was right: those exist for pages somebody READS —
 * a heading, a lead paragraph, then content in a 68ch reading column pinned to the left of a wide
 * screen. Correct for the roster. Wrong for a page with one sentence and one button, where the
 * result is a small card marooned in the top-left corner of an empty page.
 *
 * A single decision gets a centred card, the same shape as the step-up gate. Deliberately NOT one
 * of the `mx-auto max-w-[NNch]` patterns `hub-page.spec` forbids — that rule is about pages
 * re-centring themselves as narrow documents inside the shell, which is the opposite of what a
 * confirmation dialog wants.
 *
 * The shell still provides the main landmark; this page adds no second one.
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
    <div className="flex min-h-[70vh] items-center justify-center py-8">
      <div className="w-full max-w-[30rem]">
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
            Companion app
          </p>
          <h1
            className="mt-3 text-[clamp(1.5rem,3.5vw,2rem)] leading-tight text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            CONNECT THE APP
          </h1>
          <div className="rule-glow mx-auto mt-5 w-24" aria-hidden="true" />
          <p className="mt-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            The companion reads your Elite Dangerous journal and keeps your profile, your ships and
            the squadron&rsquo;s market prices current. Connecting it here is what links it to your
            account.
          </p>
        </div>

        <div className="mt-8">
          <ApproveDevice code={code} label={link?.label ?? null} />
        </div>
      </div>
    </div>
  );
}
