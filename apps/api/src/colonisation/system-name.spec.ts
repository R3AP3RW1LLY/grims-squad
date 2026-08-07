import { describe, expect, it } from 'vitest';
import { canonicalSystemName } from './system-name.js';

/**
 * Repairing the case of a system name.
 *
 * ★ REPORTED BY THE SYSTEM'S OWNER, 2026-08-07 ★
 *
 * They typed "COL 285 SECTOR GL-W C2-12" — their own system — and were told we hold no coordinates
 * for it. Our own lookup is case-insensitive, but the galaxy service we fall back to is not, and it
 * answers a mis-cased name with silence rather than an error.
 *
 * Elite's procedural names have a fixed shape: title-cased words, an UPPERCASE two-letter block
 * with a hyphen, then a lowercase class letter with numbers. That is enough to repair the common
 * case, which is somebody typing in caps or all lower.
 */

describe('canonical system names', () => {
  it('MANDATORY: repairs the exact input that failed', () => {
    expect(canonicalSystemName('COL 285 SECTOR GL-W C2-12')).toBe('Col 285 Sector GL-W c2-12');
  });

  it('repairs all-lowercase too', () => {
    expect(canonicalSystemName('col 285 sector gl-w c2-12')).toBe('Col 285 Sector GL-W c2-12');
  });

  it('leaves an already-correct name alone', () => {
    const good = 'Col 285 Sector GL-W c2-12';
    expect(canonicalSystemName(good)).toBe(good);
  });

  it('handles the other procedural shapes', () => {
    expect(canonicalSystemName('HYADES SECTOR AV-W B2-4')).toBe('Hyades Sector AV-W b2-4');
    expect(canonicalSystemName('praea euq zt-g d10-33')).toBe('Praea Euq ZT-G d10-33');
  });

  it('leaves catalogue names in caps, because that is their real form', () => {
    // HIP, HR and LHS are catalogue prefixes and genuinely uppercase.
    expect(canonicalSystemName('hip 31802')).toBe('HIP 31802');
    expect(canonicalSystemName('HR 2340')).toBe('HR 2340');
    expect(canonicalSystemName('lhs 3447')).toBe('LHS 3447');
  });

  it('title-cases an ordinary named system', () => {
    expect(canonicalSystemName('SHINRARTA DEZHRA')).toBe('Shinrarta Dezhra');
    expect(canonicalSystemName('sol')).toBe('Sol');
  });

  it('collapses stray whitespace rather than failing on it', () => {
    expect(canonicalSystemName('  col  285   sector  gl-w  c2-12 ')).toBe('Col 285 Sector GL-W c2-12');
  });

  it('returns an empty string unchanged rather than throwing', () => {
    expect(canonicalSystemName('')).toBe('');
    expect(canonicalSystemName('   ')).toBe('');
  });
});
