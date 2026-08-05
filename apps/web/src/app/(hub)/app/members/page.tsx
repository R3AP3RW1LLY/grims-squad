import type { Metadata } from 'next';
import { getSquadRosterGated, getPromotionStandings } from '../../../../lib/api';
import { SquadRoster } from './squad-roster';
import { StepUp } from '../step-up';
import { NoAccess, AdminUnavailable } from '../no-access';
import { PageHeader, Section, StatGrid, StatTile } from '../../../../components/hub-page';
import { isTimedOut } from './moderation-rules';
import { RefreshInara } from './refresh-inara';

export const metadata: Metadata = {
  title: "Squad members — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Squad Members — the Discord server, with the tools to moderate it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "we need to create a full on member roster that shows every member in our discord with full
 * administrative tools for them, kick, ban, timeout blah blah blah. create a new Squad Members page
 * in the administration category"
 *
 * ★ `/app/members` HAS BEEN A NAV ENTRY BEFORE, WITH NOTHING BEHIND IT ★
 *
 * It was removed on 2026-07-29 because it pointed at a route that had no page: every officer who
 * clicked it got a 404 from their own sidebar. The route exists this time, and the nav entry was
 * added in the same change as the page rather than ahead of it.
 *
 * ★ WHY IT IS NOT A TAB ON /app ★
 *
 * The console's tabs are about the promotion cycle — who has been active, who qualifies, what
 * changed. This is about the SERVER: who is in it, what they wear, and removing somebody. Different
 * question, different people, and a ban button does not belong beside a promotion roster.
 */
export default async function SquadMembersPage() {
  const read = await getSquadRosterGated();

  /*
   * ★ EACH REFUSAL GETS THE SCREEN THAT MATCHES IT ★
   *
   * Only ONE of these asks for a code. On 2026-07-30 an officer holding MEMBER_MANAGE but not
   * ROLE_MANAGE was shown the authenticator box on /app/roles, entered valid codes seven times, and
   * was returned to it every time — because no code can grant a permission.
   */
  if (read.state === 'needs-step-up') return <StepUp />;
  if (read.state === 'signed-out') return <StepUp />;
  if (read.state === 'forbidden') {
    return <NoAccess what="the squad members roster" permission="MEMBER_MANAGE" />;
  }
  if (read.state === 'unavailable') return <AdminUnavailable />;

  const rows = read.data.rows;
  const now = Date.now();

  /*
   * Ladder standings, keyed by website user id for the promote control.
   *
   * Fetched separately rather than folded into the roster: the roster is every Discord account and
   * the ladder is only the ones with a website rank, so joining them server-side would put a null
   * on most rows to serve a panel that shows one member at a time.
   *
   * A failure here costs the promote control, not the page — moderation is what an officer opened
   * this for.
   */
  const standingsRead = await getPromotionStandings();
  const standings = Object.fromEntries(
    (standingsRead?.standings ?? []).map((s) => [s.userId, s]),
  );

  /*
   * ★ THE API NO LONGER SENDS BOTS AT ALL — SQUADRON OWNER, 2026-08-02 ★
   *
   * "this is for players only". `squadRoster()` filters them in the query, so this is belt and
   * braces rather than the guard: if a bot ever reached this page it would be a fault worth seeing
   * as a wrong count, not one this line quietly papers over.
   */
  const people = rows.filter((r) => !r.isBot);
  const timedOut = rows.filter((r) => isTimedOut(r, now)).length;
  const inVoice = rows.filter((r) => r.inVoiceSince !== null).length;
  /*
   * Counted and shown, because it is the number that explains a greyed-out button before anybody
   * presses one. A bot cannot action anybody whose highest role sits at or above its own.
   */
  const outOfReach = people.filter((r) => !r.moderatable).length;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Squad members"
        subtitle="Everybody in the Discord server, and the tools to moderate them"
        /*
         * `action` renders inside the header row, above the rule that separates it from the body —
         * which is where the owner asked for it: "put that new button on the /app/members page above
         * the title line".
         */
        action={<RefreshInara />}
      />

      <Section
        title="The server"
        description="Every action here happens in Discord immediately and is written to the squadron audit log with your name, the reason and the outcome — including the ones Discord refuses."
      >
        <StatGrid>
          <StatTile label="Members" value={String(people.length)} hint="Players in the server" tone="accent" />
          <StatTile
            label="In voice"
            value={String(inVoice)}
            hint={inVoice === 0 ? 'Nobody in comms' : 'Right now'}
          />
          <StatTile
            label="Timed out"
            value={String(timedOut)}
            hint={timedOut === 0 ? 'Nobody is muted' : 'Currently muted'}
            tone={timedOut === 0 ? 'default' : 'warn'}
          />
          <StatTile
            label="Out of reach"
            value={String(outOfReach)}
            hint="Outrank the bot in Discord"
            tone={outOfReach === 0 ? 'default' : 'warn'}
          />
        </StatGrid>

        <div className="mt-6">
          {/*
            `now` from the server, not from the browser.

            Two things on this page are relative to the present — how long somebody has been here,
            and whether a timeout has expired. A client component still renders on the server first,
            so reading the clock inside it would put one answer in the HTML and another at
            hydration.
          */}
          <SquadRoster rows={rows} now={now} standings={standings} />
        </div>
      </Section>
    </>
  );
}
