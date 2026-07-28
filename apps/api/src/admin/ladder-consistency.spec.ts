import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LADDER_NEXT } from './admin.store.js';

/**
 * The display ladder must agree with the SSOT.
 *
 * ★ WHY A COPY EXISTS AT ALL ★
 *
 * `LADDER_NEXT` powers one column on an admin table: "working toward". The
 * authority is ssot/02-domain/rank-progression.yaml, read by the promotion
 * worker — and the API deliberately does not read it, because the API has no
 * business promoting anyone, and giving it the parser would put the ladder in
 * two places that both ACT on it.
 *
 * The risk that leaves is silent drift: a rung renamed in the SSOT, and an
 * admin page confidently showing an officer the wrong next rank for months.
 * This test is the whole mitigation.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SSOT = resolve(HERE, '../../../../ssot/02-domain/rank-progression.yaml');

function ladderFromSsot(): Array<{ rank: string; next: string | null }> {
  const yaml = readFileSync(SSOT, 'utf8');
  const out: Array<{ rank: string; next: string | null }> = [];

  /*
   * A narrow regex rather than a YAML parser, deliberately. The shape being
   * read is two adjacent keys under `ladder:`; adding a parser dependency for
   * that would cost more than it protects.
   */
  const ladderSection = yaml.slice(yaml.indexOf('\nladder:'));
  for (const block of ladderSection.split(/\n\s*-\s+rank:\s*/).slice(1)) {
    const rank = block.split('\n')[0]?.trim();

    /*
     * To END OF LINE, not `\S+`.
     *
     * Half these rank names contain a space — "Master Sergeant", "2nd
     * Lieutenant", "Grand Master General" — and `\S+` truncates every one of
     * them at the first word. It read "Master Sergeant" as "Master", which is
     * not a rank, and the resulting failure looked like real drift rather than
     * a broken parser.
     */
    const raw = /\bnext:[ \t]*(.+)/.exec(block)?.[1]?.trim();

    // YAML `next: null` arrives as the STRING "null". Taken literally, the top
    // of the ladder would point at a rung called "null".
    const next = raw === undefined || raw === 'null' ? null : raw;

    if (rank !== undefined && rank !== '') out.push({ rank, next });
  }

  return out;
}

describe('LADDER_NEXT agrees with the SSOT', () => {
  const ssot = ladderFromSsot();

  it('parsed a ladder at all', () => {
    // Guards the regex above. A parse that silently returned nothing would make
    // every assertion below vacuously true, which is worse than failing.
    expect(ssot.length).toBeGreaterThan(5);
  });

  it('MANDATORY: every rung points at the same next rank', () => {
    for (const rung of ssot) {
      if (rung.next === null) continue;
      expect(LADDER_NEXT[rung.rank], `${rung.rank} -> next`).toBe(rung.next);
    }
  });

  it('MANDATORY: invents no rung the SSOT does not have', () => {
    // A stale entry left behind after a rename would show an officer a rank
    // that no longer exists, which is worse than showing nothing at all.
    const known = new Set(ssot.map((r) => r.rank));
    for (const rank of Object.keys(LADDER_NEXT)) {
      expect(known.has(rank), `${rank} is not in the SSOT ladder`).toBe(true);
    }
  });

  it('leaves the top of the ladder with nowhere to go', () => {
    // Grand Master General has nothing above it. An entry here would render an
    // upward arrow pointing at a rank that does not exist.
    const top = ssot[ssot.length - 1];
    expect(top?.next ?? null).toBeNull();
    expect(LADDER_NEXT[top?.rank ?? '']).toBeUndefined();
  });
});
