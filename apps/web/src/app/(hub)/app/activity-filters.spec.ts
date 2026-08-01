import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  isFiltering,
  matchesFilter,
  rankLabel,
  tenureBucket,
  distinct,
  type ActivityFilter,
} from './activity-filters';
import { squadronTenure } from './member-tenure';
import type { AdminActivityRow } from '../../../lib/api';

const NOW = new Date('2026-08-01T12:00:00Z').getTime();

function row(over: Partial<AdminActivityRow> = {}): AdminActivityRow {
  return {
    discordId: '820808610073280512',
    handle: null,
    displayName: null,
    nick: 'Rablefin',
    joinedWebsite: false,
    cmdrName: null,
    verifiedVia: null,
    lastSeenAt: '2026-07-30T00:00:00Z',
    inVoiceSince: null,
    currentRank: 'Cadet',
    appointment: null,
    membershipRole: null,
    nextRank: 'Sergeant',
    messageCount: 10,
    forumPostCount: 0,
    voiceJoinCount: 0,
    gameActivity: 'observed',
    qualifies: true,
    lastActivityAt: null,
    joinedAt: '2025-08-01T00:00:00Z',
    activeSince: null,
    ...over,
  };
}

const filter = (over: Partial<ActivityFilter>): ActivityFilter => ({ ...EMPTY_FILTER, ...over });

describe('matchesFilter', () => {
  it('an empty filter keeps everything', () => {
    expect(matchesFilter(row(), EMPTY_FILTER, NOW)).toBe(true);
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
  });

  it('searches every name a member is known by', () => {
    const r = row({ nick: 'Rablefin', cmdrName: 'HARRY BALLS', handle: 'rab' });
    expect(matchesFilter(r, filter({ member: 'rable' }), NOW)).toBe(true);
    expect(matchesFilter(r, filter({ member: 'harry' }), NOW)).toBe(true);
    expect(matchesFilter(r, filter({ member: 'RAB' }), NOW)).toBe(true);
    expect(matchesFilter(r, filter({ member: 'nobody' }), NOW)).toBe(false);
  });

  it('MANDATORY: searches the discord id too', () => {
    // What an officer has in hand after copying somebody out of Discord's own UI, and the only
    // identifier that is never ambiguous.
    expect(matchesFilter(row(), filter({ member: '8208086' }), NOW)).toBe(true);
  });

  it('whitespace alone is not a search', () => {
    expect(matchesFilter(row({ nick: 'X' }), filter({ member: '   ' }), NOW)).toBe(true);
  });

  it('separates hub accounts from Discord-only members', () => {
    expect(matchesFilter(row({ joinedWebsite: true }), filter({ hub: 'joined' }), NOW)).toBe(true);
    expect(matchesFilter(row({ joinedWebsite: true }), filter({ hub: 'discord' }), NOW)).toBe(false);
    expect(matchesFilter(row({ joinedWebsite: false }), filter({ hub: 'discord' }), NOW)).toBe(true);
  });

  it('filters on commander verification', () => {
    expect(matchesFilter(row({ cmdrName: 'GRIM' }), filter({ verified: 'yes' }), NOW)).toBe(true);
    expect(matchesFilter(row({ cmdrName: null }), filter({ verified: 'yes' }), NOW)).toBe(false);
    expect(matchesFilter(row({ cmdrName: null }), filter({ verified: 'no' }), NOW)).toBe(true);
  });

  it('MANDATORY: the rank filter uses the label the table shows', () => {
    /*
     * The column falls back through rank, then membership role, then "Unranked". A filter that read
     * `currentRank` alone would offer "Grim's Squad members" in the dropdown and then match nothing
     * when it was picked — an empty table that looks like a bug in the data.
     */
    const member = row({ currentRank: null, membershipRole: "Grim's Squad members" });
    expect(rankLabel(member)).toBe("Grim's Squad members");
    expect(matchesFilter(member, filter({ rank: "Grim's Squad members" }), NOW)).toBe(true);

    const nobody = row({ currentRank: null, membershipRole: null });
    expect(rankLabel(nobody)).toBe('Unranked');
    expect(matchesFilter(nobody, filter({ rank: 'Unranked' }), NOW)).toBe(true);
  });

  it('MANDATORY: top of the ladder filters as n/a, not as "no"', () => {
    /*
     * `qualifies` is false for a Grand Master General by design — there is no rank above them. A
     * two-state filter would file them with members who have done nothing all month, which is the
     * opposite of what they have done.
     */
    const top = row({ currentRank: 'Grand Master General', nextRank: null, qualifies: false });
    expect(matchesFilter(top, filter({ qualifies: 'na' }), NOW)).toBe(true);
    expect(matchesFilter(top, filter({ qualifies: 'no' }), NOW)).toBe(false);

    const idle = row({ qualifies: false });
    expect(matchesFilter(idle, filter({ qualifies: 'no' }), NOW)).toBe(true);
    expect(matchesFilter(idle, filter({ qualifies: 'na' }), NOW)).toBe(false);
  });

  it('MANDATORY: somebody in voice is never filtered as gone quiet', () => {
    /*
     * The single most obviously wrong thing this page can do. An officer filtering for who has gone
     * quiet must not be handed somebody who is sitting in comms right now, however old their last
     * message is.
     */
    const inComms = row({ lastSeenAt: '2025-01-01T00:00:00Z', inVoiceSince: '2026-08-01T11:00:00Z' });
    expect(matchesFilter(inComms, filter({ seen: 'quiet' }), NOW)).toBe(false);
    expect(matchesFilter(inComms, filter({ seen: 'live' }), NOW)).toBe(true);
  });

  it('finds members who have gone quiet', () => {
    const silent = row({ lastSeenAt: '2026-01-01T00:00:00Z', inVoiceSince: null });
    expect(matchesFilter(silent, filter({ seen: 'quiet' }), NOW)).toBe(true);
    expect(matchesFilter(silent, filter({ seen: 'active' }), NOW)).toBe(false);
  });

  it('MANDATORY: a blank number box is no filter, and zero is a real one', () => {
    /*
     * Conflating them is the obvious bug: null must mean "not filtering", so clearing the box
     * restores every row rather than leaving a 0 quietly applied — or worse, filtering nothing while
     * showing a value.
     */
    expect(matchesFilter(row({ messageCount: 0 }), filter({ minMessages: null }), NOW)).toBe(true);
    expect(matchesFilter(row({ messageCount: 0 }), filter({ minMessages: 0 }), NOW)).toBe(true);
    expect(matchesFilter(row({ messageCount: 0 }), filter({ minMessages: 1 }), NOW)).toBe(false);
    expect(matchesFilter(row({ messageCount: 5 }), filter({ minMessages: 5 }), NOW)).toBe(true);
    expect(isFiltering(filter({ minMessages: 0 }))).toBe(true);
  });

  it('every filter ANDs with the others', () => {
    const r = row({ joinedWebsite: true, cmdrName: 'GRIM', messageCount: 50 });
    expect(matchesFilter(r, filter({ hub: 'joined', verified: 'yes', minMessages: 10 }), NOW)).toBe(true);
    expect(matchesFilter(r, filter({ hub: 'joined', verified: 'yes', minMessages: 99 }), NOW)).toBe(false);
  });
});

