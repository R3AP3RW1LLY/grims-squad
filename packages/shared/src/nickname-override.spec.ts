import { describe, it, expect } from 'vitest';
import { overrideActionFor, composeNickname } from './nickname.js';

/**
 * Capturing a nickname somebody set in Discord.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "if they update it in discord, it should also update here and not change back!" — asked about
 * officers, and answered as applying to officers plus anyone an officer grants the right to.
 *
 * ★ THE ONE THAT WOULD HAVE BEEN A SLOW DISASTER ★
 *
 * Our own renames fire `GuildMemberUpdate` as well. Recording every change would mean the first
 * time the nightly sweep corrected somebody they acquired an override and were never corrected
 * again — the convention disabling itself, one member at a time, with the symptom appearing weeks
 * later as "the names stopped matching".
 */

const convention = composeNickname(null, 'grim reaper'); // 'Grim Reaper'

describe('deciding what a Discord rename means', () => {
  it('MANDATORY: ignores our own rename to the convention', () => {
    // The trap. This is what the sweep and the verification sync both write.
    expect(
      overrideActionFor({ newNick: convention, conventionNick: convention, mayOverride: true }),
    ).toBe('ignore');
  });

  it('ignores a re-typed name that differs only in capitals', () => {
    // Elite is case-insensitive about names. Somebody typing their own name with different capitals
    // has not chosen a different name, and opting them out for it would be an accident.
    expect(
      overrideActionFor({ newNick: 'GRIM REAPER', conventionNick: convention, mayOverride: true }),
    ).toBe('ignore');
    expect(
      overrideActionFor({ newNick: '  Grim Reaper  ', conventionNick: convention, mayOverride: true }),
    ).toBe('ignore');
  });

  it('MANDATORY: records a name they actually chose', () => {
    expect(
      overrideActionFor({ newNick: 'Pebblemerchant', conventionNick: convention, mayOverride: true }),
    ).toBe('set');
  });

  it('MANDATORY: ignores everybody who may not override', () => {
    /*
     * The uniformity half of the rule. A member renaming themselves is put back tonight, and
     * recording anything here would imply to whoever reads the audit that it had stuck.
     */
    expect(
      overrideActionFor({ newNick: 'xXShadowXx', conventionNick: convention, mayOverride: false }),
    ).toBe('ignore');
    expect(
      overrideActionFor({ newNick: null, conventionNick: convention, mayOverride: false }),
    ).toBe('ignore');
  });

  it('treats removing the nickname as putting themselves back', () => {
    // Clearing your nickname in Discord reads as "back to normal", so it releases the override
    // rather than freezing an empty name.
    expect(overrideActionFor({ newNick: null, conventionNick: convention, mayOverride: true })).toBe(
      'clear',
    );
    expect(overrideActionFor({ newNick: '   ', conventionNick: convention, mayOverride: true })).toBe(
      'clear',
    );
  });

  it('records a chosen name even when there is no convention to compare against', () => {
    /*
     * An officer with no verified Inara name yet. There is nothing to match, so anything they set
     * is by definition their own choice — and refusing to record it would leave them wondering why
     * theirs was the one name that did not stick.
     */
    expect(
      overrideActionFor({ newNick: 'Pebblemerchant', conventionNick: null, mayOverride: true }),
    ).toBe('set');
  });
});
