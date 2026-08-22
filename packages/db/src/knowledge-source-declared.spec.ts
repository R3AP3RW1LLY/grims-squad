import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_SOURCES } from '@grims/shared';

/**
 * Every source written into `knowledge_items` must be a source the platform DECLARES.
 *
 * ★ FOUND 2026-08-22: 5,917 ROWS THAT COULD NEVER BE EMBEDDED ★
 *
 * `live-systems.ts` inserts systems a member flew to with `source = 'companion'`. That string was
 * never added to `KNOWLEDGE_SOURCES`, so it was not in `EMBEDDED_SOURCES` either, so no sweep ever
 * selected those rows. They sat with `text` populated and `embedding` NULL from the day the feature
 * shipped — invisible to the assistant, and to anyone reading a row count.
 *
 * ★ WHY THE EXISTING GUARD DID NOT CATCH IT ★
 *
 * ai-knowledge.ts already makes `STORAGE_KIND` and `EMBED_EVERY_MINUTES` exhaustive Records over
 * `KnowledgeSource`, deliberately, so that "adding a source is a compile error rather than a
 * silently unembedded one". That works perfectly — for sources added through TypeScript.
 *
 * These rows are written by `$executeRawUnsafe` with the source as a SQL string literal. The
 * compiler never sees it. So the guard has to read the SQL, which is what this does.
 *
 * ★ IT READS THE QUERIES, NOT THE DATABASE ★
 *
 * A test against live data would pass on any machine whose `knowledge_items` happens not to contain
 * the offending source yet — including CI, on the day somebody adds one.
 */

const SRC_DIRS = [
  join(process.cwd(), 'src'),
  join(process.cwd(), '..', '..', 'apps', 'eddn-collector', 'src'),
];

function tsFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.includes('.spec.'))
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

/** Each `INSERT INTO knowledge_items (source, …) VALUES ( 'x'` and the file it came from. */
function insertedSources(): Array<{ file: string; source: string }> {
  const found: Array<{ file: string; source: string }> = [];

  for (const dir of SRC_DIRS) {
    for (const file of tsFiles(dir)) {
      const text = readFileSync(file, 'utf8');
      // `source` is the first column in every one of these inserts, so the first quoted literal
      // after VALUES( is the source. Non-greedy across newlines: these are formatted SQL.
      const re = /INSERT\s+INTO\s+knowledge_items\s*\(\s*source[\s\S]*?VALUES\s*\(\s*'([a-z_]+)'/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[1] !== undefined) found.push({ file: file.split(/[\\/]/).pop() ?? file, source: m[1] });
      }
    }
  }
  return found;
}

describe('every source written to knowledge_items is declared', () => {
  it('★ MANDATORY: no raw-SQL insert smuggles in an undeclared source ★', () => {
    const inserts = insertedSources();

    /*
     * A guard on the guard. If the regex stops matching — a reformat, a renamed table — an empty
     * list would pass and this file would go quiet while claiming to watch the thing that already
     * went wrong once.
     */
    expect(inserts.length, 'the scan found no inserts at all — the pattern has gone stale').toBeGreaterThanOrEqual(2);

    const undeclared = inserts.filter(
      (i) => !(KNOWLEDGE_SOURCES as readonly string[]).includes(i.source),
    );

    expect(
      undeclared.map((u) => `${u.file} inserts source='${u.source}'`),
      'an undeclared source is never swept for embedding — its rows are invisible to the assistant for ever',
    ).toEqual([]);
  });

  it('names companion specifically, because that is the one that was missed', () => {
    /*
     * Systems a member actually flew to are the most squadron-relevant rows there are. Losing those
     * to a missing string is worth a test of its own, so a future edit that drops it fails loudly
     * rather than quietly returning to 5,917 unembedded rows.
     */
    expect(KNOWLEDGE_SOURCES as readonly string[]).toContain('companion');
  });
});
