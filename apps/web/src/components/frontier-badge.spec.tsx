import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RosterCard } from './roster-card';
import type { RosterMember } from '../lib/api';

/**
 * Both verification badges, RENDERED.
 *
 * ★ WHY THIS EXISTS ALONGSIDE THE UNIT TESTS ★
 *
 * `roster-card.spec.ts` proves `frontierBadge` returns the right words for each
 * state, and a source scan proves the card calls it. Neither proves what lands on
 * a card — and a card that computed "Frontier expired" correctly and then printed
 * it nowhere would pass both and be exactly the bug that gets reported.
 *
 * The other half is the one this file exists for. There are now TWO badges on
 * every card, and the squadron owner asked for the second one "like we have for
 * Inara verified" — so they are deliberately the same pill. Two identical pills
 * that differ only in a colour are one badge with a bug. These tests strip the
 * colour out and check they are still telling a reader two different things.
 */

const COMMANDER = {
  ranks: [],
  rankSource: null,
  ranksFetchedAt: null,
  squadronRank: null,
  currentShip: null,
  lastPlayedAt: null,
};

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
    cmdrName: 'PEBBLEMERCAHNT',
    squadronVerified: false,
    frontierVerification: 'none',
    commander: COMMANDER,
    discordRoles: [],
    isOfficer: false,
    siteRoles: [],
    founder: null,
    ...over,
  } as RosterMember;
}

const render = (over: Partial<RosterMember>): string =>
  renderToStaticMarkup(<RosterCard member={member(over)} viewerTimezone="UTC" />);

/** The card as somebody who cannot distinguish the colours reads it. */
const withoutColour = (html: string): string => html.replace(/ class="[^"]*"/g, '');

const occurrences = (html: string, needle: string): number => html.split(needle).length - 1;

describe('the Frontier badge on a card', () => {
  it('MANDATORY: a verified member is told so, in words', () => {
    expect(render({ frontierVerification: 'verified' })).toContain('Frontier verified');
  });

  it('MANDATORY: an expired grant never renders as verified', () => {
    /*
     * ★ THE ONE THAT MATTERS ★
     *
     * Frontier honours a link for 25 days. Past that the platform cannot ask
     * Frontier anything about this member, so a lit badge would be a claim we
     * have no way to stand behind. It says what is true instead: this WAS proven,
     * and the connection has lapsed.
     */
    const html = render({ frontierVerification: 'expired' });

    expect(html).toContain('Frontier expired');
    expect(html).not.toContain('Frontier verified');
  });

  it('MANDATORY: somebody who has never linked is not shown as expired either', () => {
    // They have not lapsed; they have not started. Telling them to reconnect
    // something they never connected sends them looking for a button that does
    // not apply to them.
    const html = render({ frontierVerification: 'none' });

    expect(html).not.toContain('Frontier verified');
    expect(html).not.toContain('Frontier expired');
  });

  it('MANDATORY: both badges always render, in every combination', () => {
    /*
     * A badge that appears only on success leaves everybody else merely
     * unlabelled, and a reader cannot tell "not verified" from "not reported".
     * With two badges the failure is worse: one pill on a card gives no clue
     * WHICH check it is the answer to.
     */
    const nothing = render({ squadronVerified: false, frontierVerification: 'none' });
    expect(occurrences(nothing, 'Not verified')).toBe(2);

    const both = render({ squadronVerified: true, frontierVerification: 'verified' });
    expect(both).toContain('Inara verified');
    expect(both).toContain('Frontier verified');
  });

  it('MANDATORY: the two badges are told apart WITHOUT colour', () => {
    /*
     * ★ THE POINT OF THIS FILE ★
     *
     * Both pills are green with a tick when both checks pass. If green-with-a-
     * tick were the whole signal, a card would be asserting two different things
     * in a way nobody could separate — including anybody who cannot distinguish
     * the colours at all.
     *
     * Three things separate them and none is a colour: the label column says
     * which source is being answered, the pill names its own source, and the
     * rows are in a fixed order on every card.
     */
    const plain = withoutColour(render({ squadronVerified: true, frontierVerification: 'verified' }));

    expect(plain).toContain('<dt>Inara</dt>');
    expect(plain).toContain('<dt>Frontier</dt>');
    expect(plain).toContain('Inara verified');
    expect(plain).toContain('Frontier verified');

    // And the label column reaches them in that order, so the same badge is in
    // the same place on every card in the grid.
    expect(plain.indexOf('<dt>Inara</dt>')).toBeLessThan(plain.indexOf('<dt>Frontier</dt>'));
  });

  it('MANDATORY: the three Frontier states are told apart WITHOUT colour', () => {
    // Same argument one level down. A member reading their own card in
    // greyscale must still be able to tell "verified" from "expired".
    const states = (['verified', 'expired', 'none'] as const).map((frontierVerification) =>
      withoutColour(render({ frontierVerification })),
    );

    expect(new Set(states).size).toBe(3);
  });

  it('MANDATORY: nothing on the Frontier badge claims a squadron', () => {
    /*
     * Squadron verification via cAPI was dropped from scope. Frontier proves an
     * IDENTITY — that this member signed in to Frontier and Frontier named this
     * commander. It has no idea who they fly with, and the tooltip says so out
     * loud rather than leaving a reader to assume the badge means what the one
     * above it means.
     */
    const html = render({ frontierVerification: 'verified' });

    expect(html).toMatch(/says nothing about which squadron/i);
  });
});
