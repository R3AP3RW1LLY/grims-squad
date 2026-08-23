import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VECTOR_INDEXES } from '@grims/shared';

/**
 * The embed job must rebuild the indexes retrieval actually uses.
 *
 * ★ FOUND IN PRODUCTION, 2026-08-23 ★
 *
 * `embedKnowledge` rebuilt `knowledge_items_embedding_idx` by name — the single shared index that
 * the prose/place split replaced the night before. Every sweep therefore spent a long CONCURRENT
 * rebuild on an index no query plans against, and rebuilt neither of the two that every query now
 * does.
 *
 * Nothing failed. The log still said "vector index rebuilt", truthfully, about an index nobody
 * reads. Meanwhile the place index was accumulating a million rows with no rebuild — heading for
 * exactly the degradation the rebuild exists to prevent, where retrieval keeps returning rows and
 * they are simply the wrong ones.
 *
 * ★ WHY THIS TEST READS SOURCE ★
 *
 * The failure is a NAME. Running the job proves it rebuilt something; only the name says whether it
 * rebuilt the right thing, and a wrong name still succeeds.
 */

const REPO = join(process.cwd(), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

const JOB = 'apps/worker/src/jobs/embed-knowledge.ts';

describe('the embed job rebuilds what retrieval uses', () => {
  it('★ MANDATORY: it does not name the retired shared index ★', () => {
    const src = read(JOB);

    expect(src.length, 'the job is readable').toBeGreaterThan(1_000);
    expect(
      src,
      'knowledge_items_embedding_idx was replaced by the prose/place split — rebuilding it is work nobody benefits from',
    ).not.toMatch(/REINDEX INDEX (CONCURRENTLY )?knowledge_items_embedding_idx/);
  });

  it('★ MANDATORY: it rebuilds from VECTOR_INDEXES, not a typed-out name ★', () => {
    /*
     * A hardcoded name is how this broke. The constant is shared with the migrations that create
     * the indexes, so the job cannot drift from them without the constant changing too.
     */
    expect(read(JOB)).toContain('VECTOR_INDEXES');
  });

  it('★ MANDATORY: every named index is one a migration actually creates ★', () => {
    /*
     * The other direction, and the quieter failure: rebuilding an index that does not exist throws
     * per sweep, gets caught, and prints an error nobody reads — while the indexes that DO exist go
     * unrebuilt for ever.
     */
    const dir = join(REPO, 'packages', 'db', 'prisma', 'migrations');
    const sql = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        try {
          return readFileSync(join(dir, e.name, 'migration.sql'), 'utf8');
        } catch {
          return '';
        }
      })
      .join('\n');

    // Guard on the guard: an unreadable migrations directory would pass everything below.
    expect(sql.length, 'migrations are readable').toBeGreaterThan(1_000);
    expect(VECTOR_INDEXES.length).toBeGreaterThanOrEqual(2);

    for (const index of VECTOR_INDEXES) {
      expect(sql, `${index} must be created by a migration`).toContain(index);
    }
  });

  it('the retired index is not in the rebuild list', () => {
    expect(VECTOR_INDEXES as readonly string[]).not.toContain('knowledge_items_embedding_idx');
  });
});
