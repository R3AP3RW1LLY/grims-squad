import type { Metadata } from 'next';
import {
  getChangelog,
  getChangelogPendingGated,
  getMe,
  type ChangelogRelease,
  type PendingChangelog,
} from '../../../lib/api';
import { formatLocal } from '../../../lib/time';
import { PageHeader, PageBody, Panel, CouldNotLoad } from '../../../components/hub-page';

export const metadata: Metadata = {
  title: "Changelog — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * What each deploy changed, grouped by who it changed things for.
 *
 * The entries are the commit messages' own prose — `tools/changelog.mjs`
 * strips the machinery and keeps the words, and the deploy script records the
 * result the moment a deploy verifies. So this page is a ledger, not an
 * announcement channel: it says what shipped because shipping wrote it down.
 *
 * ★ THE PENDING SECTION IS THE API'S CALL, NOT THIS PAGE'S ★
 *
 * The preview of a build that has NOT deployed yet comes from a gated
 * endpoint (SITE_CONFIG). This page renders whatever that read returns and
 * asks no permission question of its own — the same single-source rule as the
 * nav: two places answering "who may see this" is how the two answers drift.
 * For everybody else the read comes back forbidden and the page simply has no
 * pending section, which is the page working, not failing.
 */

/**
 * The changelog markdown, rendered without a markdown library.
 *
 * ★ A PARSER FOR A GRAMMAR WE WROTE, NOT FOR MARKDOWN ★
 *
 * The only writer of these strings is `tools/changelog.mjs`: `### Subject`
 * headings, blank-line-separated paragraphs, and the occasional dashed list
 * inside a commit body. Parsing exactly that means no dependency, no
 * dangerouslySetInnerHTML, and no path where somebody's commit prose becomes
 * live HTML — the CSP would catch a script, but never rendering one is
 * strictly better than blocking one.
 */
function ChangelogMarkdown({ md }: { md: string }) {
  const blocks = md.split(/\n[ \t]*\n/).filter((b) => b.trim() !== '');

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.startsWith('### ')) {
          return (
            <h4 key={i} className="pt-2 font-semibold text-[var(--color-text-primary)]">
              {block.slice(4).trim()}
            </h4>
          );
        }

        const lines = block.split('\n');
        if (lines.every((line) => /^[-*]\s+/.test(line.trim()))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {lines.map((line, j) => (
                <li key={j}>{line.trim().replace(/^[-*]\s+/, '')}</li>
              ))}
            </ul>
          );
        }

        /*
         * Commit bodies arrive hard-wrapped at ~72 characters. Joining the
         * lines lets the paragraph reflow to the reading width instead of
         * preserving somebody's editor margin as ragged line breaks.
         */
        return (
          <p key={i} className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {lines.join(' ')}
          </p>
        );
      })}
    </div>
  );
}

/** The three audience groups of one release, empty ones omitted rather than headed over nothing. */
function ReleaseGroups({
  websiteMd,
  companionMd,
  platformMd,
}: {
  websiteMd: string;
  companionMd: string;
  platformMd: string;
}) {
  const groups = [
    { title: 'Website', md: websiteMd },
    { title: 'Companion App', md: companionMd },
    { title: 'Platform', md: platformMd },
  ].filter((group) => group.md.trim() !== '');

  if (groups.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        This deploy carried no recorded changes.
      </p>
    );
  }

  /*
   * ★ THE WIDTH IS FILLED WITH DIFFERENT CONTENT — hub-page's own doctrine, applied ★
   *
   * The first cut rendered the three groups stacked in the narrow reading column, which on a
   * wide screen sat "all smashed to the left" (the owner's words). Website, Companion App and
   * Platform are three parallel answers to the same deploy, so they sit as three columns — each
   * its own readable measure — collapsing to a stack only where the viewport forces it.
   */
  return (
    <div className={`grid gap-8 ${groups.length > 1 ? 'lg:grid-cols-2 xl:grid-cols-3' : ''}`}>
      {groups.map((group) => (
        <section key={group.title} className="min-w-0">
          <h3 className="mb-3 border-b border-[var(--color-border-hairline)] pb-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
            {group.title}
          </h3>
          <ChangelogMarkdown md={group.md} />
        </section>
      ))}
    </div>
  );
}

/** `12 Aug 2026, 21:30 · 2026-08-12 21:30 UTC` — local AND UTC, always (INV-025). */
function bothTimes(iso: string, viewerTz: string): string {
  const utc = `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return `${formatLocal(iso, viewerTz)} · ${utc}`;
}

function Release({ release, viewerTz }: { release: ChangelogRelease; viewerTz: string }) {
  return (
    <article className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          className="text-lg text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {/* The version leads when a release has one; the deploy instant always rides with it. */}
          {release.version === null ? 'Deployed' : `v${release.version} —`}{' '}
          {bothTimes(release.deployedAt, viewerTz)}
        </h2>
        <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
          {release.fromSha.slice(0, 8)} → {release.toSha.slice(0, 8)}
        </span>
      </header>
      <ReleaseGroups
        websiteMd={release.websiteMd}
        companionMd={release.companionMd}
        platformMd={release.platformMd}
      />
    </article>
  );
}

function PendingRelease({ pending, viewerTz }: { pending: PendingChangelog; viewerTz: string }) {
  return (
    <Panel tone="warning" title="Pending — built, not yet deployed">
      <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-primary)]">
        {pending.version === null ? '' : `Version ${pending.version}: `}
        {pending.commitCount} commit{pending.commitCount === 1 ? '' : 's'} sit between production
        ({pending.fromSha.slice(0, 8)}) and this build ({pending.toSha.slice(0, 8)}). Nothing below
        is on the site yet — this preview exists so the release can be read before it ships, and it
        becomes the top entry above the moment a deploy records it. Generated{' '}
        {bothTimes(pending.generatedAt, viewerTz)}.
      </p>
      <ReleaseGroups
        websiteMd={pending.websiteMd}
        companionMd={pending.companionMd}
        platformMd={pending.platformMd}
      />
    </Panel>
  );
}

export default async function ChangelogPage() {
  const [me, log, pendingRead] = await Promise.all([
    getMe(),
    getChangelog(),
    getChangelogPendingGated(),
  ]);
  const viewerTz = me.user?.timezone ?? 'UTC';

  const pending = pendingRead.state === 'ok' ? pendingRead.data.pending : null;

  return (
    <>
      <PageHeader
        eyebrow="Squadron"
        title="Changelog"
        subtitle="What each deploy changed"
      />
      <PageBody wide lead="Every deploy is recorded here the moment it goes live: what changed on the website, what changed in the companion app, and what changed in the platform behind them — in the words of the people who built it, newest first.">
        {pending !== null && (
          <div className="mb-8">
            <PendingRelease pending={pending} viewerTz={viewerTz} />
          </div>
        )}

        {log === null ? (
          <CouldNotLoad what="the changelog" />
        ) : log.releases.length === 0 ? (
          <Panel>
            <p className="text-[var(--color-text-primary)]">No releases recorded yet.</p>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              The ledger starts with the first deploy made after the changelog shipped — earlier
              deploys predate the recorder, so they are in the site rather than on this page.
            </p>
          </Panel>
        ) : (
          <div className="space-y-6">
            {log.releases.map((release) => (
              <Release key={release.id} release={release} viewerTz={viewerTz} />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
