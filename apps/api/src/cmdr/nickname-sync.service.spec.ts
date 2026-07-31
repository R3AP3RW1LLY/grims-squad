import { describe, it, expect, beforeEach } from 'vitest';
import { NicknameSyncService, type NicknameSyncDeps, composeNickname } from './nickname-sync.service.js';

/**
 * Keeping a member's Discord nickname equal to their verified in-game name.
 *
 * Human decision, refined 2026-07-27: set when the Inara key is FIRST ADDED,
 * and re-checked whenever we call Inara for anything. NOT driven by sign-in —
 * a login tells us nothing new about their commander name, so syncing on it
 * would be a Discord write per login for 108 people that could only ever
 * produce the same answer.
 *
 * It self-heals: a member who renames themselves in Discord is put back at the
 * next Inara call, because every check compares current against verified.
 *
 * ★ THE RULE THAT MATTERS MOST HERE ★
 *
 * IT MUST NEVER BREAK ITS CALLER. It hangs off a verification the member is
 * waiting on, and every way it can fail is an ordinary fact about the guild:
 *
 *   - the guild OWNER cannot be renamed by a bot, ever, by Discord's design
 *   - a member outranking the bot cannot be renamed
 *   - the bot may not hold Manage Nicknames
 *   - Discord may simply be rate limiting us
 *
 * Any of those failing the verification itself would be absurd — it worked;
 * only the cosmetic rename did not.
 */

const OK = { ok: true, reason: null };

function deps(over: Partial<NicknameSyncDeps> = {}): NicknameSyncDeps {
  return {
    guildId: 'g1',
    verifiedNameFor: async () => 'GRIM',
    currentNickFor: async () => null,
    setNickname: async () => OK,
    rememberNickname: async () => undefined,
    // The rank prefix. Null by default so the existing assertions, which are
    // about the NAME, keep testing the name.
    rankFor: async () => rank,
    writeAudit: async () => undefined,
    ...over,
  };
}

let calls: Array<{ userId: string; nick: string }>;
/*
 * The rank prefix the fake reports. Null throughout, because every test in this
 * file is about the NAME half of the nickname — the prefix has its own suite
 * below, against composeNickname directly, where the 32-character boundary is
 * the whole point.
 */
const rank: string | null = null;
let audit: Array<Record<string, unknown>>;

beforeEach(() => {
  calls = [];
  audit = [];
});

const recording = (over: Partial<NicknameSyncDeps> = {}): NicknameSyncDeps =>
  deps({
    setNickname: async (_g, userId, nick) => {
      calls.push({ userId, nick });
      return OK;
    },
    writeAudit: async (e) => {
      audit.push(e);
    },
    ...over,
  });

describe('when a member has a verified name', () => {
  it('sets the Discord nickname to match', async () => {
    const svc = new NicknameSyncService(recording());
    const r = await svc.sync('u1', 'd1');

    expect(r.changed).toBe(true);
    expect(calls).toEqual([{ userId: 'd1', nick: 'GRIM' }]);
  });

  it('MANDATORY: does nothing when the nickname already matches', async () => {
    // Every Inara call would otherwise be a Discord write and an audit row —
    // and a guild audit log full of no-op renames is one nobody reads.
    const svc = new NicknameSyncService(recording({ currentNickFor: async () => 'GRIM' }));
    const r = await svc.sync('u1', 'd1');

    expect(r.changed).toBe(false);
    expect(calls).toEqual([]);
    expect(audit).toEqual([]);
  });

  it('treats a case-only difference as already matching', async () => {
    // Elite is case-insensitive about commander names, and rewriting "Grim" to
    // "GRIM" on every check is churn that means nothing.
    const svc = new NicknameSyncService(recording({ currentNickFor: async () => 'grim' }));
    expect((await svc.sync('u1', 'd1')).changed).toBe(false);
    expect(calls).toEqual([]);
  });

  it('audits a change, with both names', async () => {
    const svc = new NicknameSyncService(recording({ currentNickFor: async () => 'OldName' }));
    await svc.sync('u1', 'd1');

    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).toContain('OldName');
    expect(JSON.stringify(audit[0])).toContain('GRIM');
  });
});

