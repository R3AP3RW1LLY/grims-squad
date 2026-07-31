import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@grims/db';
import { readInaraKnowledge } from './ingest-inara.js';

/**
 * The roster, as knowledge.
 *
 * ★ WHY THE TEXT MATTERS AS MUCH AS THE DATA ★
 *
 * These rows are handed to the assistant at question time and it quotes them. A caveat that lives
 * in a comment, a column, or this file is a caveat that is gone the moment the row is retrieved —
 * it has to be IN the sentence.
 */

function fakeDb(rows: unknown[]): PrismaClient {
  return { $queryRawUnsafe: async () => rows } as unknown as PrismaClient;
}

const profile = (over: Record<string, unknown> = {}) => ({
  search_name: 'PEBBLEMERCHANT',
  ranks: [
    { key: 'combat', label: 'Deadly', name: 'combat', index: 7 },
    { key: 'trade', label: 'Tycoon', name: 'trade', index: 8 },
  ],
  squadron_name: "Grim's Squad",
  squadron_rank: 'Cadet',
  is_found: true,
  fetched_at: new Date('2026-08-01T05:12:00Z'),
  handle: 'pebble',
  ...over,
});

describe('one row per commander', () => {
  it('keys on the commander name, case-folded', async () => {
    // `search_name` is citext, so the case carries no information — and two rows differing only in
    // case would be two answers to the same question.
    const { rows } = await readInaraKnowledge(fakeDb([profile({ search_name: 'PebbleMerchant' })]));

    expect(rows[0]?.extKey).toBe('pebblemerchant');
    // The DISPLAY name keeps its original casing: it is what gets shown back.
    expect(rows[0]?.name).toBe('PebbleMerchant');
  });

  it('reads like a sentence, not like a data structure', async () => {
    const { rows } = await readInaraKnowledge(fakeDb([profile()]));

    expect(rows[0]?.text).toContain('CMDR PEBBLEMERCHANT');
    expect(rows[0]?.text).toContain("is Cadet in Grim's Squad");
    expect(rows[0]?.text).toContain('Deadly');
  });

  it('MANDATORY: says in the text itself that Inara is self-reported', async () => {
    /*
     * ★ THE CLAIM THIS PREVENTS ★
     *
     * A member types their squadron and ranks into a website. If the assistant quotes that as
     * fact, it is telling the squadron somebody holds a rank on no evidence at all — and it will
     * sound exactly as certain as when it reads a real one out of the journal.
     *
     * The caveat travels inside the sentence because that is the only part that survives
     * retrieval.
     */
    const { rows } = await readInaraKnowledge(fakeDb([profile()]));

    expect(rows[0]?.text).toContain('Self-reported');
  });
});

describe('the squadron gets a row of its own', () => {
  it('states the count once instead of leaving it to be counted', async () => {
    /*
     * "How many of us are there" answered from a hundred and seven individual rows means
     * retrieving all of them and trusting the model to count. It will not always.
     */
    const { rows } = await readInaraKnowledge(
      fakeDb([
        profile({ search_name: 'ALPHA' }),
        profile({ search_name: 'BETA' }),
        profile({ search_name: 'GAMMA' }),
      ]),
    );

    const squadron = rows.find((r) => r.kind === 'squadron');
    expect(squadron?.text).toContain('has 3 commanders');
    expect(squadron?.text).toContain('ALPHA, BETA, GAMMA');
  });

  it('omits the squadron row when nobody is in one', async () => {
    // Rather than writing "the squadron has 0 commanders", which is a false statement about a real
    // squadron whenever the roster cache is merely empty.
    const { rows } = await readInaraKnowledge(fakeDb([profile({ squadron_name: null })]));

    expect(rows.find((r) => r.kind === 'squadron')).toBeUndefined();
  });
});

describe('nothing is invented', () => {
  it('handles a commander with no ranks and no squadron', async () => {
    const { rows } = await readInaraKnowledge(
      fakeDb([profile({ ranks: [], squadron_name: null, squadron_rank: null, handle: null })]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('CMDR PEBBLEMERCHANT (Self-reported on Inara, not read from the game.)');
  });

  it('survives ranks arriving as something other than an array', async () => {
    // Upstream shape drift must cost the RANKS, not the row — and certainly not the whole ingest.
    const { rows } = await readInaraKnowledge(fakeDb([profile({ ranks: null })]));

    expect(rows).toHaveLength(2);
    expect(rows[0]?.text).not.toContain('Ranks:');
  });
});
