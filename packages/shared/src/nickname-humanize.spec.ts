import { describe, it, expect } from 'vitest';
import { humanizeCommanderName, composeNickname, MAX_NICK } from './nickname.js';

/**
 * The naming convention, which the squadron owner called non-negotiable.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "these need to match their verified inara name please. this is non-negotiable! ... their name
 * must match what is on inara exactly, but humanized (first letter capitalized) ... if they have
 * two words seperated by a space, then each first letter of each word must be capitalized. if they
 * have "" in their name, then everything between the quotes must be capitalized letters please like
 * a call sign."
 *
 * ★ ONE RULE FOR EVERY RANK ★
 *
 * Allies, Grim's Squad members, the tenure ladder from Cadet to Grand Master General, and officers
 * all wear the same shape. Rank does not appear in the nickname and does not change how the name is
 * cased. Officers differ only in being permitted to override the whole thing.
 *
 * Every case below was either stated by the owner or chosen by them from worked examples.
 */

describe('humanizing a commander name', () => {
  it('capitalizes the first letter of a single word', () => {
    expect(humanizeCommanderName('grimreaper')).toBe('Grimreaper');
  });

  it('MANDATORY: brings an ALL-CAPS name back down', () => {
    /*
     * The reason the rule lowercases before raising the word starts. Inara names are frequently
     * typed in capitals, and "humanized" is precisely what that is not.
     */
    expect(humanizeCommanderName('GRIMREAPER')).toBe('Grimreaper');
    expect(humanizeCommanderName('GRIM REAPER')).toBe('Grim Reaper');
  });

  it('MANDATORY: capitalizes each word of a two-word name', () => {
    // Owner: "if they have two words seperated by a space, then each first letter of each word
    // must be capitalized".
    expect(humanizeCommanderName('grim reaper')).toBe('Grim Reaper');
    expect(humanizeCommanderName('the grim reaper')).toBe('The Grim Reaper');
  });

  it('treats hyphens and apostrophes as word breaks', () => {
    // Chosen from worked examples rather than assumed.
    expect(humanizeCommanderName('jean-luc picard')).toBe('Jean-Luc Picard');
    expect(humanizeCommanderName("o'brien")).toBe("O'Brien");
    expect(humanizeCommanderName("d'artagnan de-vere")).toBe("D'Artagnan De-Vere");
  });

  it('MANDATORY: shouts the callsign between quotes', () => {
    // Owner: "if they have "" in their name, then everything between the quotes must be
    // capitalized letters please like a call sign."
    expect(humanizeCommanderName('sean "grim" ross')).toBe('Sean "GRIM" Ross');
    expect(humanizeCommanderName('SEAN "grim" ROSS')).toBe('Sean "GRIM" Ross');
    expect(humanizeCommanderName('"reaper"')).toBe('"REAPER"');
  });

  it('normalises smart quotes, so a phone-typed name still shouts', () => {
    // A name typed on a phone arrives with curly quotes. Without this the member would have no idea
    // why their callsign was the only one not in capitals.
    expect(humanizeCommanderName('sean “grim” ross')).toBe('Sean "GRIM" Ross');
  });

  it('MANDATORY: ignores an unbalanced quote rather than shouting the rest', () => {
    /*
     * `sean "grim` is a typo. Treating the single quote as an opening one would uppercase
     * everything after it and leave the member wearing A SHOUTING HALF NAME. Wrong in the small way
     * beats wrong in the loud way.
     */
    expect(humanizeCommanderName('sean "grim')).toBe('Sean "grim');
    expect(humanizeCommanderName('grim" reaper')).toBe('Grim" Reaper');
  });

  it('does not treat an apostrophe as a callsign quote', () => {
    // The trap this avoids: `o'brien` would otherwise open a callsign and shout the rest.
    expect(humanizeCommanderName("sean o'brien")).toBe("Sean O'Brien");
  });

  it('collapses stray whitespace instead of producing empty words', () => {
    expect(humanizeCommanderName('  grim   reaper  ')).toBe('Grim Reaper');
    expect(humanizeCommanderName('')).toBe('');
    expect(humanizeCommanderName('   ')).toBe('');
  });

  it('keeps digits and the characters around them intact', () => {
    // Elite names carry numbers often enough that mangling them would be noticed immediately.
    expect(humanizeCommanderName('viper mk3')).toBe('Viper Mk3');
    expect(humanizeCommanderName('cmdr 7')).toBe('Cmdr 7');
  });

  it('flattens deliberate inner capitals, which is the accepted cost', () => {
    /*
     * Recorded rather than hidden. The owner was shown this exact trade against the alternative
     * (leaving ALL-CAPS names shouting) and chose it. A member who needs `McDonald` is what the
     * override exists for.
     */
    expect(humanizeCommanderName('McDonald')).toBe('Mcdonald');
    expect(humanizeCommanderName('MkII')).toBe('Mkii');
  });

  it('is idempotent — running it twice changes nothing', () => {
    // The nightly sweep compares the stored nickname against a freshly computed one. If humanizing
    // an already-humanized name moved it, every member would be renamed every night forever.
    for (const raw of ['grim reaper', 'GRIMREAPER', 'sean "grim" ross', "jean-luc o'brien"]) {
      const once = humanizeCommanderName(raw);
      expect(humanizeCommanderName(once), raw).toBe(once);
    }
  });
});

describe('the nickname the guild actually gets', () => {
  it('is the humanized name and nothing else', () => {
    // No rank prefix — removed 2026-07-31 on the owner's instruction, because the rank is already
    // visible as a coloured role in the member list.
    expect(composeNickname('Galactic Admiral', 'grim reaper')).toBe('Grim Reaper');
    expect(composeNickname(null, 'GRIMREAPER')).toBe('Grimreaper');
  });

  it('MANDATORY: never exceeds what Discord accepts', () => {
    // A rejected API call leaves the member with no nickname at all, which is worse than a
    // shortened one.
    const long = 'a'.repeat(80);
    expect(composeNickname(null, long).length).toBe(MAX_NICK);
  });

  it('humanizes before truncating, so the preview cannot disagree', () => {
    // Truncating first would title-case a name that had already lost its last word, and the
    // settings page promises the member exactly this string.
    const raw = 'the quick brown fox jumps over it';
    expect(composeNickname(null, raw)).toBe(humanizeCommanderName(raw).slice(0, MAX_NICK));
  });
});
