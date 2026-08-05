import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@grims/db';

/**
 * A permission mask must never be read out of Prisma with `.toString()`.
 *
 * ★ THE BUG THIS EXISTS TO STOP, WHICH HAD ALREADY HAPPENED ★
 *
 * `perm_mask` is `NUMERIC(40,0)` and Prisma returns it as a Decimal. `Decimal.toString()` switches
 * to exponential notation at 1e21 — and every role in this squadron that grants anything sits at
 * about 1.198e21, just over the line. `BigInt('1.198...e+21')` throws.
 *
 * So the conversion fails on exactly the roles that MATTER and succeeds on the ones that grant
 * nothing. On 2026-08-01 that shipped inside the rank preview, wrapped in a catch returning zero,
 * and the owner reported it the same hour: viewing as Galactic Admiral looked identical to viewing
 * as a Cadet. One of them was a swallowed parse error and the other was an empty mask, and nothing
 * on screen or in a log could tell them apart.
 *
 * `.toFixed(0)` never uses exponential notation. Every other reader in the codebase already used
 * it. This test is the thing that makes that true of the next one.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Prisma Decimal, as this project actually receives it', () => {
  it('MANDATORY: toString() is exponential for a real mask, and toFixed(0) is not', () => {
    /*
     * Asserted against the real library rather than assumed. If a future Prisma raises the
     * exponential threshold this test goes green on its own and the rule becomes unnecessary — but
     * nobody has to guess whether it still applies.
     */
    const real = new Prisma.Decimal('1198028440278813129983');

    expect(real.toString(), 'Decimal no longer uses exponential notation').toContain('e+');
    expect(() => BigInt(real.toString())).toThrow();
    expect(BigInt(real.toFixed(0))).toBe(1198028440278813129983n);
  });

  it('a mask small enough to escape it is not evidence the rule is unneeded', () => {
    // The trap is that small masks work perfectly. A role granting one permission parses fine
    // either way, which is why this was invisible in every test that used a toy value.
    const small = new Prisma.Decimal('12345');
    expect(BigInt(small.toString())).toBe(12345n);
  });
});

describe('every reader of permMask', () => {
  it('MANDATORY: converts with toFixed, never toString', () => {
    const offenders: string[] = [];

    for (const file of globSync('**/*.ts', { cwd: SRC })) {
      if (file.endsWith('.spec.ts')) continue;

      const source = readFileSync(join(SRC, file), 'utf8');

      /*
       * `BigInt(<something>permMask.toString())` only. A bare `permMask.toString()` is fine and
       * common — serialising an ALREADY-CONVERTED bigint to JSON for the roles page does exactly
       * that, and flagging it would make this guard cry wolf until somebody deleted it.
       */
      for (const m of source.matchAll(/BigInt\([^)]*permMask\.toString\(\)/g)) {
        offenders.push(`${file.split(sep).join('/')} — ${m[0]}`);
      }
    }

    expect(
      offenders,
      'permMask is NUMERIC(40,0); Prisma returns a Decimal whose toString() is exponential above ' +
        '1e21, which every real role mask here exceeds. BigInt() then throws — on exactly the ' +
        'roles that grant something. Use .toFixed(0):\n' + offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });
});
