import { describe, it, expect } from 'vitest';
import { auditCommanders, type AuditableCommander } from './daily-commander-audit.js';
import { composeNickname, sameSquadron } from '@grims/shared';
import { isRename } from '@grims/db';

/**
 * The nightly sweep.
 *
 * ★ WHAT IT IS FOR ★
 *
 * Three facts go stale between logins and a member has no reason to notice any of them: they
 * rename their commander on Inara, they leave the squadron on Inara, or their Discord nickname
 * stops matching their name. Nothing else looks at everybody.
 *
 * ★ WHAT IT MUST NEVER DO ★
 *
 * Punish anyone. A departure is recorded for an officer to read; access is not
 * revoked at quarter past midnight by a cron job with nobody watching.
 */

const OURS = "Grim's Squad";
const matches = (r: string | null) => sameSquadron(r, OURS);
const AT = new Date('2026-07-29T00:15:00.000Z');

const cmdr = (over: Partial<AuditableCommander> = {}): AuditableCommander => ({
  userId: 'u1',
  cmdrName: 'PEBBLE',
  discordId: 'd1',
  apiKey: 'key-1',
  // The commander name alone. The rank prefix was dropped 2026-07-31 — see composeNickname.
  currentNick: 'PEBBLE',
  rank: 'Cadet',
  // Nobody overrides by default — the convention is what almost everyone wears.
  nicknameOverride: null,
  ...over,
});

/**
 * What Inara says when asked.
 *
 * A bare string is the squadron, and the commander name comes back unchanged — which is the
 * overwhelmingly common answer and keeps the existing fixtures reading as they did. The object form
 * is for the case this file exists to cover: Inara reporting a DIFFERENT name from the one we hold.
 */
type Answer = string | null | { cmdrName?: string; squadronName?: string | null };

function harness(commanders: AuditableCommander[], answers: Record<string, Answer>) {
  const squadrons: Array<{ userId: string; reported: string | null; matched: boolean }> = [];
  const nicks: Array<{ discordId: string; nickname: string }> = [];
  const names: Array<{ userId: string; cmdrName: string; at: Date }> = [];
  const audit: Array<Record<string, unknown>> = [];
  let refuse = false;
  /** Set to make every rename refuse, as the unique index does when the name is taken. */
  let nameConflict: string | null = null;

  /** The squadron half of an answer, whichever shape it was written in. */
  const squadronOf = (a: Answer): string | null =>
    a === null || typeof a === 'string' ? a : (a.squadronName ?? null);

  const store = {
    listCommanders: async () => commanders,
    recordName: async (userId: string, cmdrName: string, at: Date) => {
      if (nameConflict !== null) return { applied: false, reason: nameConflict };
      names.push({ userId, cmdrName, at });
      return { applied: true, reason: null };
    },
    recordSquadron: async (userId: string, reported: string | null, matched: boolean) => {
      squadrons.push({ userId, reported, matched });
    },
    rememberNickname: async (discordId: string, nickname: string) => {
      nicks.push({ discordId, nickname });
    },
    writeAudit: async (e: Record<string, unknown>) => {
      audit.push(e);
    },
  };

  const source = {
    ownIdentity: async (apiKey: string) => {
      if (!(apiKey in answers)) throw new Error('unreachable');
      const answer = answers[apiKey] as Answer;
      const owner = commanders.find((c) => c.apiKey === apiKey);
      return {
        // Inara answers with whatever they are called NOW. Unless a test says otherwise, that is
        // the name we already hold.
        cmdrName:
          answer !== null && typeof answer === 'object' && answer.cmdrName !== undefined
            ? answer.cmdrName
            : (owner?.cmdrName ?? ''),
        squadronName: squadronOf(answer),
      };
    },
    publicSquadrons: async (names: readonly string[]) =>
      new Map(
        names.flatMap((n) =>
          n.toLowerCase() in answers
            ? [[n.toLowerCase(), { squadronName: squadronOf(answers[n.toLowerCase()] as Answer) }] as const]
            : [],
        ),
      ),
  };

  const nicknames = {
    set: async () => ({ ok: !refuse, reason: refuse ? 'Guild owner.' : null }),
  };

  return {
    squadrons,
    nicks,
    names,
    audit,
    setRefuse: (v: boolean) => {
      refuse = v;
    },
    setNameConflict: (reason: string | null) => {
      nameConflict = reason;
    },
    run: () => auditCommanders(store, source, nicknames, matches, composeNickname, isRename, AT),
  };
}

