import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A `bytea` column read from a RAW query must go through `Buffer.from(...)`.
 *
 * ★ THE SAME MISTAKE, FOUR TIMES, IN ONE WORKER — 2026-08-17 ★
 *
 * Prisma 6 maps `bytea` from a raw query to a **Uint8Array**, not a Buffer. `Uint8Array.toString`
 * ignores its argument and returns the bytes comma-separated — `"118,49,46,107..."` — so a cipher
 * handed one answers "Malformed envelope".
 *
 * Three files already carry this fix WITH a comment explaining it: daily-commander-audit.wiring.ts,
 * member-key-pool.ts and squadron-recheck.wiring.ts. The cAPI poller was written without it, and
 * the consequence was total and silent:
 *
 *   the decrypt threw, the error was caught, the token became null
 *   the caller reported that as "the Frontier link expired — the member must reconnect"
 *   SEVEN HEALTHY GRANTS were declared dead, every minute, for a fortnight
 *   zero cAPI rows, zero poll states, zero refreshes — the feature never ran once
 *
 * Nothing errored, nothing alerted, and the one log line that existed blamed the members.
 *
 * A comment in three files did not stop the fourth. A test does.
 */

const ROOT = join(process.cwd(), 'src');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('decoding an encrypted column read by raw SQL', () => {
  it('★ MANDATORY: never .toString(utf8) straight off a raw bytea value ★', () => {
    /*
     * Matches `<something>_enc.toString('utf8')` — the shape every one of these bugs took — and
     * accepts it when wrapped, because `Buffer.from(x).toString('utf8')` is the correct form and
     * contains no `_enc.toString`.
     */
    const wrong = /(?<!Buffer\.from\()\b\w*[Ee]nc\.toString\(\s*['"]utf8['"]\s*\)/;

    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '');
      // Split on both separators rather than normalising with a regex: writing this file through a
      // shell ate the escape and left an unterminated pattern.
      if (wrong.test(src)) offenders.push(file.split('src')[1] ?? file);
    }

    expect(
      offenders,
      'Prisma 6 returns bytea from a raw query as a Uint8Array. `.toString("utf8")` on one yields ' +
        'comma-separated bytes, the cipher fails with "Malformed envelope", and the caller reports ' +
        'a healthy Frontier grant as expired. Wrap it: Buffer.from(value).toString("utf8").',
    ).toEqual([]);
  });
});
