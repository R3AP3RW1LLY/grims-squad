import { describe, it, expect } from 'vitest';
import {
  JOURNAL_EVENTS,
  telemetryCategoryFor,
  REQUIRED_CATEGORY,
  isBaselineCategory,
  type JournalEventName,
} from '@grims/shared';
import { DECLINABLE_CATEGORIES } from './consent.service.js';

/**
 * Journal events are stored under the right consent category (INV-013).
 *
 * ★ WHAT COMPILATION ALREADY GUARANTEES ★
 *
 * The mapping is a total `Record<JournalCategory, TelemetryCategoryName>`, so
 * adding a label to the allowlist without deciding where it belongs is a type
 * error. That covers completeness, and this file does not repeat it.
 *
 * ★ WHAT IT DOES NOT ★
 *
 * The compiler cannot tell that `session` must stay ALONE, or that the strings
 * involved are real values of the database enum. Both are checked here.
 */

const EVENT_NAMES = Object.keys(JOURNAL_EVENTS) as JournalEventName[];

describe('journal event consent categories', () => {
  it('MANDATORY: only LoadGame is stored under `session`', () => {
    /*
     * `session` is the category a member must accept for the promotion engine to
     * see them at all, and it is the least revealing thing we collect: that they
     * launched the game, and nothing about what they did next.
     *
     * The moment anything else shares it, qualifying for a promotion silently
     * starts costing more than the member agreed to.
     */
    const inSession = EVENT_NAMES.filter((n) => telemetryCategoryFor(n) === 'session');
    expect(inSession).toEqual(['LoadGame']);
  });

  it('MANDATORY: every allowlisted event is either required or declinable', () => {
    /*
     * An event in neither set could never be stored: not baseline, so it needs
     * consent — and not offered, so consent can never be given. It would be
     * refused forever, silently, and the only symptom would be missing data
     * nobody could explain.
     */
    for (const name of EVENT_NAMES) {
      const category = telemetryCategoryFor(name);
      const reachable =
        isBaselineCategory(category) || (DECLINABLE_CATEGORIES as readonly string[]).includes(category);
      expect(reachable, name + ' -> ' + category).toBe(true);
    }
  });

  it('MANDATORY: the required category is not also declinable', () => {
    /*
     * ★ THE OLD VERSION OF THIS CHECKED THE WHOLE BASELINE ★
     *
     * Session, profile and fleet were all collected regardless. Under opt-out
     * (INV-013, amended 2026-07-29) only `session` is required — profile and
     * fleet CAN now be switched off, and asserting otherwise would pin a rule
     * that no longer exists.
     *
     * A category in both lists would be collected regardless AND offered as a
     * switch, so turning it off would appear to work and change nothing.
     */
    expect(DECLINABLE_CATEGORIES).not.toContain(REQUIRED_CATEGORY);
    expect(REQUIRED_CATEGORY).toBe('session');

    // And profile and fleet ARE declinable now, which is the change.
    expect(DECLINABLE_CATEGORIES).toContain('profile');
    expect(DECLINABLE_CATEGORIES).toContain('fleet');
  });

  it('MANDATORY: the category names are real values of the database enum', () => {
    /*
     * `@grims/shared` is bundled into the browser and cannot import the
     * generated Prisma client, so the three strings are written out by hand
     * there. A typo would not fail to compile — it would fail at INSERT, in
     * production, on a member's first upload.
     *
     * Read from the migration rather than the client, because the enum values
     * are what the database will actually accept.
     */
    const migration = readMigration();
    for (const category of DECLINABLE_CATEGORIES) {
      expect(migration, category).toMatch(new RegExp(`'${category}'`));
    }
  });

  it('MANDATORY: no baseline event is filed under a category that overstates it', () => {
    /*
     * The optional categories describe what a commander DID. Nothing in the
     * BASELINE observes any of that — it is who they are, what they own, and
     * the fact that they played.
     *
     * Filing a rank under `combat` would be a lie told to the consent screen:
     * the member would see combat data collected whether or not they opted in.
     */
    const baselineEvents = [
      'LoadGame',
      'Rank',
      'Progress',
      'Loadout',
      'StoredShips',
      'SquadronStartup',
    ] as const;

    for (const name of baselineEvents) {
      expect(isBaselineCategory(telemetryCategoryFor(name)), name).toBe(true);
    }
  });
});

function readMigration(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync, readdirSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolve } = require('node:path') as typeof import('node:path');

  const dir = resolve(process.cwd(), '../../packages/db/prisma/migrations');
  return readdirSync(dir)
    .map((d) => {
      try {
        return readFileSync(resolve(dir, d, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}
