import { describe, expect, it } from 'vitest';
import { capacityFrom, markWanted, parseCargo } from './cargo.js';

/**
 * Reading the hold.
 *
 * ★ THE FIXTURES ARE REAL ★
 *
 * Both the Cargo.json shape and the CargoCapacity below were taken off the squadron owner's own
 * machine rather than invented — including the detail that Frontier writes the file with spaces
 * inside the braces and a blank line in an empty inventory, which a hand-written fixture would have
 * tidied away.
 */

/** Verbatim from the owner's machine, empty hold. */
const EMPTY = '{ "timestamp":"2026-08-03T17:17:49Z", "event":"Cargo", "Vessel":"Ship", "Count":0, "Inventory":[ \n\n ] }';

const FULL = JSON.stringify({
  timestamp: '2026-08-03T16:40:00Z',
  event: 'Cargo',
  Vessel: 'Ship',
  Count: 1040,
  Inventory: [
    { Name: 'steel', Count: 600, Stolen: 0 },
    { Name: '$cmmcomposite_name;', Name_Localised: 'CMM Composite', Count: 440, Stolen: 0 },
  ],
});

describe('reading Cargo.json', () => {
  it('reads a real hold', () => {
    const hold = parseCargo(FULL);
    expect(hold?.used).toBe(1040);
    // Biggest first: on a panel over a cockpit only the first few lines are ever read.
    expect(hold?.items.map((i) => i.commodity)).toEqual(['Steel', 'CMM Composite']);
  });

  it('prefers the localised name over the symbol', () => {
    /*
     * Load-bearing. Our commodity tables are keyed on display names, so `$cmmcomposite_name;` would
     * match nothing when the panel works out whether the build in front of you wants it.
     */
    const hold = parseCargo(FULL);
    expect(hold?.items.map((i) => i.commodity)).toContain('CMM Composite');
    expect(hold?.items.map((i) => i.commodity)).not.toContain('$cmmcomposite_name;');
  });

  it('cleans a bare symbol into something a market screen would show', () => {
    expect(parseCargo(FULL)?.items[0]?.commodity).toBe('Steel');
  });

  it('reads an EMPTY hold as an empty hold, not as unknown', () => {
    /*
     * ★ THE DISTINCTION THE WHOLE FEATURE RESTS ON ★
     *
     * A member who has just delivered everything genuinely has nothing aboard, and that is an answer
     * the panel can state. It is not the same as failing to read the file, which is what null means
     * — and confusing the two is how somebody with a full hold gets told they are carrying nothing.
     */
    const hold = parseCargo(EMPTY);
    expect(hold).not.toBeNull();
    expect(hold?.used).toBe(0);
    expect(hold?.items).toEqual([]);
  });

  it('answers null on a file it cannot read', () => {
    expect(parseCargo('not json at all')).toBeNull();
    expect(parseCargo('')).toBeNull();
  });

  it('survives a byte-order mark', () => {
    // This exact failure cost an evening once already, on the config file: JSON.parse throws on a
    // BOM and the result looks indistinguishable from a corrupt file.
    const bom = String.fromCharCode(0xfe_ff);
    expect(parseCargo(`${bom}${FULL}`)?.used).toBe(1040);
  });

  it('drops entries with no name or no count rather than showing a blank row', () => {
    const odd = JSON.stringify({
      Count: 5,
      Inventory: [
        { Name: '', Count: 5 },
        { Name: 'steel', Count: 0 },
        { Name: 'gold', Count: 5 },
      ],
    });
    expect(parseCargo(odd)?.items.map((i) => i.commodity)).toEqual(['Gold']);
  });

  it('trusts Frontier’s own total over a sum of the list', () => {
    // They agree in practice. When they do not it is because the file was read mid-write, and their
    // figure is the less wrong one.
    const mismatched = JSON.stringify({ Count: 999, Inventory: [{ Name: 'steel', Count: 1 }] });
    expect(parseCargo(mismatched)?.used).toBe(999);
  });
});

describe('finding the ship’s capacity', () => {
  it('reads CargoCapacity out of a journal slice', () => {
    // 1040 is the owner's actual ship, and matches their 1,040 t deliveries exactly.
    expect(capacityFrom('{"event":"Loadout","Ship":"type9","CargoCapacity":1040}')).toBe(1040);
  });

  it('keeps the LAST one, because a refit changes it mid-session', () => {
    /*
     * `Loadout` fires on boarding and again on every refit, so a session contains several and only
     * the most recent describes the ship being flown now. Taking the first would report the hold
     * somebody had before they swapped their racks.
     */
    const journal = ['"CargoCapacity":512', '"CargoCapacity":1040', '"CargoCapacity":784'].join('\n');
    expect(capacityFrom(journal)).toBe(784);
  });

  it('answers null when no Loadout has been seen', () => {
    // Null renders as no capacity rather than as a hold of size zero, which would read as full.
    expect(capacityFrom('{"event":"FSDJump"}')).toBeNull();
  });
});

describe('marking what the build wants', () => {
  const hold = {
    used: 1000,
    at: null,
    items: [
      { commodity: 'Steel', count: 600, wanted: false },
      { commodity: 'Gold', count: 400, wanted: false },
    ],
  };

  it('marks only what the site is asking for', () => {
    const marked = markWanted(hold, new Set(['Steel']));
    expect(marked.items.find((i) => i.commodity === 'Steel')?.wanted).toBe(true);
    expect(marked.items.find((i) => i.commodity === 'Gold')?.wanted).toBe(false);
  });

  it('marks nothing when there is no site to compare against', () => {
    // Not docked at a construction site, so no commodity is "wanted" and none should be dressed up
    // as though it were.
    expect(markWanted(hold, new Set()).items.every((i) => !i.wanted)).toBe(true);
  });
});
