import { describe, expect, it } from 'vitest';
import { cleanStationName, hasLocalisationToken } from './station-name.js';

/**
 * ★ THE NAME A MEMBER ACTUALLY SAW IN PRODUCTION, 2026-08-09 ★
 *
 * Reported by the squadron owner against a live colonisation project. The first case below is that
 * exact string; the rest are the shapes the same journal field takes.
 */
describe('station names arrive in the game vocabulary', () => {
  it('★ MANDATORY: the reported name reads as a person would say it ★', () => {
    expect(cleanStationName('$EXT_PANEL_ColonisationShip; Mitra Horizons')).toBe('Mitra Horizons');
  });

  it('names an unnamed colonisation ship rather than returning nothing', () => {
    /*
     * The token alone is what a construction site is called before anybody names it. Returning ''
     * here would put a blank into the one column members search stations by.
     */
    expect(cleanStationName('$EXT_PANEL_ColonisationShip;')).toBe('System Colonisation Ship');
  });

  it('strips the numbered-variant form the game uses for repeats', () => {
    expect(cleanStationName('$EXT_PANEL_ColonisationShip:#index=1; Mitra Horizons')).toBe(
      'Mitra Horizons',
    );
  });

  it('strips more than one key, because one pass would leave the same symptom', () => {
    expect(cleanStationName('$EXT_PANEL_ColonisationShip; $EXT_PANEL_extra; Mitra Horizons')).toBe(
      'Mitra Horizons',
    );
  });

  it('renders an unknown key readably instead of showing it raw', () => {
    /*
     * ★ THE 62 ROWS THAT ARE NOT COLONISATION SHIPS ★
     *
     * Production carries Operations_Runner_Name (50 rows) and three megaship variants (12), all of
     * which are the key and nothing else. Returning the original would put
     * `$Operations_Runner_Name:#index=1;` in front of a member — the exact complaint that started
     * this, just rarer. Nothing is invented: the identifier is spelled the way a person reads it.
     */
    expect(cleanStationName('$Operations_Runner_Name:#index=1;')).toBe('Operations Runner');
    expect(cleanStationName('$Operations_CounterAttack_Megaship_name:#index=1;')).toBe(
      'Operations CounterAttack Megaship',
    );
  });

  it('leaves ordinary names completely alone', () => {
    // The overwhelming majority. This is applied to every station name from every source, so a
    // normaliser that touched normal names would be far more damaging than the bug it fixes.
    for (const name of [
      'Jameson Memorial',
      'Mitra Horizons',
      "Ray's Rest",
      'Hutton Orbital',
      'V7G-N2L',
      'A 2 A Ring',
      // A dollar sign that is not a token must survive: it is a legal character in a carrier name.
      'The $5 Station',
    ]) {
      expect(cleanStationName(name)).toBe(name);
    }
  });

  it('passes null and undefined straight through', () => {
    // Station name is nullable in several of the tables this feeds.
    expect(cleanStationName(null)).toBeNull();
    expect(cleanStationName(undefined)).toBeUndefined();
  });

  it('trims, because the token is followed by a space', () => {
    expect(cleanStationName('  Mitra Horizons  ')).toBe('Mitra Horizons');
  });

  describe('hasLocalisationToken', () => {
    it('recognises exactly what cleanStationName would change', () => {
      expect(hasLocalisationToken('$EXT_PANEL_ColonisationShip; Mitra Horizons')).toBe(true);
      expect(hasLocalisationToken('Mitra Horizons')).toBe(false);
      expect(hasLocalisationToken('The $5 Station')).toBe(false);
      expect(hasLocalisationToken(null)).toBe(false);
    });
  });
});
