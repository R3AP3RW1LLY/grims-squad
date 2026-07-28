import { describe, it, expect } from 'vitest';
import { auditCommanders, type AuditableCommander } from './daily-commander-audit.js';
import { composeNickname, sameSquadron } from '@grims/shared';

/**
 * The nightly sweep.
 *
 * ★ WHAT IT IS FOR ★
 *
 * Two facts go stale between logins and a member has no reason to notice
 * either: they leave the squadron on Inara, or their Discord nickname stops
 * matching their rank. Nothing else looks at everybody.
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
  currentNick: 'Cadet - PEBBLE',
  rank: 'Cadet',
  ...over,
});

function harness(commanders: AuditableCommander[], answers: Record<string, string | null>) {
  const squadrons: Array<{ userId: string; reported: string | null; matched: boolean }> = [];
  const nicks: Array<{ discordId: string; nickname: string }> = [];
  const audit: Array<Record<string, unknown>> = [];
  let refuse = false;

  const store = {
    listCommanders: async () => commanders,
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
    ownSquadron: async (apiKey: string) => {
      if (!(apiKey in answers)) throw new Error('unreachable');
      return { squadronName: answers[apiKey] ?? null };
    },
    publicSquadrons: async (names: readonly string[]) =>
      new Map(
        names.flatMap((n) =>
          n.toLowerCase() in answers
            ? [[n.toLowerCase(), { squadronName: answers[n.toLowerCase()] ?? null }] as const]
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
    audit,
    setRefuse: (v: boolean) => {
      refuse = v;
    },
    run: () => auditCommanders(store, source, nicknames, matches, composeNickname, AT),
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

describe('nicknames', () => {
  it('MANDATORY: puts back a nickname somebody changed by hand', async () => {
    const h = harness([cmdr({ currentNick: 'xXShadowXx' })], { 'key-1': OURS });
    const report = await h.run();

    expect(report.nicknamesFixed).toBe(1);
    expect(h.nicks[0]).toMatchObject({ discordId: 'd1', nickname: 'Cadet - PEBBLE' });
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
    const h = harness([cmdr({ currentNick: 'cadet - pebble' })], { 'key-1': OURS });
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
    expect(h.nicks[0]?.nickname).toBe('PEBBLEMERCAHNT');
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
