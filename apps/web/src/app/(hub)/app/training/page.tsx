import type { Metadata } from 'next';
// The barrel, not the `/ai` subpath: this is a SERVER component, and the subpath exists for client
// components that must not pull the whole of shared into a browser bundle. `SOURCE_LABELS` lives in
// the knowledge contract, which the subpath does not re-export.
import { SOURCE_LABELS, SOURCE_ANSWERS, type KnowledgeSource } from '@grims/shared';
import { getAiTrainingGated, type TrainingSource } from '../../../../lib/api';
import { StepUp } from '../step-up';
import { NoAccess, AdminUnavailable } from '../no-access';
import { PageHeader, PageBody, Section, StatGrid, StatTile } from '../../../../components/hub-page';
import { LiveRefresh } from '../live-refresh';
import { IngestProgress } from './progress';
import { RerunButton } from './rerun';

export const metadata: Metadata = {
  title: "AI training — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * What GMSD AI knows, and when it last learned it.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "include the AI training page in the Administration Category as a new page, show the ingestion
 * categories, if it has been trained, if it is training, and when the next ingestion cycle will be
 * in hours."
 *
 * ★ WHAT THIS PAGE IS ACTUALLY FOR ★
 *
 * It answers "why did the AI not know that", which until now had no answer anybody could look up.
 * A source that is broken and a source that has never run both produce silence, and three jobs on
 * this platform were written, tested and merged without ever executing once — no cron, no timer,
 * no container. Nothing anywhere said so.
 *
 * So every source is listed whether or not it has data, and a source that has never run says
 * exactly that rather than showing an empty count that could mean anything.
 */
export default async function TrainingPage() {
  const read = await getAiTrainingGated();

  if (read.state === 'needs-step-up') return <StepUp />;
  if (read.state === 'signed-out') return <StepUp />;
  if (read.state === 'forbidden') {
    return <NoAccess what="the AI training status" permission="AI_TRAINING" />;
  }
  if (read.state === 'unavailable') return <AdminUnavailable />;

  const sources = read.data.sources;
  const totalRows = sources.reduce((n, s) => n + s.rows, 0);
  const trained = sources.filter((s) => s.rows > 0).length;
  const running = sources.filter((s) => s.ingesting);
  const overdue = sources.filter((s) => s.nextInHours !== null && s.nextInHours < 0);
  /*
   * The flag, not the message. This counted every source with a `lastError` as stalled, which
   * lumped in ordinary failures — so the tile and the row pill could describe the same source two
   * different ways, and the tile was the one people read first.
   */
  const stalled = sources.filter((s) => s.stalled);
  const failed = sources.filter((s) => !s.stalled && s.lastError !== null);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="AI training"
        subtitle="What GMSD AI has learned, and when it next learns more"
      />

      <LiveRefresh />

      <PageBody
        wide
        lead="Facts are stored and looked up at question time rather than baked into the model. That is why a correction takes a second instead of a retraining run — and why a source that has stopped ingesting matters immediately."
      >
        <StatGrid>
          <StatTile label="Facts held" value={totalRows.toLocaleString()} tone="accent" />
          <StatTile label="Sources with data" value={`${trained} of ${sources.length}`} />
          <StatTile
            label="Ingesting now"
            value={running.length === 0 ? 'None' : String(running.length)}
            tone={running.length > 0 ? 'accent' : 'default'}
          />
          <StatTile
            label={stalled.length + failed.length > 0 ? 'Needs attention' : 'Overdue'}
            /*
             * A STALL outranks a failure, and a failure outranks being overdue. Overdue means a
             * schedule has slipped and will catch up on its own; the other two mean a job is not
             * coming back. Showing the smaller number when the larger problem exists is how the
             * larger problem gets missed.
             */
            value={
              stalled.length > 0
                ? `${stalled.length} stalled`
                : failed.length > 0
                  ? `${failed.length} failed`
                  : overdue.length === 0
                    ? 'None'
                    : String(overdue.length)
            }
            tone={stalled.length + failed.length + overdue.length > 0 ? 'warn' : 'default'}
          />
        </StatGrid>

        <Section
          title="Ingestion sources"
          description="Each one answers a different kind of question. Where a source is silent, so is the assistant."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-hairline)] text-left">
                  <Th>Source</Th>
                  <Th>Answers</Th>
                  <Th align="right">Facts</Th>
                  <Th>State</Th>
                  <Th align="right">Next cycle</Th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <SourceRow key={s.source} source={s} />
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </PageBody>
    </>
  );
}

