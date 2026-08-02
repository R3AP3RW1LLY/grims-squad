import { describe, it, expect } from 'vitest';
import {
  BUILD_VISIBILITIES,
  BUILD_VISIBILITY_LABELS,
  BUILD_VISIBILITY_NOTES,
  isBuildVisibility,
  isShareToken,
  SHARE_TOKEN_ALPHABET,
  SHARE_TOKEN_LENGTH,
} from './ship-build.js';

/**
 * The sharing contract.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "the ability for our users to share their builds and make them visible to the squadron and public
 * if they choose to."
 */

describe('build visibility', () => {
  it('offers exactly three states', () => {
    expect([...BUILD_VISIBILITIES]).toEqual(['private', 'squadron', 'public']);
  });

  it('describes every one of them to the person choosing', () => {
    // A visibility with no label renders as a blank radio button, and a member picking blind is the
    // one outcome this feature must never produce.
    for (const v of BUILD_VISIBILITIES) {
      expect(BUILD_VISIBILITY_LABELS[v]).toBeTruthy();
      expect(BUILD_VISIBILITY_NOTES[v]).toBeTruthy();
    }
  });

  it('says out loud that a public link cannot be recalled', () => {
    // The one asymmetry that matters: un-sharing from the squadron works, un-sharing from the
    // internet does not, and the member deciding has to be told which they are choosing.
    expect(BUILD_VISIBILITY_NOTES.public).toMatch(/cannot take it back/i);
    expect(BUILD_VISIBILITY_NOTES.squadron).toMatch(/private and it is gone/i);
  });

  it('refuses anything that is not one of the three', () => {
    expect(isBuildVisibility('private')).toBe(true);
    expect(isBuildVisibility('public')).toBe(true);

    // A typo must not read as a valid visibility. The database has a CHECK constraint for the same
    // reason — whichever layer sees it first, `pubic` is not a state.
    expect(isBuildVisibility('pubic')).toBe(false);
    expect(isBuildVisibility('PUBLIC')).toBe(false);
    expect(isBuildVisibility('')).toBe(false);
    expect(isBuildVisibility(null)).toBe(false);
    expect(isBuildVisibility(undefined)).toBe(false);
    expect(isBuildVisibility(3)).toBe(false);
  });
});

describe('share tokens', () => {
  it('draws from an alphabet with no vowels and no lookalikes', () => {
    // No vowels, so a random token cannot spell something the squadron then has to explain.
    for (const vowel of 'aeiou') {
      expect(SHARE_TOKEN_ALPHABET, `contains ${vowel}`).not.toContain(vowel);
    }

    // These get read down a voice channel and typed by hand.
    for (const confusable of ['0', 'o', '1', 'l', 'i']) {
      expect(SHARE_TOKEN_ALPHABET, `contains ${confusable}`).not.toContain(confusable);
    }

    // And no character may appear twice, which would quietly bias the distribution.
    expect(new Set(SHARE_TOKEN_ALPHABET).size).toBe(SHARE_TOKEN_ALPHABET.length);
  });

  it('is long enough that guessing is not a strategy', () => {
    // ~58 bits. Far past guessable for a resource whose worst case is a stranger reading a ship
    // build, and the number is asserted so shortening it is a deliberate act.
    const bits = SHARE_TOKEN_LENGTH * Math.log2(SHARE_TOKEN_ALPHABET.length);
    expect(bits).toBeGreaterThan(50);
  });

  it('accepts a well-formed token and rejects everything else', () => {
    const good = SHARE_TOKEN_ALPHABET.slice(0, SHARE_TOKEN_LENGTH);
    expect(isShareToken(good)).toBe(true);

    expect(isShareToken(good.slice(0, -1)), 'too short').toBe(false);
    expect(isShareToken(`${good}b`), 'too long').toBe(false);
    expect(isShareToken(good.toUpperCase()), 'wrong case').toBe(false);
    expect(isShareToken(`${good.slice(0, -1)}0`), 'excluded character').toBe(false);

    /*
     * The reason this guard exists at all: the token goes into a `where` clause, and a caller
     * pasting a URL fragment, a path traversal or a null must be turned away before it gets there.
     */
    expect(isShareToken('../../../etc/passwd')).toBe(false);
    expect(isShareToken('')).toBe(false);
    expect(isShareToken(null)).toBe(false);
    expect(isShareToken(42)).toBe(false);
  });
});
