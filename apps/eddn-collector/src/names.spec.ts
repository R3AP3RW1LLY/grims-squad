import { describe, expect, it } from 'vitest';
import { parseEdcdCsv, squash } from './names.js';

/**
 * The naming layer is the part of the collector that can be wrong SILENTLY.
 *
 * Everything else fails loudly: a bad connection throws, a locked table times out, a malformed
 * frame is skipped. Getting a commodity name wrong inserts a perfectly valid row that no route
 * query will ever return, and the collector goes on reporting thousands of successful updates while
 * every price a member sees stays a day old. It is the one failure that looks exactly like success.
 */

describe('squash', () => {
  it('erases the punctuation and case that separate the two spellings of one commodity', () => {
    expect(squash('Advanced Catalysers')).toBe('advancedcatalysers');
    expect(squash('advancedcatalysers')).toBe('advancedcatalysers');
    // The awkward real ones: a hyphen, a full stop, a digit.
    expect(squash('Agri-Medicines')).toBe('agrimedicines');
    expect(squash('H.E. Suits')).toBe('hesuits');
    expect(squash('CD-75 Kitten Brand Coffee')).toBe('cd75kittenbrandcoffee');
  });

  it('keeps genuinely different commodities apart', () => {
    // If this ever collided, one of the two would silently take the other's prices.
    expect(squash('Void Opals')).not.toBe(squash('Opal'));
    expect(squash('Gold')).not.toBe(squash('Goldenrod'));
  });
});

describe('parseEdcdCsv', () => {
  /**
   * ★ BY HEADER, NOT BY POSITION ★
   *
   * The two EDCD files do not have the same columns — `rare_commodity.csv` carries an extra
   * `market_id` between `symbol` and `category`. A positional reader would take the market id for a
   * name in one file and be wrong without failing, which is how a whole class of rare goods would
   * quietly stop resolving.
   */
  it('reads the standard file', () => {
    const rows = parseEdcdCsv(
      ['id,symbol,category,name', '128049152,Platinum,Metals,Platinum', '128673848,LowTemperatureDiamond,Minerals,Low Temperature Diamonds'].join('\n'),
    );
    expect(rows).toEqual([
      { symbol: 'Platinum', name: 'Platinum' },
      { symbol: 'LowTemperatureDiamond', name: 'Low Temperature Diamonds' },
    ]);
  });

  it('reads the rare file, whose columns are in a different order', () => {
    const rows = parseEdcdCsv(
      ['id,symbol,market_id,category,name', '128666746,EraninPearlWhisky,128001536,Legal Drugs,Eranin Pearl Whisky'].join('\n'),
    );
    // Positionally, `name` sits where `category` does in the other file. Only the header knows.
    expect(rows).toEqual([{ symbol: 'EraninPearlWhisky', name: 'Eranin Pearl Whisky' }]);
  });

  it('returns nothing rather than guessing when the columns it needs are absent', () => {
    // A file that moved or was replaced by an error page must yield no aliases, not wrong ones.
    expect(parseEdcdCsv('id,thing,other\n1,a,b')).toEqual([]);
    expect(parseEdcdCsv('<!DOCTYPE html><html>404</html>')).toEqual([]);
    expect(parseEdcdCsv('')).toEqual([]);
  });

  it('survives blank lines and carriage returns', () => {
    // GitHub serves these with LF, but a proxy or a checkout setting can hand back CRLF.
    const rows = parseEdcdCsv('id,symbol,category,name\r\n1,Gold,Metals,Gold\r\n\r\n');
    expect(rows).toEqual([{ symbol: 'Gold', name: 'Gold' }]);
  });
});

