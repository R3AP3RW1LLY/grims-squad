import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  foundingStanding,
  FOUNDING_ROLE_KEYS,
  SQUADRON_FOUNDING_ROLE_KEYS,
} from './founding.js';

/**
 * Founding standing.
 *
 * ★ WHAT THESE TESTS ARE ACTUALLY PROTECTING ★
 *
 * The squadron owner asked for a Founders tab, a title, and a fixed order at the
 * top of the roster — and every one of those fails SILENTLY if it regresses. A
 * tab that lists the wrong people still renders. A title read from the wrong
 * field still prints a word. An ordering that drops its pin still shows a
 * roster. Nothing would say so, and the person who would notice is the owner.
 *
 * So the rules are pinned: the standing is recognised by role KEY and never by
 * name, the title and the order are read from the role row rather than decided
 * here, and a member with no founding role is left completely alone.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** The roles as the migration seeds them. Names and orders are the role row's. */
const FOUNDER = { key: 'founder', name: 'Founder', rankOrder: 800 };
const CO_FOUNDER = { key: 'co_founder', name: 'Co-Founder', rankOrder: 810 };
const HUB_FOUNDER = { key: 'hub_founder', name: 'Founder', rankOrder: 820 };
const WEBMASTER = { key: 'webmaster', name: 'Webmaster', rankOrder: 1000 };
const MEMBERS = { key: 'grims_squad_members', name: "Grim's Squad members", rankOrder: 900 };

describe('founding standing', () => {
  it('MANDATORY: a member with no founding role has none', () => {
    /*
     * The overwhelming majority of the squadron. Everything downstream keys off
     * null — the pinned block at the top of the roster, the Founders tab, and
     * whether the card shows a founding title instead of the site ones — so a
     * non-null answer here would quietly promote a hundred people at once.
     */
    expect(foundingStanding([MEMBERS])).toBeNull();
    expect(foundingStanding([])).toBeNull();
  });

  it('MANDATORY: the webmaster role alone is not founding standing', () => {
    // The two are separate facts about the same person, and only one of them
    // was granted by the owner's instruction.
    expect(foundingStanding([WEBMASTER, MEMBERS])).toBeNull();
  });

  it('takes the title from the ROLE ROW, verbatim', () => {
    /*
     * `roles.name`, not a constant in this file. That is what makes "rename
     * Co-Founder" an edit on /app -> Roles rather than a deploy.
     */
    expect(foundingStanding([CO_FOUNDER, MEMBERS])?.title).toBe('Co-Founder');
    expect(foundingStanding([{ ...CO_FOUNDER, name: 'Founding Officer' }])?.title).toBe(
      'Founding Officer',
    );
  });

  it('MANDATORY: the four the owner named are on the Founders tab', () => {
    // Mr Grimsoul holds `founder`; the three co-founders hold `co_founder`.
    expect(foundingStanding([FOUNDER])?.foundedSquadron).toBe(true);
    expect(foundingStanding([CO_FOUNDER])?.foundedSquadron).toBe(true);
  });

  it('MANDATORY: the hub founder is titled Founder and is NOT on the Founders tab', () => {
    /*
     * The owner's instruction holds both halves at once: Pebblemerchant's card
     * "should say founder", and the tab gets "only these people" — four names,
     * theirs not among them — with Pebblemerchant placed "after the founders".
     *
     * A single role could carry only one of those. Two rows carry both.
     */
    const standing = foundingStanding([HUB_FOUNDER, WEBMASTER, MEMBERS]);
    expect(standing?.title).toBe('Founder');
    expect(standing?.foundedSquadron).toBe(false);
  });

  it('MANDATORY: precedence pins the founder above the co-founders above the hub founder', () => {
    /*
     * "Mr Grimsoul in the #1 spot, then after the founders, Pebblemerchant
     * should always be directly after them." Lower is more senior, the same
     * direction as the leadership ladder.
     */
    const order = [FOUNDER, CO_FOUNDER, HUB_FOUNDER].map(
      (r) => foundingStanding([r])?.precedence ?? Number.MAX_SAFE_INTEGER,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(3);
  });

  it('takes the most senior when somebody holds two', () => {
    /*
     * Nothing grants two today; a hand-edit on the roles page could. Picking the
     * first match would make the answer depend on query order, so a member's
     * title could change between two page loads with nothing having moved.
     */
    expect(foundingStanding([HUB_FOUNDER, CO_FOUNDER, FOUNDER])?.title).toBe('Founder');
    expect(foundingStanding([HUB_FOUNDER, CO_FOUNDER])?.title).toBe('Co-Founder');
  });

  it('MANDATORY: recognises the standing by KEY, never by name', () => {
    /*
     * Matching on the displayed name would work right up until the owner edited
     * the label — and then the Founders tab would empty with nothing anywhere
     * to explain it. A role named "Founder" that is not a founding role gets
     * nothing.
     */
    expect(foundingStanding([{ key: 'colour_orange', name: 'Founder', rankOrder: 950 }])).toBeNull();

    const source = readFileSync(resolve(HERE, 'founding.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\.name\s*===/);
  });

  it('MANDATORY: every Founders-tab key is a founding key', () => {
    // A tab key outside the founding set would be a member on the tab whose
    // card showed no founding title and who was not pinned anywhere.
    const missing = SQUADRON_FOUNDING_ROLE_KEYS.filter((k) => !FOUNDING_ROLE_KEYS.includes(k));
    expect(missing).toEqual([]);
  });

  it('MANDATORY: every key here is granted by the migration, and vice versa', () => {
    /*
     * A key named in source with no role behind it is standing nobody can ever
     * hold; a role seeded with no key here is a row that renders nothing. Both
     * fail silently, so the migration and this file are checked against each
     * other rather than trusted to agree.
     */
    const sql = readFileSync(
      resolve(HERE, '../../../../packages/db/prisma/migrations/20260805180000_founding_roles/migration.sql'),
      'utf8',
    );
    const seeded = [...sql.matchAll(/gen_random_uuid\(\),\s*'([a-z_]+)'/g)].map((m) => m[1]);

    expect(seeded.length).toBeGreaterThan(0);
    expect([...seeded].sort()).toEqual([...FOUNDING_ROLE_KEYS].sort());
  });
});