function SourceRow({ source: s }: { source: TrainingSource }) {
  const key = s.source as KnowledgeSource;

  return (
    <tr className="border-b border-[var(--color-border-hairline)] align-top">
      <td className="py-3 pr-4">
        <div className="text-[var(--color-text-primary)]">{SOURCE_LABELS[key] ?? s.source}</div>
        {s.lastError !== null && (
          /*
           * The error is shown in FULL rather than as a status pill, because "galaxy: failed" is
           * something an officer can only escalate and the message is usually something they can
           * act on — a missing file, a rejected key, a disk with nothing left on it.
           */
          <div className="mt-1 font-mono text-[11px] leading-relaxed text-[var(--color-semantic-hostile-bright)]">
            {s.lastError}
          </div>
        )}
      </td>
      <td className="py-3 pr-4 text-[var(--color-text-secondary)]">{SOURCE_ANSWERS[key] ?? ''}</td>
      <td className="py-3 pr-4 text-right font-mono tabular-nums text-[var(--color-text-primary)]">
        {s.rows === 0 ? '—' : s.rows.toLocaleString()}
      </td>
      <td className="py-3 pr-4">
        <State source={s} />
        {/*
          The live bar sits UNDER the pill rather than in the next cell, so the countdown reads as
          part of "Training now" rather than as a competing answer to "next cycle".
        */}
        {s.ingesting && (
          <IngestProgress
            startedAt={s.startedAt}
            rowsSoFar={s.rowsSoFar}
            expectedRows={s.expectedRows}
          />
        )}

        {/*
          ★ OFFERED WHEN SOMETHING IS WRONG, AND ONLY THEN ★
          A stall, a failure, or a source that has never run — the three states that need somebody.
          A "run now" button on a healthy source invites a member to kick off a 448,676-row import
          because the number looked low, which is how a nightly job becomes an hourly one.
        */}
        {!s.ingesting && (s.lastError !== null || s.lastIngestedAt === null) && (
          <div className="mt-2">
            {/*
              ★ EXCEPT EDDN, WHICH HAS NOTHING TO START ★
              It is a resident subscriber, not a job — the daemon has no entry for it and would
              reject the request, leaving the member with "Requested" and no run. What it needs when
              it is down is its container restarted, so that is what it says.
            */}
            {s.source === 'eddn' ? (
              <p className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                Runs continuously — restart the collector if it has stopped reporting.
              </p>
            ) : (
              <RerunButton source={s.source} label={SOURCE_LABELS[key] ?? s.source} />
            )}
          </div>
        )}
      </td>
      <td className="py-3 text-right font-mono tabular-nums text-[var(--color-text-secondary)]">
        {nextLabel(s)}
      </td>
    </tr>
  );
}

/**
 * ★ FOUR STATES, AND THEY ARE NOT INTERCHANGEABLE ★
 *
 * "Never run" and "failed" both leave a source empty and need opposite reactions — one is
 * something nobody has set up, the other is something that broke. Collapsing them into "no data"
 * is exactly how three jobs sat unexecuted for weeks.
 */
function State({ source: s }: { source: TrainingSource }) {
  if (s.ingesting) return <Pill tone="accent">Training now</Pill>;
  /*
   * A stall still arrives as an error message — the job that died left none of its own — but which
   * KIND of wrong it is comes from the flag, not from reading the prose. This used to sniff for a
   * prefix the service had since stopped writing, so every stall showed as "Last run failed" while
   * the tile above went on counting it as stalled.
   */
  if (s.stalled) return <Pill tone="danger">Stalled</Pill>;
  if (s.lastError !== null) return <Pill tone="danger">Last run failed</Pill>;

  /*
   * ★ A SOURCE THAT NEVER FINISHES MUST NOT SAY "TRAINED" — squadron owner, 2026-08-01 ★
   *
   * "if its always updating we should not say Trained it should be Live Updating or something."
   *
   * Exactly right, and the pill was wrong for a specific reason. "Trained" answers "when did the
   * last run complete", which is the only question the other six sources have. The collector has no
   * runs — it closes a reporting window every fifteen minutes purely so this page has something
   * recent to show. Calling that "Trained" reports the bookkeeping as if it were the work, and
   * implies a finished batch that will now sit still until the next one.
   *
   * The freshness check still applies underneath: `stalled` and `lastError` are tested first, so a
   * collector that has actually stopped says so rather than claiming to be live.
   */
  if (s.source === 'eddn') {
    /*
     * ...but only while it is actually live. A collector stopped CLEANLY leaves no unfinished row,
     * so `stalled` is false and nothing else here would notice — the pill would go on saying "Live"
     * over prices that stopped updating hours ago, which is the most confident kind of wrong.
     *
     * Its deadline is the guard: `REFRESH_HOURS.eddn` is one hour and it closes a window every
     * fifteen minutes, so overdue at all means four expected reports did not arrive.
     */
    const dead = s.nextInHours !== null && s.nextInHours < 0;
    return dead ? <Pill tone="danger">Not reporting</Pill> : <Pill tone="accent">Live</Pill>;
  }
  if (s.lastIngestedAt === null) return <Pill tone="muted">Never run</Pill>;
  return <Pill tone="ok">Trained</Pill>;
}

function nextLabel(s: TrainingSource): string {
  /*
   * ★ THE INFINITY, ASKED FOR BY NAME — squadron owner, 2026-08-01 ★
   *
   * "something with the infinite symbol where the - is there now if we can do that please"
   *
   * "Next cycle" has no answer for a subscriber: there is no next one, because there is no
   * boundary between this one and the last. A dash reads as missing data — the same thing the page
   * shows when it does not know — and every other value in this column is a duration, so a number
   * here would be a promise of a wait that never happens. The symbol says "continuously" in the
   * width of one character.
   */
  if (s.source === 'eddn') return '∞';
  if (s.ingesting) return 'in progress';
  if (s.nextInHours === null) return 'not scheduled';
  // Negative is overdue, and it is SHOWN as overdue rather than clamped to zero: "4h overdue" and
  // "due now" need different reactions, and clamping hides the first.
  if (s.nextInHours < 0) return `${Math.abs(s.nextInHours).toFixed(1)}h overdue`;
  if (s.nextInHours < 1) return 'within the hour';
  return `in ${s.nextInHours.toFixed(1)}h`;
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`pb-2 font-mono text-[10px] font-normal uppercase tracking-[0.24em] text-[var(--color-text-secondary)] ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'ok' | 'accent' | 'danger' | 'muted';
}) {
  const colour = {
    ok: 'border-[var(--color-semantic-success)] text-[var(--color-semantic-success)]',
    accent: 'border-[var(--color-brand-cyan-bright)] text-[var(--color-brand-cyan-bright)]',
    danger: 'border-[var(--color-semantic-hostile-bright)] text-[var(--color-semantic-hostile-bright)]',
    muted: 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)]',
  }[tone];

  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${colour}`}
    >
      {children}
    </span>
  );
}