describe('squadron membership', () => {
  it('MANDATORY: confirms a member Inara still shows in the squadron', async () => {
    const h = harness([cmdr()], { 'key-1': OURS });
    const report = await h.run();

    expect(report).toMatchObject({ checked: 1, confirmed: 1, departed: 0, unreachable: 0 });
    expect(h.squadrons[0]).toMatchObject({ matched: true, reported: OURS });
  });

  it('MANDATORY: records a departure and RECORDS IT ONLY', async () => {
    /*
     * ★ THE LINE THIS JOB MUST NOT CROSS ★
     *
     * Inara membership is self-managed on a site we do not run. Somebody who
     * removed themselves from it has not necessarily left the squadron, and
     * stripping their access at 00:15 with nobody watching is not a decision a
     * cron job gets to make. It writes an audit row for an officer instead.
     */
    const h = harness([cmdr()], { 'key-1': 'The Dark Wheel' });
    const report = await h.run();

    expect(report.departed).toBe(1);
    expect(h.squadrons[0]).toMatchObject({ matched: false, reported: 'The Dark Wheel' });
    expect(h.audit.some((a) => a['action'] === 'cmdr.squadron.departed')).toBe(true);
  });

  it('MANDATORY: leaves stored state ALONE when Inara does not answer', async () => {
    // A failed call is not evidence about anybody's membership. Writing
    // "not in the squadron" on a timeout would un-verify real members every
    // time Inara had a bad night.
    const h = harness([cmdr()], {});
    const report = await h.run();

    expect(report.unreachable).toBe(1);
    expect(h.squadrons).toHaveLength(0);
  });

  it('reads members without a key from the batched public lookup', async () => {
    // The cheap path: thirty names per request instead of one call each.
    const h = harness([cmdr({ apiKey: null })], { pebble: OURS });
    const report = await h.run();

    expect(report.confirmed).toBe(1);
  });

  it('treats "Inara has no such commander" as an answer, not a failure', async () => {
    /*
     * A member who deleted their Inara account. Inara answered — it simply has
     * nothing — and they must stop showing as confirmed. Skipping this as
     * unreachable would leave a deleted account verified forever.
     */
    const h = harness([cmdr({ apiKey: null })], {});
    const report = await h.run();

    expect(report.unreachable).toBe(1);
    expect(h.squadrons).toHaveLength(0);
  });
});

/**
 * Commander renames.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "we have users that have updated their inara usernames, we clicked the check inara button on the
 * /app/members page of the website if they have been changed they need to be updated in the
 * website, and in discord, check to make sure this is happening! this is very important!"
 *
 * It was not happening. The sweep read each member's STORED name, asked Inara only about their
 * squadron, and composed their nickname from the stored name again — three steps, none of which
 * could see a rename. These tests are the ones that would have failed.
 */
