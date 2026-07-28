import type { AdminDashboard } from '../../../lib/api';
import { Section, StatGrid, StatTile } from '../../../components/hub-page';
import {
  ActivityHeatmap,
  Donut,
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

  const label = monthLabel(data.month);
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
          hint={`${discord.forumPosts} forum · ${discord.voiceJoins} voice joins`}
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
        description="Every day of the month, shaded by how much happened. Counted from per-day records rather than from a monthly total, so a member active on the 5th and the 20th appears on both."
      >
        {discord.daily.some((d) => d > 0) ? (
          <ActivityHeatmap days={heat} monthLabel={label} />
        ) : (
          <Empty>Nothing recorded this month yet.</Empty>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
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
        </Section>

        <Section
          title="What the squadron flies"
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
        </Section>

        <Section
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
            ★ APPOINTMENTS ARE NOT RUNGS ★

            Squadron Leader and above are appointments, not ranks earned by
            qualifying months, and promotion never moves anybody along them.
            One segmented bar rather than more of the bars above, because that
            reads as "this is the leadership" instead of as a continuation of
            the ladder — which is exactly the confusion to avoid.
          */}
          {squadron.appointments.length > 0 && (
            <div className="mt-6 border-t border-[var(--color-border-hairline)] pt-4">
              <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                Leadership appointments
              </p>
              <StackedStrip
                unit="held"
                data={squadron.appointments.map((r) => ({ label: r.rank, value: r.held }))}
              />
            </div>
          )}
        </Section>

        <Section
          title="Journal telemetry"
          description="What the companion app has sent, by event type. Baseline categories are always collected; anything beyond them is opt-in and appears here only once somebody has turned it on."
        >
          {game.byType.length > 0 ? (
            <>
              <Donut
                unit="events"
                data={game.byType.slice(0, 10).map((t) => ({ label: t.type, value: t.count }))}
              />
              <p className="mt-4 border-t border-[var(--color-border-hairline)] pt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
                {game.events.toLocaleString('en-GB')} events from {game.reporting}{' '}
                {game.reporting === 1 ? 'commander' : 'commanders'} · {game.sessionsThisMonth}{' '}
                sessions this month
              </p>
            </>
          ) : (
            <Empty>
              Nothing ingested yet. Journal data arrives once a member installs the companion app
              and pairs it.
            </Empty>
          )}
        </Section>
      </div>
    </>
  );
}
