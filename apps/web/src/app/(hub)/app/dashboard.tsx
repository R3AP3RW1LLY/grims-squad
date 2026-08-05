import type { AdminDashboard } from '../../../lib/api';
import { Section, StatGrid, StatTile } from '../../../components/hub-page';
import { voiceTime } from './voice-time';
import {
  ActivityChart,
  Donut,
  MonthlyBars,
  RankedBars,
  StackedStrip,
  BRAND,
  type HeatDay,
} from './charts';

/**
 * The admin dashboard.
 *
 * ★ WHAT IT IS FOR ★
 *
 * Answering, in one screen, the three questions an officer actually opens this
 * page with: is the squadron alive, is anyone flying, and who is due a
 * promotion. Every panel is one of those three and nothing else — a dashboard
 * that shows everything is a dashboard nobody reads.
 *
 * ★ WHY EACH PANEL IS THE SHAPE IT IS ★
 *
 *   heatmap    the SHAPE of a month. Thirty-one bars answer "how busy was the
 *              17th"; a calendar answers "when does this squadron play", which
 *              is the question somebody scheduling an operation actually has.
 *   bars       rankings. Horizontal, because commander names and ship types do
 *              not fit under a vertical bar without rotating the labels.
 *   donut      composition out of a whole — what the squadron flies, and what
 *              the companion app is sending.
 *   strip      a small set that IS a whole. Nine officers across a few offices
 *              is a composition, not a ranking.
 *
 * The page stays a server component; only the drawing is a client one. See
 * charts.tsx.
 */

/** `2026-07` as `July 2026`. Nobody reads a month as a number. */
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (y === undefined || m === undefined || Number.isNaN(y) || Number.isNaN(m)) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-dashed border-[var(--color-border-hairline)] px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}