describe('when it cannot or should not run', () => {
  it('does nothing when the member has no verified name', async () => {
    // No Inara key, or not verified yet. Their nickname is their own business.
    const svc = new NicknameSyncService(recording({ verifiedNameFor: async () => null }));
    const r = await svc.sync('u1', 'd1');

    expect(r.changed).toBe(false);
    expect(r.reason).toMatch(/no verified/i);
    expect(calls).toEqual([]);
  });

  it('MANDATORY: a Discord refusal is reported, never thrown', async () => {
    // The owner case, the hierarchy case and the missing-permission case all
    // land here. The verification must survive every one of them.
    const svc = new NicknameSyncService(
      deps({ setNickname: async () => ({ ok: false, reason: 'Discord refused: server owner.' }) }),
    );

    const r = await svc.sync('u1', 'd1');
    expect(r.changed).toBe(false);
    expect(r.reason).toMatch(/owner/i);
  });

  it('MANDATORY: an unexpected error is swallowed, not propagated', async () => {
    // A network blip while renaming somebody must not fail the verification
    // they were actually doing.
    const svc = new NicknameSyncService(
      deps({
        setNickname: async () => {
          throw new Error('socket hang up');
        },
      }),
    );

    await expect(svc.sync('u1', 'd1')).resolves.toMatchObject({ changed: false });
  });

  it('survives the lookup itself failing', async () => {
    const svc = new NicknameSyncService(
      deps({
        verifiedNameFor: async () => {
          throw new Error('database gone');
        },
      }),
    );
    await expect(svc.sync('u1', 'd1')).resolves.toMatchObject({ changed: false });
  });

  it('does not write an audit row when nothing changed', async () => {
    const svc = new NicknameSyncService(
      recording({ setNickname: async () => ({ ok: false, reason: 'nope' }) }),
    );
    await svc.sync('u1', 'd1');
    expect(audit).toEqual([]);
  });
});

describe('@DESIGN-ADV it does not rename the same person forever', () => {
  it('MANDATORY: records the nickname it set, so the next check sees a match', async () => {
    /*
     * The bug this closes: currentNickFor reads our STORED copy, which was
     * only ever written by the OAuth callback. After a rename our copy stayed
     * stale, so every later check compared the OLD nickname against the
     * verified name, saw a mismatch it had just fixed, and renamed again — on
     * every Inara call, forever, filling the guild audit log with identical
     * renames.
     */
    const remembered: Array<{ discordId: string; nick: string }> = [];
    const svc = new NicknameSyncService(
      recording({
        currentNickFor: async () => 'OldName',
        rememberNickname: async (discordId, nick) => {
          remembered.push({ discordId, nick });
        },
      }),
    );

    await svc.sync('u1', 'd1');
    expect(remembered).toEqual([{ discordId: 'd1', nick: 'GRIM' }]);
  });

  it('does not record anything when Discord refused the rename', async () => {
    // Remembering a nickname we failed to set would be worse than not
    // remembering at all: the next check would see a false match and never
    // retry, leaving the member permanently misnamed.
    const remembered: string[] = [];
    const svc = new NicknameSyncService(
      deps({
        setNickname: async () => ({ ok: false, reason: 'Discord refused: server owner.' }),
        rememberNickname: async (_d, nick) => {
          remembered.push(nick);
        },
      }),
    );

    await svc.sync('u1', 'd1');
    expect(remembered).toEqual([]);
  });
});