describe('commander renames', () => {
  it('MANDATORY: stores the name Inara reports NOW, not the one we held', async () => {
    const h = harness([cmdr({ cmdrName: 'PEBBLE' })], {
      'key-1': { cmdrName: 'Pebblemerchant', squadronName: OURS },
    });

    const out = await h.run();

    expect(out.renamed).toBe(1);
    expect(h.names).toEqual([{ userId: 'u1', cmdrName: 'Pebblemerchant', at: AT }]);
  });

  it('MANDATORY: a rename reaches DISCORD, in the same pass that found it', async () => {
    /*
     * The half of the owner's report that a database-only fix would leave broken. There is no
     * second job and no second Inara call: the request that discovered the rename is the one that
     * renames them in the guild.
     */
    const h = harness([cmdr({ cmdrName: 'PEBBLE', currentNick: 'Pebble' })], {
      'key-1': { cmdrName: 'Pebblemerchant', squadronName: OURS },
    });

    const out = await h.run();

    expect(h.nicks, 'the new name never reached Discord').toEqual([
      { discordId: 'd1', nickname: 'Pebblemerchant' },
    ]);
    expect(out.nicknamesFixed).toBe(1);
  });

  it('MANDATORY: writes an audit row naming both the old and the new', async () => {
    const h = harness([cmdr({ cmdrName: 'PEBBLE' })], {
      'key-1': { cmdrName: 'Pebblemerchant', squadronName: OURS },
    });

    await h.run();

    const row = h.audit.find((a) => a['action'] === 'cmdr.name.changed');
    expect(row).toMatchObject({
      targetId: 'u1',
      before: { cmdrName: 'PEBBLE' },
      after: { cmdrName: 'Pebblemerchant', source: 'daily_audit' },
    });
  });

  it('MANDATORY: an unchanged name writes NOTHING', async () => {
    /*
     * This runs nightly against everybody. A sweep that rewrote every member's name every night
     * would revoke and recreate a verification row per member per day, and bury the real renames in
     * an audit log nobody could read.
     */
    const h = harness([cmdr({ cmdrName: 'PEBBLE', currentNick: 'Pebble' })], { 'key-1': OURS });

    const out = await h.run();

    expect(out.renamed).toBe(0);
    expect(h.names).toEqual([]);
    expect(h.nicks).toEqual([]);
    expect(h.audit.some((a) => a['action'] === 'cmdr.name.changed')).toBe(false);
  });

  it('MANDATORY: a case-only difference is not a rename', async () => {
    // Elite is case-insensitive, the citext column is, and composeNickname humanizes anyway — so
    // 'PEBBLE' and 'Pebble' are one commander wearing one nickname. Treating them as a rename would
    // rewrite the whole squadron nightly and change nothing anybody could see.
    const h = harness([cmdr({ cmdrName: 'PEBBLE', currentNick: 'Pebble' })], {
      'key-1': { cmdrName: 'pebble', squadronName: OURS },
    });

    const out = await h.run();

    expect(out.renamed).toBe(0);
    expect(h.names).toEqual([]);
  });

  it('MANDATORY: leaves the stored name ALONE when Inara cannot be reached', async () => {
    /*
     * The rule that already governs the squadron half, extended to the name: a failed call is not
     * evidence about anybody. Never revoke, never rewrite, on somebody else's outage.
     */
    const h = harness([cmdr({ cmdrName: 'PEBBLE', currentNick: 'Pebble' })], {});

    const out = await h.run();

    expect(out.unreachable).toBe(1);
    expect(out.renamed).toBe(0);
    expect(h.names).toEqual([]);
    expect(h.squadrons).toEqual([]);
    expect(h.nicks).toEqual([]);
  });

  it('MANDATORY: refuses a rename onto a name another member already holds', async () => {
    /*
     * Two members cannot both be one commander (INV-005). The sweep is not the place to decide
     * which of them is wrong, and half a rename — a new name on the roster and the old one in
     * Discord — is worse than the stale name it started with.
     */
    const h = harness([cmdr({ cmdrName: 'PEBBLE', currentNick: 'Pebble' })], {
      'key-1': { cmdrName: 'Grimreaper', squadronName: OURS },
    });
    h.setNameConflict('Another member is already verified as CMDR Grimreaper.');

    const out = await h.run();

    expect(out.renameConflicts).toBe(1);
    expect(out.renamed).toBe(0);
    expect(h.nicks, 'renamed them in Discord after refusing the name').toEqual([]);
    expect(h.audit.find((a) => a['action'] === 'cmdr.name.conflict')).toMatchObject({
      after: { applied: false, reason: 'Another member is already verified as CMDR Grimreaper.' },
    });
  });

  it('reports a member Discord will not rename, rather than losing it', async () => {
    /*
     * The guild owner cannot be renamed by a bot. That is ordinarily an unremarkable fact, counted
     * and no more — but when we have JUST changed their commander name it is the moment the site
     * and the guild started disagreeing about who somebody is, which is the whole complaint. It
     * gets a row an officer can search, once.
     */
    const h = harness([cmdr({ cmdrName: 'PEBBLE', currentNick: 'Pebble' })], {
      'key-1': { cmdrName: 'Pebblemerchant', squadronName: OURS },
    });
    h.setRefuse(true);

    const out = await h.run();

    expect(out.renamed).toBe(1);
    expect(out.nicknamesRefused).toBe(1);
    expect(h.audit.find((a) => a['action'] === 'discord.nickname.refused')).toMatchObject({
      targetId: 'u1',
      after: { nickname: 'Pebblemerchant', applied: false, reason: 'Guild owner.' },
    });
  });

  it('leaves an overridden member wearing their own nickname, and still stores the name', async () => {
    /*
     * "if an officer overrides their name, then this is the name that stays as their discord
     * nickname" — squadron owner, 2026-08-02. The override is about the NICKNAME. Their commander
     * name is a fact about Inara and still moves, so the roster is right even where the guild is
     * deliberately not.
     */
    const h = harness(
      [cmdr({ cmdrName: 'PEBBLE', currentNick: 'Pebblemerchant', nicknameOverride: 'Pebblemerchant' })],
      { 'key-1': { cmdrName: 'Grimreaper', squadronName: OURS } },
    );

    const out = await h.run();

    expect(out.renamed).toBe(1);
    expect(h.names[0]).toMatchObject({ cmdrName: 'Grimreaper' });
    expect(h.nicks, 'the sweep renamed somebody who had opted out').toEqual([]);
    expect(out.nicknamesOverridden).toBe(1);
  });

  it('one member failing to rename does not stop the sweep', async () => {
    const h = harness(
      [
        cmdr({ userId: 'u1', discordId: 'd1', apiKey: 'key-1' }),
        cmdr({ userId: 'u2', discordId: 'd2', apiKey: 'key-2', currentNick: 'Pebble' }),
      ],
      { 'key-2': { cmdrName: 'Pebblemerchant', squadronName: OURS } },
    );

    const out = await h.run();

    expect(out).toMatchObject({ checked: 2, unreachable: 1, renamed: 1 });
    expect(h.names).toEqual([{ userId: 'u2', cmdrName: 'Pebblemerchant', at: AT }]);
  });
});