export function Dashboard({ data }: { data: AdminDashboard }) {
  const { discord, game, squadron } = data;

  /*
   * "July 2026" for a month, "2026" for the year view — the API sends the bare year as the label
   * when YTD was asked for, and `monthLabel` would turn that into something meaningless.
   */
  const label = /^\d{4}$/.test(data.month) ? data.month : monthLabel(data.month);
  const participation =
    squadron.members === 0 ? 0 : Math.round((discord.activeMembers / squadron.members) * 100);

  /*
   * The weekday of each day, computed HERE rather than sent by the API.
   *
   * It is derived from the month and the index — the same two facts on both
   * sides — so sending it would be shipping something the client already knows,
   * and giving two places the chance to disagree about what day the 3rd was.
   */
  const [year, month] = data.month.split('-').map(Number);
  const heat: HeatDay[] = discord.daily.map((messages, i) => ({
    day: i + 1,
    messages,
    members: discord.dailyMembers[i] ?? 0,
    // `?? 0` for the same reason as sign-ins below: a shorter array must draw a zero rather
    // than break the line.
    voice: discord.dailyVoice[i] ?? 0,
    forum: discord.dailyForum[i] ?? 0,
    /*
     * From `game`, not `discord` — it is a journal fact (`LoadGame`), and the
     * two arrive as separate arrays covering the same days. `?? 0` because a
     * month with no telemetry at all returns a shorter array, and a missing
     * index must draw a zero rather than break the line.
     */
    signIns: data.game.dailySignIns[i] ?? 0,
    weekday: new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, i + 1)).getUTCDay(),
  }));

  return (
    <>
      <StatGrid>
        <StatTile
          label="Active this month"
          value={String(discord.activeMembers)}
          hint={`${participation}% of ${squadron.members} in the guild`}
          tone={discord.activeMembers === 0 ? 'warn' : 'accent'}
        />
        <StatTile
          label="Messages"
          value={discord.messages.toLocaleString('en-GB')}
          /*
            Voice TIME beside the voice JOINS, per the owner (2026-08-04): how long, next to how
            often, replacing nothing. A dash means no minutes are banked for the period — which
            is every month before the banking shipped, as well as genuine silence.
          */
          hint={`${discord.forumPosts} forum · ${discord.voiceJoins} voice joins · ${voiceTime(discord.voiceMinutes)} in voice`}
        />
        <StatTile
          label="Playing now"
          value={String(game.playingNow)}
          hint={game.playingNow === 0 ? 'Nobody in the black' : 'Journal still being written'}
          tone={game.playingNow > 0 ? 'accent' : 'default'}
        />
        <StatTile
          label="Qualifying"
          value={String(squadron.qualifying)}
          hint={`${squadron.withAccounts} signed up, ${squadron.verified} verified`}
          tone={squadron.qualifying === 0 ? 'warn' : 'default'}
        />
      </StatGrid>

      <Section
        title={`Who showed up — ${label}`}
        description="Actions per day against the number of people behind them. Counted from per-day records rather than from a monthly total, so a member active on the 5th and the 20th appears on both."
      >
        {discord.daily.some((d) => d > 0) ? (
          <ActivityChart days={heat} monthLabel={label} granularity={data.granularity} />
        ) : (
          /*
           * ★ SAYS WHY, AND WHERE TO LOOK ★
           *
           * This read "Nothing recorded this month yet", which is true and reads as a fault — the
           * squadron owner opened the console four minutes into August and reasonably concluded the
           * page was broken. Nothing was lost; the previous month was full and unreachable.
           *
           * A fresh month being quiet is the expected state for a day or two every month, so the
           * empty state names it and points at the tabs rather than leaving somebody to guess.
           */
          <Empty>
            {label} has only just started, so there is nothing charted yet. Pick an earlier month —
            or YTD — above to see history. Nothing has been lost.
          </Empty>
        )}
      </Section>

      {/*
        ★ auto-rows-fr, AND fill ON EVERY PANEL ★

        Grid already stretches items to their row, so the <section> elements
        matched — but their CONTENT did not, so the horizontal rule near the
        bottom of each landed at a different height. Two panels side by side
        with misaligned rules reads as a rendering fault rather than as two
        panels of different length.

        `fill` makes each section a flex column; the rule at the foot of each is
        marked `mt-auto` and is therefore pushed to the same line.
      */}
      <div className="grid auto-rows-fr gap-6 lg:grid-cols-2">
        <Section
          fill
          title="Most active"
          description="Top ten by messages this month, named by their Discord server nickname — which in this squadron is the commander name."
        >
          {discord.top.length > 0 ? (
            <RankedBars
              unit="messages"
              colour={BRAND.cyan}
              data={discord.top.map((t) => ({
                label: t.name,
                value: t.messages,
                hint: t.cmdrName ?? undefined,
              }))}
            />
          ) : (
            <Empty>No activity recorded yet.</Empty>
          )}
          <div className="mt-auto pt-5">
            <div className="border-t border-[var(--color-border-hairline)]" />
          </div>
        </Section>

        <Section
          fill
          title="What we fly"
          description="The ship each commander was last seen in — not every ship they own, and not counted per session, so the most frequent player does not decide this alone."
        >
          {game.ships.length > 0 ? (
            <Donut
              unit={game.ships.length === 1 ? 'pilot' : 'pilots'}
              data={game.ships.map((s) => ({ label: s.ship, value: s.pilots }))}
            />
          ) : (
            <Empty>No commander has reported a session yet.</Empty>
          )}
          <div className="mt-auto pt-5">
            <div className="border-t border-[var(--color-border-hairline)]" />
          </div>

        </Section>

        <Section
          fill
          title="What we wear"
          description="The suit each commander was last seen in, for anybody who plays on foot. Read from the same journal events as the ships above — a commander who never leaves the cockpit simply does not appear here."
        >
          {game.suits.length > 0 ? (
            <Donut
              unit={game.suits.length === 1 ? 'pilot' : 'pilots'}
              data={game.suits.map((s) => ({ label: s.suit, value: s.pilots }))}
            />
          ) : (
            <Empty>Nobody has been on foot yet.</Empty>
          )}
        </Section>

        <Section
          fill
          title="How the squadron is doing"
          description="Credit balances, in bands, for members who have chosen to share them. Nobody is named and no figure is ever shown — only how many commanders sit in each range."
        >
          {game.creditBands.length > 0 ? (
            <Donut
              unit={
                game.creditBands.reduce((a, b) => a + b.pilots, 0) === 1 ? 'commander' : 'commanders'
              }
              data={game.creditBands.map((b) => ({ label: b.band, value: b.pilots }))}
            />
          ) : (
            /*
             * One message for both causes, because it has to be true of both: nobody has opted in,
             * or too few have for a band to be anonymous. Saying which would itself leak the count.
             */
            <Empty>
              {/*
                The sidebar's wording, exactly. This sentence tells a member where to go, so it has
                to name the thing they will actually see in the nav — a pointer to "Commander
                management" sends them looking for an entry that says Commander Mgmt.
              */}
              Not enough commanders share their balance yet. Turn it on in Commander Mgmt to be
              counted.
            </Empty>
          )}
        </Section>

        <Section
          fill
          title="The ladder"
          description="Members at each tenure rank, read from the roles they wear in Discord. Counted once each, at their highest rung."
        >
          {squadron.ranks.length > 0 ? (
            <RankedBars
              unit="members"
              colourful
              data={squadron.ranks.map((r) => ({ label: r.rank, value: r.held }))}
            />
          ) : (
            <Empty>Nobody holds a squadron rank yet.</Empty>
          )}

          {/*
            ONE rule per panel, pinned to the foot. It used to sit ABOVE the
            appointments block, which put it at a different height from the
            telemetry panel's — the misalignment that was reported.
          */}
          <div className="mt-auto pt-5">
            <div className="border-t border-[var(--color-border-hairline)]" />
          </div>
        </Section>

        <Section
          fill
          /*
            ★ PERIOD-SCOPED NOW — SQUADRON OWNER, 2026-08-01 ★

            "the Journal Telemetry needs to be split into the YTD and per month so we can see it
            per month how much telemetry were getting etc. this should be the way every chart /
            graph works in /app". This panel used to show ALL-TIME figures whatever the period
            control said — which, with raw telemetry purged at thirty days, meant "all time" was
            quietly "the last thirty days". Closed months now come from the month bank; the
            month still running is counted live.
          */
          title={`Journal telemetry — ${label}`}
          description="What the companion app sent in this period, by event type. Baseline categories are always collected; anything beyond them is opt-in and appears here only once somebody has turned it on."
        >
          {game.byType.length > 0 ? (
            <>
              {/*
                The year view gets BOTH answers: the bars say WHEN telemetry arrived (the
                owner's "per month how much telemetry were getting"), the donut says WHAT it
                was across the year. A chosen month needs no bars — its donut and total ARE the
                month — and a monthly bank cannot draw a closed month's days anyway.
              */}
              {data.granularity === 'month' && (
                <div className="mb-5">
                  <MonthlyBars values={game.monthlyEvents} yearLabel={data.month} unit="events" />
                </div>
              )}

              <Donut
                unit="events"
                data={game.byType.slice(0, 10).map((t) => ({ label: t.type, value: t.count }))}
              />

              {/*
                Below the chart and ABOVE the rule, as asked. It previously sat
                underneath a rule of its own, which both put it on the wrong
                side of the line and left that line at a different height from
                the ladder panel's.

                Two shapes on purpose. A month's reporter count is exact; a year's is the
                busiest month's figure, because distinct commanders cannot be summed across
                months whose raw rows are purged — and the sentence says which it is showing.
              */}
              <p className="mt-4 font-mono text-[11px] text-[var(--color-text-secondary)]">
                {data.granularity === 'month' ? (
                  <>
                    {game.events.toLocaleString('en-GB')} events · {game.sessionsThisMonth}{' '}
                    sessions in {label} · {game.reporting}{' '}
                    {game.reporting === 1 ? 'commander' : 'commanders'} reporting in the busiest
                    month
                  </>
                ) : (
                  <>
                    {game.events.toLocaleString('en-GB')} events from {game.reporting}{' '}
                    {game.reporting === 1 ? 'commander' : 'commanders'} · {game.sessionsThisMonth}{' '}
                    sessions in {label}
                  </>
                )}
              </p>

              {/*
                ★ WHERE THE RECORD BEGINS ★

                Monthly banking started on a date, and months before it hold nothing — not
                zero. In a year view that includes such months, the bars honestly show empty
                slots; this line is what stops empty reading as "nobody flew in the spring".
              */}
              {game.telemetryRecordedFrom !== null &&
                data.granularity === 'month' &&
                `${data.month}-01` < game.telemetryRecordedFrom && (
                  <p className="mt-1 font-mono text-[11px] text-[var(--color-text-dim)]">
                    Recorded from {monthLabel(game.telemetryRecordedFrom)} — earlier months hold
                    no telemetry record, not a zero.
                  </p>
                )}

              <div className="mt-auto pt-5">
                <div className="border-t border-[var(--color-border-hairline)]" />
              </div>
            </>
          ) : game.telemetryRecordedFrom !== null &&
            (data.granularity === 'month'
              ? data.month < game.telemetryRecordedFrom.slice(0, 4)
              : data.month < game.telemetryRecordedFrom) ? (
            /*
              A period that PREDATES the record. Saying "nothing ingested yet" here would be
              false — plenty has been ingested since — and a blank chart would read as a fault.
              The honest sentence is that the record starts later than the period asked about.
            */
            <Empty>
              Telemetry is recorded from {monthLabel(game.telemetryRecordedFrom)}. {label}{' '}
              predates the record, so there is nothing to chart — the raw events were purged on
              their 30-day schedule before monthly banking existed.
            </Empty>
          ) : (
            <Empty>
              Nothing ingested in {label} yet. Journal data arrives once a member installs the
              companion app and pairs it.
            </Empty>
          )}
        </Section>
      </div>

      {/*
        ★ ITS OWN PANEL, AND FULL WIDTH ★

        This sat inside "The ladder", which was wrong twice over. Visually, a
        segmented bar squeezed into half a column left every small office too
        narrow to carry its own number — the counts collapsed into a stray
        "2 4" floating above a legend that then repeated them.

        More importantly it READ as part of the ladder. Appointments are not
        rungs: they are not earned by qualifying months and promotion never
        moves anybody along them. Somebody can be a Cadet by tenure and a
        Galactic Admiral by appointment at once, and nesting the two invites
        exactly the confusion that had every officer displaying as "Squadron
        Leader" in the first place.

        Full width because a stacked bar IS wide, and because the leadership of
        a squadron deserves its own line rather than a footnote beneath a chart
        about something else.
      */}
      {squadron.appointments.length > 0 && (
        <Section
          title="Leadership appointments"
          description="Offices held right now, most senior first. A separate axis from the ladder above — these are appointed, not earned by qualifying months, and promotion never moves anybody along them."
        >
          <StackedStrip
            unit={squadron.appointments.length === 1 ? 'officer' : 'officers'}
            data={squadron.appointments.map((r) => ({ label: r.rank, value: r.held }))}
          />
        </Section>
      )}
    </>
  );
}
