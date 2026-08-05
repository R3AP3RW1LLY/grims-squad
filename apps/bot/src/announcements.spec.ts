import { describe, expect, it } from 'vitest';
import {
  channelEnvFor,
  truncateForDiscord,
  DISCORD_MESSAGE_LIMIT,
} from './announcements.js';

/**
 * The announcement poller's two decisions that can go wrong quietly.
 *
 * The poller itself is exercised the same way ops-alerts is — by running the bot — but which
 * channel a kind lands in and whether an oversized changelog can wedge the queue are both pure
 * questions, and both have failure modes nobody would see until the wrong channel lit up or a
 * deploy announcement silently never arrived.
 */

describe('channelEnvFor — which variable names the destination', () => {
  it('MANDATORY: deploys and verifications share the announcements channel', () => {
    expect(channelEnvFor('deploy')).toBe('DISCORD_ANNOUNCE_CHANNEL_ID');
    expect(channelEnvFor('member-verified')).toBe('DISCORD_ANNOUNCE_CHANNEL_ID');
  });

  it('MANDATORY: promotions go to their own channel', () => {
    expect(channelEnvFor('promotion')).toBe('DISCORD_PROMOTIONS_CHANNEL_ID');
  });

  it('MANDATORY: a squadron colonisation project goes to its own channel', () => {
    /*
     * Squadron owner, 2026-08-05: colonisation announces to a channel of its own, not the general
     * one — a call to haul is aimed at the people who want to be told about hauling.
     *
     * The ID itself stays out of source (INV-008). This asserts only which VARIABLE is consulted,
     * which is the part that can silently regress.
     */
    expect(channelEnvFor('colony-project')).toBe('DISCORD_COLONY_CHANNEL_ID');
  });

  it('an unknown kind waits on the general channel rather than vanishing', () => {
    // A future producer's rows should block on configuration, not on a string mismatch.
    expect(channelEnvFor('season-finale')).toBe('DISCORD_ANNOUNCE_CHANNEL_ID');
  });
});

describe('truncateForDiscord — an oversized post must not wedge the queue', () => {
  it('leaves anything within the limit untouched', () => {
    expect(truncateForDiscord('short')).toBe('short');
    const exact = 'a'.repeat(DISCORD_MESSAGE_LIMIT);
    expect(truncateForDiscord(exact)).toBe(exact);
  });

  it('MANDATORY: an oversized message comes back within the limit, ending in the pointer', () => {
    const long = 'x'.repeat(DISCORD_MESSAGE_LIMIT * 3);
    const cut = truncateForDiscord(long);
    expect(cut.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    expect(cut.endsWith('… (full changelog on the site)')).toBe(true);
  });

  it('the tail lands on its own line, not glued to a cut word', () => {
    const long = `word `.repeat(1000);
    const cut = truncateForDiscord(long);
    expect(cut).toContain('\n… (full changelog on the site)');
    expect(cut.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
  });

  it('never crashes on the degenerate inputs a producer could emit', () => {
    expect(truncateForDiscord('')).toBe('');
    expect(truncateForDiscord('\n\n')).toBe('\n\n');
  });
});
