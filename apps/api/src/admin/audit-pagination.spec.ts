import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const store = readFileSync(resolve(HERE, 'admin.store.ts'), 'utf8');
const controller = readFileSync(resolve(HERE, 'admin.controller.ts'), 'utf8');

/** Source with comments stripped, so prose explaining a rule cannot satisfy it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
}

/**
 * Paging the audit log.
 *
 * ★ THE FAILURE THAT MATTERS ★
 *
 * `ORDER BY created_at DESC` is not a total order. Rows written inside one
 * transaction share a timestamp to the microsecond, and Postgres may return
 * equal keys in any order — including a DIFFERENT order for the same query run
 * twice.
 *
 * Without paging that was invisible; every row came back regardless of order.
 * With paging, a tie straddling a page boundary means a row appears on both
 * pages or on NEITHER. A silently missing entry is not an acceptable failure
 * for an audit log, because completeness is the entire thing it offers.
 */
describe('audit ordering', () => {
  it('MANDATORY: is deterministic — a unique tiebreak follows the timestamp', () => {
    /*
     * `id` is a monotonic bigint, so it breaks every tie the same way each
     * time. Any unique column would do; the point is that one exists.
     */
    expect(code(store)).toMatch(/orderBy:\s*\[\{\s*createdAt:\s*'desc'\s*\},\s*\{\s*id:\s*'desc'\s*\}\s*\]/);
  });

  it('MANDATORY: no audit query orders by timestamp alone', () => {
    // Both the filtered search and the plain tail. The tail does not paginate
    // today, and pinning it means it cannot start doing so unsafely.
    expect(code(store)).not.toMatch(/orderBy:\s*\{\s*createdAt:\s*'desc'\s*\}/);
  });
});

describe('paging', () => {
  it('MANDATORY: counts with the SAME filter it queries with', () => {
    /*
     * A total taken over the whole table would say "page 1 of 40" while the
     * filter matched nine rows — so the operator pages into emptiness and
     * concludes the log lost their entries.
     */
    expect(code(store)).toMatch(/auditLog\.count\(\{\s*where\s*\}\)/);
  });

  it('MANDATORY: skips by offset derived from the page', () => {
    expect(code(store)).toContain('skip: filter.offset ?? 0');
    expect(code(controller)).toMatch(/offset:\s*\(currentPage - 1\) \* capped/);
  });

  it('MANDATORY: a nonsense page number reads as page one', () => {
    /*
     * Negative, zero, or "banana" in a hand-edited URL. Clamping means the
     * worst case is seeing the first page — an error would turn a mistyped URL
     * into a broken console.
     */
    expect(code(controller)).toMatch(/Math\.max\(Math\.trunc\(requested\), 1\)/);
    expect(code(controller)).toContain('Number.isFinite(requested)');
  });
});

describe('who did it', () => {
  it('MANDATORY: carries the display name AND the handle', () => {
    /*
     * The name is what an officer recognises — the Discord server nickname,
     * which the hub keeps matching the member's in-game commander name.
     *
     * The handle is not replaced by it. A display name is chosen by the member
     * and can be changed to match somebody else's, so a log identifying people
     * by name alone could be made to misattribute an action. The handle is
     * unique and stable, and it is what actually identifies the row.
     */
    expect(code(store)).toMatch(/actor:\s*\{\s*select:\s*\{\s*handle:\s*true,\s*displayName:\s*true\s*\}\s*\}/);
    expect(code(store)).toContain('actorName: r.actor?.displayName ?? null');
    expect(code(store)).toContain('actorHandle: r.actor?.handle ?? null');
  });

  it('MANDATORY: an actorless row stays actorless', () => {
    // Reconciliation and promotion runs have no human behind them. Filling in a
    // name there would be a lie about who acted, and the log exists precisely
    // to answer that question.
    expect(code(store)).toContain('?? null');
    expect(code(store)).not.toMatch(/actorName:\s*r\.actor\?\.displayName \?\? ['"]/);
  });
});
