import type { AdminDashboard } from '../../../lib/api';
import { Section, StatGrid, StatTile } from '../../../components/hub-page';

/**
 * The admin dashboard.
 *
 * ★ WHAT IT IS FOR ★
 *
 * Answering, in one screen, the three questions an officer actually opens this
 * page with: is the squadron alive, is anyone flying, and who is due a
 * promotion. Every panel below is one of those three and nothing else — a
 * dashboard that shows everything is a dashboard nobody reads.
 *
 * ★ NO CHARTING LIBRARY ★
 *
 * The bars are divs. A charting library would be ~90 kB on a page four people
 * see, would need a client component and would ship a rendering engine to draw
 * thirty rectangles. CSS grid does it, renders on the server, and works with
 * JavaScript switched off.
 */

function Bars({ values, label }: { values: readonly number[]; label: string }) {
  // Scaled to the busiest day, not to a fixed ceiling. A fixed one either
  // clips a good month or flattens a quiet one into a straight line.
  const peak = Math.max(1, ...values);

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex h-24 items-end gap-px" role="img" aria-label={label}>
        {values.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-[var(--color-brand-cyan-bright)] transition-all"
            style={{
              height: `${Math.max(2, (v / peak) * 100)}%`,
              // Quiet days recede rather than vanishing. A zero-height bar and
              // a missing day look identical, and they are not the same thing.
              opacity: v === 0 ? 0.15 : 0.45 + (v / peak) * 0.55,
            }}
            title={`Day ${i + 1}: ${v}`}
          />
        ))}
      </div>
    </figure>
  );
}

/** A labelled proportional bar, for rankings where the numbers matter as much as the order. */
function Ranked({
  rows,
  unit,
}: {
  rows: ReadonlyArray<{ label: string; value: number; sub?: string | undefined }>;
  unit: string;
}) {
  const peak = Math.max(1, ...rows.map((r) => r.value));

  return (
    <ol className="m-0 list-none space-y-2 p-0">
      {rows.map((r) => (
        <li key={r.label} className="relative overflow-hidden rounded px-3 py-2">
          {/*
            The bar sits BEHIND the text rather than beside it. A separate bar
            column forces the labels into a narrow gutter, and commander names
            and ship types are both long.
          */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 rounded bg-[var(--color-brand-cyan-bright)] opacity-[0.14]"
            style={{ width: `${(r.value / peak) * 100}%` }}
          />
          <span className="relative flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-[var(--color-text-primary)]">
              {r.label}
              {r.sub !== undefined && (
                <span className="ml-2 font-mono text-[10px] text-[var(--color-text-secondary)]">
                  {r.sub}
                </span>
              )}
            </span>
            <span className="shrink-0 font-mono text-sm text-[var(--color-brand-cyan-bright)]">
              {r.value.toLocaleString('en-GB')}
              <span className="ml-1 text-[10px] text-[var(--color-text-secondary)]">{unit}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
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

  const participation =
    squadron.members === 0 ? 0 : Math.round((discord.activeMembers / squadron.members) * 100);

  return (
    <>
      <StatGrid>
        <StatTile
          label="Active this month"
          value={String(discord.activeMembers)}
          hint={`${participation}% of ${squadron.members} members`}
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
          hint="Discord activity AND an Elite session"
          tone={squadron.qualifying === 0 ? 'warn' : 'default'}
        />
      </StatGrid>

      <Section
        title={`Who showed up — ${data.month}`}
        description="Members active on each day of the month. Discord keeps no per-message history, so this counts people rather than messages: a tall bar is a busy day for the squadron, not for one person."
      >
        {discord.daily.some((d) => d > 0) ? (
          <Bars values={discord.daily} label={`Active members per day, ${data.month}`} />
        ) : (
          <Empty>Nothing recorded this month yet.</Empty>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Most active"
          description="By message count this month. The same figures the promotion system reads."
        >
          {discord.top.length > 0 ? (
            <Ranked
              unit="msg"
              rows={discord.top.map((t) => ({
                label: t.name,
                value: t.messages,
                sub: t.voice > 0 ? `${t.voice} voice` : undefined,
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
            <Ranked
              unit={game.ships.length === 1 ? 'pilot' : 'pilots'}
              rows={game.ships.map((s) => ({ label: s.ship, value: s.pilots }))}
            />
          ) : (
            <Empty>No commander has reported a session yet.</Empty>
          )}
        </Section>

        <Section
          title="The ladder"
          description="Members holding each rank right now, read from granted roles."
        >
          {squadron.ranks.length > 0 ? (
            <Ranked
              unit={'held'}
              rows={squadron.ranks.map((r) => ({ label: r.rank, value: r.held }))}
            />
          ) : (
            <Empty>Nobody holds a squadron rank yet.</Empty>
          )}
        </Section>

        <Section
          title="Journal telemetry"
          description="What the companion app has sent, by event type. Baseline categories are always collected; anything beyond them is opt-in and appears here only once somebody has turned it on."
        >
          {game.byType.length > 0 ? (
            <>
              <Ranked
                unit="events"
                rows={game.byType.slice(0, 8).map((t) => ({ label: t.type, value: t.count }))}
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
