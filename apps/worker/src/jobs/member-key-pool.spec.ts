import { describe, it, expect } from 'vitest';
import { RotatingKeyPool } from './member-key-pool.js';

/**
 * The keys the rank sweep calls Inara with.
 *
 * ★ THERE IS NO SQUADRON KEY ★
 *
 * Inara issues keys to PEOPLE, so the sweep borrows one from a member who has
 * linked theirs. Its envelope carries exactly ONE key and any number of events,
 * so a thirty-name chunk is authenticated by a single member — which is why
 * rotation and retirement matter rather than being a nicety.
 */
describe('rotating between members', () => {
  it('MANDATORY: spreads the calls rather than always using the first', () => {
    // Always picking the same key would put the squadron's entire rate spend on
    // one person and kill the sweep the day they revoke it.
    const pool = new RotatingKeyPool(['a', 'b', 'c']);
    expect([pool.next(), pool.next(), pool.next(), pool.next()]).toEqual(['a', 'b', 'c', 'a']);
  });

  it('MANDATORY: a rejected key is never handed out again', () => {
    const pool = new RotatingKeyPool(['a', 'b']);
    pool.reject('a');
    expect([pool.next(), pool.next(), pool.next()]).toEqual(['b', 'b', 'b']);
  });

  it('MANDATORY: returns null once every key is rejected, and does not hang', () => {
    /*
     * The failure this guards is a busy-loop against a rate-limited third
     * party. A `while (true)` looking for an unrejected key would spin forever
     * here, which is the worst possible place to spin.
     */
    const pool = new RotatingKeyPool(['a', 'b']);
    pool.reject('a');
    pool.reject('b');
    expect(pool.next()).toBeNull();
    expect(pool.next()).toBeNull();
  });

  it('an empty pool answers null immediately', () => {
    expect(new RotatingKeyPool([]).next()).toBeNull();
  });

  it('de-duplicates identical keys', () => {
    // Two members pasting the same key would otherwise skew the rotation and
    // double the cost of retiring it.
    const pool = new RotatingKeyPool(['a', 'a', 'b']);
    expect(pool.size).toBe(2);
    expect([pool.next(), pool.next(), pool.next()]).toEqual(['a', 'b', 'a']);
  });

  it('ignores blank keys', () => {
    expect(new RotatingKeyPool(['', '   ', 'a']).size).toBe(1);
  });

  it('size reflects what is still usable', () => {
    const pool = new RotatingKeyPool(['a', 'b', 'c']);
    expect(pool.size).toBe(3);
    pool.reject('b');
    expect(pool.size).toBe(2);
  });
});
