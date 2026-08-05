import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlayingNow, nicknameNote, titleRoles } from './roster-card';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The card's source, WITH COMMENTS REMOVED.
 *
 * ★ WHY THIS STRIPPING EXISTS ★
 *
 * These tests assert on the order of "Playing now" and "Last flew" in the file.
 * The comments in that file explain the very decision being tested, so they
 * necessarily contain both phrases — and a raw scan finds whichever the prose
 * mentions first, not whichever the JSX renders first.
 *
 * That has now caused a false failure more than once: the code was correct and
 * a comment above it moved. Documentation must be free to explain the rule in
 * whatever order reads best, so the scan looks at code only.
 */
const source = readFileSync(resolve(HERE, 'roster-card.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * The roster card.
 *
 * ★ TWO THINGS IT GOT WRONG, BOTH REPORTED FROM A REAL SCREEN ★
 *
 * It said "last flew today" for a session fifteen hours earlier — elapsed
 * 24-hour periods labelled with calendar words — and it had no way to say
 * somebody was playing right now.
 */

const NOW = new Date('2026-07-28T17:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('playing now', () => {
  it('MANDATORY: is true while the journal is still being written', () => {
    expect(isPlayingNow(ago(30_000), NOW)).toBe(true);
  });

  it('MANDATORY: goes quiet a few minutes after they stop', () => {
    /*
     * The companion polls every twenty seconds, so a live session refreshes
     * this constantly. The window has to cover a slow poll and a loading
     * screen without leaving somebody marked online an hour after they quit —
     * which is the failure that makes a presence indicator worthless.
     */
    expect(isPlayingNow(ago(4 * 60_000), NOW)).toBe(true);
    expect(isPlayingNow(ago(6 * 60_000), NOW)).toBe(false);
  });

  it('is false for somebody who has never run the app', () => {
    expect(isPlayingNow(null, NOW)).toBe(false);
  });

  it('MANDATORY: a future timestamp does not read as playing', () => {
    // A clock skewed ahead would otherwise mark somebody online permanently,
    // and nothing would ever clear it.
    expect(isPlayingNow(new Date(NOW + 60 * 60_000).toISOString(), NOW)).toBe(false);
  });

  it('survives an unparseable value', () => {
    expect(isPlayingNow('not a date', NOW)).toBe(false);
  });
});

describe('how long ago they flew', () => {
  it('MANDATORY: reports HOURS, not "today"', () => {
    /*
     * ★ THE BUG ★
     *
     * It computed elapsed 24-hour periods and labelled them with CALENDAR
     * words, so anything under a day became "today". A session fifteen hours
     * earlier read as "today" even though it was the previous evening where
     * the member lives — and "today" is a claim about a calendar, not about
     * elapsed time.
     */
    expect(source).not.toMatch(/return 'today'/);
    expect(source).not.toMatch(/return 'yesterday'/);
    expect(source).toMatch(/hours ago/);
  });

  it('MANDATORY: playing now takes precedence over last flew', () => {
    /*
     * They answer the same question and the live one is strictly better —
     * "14 hours ago" beside a green dot would be two answers to one question.
     *
     * Anchored on the two labels rather than on a <dl>: the card grew a second
     * list (the labelled squadron rows) and an earlier version of this sliced
     * the first one it found, which no longer contains either label.
     */
    const playingAt = source.indexOf('Playing now');
    const lastFlewAt = source.indexOf('Last flew');

    expect(playingAt).toBeGreaterThan(-1);
    expect(lastFlewAt).toBeGreaterThan(-1);
    expect(playingAt).toBeLessThan(lastFlewAt);

    // And they are branches of ONE decision, not two independent blocks that
    // could both render.
    expect(source.slice(playingAt, lastFlewAt)).toContain(') : (');
  });

  it('MANDATORY: presence is shown with a WORD, not only a colour', () => {
    // A coloured dot alone is unreadable to anybody who cannot distinguish it,
    // and meaningless to a screen reader.
    expect(source).toContain('Playing now');
    expect(source).toMatch(/aria-hidden="true"[\s\S]{0,120}rounded-full/);
  });
});

describe('the local clock', () => {
  it('MANDATORY: carries AM or PM', () => {
    // 24-hour time on a roster of people in six countries is one more thing to
    // convert in your head at the moment you are trying not to.
    expect(source).toContain('dayPeriod');
    expect(source).toContain('hour12: true');
  });
});

describe('the Discord nickname note', () => {
  /*
   * ★ THE REDUNDANCY THIS REMOVES ★
   *
   * A verified member wears `RANK - COMMANDER`, so the card printed
   * "Cadet - PEBBLEMERCAHNT", then "PEBBLEMERCAHNT" as the heading, then
   * "Cadet" as a role chip. Two facts, three lines, on every single card.
   */
  const HELD = ['Cadet', 'Grim’s Squad members', 'GMSD: LEGEND'];

  it('MANDATORY: says nothing when the nickname is just rank plus commander', () => {
    expect(nicknameNote('Cadet - PEBBLEMERCAHNT', 'PEBBLEMERCAHNT', HELD)).toBeNull();
  });

  it('MANDATORY: says nothing when the nickname IS the commander name', () => {
    expect(nicknameNote('PEBBLEMERCAHNT', 'PEBBLEMERCAHNT', HELD)).toBeNull();
  });

  it('MANDATORY: KEEPS a nickname whose prefix is not a role they hold', () => {
    /*
     * The conservative half, and the one that matters. "Grimreaper" is a name
     * somebody chose. Suppressing every ` - ` prefix would have eaten it, and
     * the member would have no idea why their name vanished from the roster.
     */
    expect(nicknameNote('Grimreaper - PEBBLEMERCAHNT', 'PEBBLEMERCAHNT', HELD)).toBe(
      'Grimreaper - PEBBLEMERCAHNT',
    );
  });

  it('keeps a nickname that has nothing to do with the commander name', () => {
    expect(nicknameNote('Shawn', 'PEBBLEMERCAHNT', HELD)).toBe('Shawn');
  });

  it('matches the rank regardless of case or padding', () => {
    expect(nicknameNote('  cadet  -  pebblemercahnt  ', 'PEBBLEMERCAHNT', HELD)).toBeNull();
  });

  it('MANDATORY: adds nothing when there is no verified commander name', () => {
    // The nickname IS the heading in that case, so repeating it underneath
    // would print the same string twice.
    expect(nicknameNote('Cadet - PEBBLEMERCAHNT', null, HELD)).toBeNull();
  });

  it('survives a rank containing the separator', () => {
    // lastIndexOf, not indexOf: the commander name is the part that must
    // survive intact.
    expect(nicknameNote('Sector - Overseer - PEBBLE', 'PEBBLE', ['Sector - Overseer'])).toBeNull();
  });
});

describe('the session timer', () => {
  it('MANDATORY: counts from LoadGame, not from the presence heartbeat', () => {
    /*
     * The heartbeat is refreshed every twenty seconds, so counting from it
     * would show every commander as twenty seconds into their session forever.
     * LoadGame is "the game finished loading", which is when the session began.
     */
    expect(source).toContain('commander.lastPlayedAt');
    expect(source).not.toMatch(/SessionTimer[^>]*startedAt=\{member\.lastPlayingAt\}/);
  });

  it('MANDATORY: only appears while they are playing', () => {
    // Beside "last flew" the same number would be the age of a FINISHED
    // session — a different fact wearing the same clothes.
    const playingAt = source.indexOf('Playing now');
    const timerAt = source.indexOf('SessionTimer startedAt');
    const lastFlewAt = source.indexOf('Last flew');

    expect(timerAt).toBeGreaterThan(playingAt);
    expect(timerAt).toBeLessThan(lastFlewAt);
  });
});

describe('the verification badge', () => {
  it('MANDATORY: is driven by squadronVerified, which requires BOTH checks', () => {
    // A proven commander name says somebody controls that Inara account. It
    // says nothing about whether they fly with US.
    expect(source).toContain('verified={member.squadronVerified}');
  });

  it('MANDATORY: renders in both states, never only on success', () => {
    // A badge that appears only when verified leaves everybody else merely
    // unlabelled, and a reader cannot tell "not verified" from "not reported".
    expect(source).toContain('Not verified');
    expect(source).toContain('Inara verified');
  });

  it('MANDATORY: carries a glyph as well as a colour', () => {
    expect(source).toMatch(/verified \? '✓' : '○'/);
  });
});

describe('the layout', () => {
  it('MANDATORY: the pilot ranks do not sit on the footer border', () => {
    /*
     * mt-auto only adds space when the card is SHORTER than its grid row. On
     * the tallest card in a row there is no slack, which is exactly when the
     * bottom row of rank values collides with the footer rule.
     */
    expect(source).toMatch(/grid-cols-3[^"]*pb-5/);
  });

  it('MANDATORY: both label blocks share one label column width', () => {
    // Values lining up down the card is the whole reason it stopped looking
    // ragged; two different widths would put them back out of step.
    const columns = source.match(/grid-cols-\[4\.5rem_1fr\]/g) ?? [];
    expect(columns.length).toBe(2);
  });
});

describe('the header does not fight itself for width', () => {
  it('MANDATORY: the badge is NOT in the header block', () => {
    /*
     * ★ REPORTED FROM A REAL SCREEN ★
     *
     * Top-right of the header, the badge took the width the commander name
     * needed: "PEBBLEMERCAH…" truncated on a card with room to spare, and the
     * title line beneath it wrapped "COMMANDER" and "| WEBMASTER" onto separate
     * rows.
     *
     * It belongs in the squadron block anyway — it is a squadron fact, on the
     * same label column as Member, Rank and Awards.
     */
    const squadronAt = source.indexOf('Squadron\n');
    const badgeAt = source.indexOf('<VerificationBadge');

    expect(badgeAt).toBeGreaterThan(-1);
    expect(squadronAt).toBeGreaterThan(-1);
    expect(badgeAt).toBeGreaterThan(squadronAt);
  });

  it('MANDATORY: the title line cannot wrap', () => {
    // "COMMANDER" above "| WEBMASTER" reads as two facts rather than one title.
    const lineAt = source.indexOf('Commander</span>');
    expect(lineAt).toBeGreaterThan(-1);

    const opening = source.lastIndexOf('<p className=', lineAt);
    expect(source.slice(opening, lineAt)).not.toContain('flex-wrap');
  });

  it('MANDATORY: the squadron block always renders, so the badge always shows', () => {
    // It used to be conditional on a member holding at least one Discord role.
    // A member with none would then have had no verification state at all.
    expect(source).not.toContain('hasSquadronRows');
  });
});

/**
 * The title line beside the commander name.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "add a founders title where Pebblemerchant says webmaster it should say
 *  founder for them."
 *
 * A card that shows the wrong title still renders a card, so the rule is pinned
 * here rather than left to be noticed.
 */
describe('the founding title', () => {
  const WEBMASTER = { name: 'Webmaster', colour: null };
  const MEMBERS = { name: "Grim's Squad members", colour: null };

  it('MANDATORY: replaces the site titles for somebody with founding standing', () => {
    /*
     * Pebblemerchant, exactly as production holds them: the webmaster role, the
     * squadron membership role, and founding standing. The line is one line and
     * never wraps, so three titles in it would truncate the one the owner asked
     * to see.
     */
    const titles = titleRoles({
      founder: { title: 'Founder', precedence: 820, foundedSquadron: false },
      siteRoles: [WEBMASTER, MEMBERS],
    });

    expect(titles.map((t) => t.name)).toEqual(['Founder']);
  });

  it('MANDATORY: prints the title the ROLE ROW carries, not a constant', () => {
    // Renaming "Co-Founder" is an edit on /app -> Roles, not a deploy.
    const titles = titleRoles({
      founder: { title: 'Co-Founder', precedence: 810, foundedSquadron: true },
      siteRoles: [MEMBERS],
    });

    expect(titles.map((t) => t.name)).toEqual(['Co-Founder']);
  });

  it('MANDATORY: leaves a member with no founding standing exactly as they were', () => {
    // The overwhelming majority of the squadron. Nothing about this line moved
    // for them.
    expect(titleRoles({ founder: null, siteRoles: [WEBMASTER, MEMBERS] })).toEqual([
      WEBMASTER,
      MEMBERS,
    ]);
    expect(titleRoles({ founder: null, siteRoles: [] })).toEqual([]);
  });

  it('MANDATORY: the card renders the line through this function', () => {
    // A card that mapped `siteRoles` directly would pass every test above and
    // still print "Webmaster" on the screen the owner was looking at.
    expect(source).toContain('titleRoles(member)');
    expect(source).not.toContain('member.siteRoles.map');
  });
});
