import type { Metadata } from 'next';
import { getCompanionReleases } from '../../../lib/api';
import { CompanionDownload } from '../../(hub)/settings/devices/download';

export const metadata: Metadata = {
  title: "Companion app — Grim's Squad",
  description:
    "The Grim's Squad companion app reads Elite Dangerous journal files so your ranks, ships and activity stay current on the squadron hub.",
};

/**
 * The pitch for the companion app.
 *
 * ★ RECOMMENDED, NOT REQUIRED — AND THE PAGE HAS TO SAY BOTH ★
 *
 * The human asked for members to be told it is recommended. But ADR-022 and
 * D27 commit to the app being optional permanently: the site is complete
 * without it, and anyone who will not install a binary is verified by an
 * officer and holds a full rank.
 *
 * Those two are only compatible if the page is honest about what installing
 * buys and what declining costs. A page that leans on "recommended" without
 * saying "optional" reads as a requirement, and we would have quietly excluded
 * people who are perfectly entitled to be here.
 */
function Row({ what, journal, without }: { what: string; journal: string; without: string }) {
  return (
    <tr className="border-b border-[var(--color-border-hairline)]">
      <td className="py-3 pr-6 text-[var(--color-text-primary)]">{what}</td>
      <td className="py-3 pr-6 text-sm text-[var(--color-brand-cyan-bright)]">{journal}</td>
      <td className="py-3 text-sm text-[var(--color-text-secondary)]">{without}</td>
    </tr>
  );
}

export default async function CompanionPage() {
  /*
   * Null when the caller has no session — `getCompanionReleases` asks an authenticated route and
   * the helper collapses a refusal to null rather than throwing, so a signed-out visitor renders
   * the sign-in line instead of a failure. An empty `assets` array is a different answer again:
   * nothing has been published yet, which the download component says in its own words.
   */
  const releases = await getCompanionReleases();

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-20">
      <div className="mx-auto max-w-[76ch]">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
          Recommended
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,5vw,3.25rem)] leading-tight text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          THE COMPANION APP
        </h1>
        <div className="rule-glow mt-5" aria-hidden="true" />

        <p className="mt-6 text-lg text-[var(--color-text-primary)]">
          To get the most out of the squadron HQ, install the companion app and leave it running in
          the background while you play. It reads the game&rsquo;s own journal files on your PC and
          keeps your record here current — ranks, ships, loadouts and squadron activity, without you
          entering anything.
        </p>

        <p className="mt-4 rounded border border-[var(--color-border-hairline)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          <strong className="text-[var(--color-text-primary)]">It is optional.</strong> The site
          works fully without it and always will. An officer can verify your commander by hand, and
          you can hold any rank in the squadron without ever installing it. This is about
          convenience and detail, not access.
        </p>

        <section aria-labelledby="what-heading" className="mt-14">
          <h2
            id="what-heading"
            className="text-xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            WHAT IT ADDS
          </h2>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--color-border-hairline)] font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  <th scope="col" className="py-3 pr-6">Your record</th>
                  <th scope="col" className="py-3 pr-6">With the app</th>
                  <th scope="col" className="py-3">Without it</th>
                </tr>
              </thead>
              <tbody>
                <Row what="Pilot ranks" journal="Exact, with progress" without="Not shown" />
                <Row what="Ships and loadouts" journal="Your whole fleet" without="Not shown" />
                <Row
                  what="Monthly activity"
                  journal="Counted automatically"
                  without="An officer records it"
                />
                <Row what="Commander name" journal="Confirmed" without="Inara key, or an officer" />
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="privacy-heading" className="mt-14">
          <h2
            id="privacy-heading"
            className="text-xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            WHAT IT DOES NOT DO
          </h2>
          {/*
            Stated plainly and early. We are asking members to run our binary,
            which is a real thing to ask — the answer to "what is it doing on my
            machine" should be on the page, not in a FAQ nobody opens.
          */}
          <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-secondary)]">
            <li>
              It reads <strong>only</strong> the Elite Dangerous journal folder. Nothing else on
              your machine is touched.
            </li>
            <li>
              It sends only to this site. It does not upload to Inara, EDDN, or anywhere else.
            </li>
            <li>Your privacy settings still apply — the app does not override them.</li>
            <li>You can stop it, uninstall it, and keep your rank and your account.</li>
          </ul>
        </section>

        <section aria-labelledby="market-heading" className="mt-14">
          <h2
            id="market-heading"
            className="text-xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            MARKET DATA AND TRADE ROUTES
          </h2>
          {/*
            ★ THIS SAID THE OPPOSITE, AND IT WAS WRONG ★

            The page claimed the app "does not do market or route planning, and does not try to".
            That was true when it was written and stopped being true when the Commodities pages and
            the Freight Office landed in the app. Squadron owner, 2026-08-05: "our app does do this
            lol.. we need this fixed!"
          */}
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
            The app carries the squadron&rsquo;s market data and its trade planner. Look up what any
            commodity is worth and where to buy or sell it near you, and plan a run by naming the
            cargo, the hull and the range — the same numbers the website shows, in a window beside
            the game. Dock and open the commodities screen and your reading refreshes the
            squadron&rsquo;s prices for everybody.
          </p>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            None of that replaces EDMC, EDDiscovery or Inara. They feed the community data network
            the whole game relies on, and ours is happy to run beside them.
          </p>
        </section>

        <section aria-labelledby="get-heading" className="mt-14">
          <h2
            id="get-heading"
            className="text-xl text-[var(--color-brand-orange)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            GETTING IT
          </h2>
          {/*
            ★ THE DOWNLOAD IS ON THIS PAGE NOW ★

            It said "In testing… this page will carry the download" and never did — the installers
            lived only on /settings/devices, so somebody sent here to get the app found a promise
            instead. Squadron owner, 2026-08-05: "im on this page /companion but there is no app to
            download!"

            Still members-only, which is the standing decision: the app pairs to a squadron account
            and the release feed refuses a caller with no session. So a signed-out visitor is told
            plainly where the door is rather than being shown a button that would fail.
          */}
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
            Windows, macOS and Linux. Elite has had no native Mac client since 2015 and none on
            Linux, so players on both run it through CrossOver, Whisky or Proton — the app is a
            normal Mac or Linux program that knows where those put the game&rsquo;s journal files.
          </p>
          <div className="mt-6">
            {releases === null ? (
              <p className="text-[var(--color-text-primary)]">
                Sign in with Discord to download the app — it pairs to your squadron account, so the
                installer is kept behind the same door.{' '}
                <a href="/v1/auth/discord" className="text-[var(--color-brand-cyan-bright)]">
                  Sign in
                </a>
                .
              </p>
            ) : (
              <CompanionDownload assets={releases.assets} />
            )}
          </div>
          <p className="mt-6 text-[var(--color-text-primary)]">
            Already have it?{' '}
            <a href="/settings/devices" className="text-[var(--color-brand-cyan-bright)]">
              Pair a device and choose what it may send
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
