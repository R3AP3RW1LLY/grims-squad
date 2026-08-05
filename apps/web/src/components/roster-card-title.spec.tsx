import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RosterCard } from './roster-card';
import type { RosterMember } from '../lib/api';

/**
 * The title line, RENDERED.
 *
 * ★ WHY THIS EXISTS ALONGSIDE THE UNIT TESTS ★
 *
 * `roster-card.spec.ts` proves `titleRoles` returns the right list, and a source
 * scan proves the card calls it. Neither proves what lands on the screen — and
 * the squadron owner's instruction is about what lands on the screen: "where
 * Pebblemerchant says webmaster it should say founder for them."
 *
 * A card that computed "Founder" correctly and then printed the site roles a few
 * lines further down would pass everything else in this directory and be exactly
 * the bug that was reported.
 *
 * The fixtures are the four cases production actually holds, with the roles those
 * accounts really carry.
 */

const COMMANDER = {
  ranks: [],
  rankSource: null,
  ranksFetchedAt: null,
  squadronRank: null,
  currentShip: null,
  lastPlayedAt: null,
};

const MEMBERS = { name: "Grim's Squad members", colour: null };
const WEBMASTER = { name: 'Webmaster', colour: null };

function member(over: Partial<RosterMember>): RosterMember {
  return {
    handle: 'x',
    displayName: 'X',
    avatarUrl: null,
    bio: null,
    timezone: 'UTC',
    lastPlayingAt: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    ranks: [],
    cmdrName: null,
    squadronVerified: false,
    commander: COMMANDER,
    discordRoles: [],
    isOfficer: false,
    siteRoles: [],
    founder: null,
    ...over,
  } as RosterMember;
}

/** The rendered title line, as words. The tracking class identifies it uniquely. */
function titleLine(m: RosterMember): string {
  const html = renderToStaticMarkup(<RosterCard member={m} viewerTimezone="UTC" />);
  const at = html.indexOf('tracking-[0.22em]');
  if (at === -1) return '';
  return html
    .slice(html.lastIndexOf('<p', at), html.indexOf('</p>', at))
    .replace(/<[^>]+>/g, ' ')
    // React escapes the apostrophe in "Grim's Squad members". Read back as text.
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('what the card prints beside the commander name', () => {
  it('MANDATORY: the hub founder reads "Founder", and "Webmaster" is gone', () => {
    /*
     * Pebblemerchant, with the three roles the database actually holds against
     * that account: webmaster, squadron membership, and the founding row.
     */
    const line = titleLine(
      member({
        handle: 'r3ap3ractual_22545',
        displayName: 'Pebblemercahnt',
        cmdrName: 'PEBBLEMERCAHNT',
        siteRoles: [WEBMASTER, MEMBERS],
        founder: { title: 'Founder', precedence: 820, foundedSquadron: false },
      }),
    );

    expect(line).toBe('Commander | Founder');
    expect(line).not.toContain('Webmaster');
  });

  it('MANDATORY: a founder reads "Founder" and a co-founder reads "Co-Founder"', () => {
    const grimsoul = titleLine(
      member({
        cmdrName: 'Mr Grimsoul',
        siteRoles: [MEMBERS],
        founder: { title: 'Founder', precedence: 800, foundedSquadron: true },
      }),
    );
    const vowser = titleLine(
      member({
        cmdrName: 'Vowser',
        siteRoles: [MEMBERS],
        founder: { title: 'Co-Founder', precedence: 810, foundedSquadron: true },
      }),
    );

    expect(grimsoul).toBe('Commander | Founder');
    expect(vowser).toBe('Commander | Co-Founder');
  });

  it('MANDATORY: an ordinary member’s card is untouched', () => {
    // A hundred-odd people. Nothing about this line moved for any of them.
    expect(titleLine(member({ cmdrName: 'Vixie', siteRoles: [MEMBERS] }))).toBe(
      "Commander | Grim's Squad members",
    );
  });

  it('a founder with no verified commander name does not open with a stray divider', () => {
    // The divider belongs to the item that follows it, and is skipped for the
    // first when there is no Commander label in front of it.
    expect(
      titleLine(
        member({
          cmdrName: null,
          siteRoles: [],
          founder: { title: 'Founder', precedence: 800, foundedSquadron: true },
        }),
      ),
    ).toBe('Founder');
  });
});