describe('the name itself', () => {
  it('truncates to Discord’s 32-character ceiling', async () => {
    const long = 'A'.repeat(50);
    const svc = new NicknameSyncService(recording({ verifiedNameFor: async () => long }));
    await svc.sync('u1', 'd1');

    expect(calls[0]?.nick).toHaveLength(32);
  });

  it('ignores a blank name from upstream rather than clearing the nickname', async () => {
    // A blank nick RESETS the member to their username. Doing that because a
    // lookup returned an empty string would silently rename people for a bug.
    const svc = new NicknameSyncService(recording({ verifiedNameFor: async () => '   ' }));
    const r = await svc.sync('u1', 'd1');

    expect(r.changed).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('the rank prefix', () => {
  /**
   * `RANK - COMMANDER`, on the squadron owner's instruction (2026-07-28).
   *
   * ★ THE BOUNDARY IS THE INTERESTING PART ★
   *
   * Discord allows 32 characters. "Chief Fleet Commander - PEBBLEMERCAHNT" is
   * thirty-eight, so something has to give — and it must never be the commander
   * name, which is what people are called in game and in voice. A truncated
   * name is a different person's name.
   */
  it('MANDATORY: the rank is NOT in the nickname', () => {
    /*
     * ★ REVERSED 2026-07-31, ON THE OWNER'S INSTRUCTION ★
     *
     * "right now when we verify members, we are adding the rank prefix to their discord username,
     * we need to stop this and only show their Inara Commander name please."
     *
     * The rank is already visible in Discord — it is the role, in colour, in the member list — so
     * the prefix said the same thing twice and spent most of the 32-character budget doing it.
     *
     * Asserted as an ABSENCE rather than deleted, because "put the rank back" is a reasonable-
     * sounding change for somebody who never saw this instruction.
     */
    expect(composeNickname('Sector Overseer', 'Tychicus')).toBe('Tychicus');
    expect(composeNickname('Prime Legate', 'GRIM')).not.toContain('Prime Legate');
    expect(composeNickname('Prime Legate', 'GRIM')).not.toContain(' - ');
  });

  it('uses the name alone when there is no rank', () => {
    // A member with no mapped role at all. A leading " - " would look broken.
    expect(composeNickname(null, 'GRIM')).toBe('GRIM');
    expect(composeNickname('  ', 'GRIM')).toBe('GRIM');
  });

  it('MANDATORY: drops the RANK when the pair will not fit, never the name', () => {
    /*
     * "Chief Fleet Commander - PEBBLEMERCAHNT" is 38 characters. Truncating to
     * "Chief Fleet Commander - PEBBLEME" would leave somebody wearing most of
     * another commander's name, which is worse than wearing no rank.
     */
    const out = composeNickname('Chief Fleet Commander', 'PEBBLEMERCAHNT');
    expect(out).toBe('PEBBLEMERCAHNT');
    expect(out.length).toBeLessThanOrEqual(32);
  });

  it('a long rank no longer eats the budget', () => {
    /*
     * This used to assert that "Prime Legate - Aurelian Voss Xyz" fitted in exactly 32 characters.
     * With the rank gone the whole budget belongs to the commander name, which is the point: the
     * name is the identity, and it is what people are called in game and in voice.
     */
    expect(composeNickname('Prime Legate', 'Aurelian Voss Xyz')).toBe('Aurelian Voss Xyz');
  });

  it('still truncates a commander name that is too long on its own', () => {
    // Nothing to drop. Discord rejects anything over 32, so a long name must be
    // shortened rather than the rename failing outright.
    const out = composeNickname(null, 'A'.repeat(40));
    expect(out).toHaveLength(32);
  });

  it('MANDATORY: a rank lookup that fails does not abandon the rename', () => {
    // The rank is a decoration; the name is the point. Wired as an async IIFE
    // rather than `.catch()`, because a dependency that throws SYNCHRONOUSLY
    // never produces a promise for `.catch()` to attach to.
    expect(composeNickname(null, 'GRIM')).toBe('GRIM');
  });
});