/**
 * Members with no Inara key of their own.
 *
 * ★ THE HONEST ANSWER IS THAT WE CANNOT CHECK THEM ★
 *
 * The public lookup is BY the stored name, which is precisely the thing a rename invalidates.
 * Searching Inara for a name that no longer exists returns "no such commander" — it does not return
 * whatever they are called now, and Inara has no lookup that goes the other way. So the sweep says
 * so, in a number, rather than reporting "0 renames" and letting that read as "nobody renamed".
 */
describe('members without a key', () => {
  it('MANDATORY: counts them as uncheckable rather than passing over them silently', async () => {
    const h = harness([cmdr({ apiKey: null, currentNick: 'Pebble' })], { pebble: OURS });

    const out = await h.run();

    expect(out.namesUncheckable).toBe(1);
    expect(out.renamed).toBe(0);
    expect(h.names).toEqual([]);
  });

  it('MANDATORY: still checks their squadron', async () => {
    // Not being able to check somebody's name is no reason to stop checking the thing we CAN check.
    const h = harness([cmdr({ apiKey: null, currentNick: 'Pebble' })], { pebble: OURS });

    const out = await h.run();

    expect(out.confirmed).toBe(1);
    expect(h.squadrons[0]).toMatchObject({ userId: 'u1', matched: true });
  });

  it('counts them even when their batch lookup failed entirely', async () => {
    /*
     * "Cannot be checked without a key" is a fact about the MEMBER, not about how their chunk went.
     * Counting it only on a successful lookup would make the number shrink whenever Inara had a bad
     * night, which is the opposite of what it is for.
     */
    const h = harness([cmdr({ apiKey: null })], {});

    const out = await h.run();

    expect(out.namesUncheckable).toBe(1);
    expect(out.unreachable).toBe(1);
  });

  it('separates the two populations in one report', async () => {
    // An officer reading the summary can tell how much of the squadron was actually name-checked.
    const h = harness(
      [
        cmdr({ userId: 'u1', discordId: 'd1', apiKey: 'key-1', currentNick: 'Pebble' }),
        cmdr({ userId: 'u2', discordId: 'd2', apiKey: null, cmdrName: 'GRIM', currentNick: 'Grim' }),
      ],
      { 'key-1': { cmdrName: 'Pebblemerchant', squadronName: OURS }, grim: OURS },
    );

    const out = await h.run();

    expect(out).toMatchObject({ checked: 2, renamed: 1, namesUncheckable: 1, confirmed: 2 });
  });
});

