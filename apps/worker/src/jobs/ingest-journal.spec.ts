import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@grims/db';
import { readJournalKnowledge } from './ingest-journal.js';

/**
 * The squadron's own flight history, as knowledge.
 *
 * ★ THE PRIVACY LINE IS THE POINT ★
 *
 * A member consented to us STORING their location. The assistant reciting their movements to
 * whoever asks is a different thing, and the assistant is exactly where that distinction gets
 * lost — so the test that matters most here is the one asserting nobody is named.
 */

/** Answers the two aggregate queries, in order. */
function fakeDb(systems: unknown[], stations: unknown[]): PrismaClient {
  let call = 0;
  return {
    $queryRawUnsafe: async () => {
      call += 1;
      return call === 1 ? systems : stations;
    },
  } as unknown as PrismaClient;
}

const system = (over: Record<string, unknown> = {}) => ({
  name: 'Deciat',
  visits: 41n,
  last_at: new Date('2026-07-30T18:00:00Z'),
  commanders: 6n,
  ...over,
});

const station = (over: Record<string, unknown> = {}) => ({
  station: 'Grims Squad Headquarters',
  system: 'Hyades Sector AV-W b2-4',
  visits: 3n,
  last_at: new Date('2026-07-29T12:00:00Z'),
  ...over,
});

describe('MANDATORY: nobody is named', () => {
  it('reports how many commanders, never which', async () => {
    /*
     * ★ WHAT THIS PREVENTS ★
     *
     * "Where has CMDR X been" answered by the assistant, from data they agreed to have STORED
     * rather than published. The roster already answers that question behind a privacy setting;
     * this must not be a second route around it.
     */
    const { rows } = await readJournalKnowledge(fakeDb([system()], [station()]));

    for (const r of rows) {
      expect(JSON.stringify(r)).not.toMatch(/user_?id|cmdr[A-Z]|commanderName/i);
    }
    expect(rows[0]?.text).toContain('6 commanders');
  });
});

describe('what it says', () => {
  it('states the system, the count and when', async () => {
    const { rows } = await readJournalKnowledge(fakeDb([system()], []));

    expect(rows[0]?.text).toBe(
      'The squadron has been to Deciat — 41 recorded arrivals by 6 commanders, most recently 2026-07-30.',
    );
  });

  it('reads correctly for a single visit by a single commander', async () => {
    // Plurals that are wrong read as a bug in everything else the assistant says.
    const { rows } = await readJournalKnowledge(fakeDb([system({ visits: 1n, commanders: 1n })], []));

    expect(rows[0]?.text).toContain('1 recorded arrival by 1 commander,');
  });

  it('namespaces a station by its system', async () => {
    /*
     * Station names repeat across the galaxy constantly. "Jameson Memorial" alone is not an
     * identifier, and using it as a key would merge every station of that name into one row.
     */
    const { rows } = await readJournalKnowledge(fakeDb([], [station()]));

    expect(rows[0]?.extKey).toBe('hyades sector av-w b2-4/grims squad headquarters');
  });
});

describe('coordinates are left to the galaxy rows', () => {
  it('writes none of its own', async () => {
    /*
     * The galaxy row for the same system already carries them. A second copy here can drift, and
     * then a spatial search answers differently depending on which row it happens to hit.
     */
    const { rows } = await readJournalKnowledge(fakeDb([system()], [station()]));

    for (const r of rows) expect(r.coords).toBeNull();
  });
});
