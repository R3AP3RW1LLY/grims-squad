import { describe, expect, it } from 'vitest';
import { colonyProjectContent, type ColonyProjectAnnouncement } from './announce.js';

/**
 * The squadron colonisation announcement, in the wording the owner approved.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "when a new squadron colonization project is created, can we send a notification to this discord
 * channel please ... with a link to the project on the website ... include the name of the
 * commander who started the squadron project"
 *
 * Four decisions were put to them with previews built from live production rows, and all four were
 * confirmed: name the commander with a Discord MENTION (as every other announcement does),
 * announce ADOPTIONS as well as creations, post IMMEDIATELY rather than waiting for a tonnage
 * nobody has measured yet, and keep the channel id in configuration.
 *
 * ★ THE PREVIEW WAS WRONG ONCE, AND THAT IS WHY THIS FILE USES REAL ROWS ★
 *
 * The first preview said "Started by CMDR Pebblemerchant" because I filled the name in from
 * memory instead of reading the database. Every squadron project in production was in fact posted
 * by GMSD Aurelian Voss. The fixtures below are the real rows, so the wording is checked against
 * what members will actually see rather than against what I assumed.
 */

/*
 * ★ THE SNOWFLAKES ARE INVENTED, AND HAVE TO BE (INV-008) ★
 *
 * The names and the project rows are real — that is the point of this file, after a preview went
 * out with a name I had assumed rather than read. The Discord IDs are not: a real snowflake in
 * source is a hard-coded identity, which the invariant forbids and the secret scan catches. These
 * are the right SHAPE, which is all the template cares about.
 */
const VOSS = { displayName: 'GMSD Aurelian Voss', discordId: '100000000000000001' };
const SITE = 'https://grims-squad.com';

/** Harry's Dysfunctional Society, exactly as production holds it. */
const IDENTIFIED: ColonyProjectAnnouncement = {
  id: '52f525c5-9578-412e-88af-809104d1b707',
  title: "Harry's Dysfunctional Society",
  systemName: 'Hyades Sector XJ-Z c18',
  identifiedAs: 'Port Surface Outpost',
  totalTonnes: 216_030,
  startedBy: VOSS,
};

/** Crimson's Industrial Forge — posted before anybody docked, so it has no build type yet. */
const UNIDENTIFIED: ColonyProjectAnnouncement = {
  id: '256675fd-61b3-4efa-8910-552dae080e49',
  title: "Crimson's Industrial Forge",
  systemName: 'Hyades Sector WO-Y b1-4',
  identifiedAs: null,
  totalTonnes: null,
  startedBy: VOSS,
};

describe('a new squadron colonisation project', () => {
  it('MANDATORY: names the commander who started it, as a mention', () => {
    /*
     * The owner's actual request — "include the name of the commander who started the squadron
     * project" — answered the way every other announcement answers it, so Discord renders their
     * current name and they are pinged.
     */
    const content = colonyProjectContent(IDENTIFIED, SITE);
    expect(content).toContain(`Started by **<@${VOSS.discordId}>**`);
  });

  it('MANDATORY: links the project on the website', () => {
    expect(colonyProjectContent(IDENTIFIED, SITE)).toContain(
      'https://grims-squad.com/colonisation/52f525c5-9578-412e-88af-809104d1b707',
    );
  });

  it('a trailing slash on the site URL does not produce a double slash', () => {
    expect(colonyProjectContent(IDENTIFIED, 'https://grims-squad.com/')).toContain(
      'https://grims-squad.com/colonisation/',
    );
    expect(colonyProjectContent(IDENTIFIED, 'https://grims-squad.com/')).not.toContain('.com//');
  });

  it('reads as the owner approved it, end to end', () => {
    expect(colonyProjectContent(IDENTIFIED, SITE)).toBe(
      [
        '🏗️ **A new squadron colonisation project**',
        '',
        "**Harry's Dysfunctional Society**",
        'Hyades Sector XJ-Z c18 · Port Surface Outpost · 216,030 t',
        '',
        `Started by **<@${VOSS.discordId}>**`,
        '',
        'https://grims-squad.com/colonisation/52f525c5-9578-412e-88af-809104d1b707',
      ].join('\n'),
    );
  });

  it('MANDATORY: an unidentified site says so rather than showing a blank', () => {
    /*
     * A build type and tonnage are only known once somebody DOCKS at the site, which usually
     * happens after the project is posted. The owner chose to post immediately — waiting delivers
     * the message after the early hauling, which is the hauling it exists to summon.
     */
    const content = colonyProjectContent(UNIDENTIFIED, SITE);
    expect(content).toContain('Hyades Sector WO-Y b1-4 · build type not identified yet');
    expect(content).not.toContain('null');
    expect(content).not.toContain(' t\n');
  });
});

describe('a project adopted into the squadron', () => {
  const adopted: ColonyProjectAnnouncement = {
    ...IDENTIFIED,
    title: 'Kurland Point',
    id: 'fd54deed-7d47-496b-b1cc-b2aeb8f0abf5',
    identifiedAs: 'Pirate Installation',
    totalTonnes: 6_721,
    adoptedBy: { displayName: 'Mr Grimsoul', discordId: '100000000000000002' },
  };

  it('MANDATORY: names BOTH people, and does not transfer the credit', () => {
    /*
     * Finding the site and committing the squadron to it are different acts by different members.
     * Naming only the officer would quietly hand them the first; naming only the poster would
     * hide who made the decision.
     */
    const content = colonyProjectContent(adopted, SITE);
    expect(content).toContain(
      `Found by **<@${VOSS.discordId}>**, adopted by **<@${adopted.adoptedBy?.discordId}>**`,
    );
  });

  it('says it was adopted, not that it is new', () => {
    const content = colonyProjectContent(adopted, SITE);
    expect(content).toContain('**Adopted as a squadron project**');
    expect(content).not.toContain('A new squadron colonisation project');
  });
});

describe('a member who has not linked Discord', () => {
  it('is named in plain text rather than as a broken mention token', () => {
    // A mention for an id Discord does not know renders as literal `<@…>` noise.
    const content = colonyProjectContent(
      { ...IDENTIFIED, startedBy: { displayName: 'Vixie', discordId: null } },
      SITE,
    );
    expect(content).toContain('Started by **Vixie**');
    expect(content).not.toContain('<@');
  });
});