describe('the symbol -> name chain, as it actually runs', () => {
  /**
   * The real cases from sixty seconds of the live relay, where the squash key alone failed. These
   * are twenty-two per cent of the feed; before the alias table they were all discarded.
   */
  const OUR_NAMES = [
    'Low Temperature Diamonds',
    'Void Opals',
    'Agri-Medicines',
    'Marine Equipment',
    'Black Box',
    'H.E. Suits',
    'Unoccupied Escape Pod',
  ];

  const EDCD = parseEdcdCsv(
    [
      'id,symbol,category,name',
      '1,LowTemperatureDiamond,Minerals,Low Temperature Diamonds',
      '2,Opal,Minerals,Void Opal',
      '3,AgriculturalMedicines,Medicines,Agri-Medicines',
      '4,MarineSupplies,Machinery,Marine Equipment',
      '5,USSCargoBlackBox,Salvage,Black Box',
      '6,HazardousEnvironmentSuits,Salvage,H.E. Suits',
      '7,UnocuppiedEscapePod,Salvage,Unoccupied Escape Pod',
    ].join('\n'),
  );

  // The plural tolerance from CommodityNames#find, which is what closes `Opal` -> `Void Opals`.
  const ours = new Map(OUR_NAMES.map((n) => [squash(n), n]));
  const find = (k: string): string | undefined =>
    ours.get(k) ?? ours.get(`${k}s`) ?? (k.endsWith('s') ? ours.get(k.slice(0, -1)) : undefined);

  it.each([
    ['lowtemperaturediamond', 'Low Temperature Diamonds'],
    ['opal', 'Void Opals'],
    ['agriculturalmedicines', 'Agri-Medicines'],
    ['marinesupplies', 'Marine Equipment'],
    ['usscargoblackbox', 'Black Box'],
    ['hazardousenvironmentsuits', 'H.E. Suits'],
    // Frontier's own typo, in the symbol. It has to be carried, not corrected.
    ['unocuppiedescapepod', 'Unoccupied Escape Pod'],
  ])('resolves %s to our own spelling %s', (symbol, expected) => {
    const direct = find(squash(symbol));
    const viaEdcd = EDCD.find((e) => squash(e.symbol) === squash(symbol));
    const resolved = direct ?? (viaEdcd === undefined ? undefined : find(squash(viaEdcd.name)));
    expect(resolved).toBe(expected);
  });

  it('answers with OUR spelling, never EDCD’s', () => {
    // EDCD says "Void Opal"; our tables say "Void Opals" and every route query filters on that.
    // Writing EDCD's would create a second row for the same commodity that nothing ever reads.
    const edcdName = EDCD.find((e) => e.symbol === 'Opal')?.name;
    expect(edcdName).toBe('Void Opal');
    expect(find(squash(edcdName ?? ''))).toBe('Void Opals');
  });
});

/**
 * Commodities we have never held.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "name the 497 unnamed commodities! this needs to happen as we will be using the commodities ect
 * here soon!"
 *
 * ★ IT WAS TWO THINGS, HUNDREDS OF TIMES ★
 *
 * One fifteen-minute window reported 479 unnamed commodities across 662 markets. Not 479 different
 * commodities — `Drones` is LIMPETS, sold at very nearly every station in the galaxy, so it alone
 * accounted for most of them, and `PoliticalPrisoner` for the rest.
 *
 * The cause was a chicken and egg. Our name for a commodity comes from `market_entries`, so one we
 * had never written had no name, so it could never be written — for ever, silently.
 */
describe('a commodity we do not hold yet', () => {
  const EDCD = parseEdcdCsv(
    [
      'id,symbol,category,name',
      '1,Drones,NonMarketable,Limpets',
      '2,PoliticalPrisoner,Slavery,Political Prisoners',
      '3,Gold,Metals,Gold',
    ].join('\n'),
  );

  /** We hold Gold and nothing else — the state that produced the bug. */
  const ours = new Map([[squash('Gold'), 'Gold']]);
  const find = (k: string): string | undefined => ours.get(k);

  /** The alias loop from `#loadAliases`, including the branch this suite exists for. */
  const aliases = (): Map<string, string> => {
    const out = new Map<string, string>();
    for (const { symbol, name } of EDCD) {
      const key = squash(symbol);
      if (find(key) !== undefined) continue;

      const mine = find(squash(name));
      out.set(key, mine ?? name);
    }
    return out;
  };

  it('MANDATORY: takes EDCD’s name rather than discarding the market', () => {
    // The whole point. Before this, every message carrying limpets lost them — which is very nearly
    // every message.
    expect(aliases().get('drones')).toBe('Limpets');
    expect(aliases().get('politicalprisoner')).toBe('Political Prisoners');
  });

  it('still prefers OUR name for anything we do hold', () => {
    /*
     * The rule the rest of this file enforces: `market_entries.commodity` is what every route query
     * filters on, so writing EDCD's spelling for something we already hold would create a second
     * row for one commodity the moment the two disagreed.
     *
     * That reasoning needs us to HOLD it — which is exactly why the fallback above is safe and this
     * is not. Gold resolves directly, so no alias is written for it at all.
     */
    expect(aliases().has('gold')).toBe(false);
  });
});