describe('nicknames', () => {
  it('MANDATORY: puts back a nickname somebody changed by hand', async () => {
    const h = harness([cmdr({ currentNick: 'xXShadowXx' })], { 'key-1': OURS });
    const report = await h.run();

    expect(report.nicknamesFixed).toBe(1);
    // The commander name alone — the rank prefix was dropped 2026-07-31 — and humanized since
    // 2026-08-02, so the Inara name 'PEBBLE' is worn as 'Pebble'.
    expect(h.nicks[0]).toMatchObject({ discordId: 'd1', nickname: 'Pebble' });
  });

  it('MANDATORY: leaves a correct nickname alone', async () => {
    /*
     * This runs nightly over every member. Rewriting a matching nickname would
     * be a Discord write and an audit row per member per day, and a guild audit
     * log full of no-op renames is one nobody reads.
     */
    const h = harness([cmdr()], { 'key-1': OURS });
    const report = await h.run();

    expect(report.nicknamesFixed).toBe(0);
    expect(h.nicks).toHaveLength(0);
  });

  it('ignores case, because Elite does', async () => {
    const h = harness([cmdr({ currentNick: 'pebble' })], { 'key-1': OURS });
    expect((await h.run()).nicknamesFixed).toBe(0);
  });

  it('counts a refusal without treating it as a failure', async () => {
    // The guild owner cannot be renamed by a bot, and neither can anybody whose
    // highest role sits above the bot's. Ordinary facts about a guild.
    const h = harness([cmdr({ currentNick: 'wrong' })], { 'key-1': OURS });
    h.setRefuse(true);
    const report = await h.run();

    expect(report.nicknamesRefused).toBe(1);
    expect(report.nicknamesFixed).toBe(0);
    expect(h.nicks).toHaveLength(0);
  });

  it('skips members with no Discord identity', async () => {
    const h = harness([cmdr({ discordId: null, currentNick: 'wrong' })], { 'key-1': OURS });
    const report = await h.run();
    expect(report.nicknamesFixed).toBe(0);
  });

  it('drops the rank when the pair will not fit, never the name', async () => {
    // Discord allows 32 characters. The name is the identity; a truncated one
    // is a different person's name.
    const h = harness(
      [cmdr({ rank: 'Chief Fleet Commander', cmdrName: 'PEBBLEMERCAHNT', currentNick: 'x' })],
      { 'key-1': OURS },
    );
    await h.run();
    /*
     * Humanized since 2026-08-02. The fixture still carries the SHOUTED Inara name because that is
     * what Inara holds; what changed is the convention applied to it. See nickname-humanize.spec.ts.
     */
    expect(h.nicks[0]?.nickname).toBe('Pebblemercahnt');
  });
});

describe('one member failing does not stop the sweep', () => {
  it('carries on past an unreachable member', async () => {
    const h = harness(
      [cmdr({ userId: 'u1', apiKey: 'key-1' }), cmdr({ userId: 'u2', apiKey: 'key-2' })],
      { 'key-2': OURS },
    );
    const report = await h.run();

    expect(report).toMatchObject({ checked: 2, unreachable: 1, confirmed: 1 });
  });
});

/**
 * Nickname overrides.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "if an officer overrides their name, then this is the name that stays as their discord nickname
 * it should not change from that unless they change it."
 *
 * The sweep is the thing that would undo it, so this is where the rule has to hold.
 */
describe('nickname overrides', () => {
  it('MANDATORY: leaves an overridden member entirely alone', async () => {
    // A name that does NOT match the convention, which is the whole point of an override. Without
    // the guard the sweep would rename them back every single night.
    const h = harness(
      [cmdr({ cmdrName: 'pebble', currentNick: 'Pebblemerchant', nicknameOverride: 'Pebblemerchant' })],
      { 'key-1': OURS },
    );

    const out = await h.run();

    expect(h.nicks, 'the sweep renamed somebody who had opted out').toEqual([]);
    expect(out.nicknamesFixed).toBe(0);
    expect(out.nicknamesOverridden).toBe(1);
  });

  it('counts them rather than skipping silently', async () => {
    /*
     * "0 fixed" reads identically whether nobody drifted or everybody opted out, and the second is
     * something an officer would want to know before wondering why the convention looks patchy.
     */
    const h = harness(
      [
        cmdr({ userId: 'u1', discordId: 'd1', nicknameOverride: 'Something Else' }),
        cmdr({ userId: 'u2', discordId: 'd2', currentNick: 'stale', nicknameOverride: null }),
      ],
      { 'key-1': OURS },
    );

    const out = await h.run();

    expect(out.nicknamesOverridden).toBe(1);
    expect(out.nicknamesFixed).toBe(1);
  });

  it('still checks their SQUADRON membership', async () => {
    /*
     * An override is about the nickname and nothing else. Somebody who left Grim's Squad on Inara
     * must still be recorded as departed — letting an override suppress that would make the
     * override a way to keep a verified badge after leaving.
     */
    const h = harness(
      [cmdr({ nicknameOverride: 'Kept Name' })],
      { 'key-1': 'Some Other Squadron' },
    );

    const out = await h.run();

    expect(out.departed).toBe(1);
    expect(h.squadrons[0]?.matched).toBe(false);
  });

  it('treats an empty or whitespace override as no override', async () => {
    // A blank string is not a name. Honouring it would leave the member wearing whatever they had,
    // permanently, on the strength of an empty column.
    const h = harness([cmdr({ currentNick: 'stale', nicknameOverride: '   ' })], { 'key-1': OURS });

    const out = await h.run();

    expect(out.nicknamesFixed).toBe(1);
    expect(out.nicknamesOverridden).toBe(0);
  });
});
