import { describe, expect, it } from 'vitest';
import { ORPHAN_GRACE_MS, orphansOf } from './orphan-media.js';

/**
 * This is the decision that destroys data, so the tests are about what must SURVIVE.
 *
 * Keeping an orphan costs a few hundred kilobytes. Deleting one that is still referenced breaks a
 * member's post or banner irreversibly — the bytes are gone and the row pointing at them is left
 * showing a hole.
 */

const NOW = new Date('2026-08-01T12:00:00Z');

/*
 * ★ REAL UUIDS, AND THE FIRST DRAFT OF THIS FILE PROVED WHY ★
 *
 * These were 'a', 'b', 'c'. The banner-spec test then failed because 'c' appears inside the word
 * "background" in the serialised spec — the substring search reported a reference that did not
 * exist, and kept a file it should have deleted.
 *
 * Harmless in that direction, and a genuine warning: the whole safety argument for searching
 * serialised text rests on a media id being a uuid. Testing with short ids tests a system we do not
 * have. These are the shape production actually stores.
 */
const A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const B = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const C = '886313e1-3b8a-5372-9b90-0c9aee199e5d';

const old = (id: string) => ({ id, createdAt: new Date(NOW.getTime() - ORPHAN_GRACE_MS - 1_000) });

const NONE = { columnIds: new Set<string>(), documents: [] as string[] };

describe('orphansOf', () => {
  it('deletes an upload nothing points at', () => {
    expect(orphansOf([old(A)], NONE, NOW).map((u) => u.id)).toEqual([A]);
  });

  it('MANDATORY: keeps anything named by a column', () => {
    const refs = { columnIds: new Set([A]), documents: [] };
    expect(orphansOf([old(A), old(B)], refs, NOW).map((u) => u.id)).toEqual([B]);
  });

  it('MANDATORY: keeps anything mentioned inside a banner spec', () => {
    // The spec nests ids in `imageMediaId` and in per-layer badges. Searching the serialised form
    // catches every shape without this file knowing any of them.
    const spec = JSON.stringify({ background: 'image', imageMediaId: A, layers: [{ mediaId: B }] });
    const refs = { columnIds: new Set<string>(), documents: [spec] };
    expect(orphansOf([old(A), old(B), old(C)], refs, NOW).map((u) => u.id)).toEqual([C]);
  });

  it('MANDATORY: keeps anything embedded in a forum post', () => {
    /*
     * The worst possible deletion. A member's post from last year, with a picture in it, and
     * nothing about the sweep that would tell anybody it had happened.
     */
    const doc = JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { mediaId: A } }] });
    const refs = { columnIds: new Set<string>(), documents: [doc] };
    expect(orphansOf([old(A)], refs, NOW).map((u) => u.id)).toEqual([]);
  });

  it('MANDATORY: leaves a fresh upload alone even with nothing pointing at it', () => {
    /*
     * An upload is written BEFORE the thing that references it. A member who uploads a banner and
     * loses their connection before saving has an orphan that is about to stop being one.
     */
    const fresh = { id: A, createdAt: new Date(NOW.getTime() - 1_000) };
    expect(orphansOf([fresh], NONE, NOW)).toEqual([]);
  });

  it('deletes it once the grace period has passed', () => {
    const justOver = { id: A, createdAt: new Date(NOW.getTime() - ORPHAN_GRACE_MS - 1) };
    expect(orphansOf([justOver], NONE, NOW).map((u) => u.id)).toEqual([A]);
  });

  it('handles an empty world without throwing', () => {
    expect(orphansOf([], NONE, NOW)).toEqual([]);
  });
});
