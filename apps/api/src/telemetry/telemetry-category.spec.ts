import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOURNAL_EVENTS } from '@grims/shared';

/**
 * Journal events are stored under the right consent category (INV-013).
 *
 * ★ WHAT COMPILATION ALREADY GUARANTEES ★
 *
 * `CATEGORY_BY_LABEL` is a total `Record<JournalCategory, TelemetryCategory>`,
 * so adding a label to the allowlist without deciding where it belongs is a
 * type error, not a runtime surprise. That covers completeness, and this file
 * does not repeat it.
 *
 * ★ WHAT IT DOES NOT ★
 *
 * The compiler cannot tell that `session` must stay ALONE. Mapping `ranks` to
 * `session` would type-check perfectly and quietly bundle a member's ranks into
 * the one category they have to accept to be eligible for promotion. That is
 * the mistake worth a test.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(HERE, 'telemetry.store.prisma.ts'), 'utf8');
// Only the mapping itself, so the prose explaining it cannot satisfy a match.
const mapping = source.slice(source.indexOf('const CATEGORY_BY_LABEL'), source.indexOf('};', source.indexOf('const CATEGORY_BY_LABEL')));

describe('journal event consent categories', () => {
  it('MANDATORY: only LoadGame is stored under `session`', () => {
    /*
     * `session` is the category a member must accept for the promotion engine
     * to see them at all, and it is the least revealing thing we collect: that
     * they launched the game, and nothing about what they did next.
     *
     * The moment anything else shares it, qualifying for a promotion silently
     * starts costing more than the member agreed to.
     */
    const inSession = [...mapping.matchAll(/^\s*(\w+):\s*'session',/gm)].map((m) => m[1]);
    expect(inSession).toEqual(['session']);

    const eventsInSession = Object.entries(JOURNAL_EVENTS)
      .filter(([, label]) => inSession.includes(label))
      .map(([name]) => name);
    expect(eventsInSession).toEqual(['LoadGame']);
  });

  it('MANDATORY: nothing is filed under a category that overstates it', () => {
    /*
     * `location`, `combat`, `trade`, `exploration`, `bgs` and `carrier` describe
     * what a commander DID. Nothing in the current allowlist observes any of
     * that — we collect who they are and what they own, plus the fact that they
     * played.
     *
     * Filing a rank under `combat` would be a lie told to the consent screen.
     */
    const overstated = ['location', 'combat', 'trade', 'exploration', 'bgs', 'carrier'];
    for (const c of overstated) {
      expect(mapping, `nothing in the allowlist justifies '${c}'`).not.toContain(`'${c}'`);
    }
  });

  it('the fallback is the narrowest category, not the broadest', () => {
    // Unreachable — the service rejects off-allowlist events first — but if
    // both filters were ever bypassed, an unclassified event must reveal as
    // little as possible rather than defaulting wide.
    expect(source).toMatch(/label === undefined \? 'session'/);
  });
});