describe('tenure', () => {
  it('reads the Discord join date, and says so', () => {
    const t = squadronTenure(row({ joinedAt: '2025-02-01T00:00:00Z' }), NOW);
    expect(t?.source).toBe('joined');
    expect(t?.label).toBe('1 year 6 months');
  });

  it('MANDATORY: falls back to first activity, and does NOT call it a join date', () => {
    /*
     * Everybody who has left. Discord discards their join date, so the only date we hold is the
     * first month we recorded anything — which is a floor, not a start. They could have been here a
     * year before the bot was, and the column must not claim otherwise.
     */
    const t = squadronTenure(row({ joinedAt: null, activeSince: '2026-07-12T00:00:00Z' }), NOW);
    expect(t?.source).toBe('seen');
    expect(t?.label).toBe('20 days');
  });

  it('MANDATORY: no dates at all is unknown, never "today"', () => {
    // Rendering an absent tenure as zero would tell an officer a long-standing member joined this
    // morning — a wrong answer in the direction they would act on.
    expect(squadronTenure(row({ joinedAt: null, activeSince: null }), NOW)).toBeNull();
    expect(tenureBucket(row({ joinedAt: null, activeSince: null }), NOW)).toBe('unknown');
  });

  it('buckets by total days', () => {
    expect(tenureBucket(row({ joinedAt: '2026-07-20T00:00:00Z' }), NOW)).toBe('under1m');
    expect(tenureBucket(row({ joinedAt: '2026-05-01T00:00:00Z' }), NOW)).toBe('1to6m');
    expect(tenureBucket(row({ joinedAt: '2025-11-01T00:00:00Z' }), NOW)).toBe('6to12m');
    expect(tenureBucket(row({ joinedAt: '2024-01-01T00:00:00Z' }), NOW)).toBe('over1y');
  });

  it('the joined date wins when both are present', () => {
    // They disagree constantly — activity only starts when the bot does. The exact one wins.
    const t = squadronTenure(
      row({ joinedAt: '2024-01-01T00:00:00Z', activeSince: '2026-07-01T00:00:00Z' }),
      NOW,
    );
    expect(t?.source).toBe('joined');
    expect(t?.label).toBe('2 years 7 months');
  });
});

describe('distinct', () => {
  it('builds dropdown values from the rows, sorted and deduplicated', () => {
    const rows = [row({ currentRank: 'Sergeant' }), row({ currentRank: 'Cadet' }), row({ currentRank: 'Cadet' })];
    expect(distinct(rows, rankLabel)).toEqual(['Cadet', 'Sergeant']);
  });

  it('drops empties rather than offering a blank option', () => {
    expect(distinct([row(), row()], () => '')).toEqual([]);
  });
});
