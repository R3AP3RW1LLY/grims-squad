import { describe, it, expect } from 'vitest';
import { isSendable, NEVER_SENT } from './journal-events.js';

/**
 * What the companion transmits.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "exclude these, but literally include everything else! SendText / ReceiveText / Friends"
 *
 * That is the rule, and this asserts it as an OPEN list: anything not named is sent, including
 * events Frontier has not invented yet. The opposite arrangement — an allowlist — is what used to
 * exist, and every game update silently dropped whatever was new until somebody noticed.
 */

describe('MANDATORY: exactly three events are excluded', () => {
  it('and they are the private ones', () => {
    /*
     * All three carry someone ELSE's words or relationships. A member can consent to sharing their
     * own flying; they cannot consent on behalf of the person who messaged them.
     */
    expect([...NEVER_SENT].sort()).toEqual(['Friends', 'ReceiveText', 'SendText']);
  });

  it('MANDATORY: everything else is sent, including events we have never heard of', () => {
    const shouldSend = [
      // The two the owner named explicitly.
      'FSDJump',
      'Docked',
      // Flight and exploration.
      'Undocked', 'SupercruiseEntry', 'SupercruiseExit', 'Scan', 'FSSAllBodiesFound', 'Touchdown',
      // Trade and mining.
      'MarketBuy', 'MarketSell', 'MiningRefined', 'CargoDepot',
      // Combat, including the killboard pair.
      'Bounty', 'PVPKill', 'Died', 'Interdicted', 'HullDamage',
      // BGS.
      'MissionCompleted', 'RedeemVoucher', 'FactionKillBond',
      // Carriers, engineering, on-foot.
      'CarrierJump', 'EngineerCraft', 'SuitLoadout', 'Disembark',
      // Something Frontier has not shipped yet. An open list must carry it anyway.
      'SomeEventFrontierAddsIn2027',
    ];

    const refused = shouldSend.filter((e) => !isSendable(e));
    expect(refused).toEqual([]);
  });

  it('MANDATORY: the three excluded ones really are refused', () => {
    expect(isSendable('SendText')).toBe(false);
    expect(isSendable('ReceiveText')).toBe(false);
    expect(isSendable('Friends')).toBe(false);
  });

  it('an unnamed event is still refused', () => {
    // Shape is the one thing still checked: an event with no name cannot be routed.
    expect(isSendable('')).toBe(false);
  });
});
