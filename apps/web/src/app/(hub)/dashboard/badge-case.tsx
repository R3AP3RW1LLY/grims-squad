import { Section, CouldNotLoad } from '../../../components/hub-page';
import type { EarnedBadge } from '../../../lib/api';
import { timeAgo } from '../../../components/forum/identity';

/**
 * The badge case: every leaderboard badge this member has earned, on their own dashboard.
 *
 * ★ EVERY BADGE, NOT A SHOWCASE ★
 *
 * The forum shows a member's top three because a post header is somebody else's reading space.
 * This is their own page, and the whole point of a case is seeing the collection — including the
 * Bronze that Platinum superseded, because the ladder climbed is part of the story.
 *
 * The badges arrive from the API already resolved (name, description, icon, earned date), so a
 * key retired from the catalogue still renders what it meant when it was awarded.
 */
export function BadgeCase({ badges }: { badges: EarnedBadge[] | null }) {
  return (
    <Section
      title="Badges"
      description="Earned from the leaderboards: lifetime points climb the tier ladder, and the achievements mark the runs worth remembering. Hover a badge for what it took."
    >
      {badges === null ? (
        <CouldNotLoad what="your badges" />
      ) : badges.length === 0 ? (
        <p className="max-w-[68ch] rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Nothing earned yet. Badges come from points on the three boards —{' '}
          <a href="/leaderboards/bounties" className="text-[var(--color-brand-cyan-bright)]">
            Data Runners
          </a>
          ,{' '}
          <a href="/leaderboards/colony" className="text-[var(--color-brand-cyan-bright)]">
            Colony Builders
          </a>{' '}
          and{' '}
          <a href="/leaderboards/trade" className="text-[var(--color-brand-cyan-bright)]">
            Trade Barons
          </a>{' '}
          — and the first tier lands at 500 lifetime points on any of them.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((b) => (
            <li
              key={b.key}
              /* The full sentence rides the tooltip; the card itself stays scannable. */
              title={b.description}
              className="flex items-center gap-3 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3"
            >
              <span aria-hidden="true" className="shrink-0 text-3xl leading-none">
                {b.icon}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-[var(--color-text-primary)]">
                  {b.name}
                </span>
                <span className="block font-mono text-[11px] text-[var(--color-text-secondary)]">
                  Earned {timeAgo(b.earnedAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
