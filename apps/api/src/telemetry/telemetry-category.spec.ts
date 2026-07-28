import { describe, it, expect } from 'vitest';
import { JOURNAL_EVENTS, telemetryCategoryFor, type JournalEventName } from '@grims/shared';
import { CONSENT_CATEGORIES } from './consent.service.js';

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

  it('every allowlisted event lands in a category a member can actually choose', () => {
    // A category the settings screen never offers is a category nothing can ever
    // be consented to, so anything filed under it would be permanently refused.
    for (const name of EVENT_NAMES) {
      expect(CONSENT_CATEGORIES, name).toContain(telemetryCategoryFor(name));
    }
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
    for (const category of CONSENT_CATEGORIES) {
      expect(migration, category).toMatch(new RegExp(`'${category}'`));
    }
  });

  it('MANDATORY: nothing is filed under a category that overstates it', () => {
    /*
     * `location`, `combat`, `trade`, `exploration`, `bgs` and `carrier` describe
     * what a commander DID. Nothing in the current allowlist observes any of
     * that — we collect who they are, what they own, and the fact that they
     * played. Filing a rank under `combat` would be a lie told to the consent
     * screen.
     */
    const overstated = ['location', 'combat', 'trade', 'exploration', 'bgs', 'carrier'];
    for (const name of EVENT_NAMES) {
      expect(overstated, name).not.toContain(telemetryCategoryFor(name));
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
