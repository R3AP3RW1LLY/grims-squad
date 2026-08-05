import { describe, expect, it } from 'vitest';
import {
  appReleaseContent,
  colonyProjectContent,
  type ColonyProjectAnnouncement,
} from './announce.js';

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
  owner: 'squadron',
  startedBy: VOSS,
};

/** Crimson's Industrial Forge — posted before anybody docked, so it has no build type yet. */
const UNIDENTIFIED: ColonyProjectAnnouncement = {
  id: '256675fd-61b3-4efa-8910-552dae080e49',
  title: "Crimson's Industrial Forge",
  systemName: 'Hyades Sector WO-Y b1-4',
  identifiedAs: null,
  totalTonnes: null,
  owner: 'squadron',
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

/**
 * The companion release announcement.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "we need to make an announcement too everytime the companion app is updated please! same channel
 * as the web announcements, provide a link to manually download and update the app if they want
 * too please!"
 *
 * The order of the sentences is the whole design. The app updates itself, so leading with a
 * download link would read as an instruction and members would start doing by hand something that
 * has already happened. The automatic path is stated first; the link is offered second, for a
 * machine that has been off, an install that was never paired, or somebody who would rather.
 */
describe('a companion release announcement', () => {
  const SITE = 'https://grims-squad.com';

  it('MANDATORY: names the version', () => {
    expect(appReleaseContent('0.5.1', SITE)).toContain('v0.5.1');
  });

  it('MANDATORY: carries the manual download link the owner asked for', () => {
    expect(appReleaseContent('0.5.1', SITE)).toContain('https://grims-squad.com/companion');
  });

  it('MANDATORY: says they do not have to do anything, BEFORE offering the link', () => {
    /*
     * A link presented first is an instruction. The app installs this on its own — telling them so
     * first is what stops a hundred people downloading an installer they did not need.
     */
    const content = appReleaseContent('0.5.1', SITE);
    const reassurance = content.indexOf('do not need to do anything');
    const link = content.indexOf('/companion');

    expect(reassurance).toBeGreaterThan(-1);
    expect(reassurance).toBeLessThan(link);
  });

  it('links the changelog, so "what changed" has an answer', () => {
    expect(appReleaseContent('0.5.1', SITE)).toContain('https://grims-squad.com/changelog');
  });

  it('a trailing slash does not double up', () => {
    expect(appReleaseContent('0.5.1', 'https://grims-squad.com/')).not.toContain('.com//');
  });
});


/**
 * A member's own build.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "can we also announce player owned colonization projects in the same channel the same way we do
 * the squadron owned colonization projects?"
 *
 * Same channel, different words. A member posting a build is exactly when they would like help
 * with it — but the squadron's own efforts must not read as one entry in a list of side projects,
 * so the heading says whose it is.
 */
describe('a member-owned colonisation project', () => {
  const personal: ColonyProjectAnnouncement = { ...IDENTIFIED, owner: 'personal' };

  it('MANDATORY: says a MEMBER started it, not the squadron', () => {
    const content = colonyProjectContent(personal, SITE);
    expect(content).toContain('A member has started a colonisation project');
    expect(content).not.toContain('A new squadron colonisation project');
  });

  it('still names them, links the project, and reads the same otherwise', () => {
    const content = colonyProjectContent(personal, SITE);
    expect(content).toContain(`Started by **<@${VOSS.discordId}>**`);
    expect(content).toContain('/colonisation/52f525c5-9578-412e-88af-809104d1b707');
    expect(content).toContain('Port Surface Outpost · 216,030 t');
  });

  it('adoption still wins the heading — it IS a squadron project by then', () => {
    const adopted: ColonyProjectAnnouncement = {
      ...personal,
      adoptedBy: { displayName: 'Mr Grimsoul', discordId: '100000000000000002' },
    };
    expect(colonyProjectContent(adopted, SITE)).toContain('Adopted as a squadron project');
  });
});
