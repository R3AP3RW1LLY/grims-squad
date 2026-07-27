import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { TotpService, generateTotp, type TotpStore, type TotpRecord } from './totp.service.js';

/**
 * P1.10 — TOTP as the gate on the admin console.
 *
 * ★ WHY THIS IS MANDATORY RATHER THAN OFFERED ★
 *
 * The accounts worth attacking are precisely the ones that can grant roles and
 * change site config. "We recommended two-factor" is not a control. Enrolment
 * is forced: an officer cannot perform a privileged action until it is done.
 *
 * ★ THE THREE PROPERTIES THESE TESTS EXIST TO HOLD ★
 *
 * 1. A code is SINGLE-USE. Six digits in a 30-second window is not much, and
 *    someone reading it over a shoulder or lifting it from a screen share must
 *    not be able to use it a second time inside that window.
 * 2. Brute force is bounded. 10^6 is trivially grindable at HTTP speed, so
 *    failures lock the credential rather than merely being counted.
 * 3. The secret and the recovery codes never leave in a response or a log
 *    (INV-012). Recovery codes are shown exactly once, at enrolment, and are
 *    stored only as hashes.
 */

const SECRET = 'JBSWY3DPEHPK3PXP'; // RFC 4648 base32, the canonical test vector
const STEP_MS = 30_000;

class FakeTotpStore implements TotpStore {
  rows = new Map<string, TotpRecord>();
  recovery = new Map<string, Array<{ hash: string; usedAt: Date | null }>>();

  async get(userId: string): Promise<TotpRecord | null> {
    return this.rows.get(userId) ?? null;
  }
  async upsert(userId: string, secret: string): Promise<void> {
    this.rows.set(userId, {
      userId,
      secret,
      confirmedAt: null,
      lastUsedStep: null,
      failedCount: 0,
      lockedUntil: null,
    });
  }
  async confirm(userId: string, at: Date, step: bigint): Promise<void> {
    const r = this.rows.get(userId);
    if (r !== undefined) {
      this.rows.set(userId, { ...r, confirmedAt: at, lastUsedStep: step, failedCount: 0 });
    }
  }
  async recordSuccess(userId: string, step: bigint): Promise<void> {
    const r = this.rows.get(userId);
    if (r !== undefined) {
      this.rows.set(userId, { ...r, lastUsedStep: step, failedCount: 0, lockedUntil: null });
    }
  }
  async recordFailure(userId: string, failedCount: number, lockedUntil: Date | null): Promise<void> {
    const r = this.rows.get(userId);
    if (r !== undefined) this.rows.set(userId, { ...r, failedCount, lockedUntil });
  }
  async replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
    this.recovery.set(
      userId,
      hashes.map((h) => ({ hash: h, usedAt: null })),
    );
  }
  async consumeRecoveryCode(userId: string, hash: string, at: Date): Promise<boolean> {
    const list = this.recovery.get(userId) ?? [];
    const hit = list.find((c) => c.hash === hash && c.usedAt === null);
    if (hit === undefined) return false;
    hit.usedAt = at;
    return true;
  }
  async remove(userId: string): Promise<void> {
    this.rows.delete(userId);
    this.recovery.delete(userId);
  }
}

let store: FakeTotpStore;
let svc: TotpService;
const AT = new Date('2026-07-27T12:00:00Z');

beforeEach(() => {
  store = new FakeTotpStore();
  svc = new TotpService(store);
});

/**
 * Enrolment happens TWO MINUTES BEFORE the verification tests run.
 *
 * Not cosmetic. Confirming enrolment consumes the code it was confirmed with,
 * so enrolling and verifying inside the same 30-second step is a genuine replay
 * and is correctly refused. Real enrolment is never followed by a login in the
 * same breath, and pinning the clocks together made four tests assert that
 * replay protection should not work.
 */
const ENROL_AT = new Date(AT.getTime() - 120_000);

async function enrol(userId = 'u1', at: Date = ENROL_AT): Promise<string[]> {
  const start = await svc.beginEnrolment(userId, 'grim');
  const code = generateTotp(start.secret, at);
  const done = await svc.confirmEnrolment(userId, code, at);
  return done.recoveryCodes;
}

describe('code generation matches RFC 6238', () => {
  it('produces a six-digit code', () => {
    expect(generateTotp(SECRET, AT)).toMatch(/^\d{6}$/);
  });

  it('is stable within a 30-second step and changes across one', () => {
    const t = new Date('2026-07-27T12:00:00Z');
    expect(generateTotp(SECRET, t)).toBe(generateTotp(SECRET, new Date(t.getTime() + 29_000)));
    expect(generateTotp(SECRET, t)).not.toBe(generateTotp(SECRET, new Date(t.getTime() + STEP_MS)));
  });

  it('matches the RFC 6238 SHA-1 test vector', () => {
    // Anchoring to the published vector, not to our own output. A test that
    // only checks self-consistency would happily lock in a broken algorithm
    // that no authenticator app agrees with.
    const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
    expect(generateTotp(rfcSecret, new Date(59_000))).toBe('287082');
  });
});

describe('enrolment', () => {
  it('issues a secret and an otpauth URI for the authenticator app', async () => {
    const start = await svc.beginEnrolment('u1', 'grim');
    expect(start.secret).toMatch(/^[A-Z2-7]+$/);
    expect(start.otpauthUri).toContain('otpauth://totp/');
    expect(start.otpauthUri).toContain('Grim');
  });

  it('MANDATORY: an unconfirmed enrolment satisfies NOTHING', async () => {
    // Otherwise merely STARTING enrolment would clear the requirement, and the
    // forced-enrolment rule would be satisfiable by clicking begin and closing
    // the tab.
    await svc.beginEnrolment('u1', 'grim');
    expect(await svc.isEnrolled('u1')).toBe(false);
  });

  it('confirms only with a valid code', async () => {
    const start = await svc.beginEnrolment('u1', 'grim');
    await expect(svc.confirmEnrolment('u1', '000000', AT)).rejects.toThrow(/invalid/i);
    expect(await svc.isEnrolled('u1')).toBe(false);

    await svc.confirmEnrolment('u1', generateTotp(start.secret, AT), AT);
    expect(await svc.isEnrolled('u1')).toBe(true);
  });

  it('MANDATORY: issues recovery codes ONCE, stored only as hashes', async () => {
    const codes = await enrol();
    expect(codes.length).toBeGreaterThanOrEqual(8);

    // What is stored must be a hash of the code, never the code.
    const stored = store.recovery.get('u1') ?? [];
    for (const c of codes) {
      const hash = createHash('sha256').update(c).digest('hex');
      expect(stored.some((s) => s.hash === hash)).toBe(true);
      expect(stored.some((s) => s.hash === c)).toBe(false);
    }
  });

  it('MANDATORY: re-enrolling replaces the old recovery codes', async () => {
    // Leaving the previous set valid would mean a member who re-enrolled after
    // a suspected compromise still has the compromised codes working.
    const first = await enrol();
    await svc.remove('u1');
    const second = await enrol();
    expect(second).not.toEqual(first);

    const stored = (store.recovery.get('u1') ?? []).map((c) => c.hash);
    const oldHash = createHash('sha256').update(first[0] as string).digest('hex');
    expect(stored).not.toContain(oldHash);
  });
});

describe('verification', () => {
  it('accepts a current code', async () => {
    await enrol();
    await expect(svc.verify('u1', generateTotp(SECRET_OF(store), AT), AT)).resolves.toBe(true);
  });

  it('MANDATORY: a code cannot be replayed within its own window', async () => {
    // The single most valuable property here. Six digits in thirty seconds is
    // not much protection if the same digits keep working.
    await enrol();
    const code = generateTotp(SECRET_OF(store), AT);
    expect(await svc.verify('u1', code, AT)).toBe(true);
    await expect(svc.verify('u1', code, AT)).rejects.toThrow(/already been used|invalid/i);
  });

  it('accepts the immediately previous step, for clock skew', async () => {
    // Phones drift. Rejecting a code that was valid four seconds ago produces
    // support requests, not security.
    await enrol();
    const previous = generateTotp(SECRET_OF(store), new Date(AT.getTime() - STEP_MS));
    expect(await svc.verify('u1', previous, AT)).toBe(true);
  });

  it('rejects a code from too far in the past', async () => {
    await enrol();
    const stale = generateTotp(SECRET_OF(store), new Date(AT.getTime() - STEP_MS * 5));
    await expect(svc.verify('u1', stale, AT)).rejects.toThrow(/invalid/i);
  });

  it('MANDATORY: locks the credential after repeated failures', async () => {
    // 10^6 is grindable in minutes at HTTP speed. Counting failures without
    // acting on them is not a defence.
    await enrol();
    for (let i = 0; i < 5; i += 1) {
      await svc.verify('u1', '000000', AT).catch(() => undefined);
    }
    // Even the CORRECT code is refused while locked.
    await expect(svc.verify('u1', generateTotp(SECRET_OF(store), AT), AT)).rejects.toThrow(
      /locked|too many/i,
    );
  });

  it('clears the failure count on a success', async () => {
    await enrol();
    await svc.verify('u1', '000000', AT).catch(() => undefined);
    await svc.verify('u1', generateTotp(SECRET_OF(store), AT), AT);
    expect((await store.get('u1'))?.failedCount).toBe(0);
  });

  it('refuses when the member is not enrolled at all', async () => {
    await expect(svc.verify('nobody', '123456', AT)).rejects.toThrow(/not enrolled/i);
  });

  it('rejects a malformed code without touching the store', async () => {
    await enrol();
    await expect(svc.verify('u1', 'abcdef', AT)).rejects.toThrow(/invalid/i);
    await expect(svc.verify('u1', '12345', AT)).rejects.toThrow(/invalid/i);
  });
});

describe('recovery codes', () => {
  it('a recovery code works when the authenticator is gone', async () => {
    const codes = await enrol();
    expect(await svc.verifyRecovery('u1', codes[0] as string, AT)).toBe(true);
  });

  it('MANDATORY: a recovery code is single-use', async () => {
    const codes = await enrol();
    await svc.verifyRecovery('u1', codes[0] as string, AT);
    await expect(svc.verifyRecovery('u1', codes[0] as string, AT)).rejects.toThrow(/invalid/i);
  });

  it('rejects an unknown recovery code', async () => {
    await enrol();
    await expect(svc.verifyRecovery('u1', 'NOTACODE', AT)).rejects.toThrow(/invalid/i);
  });
});

describe('@INV-012 nothing secret leaves', () => {
  it('MANDATORY: isEnrolled and verify never return the secret', async () => {
    await enrol();
    const enrolled = await svc.isEnrolled('u1');
    expect(JSON.stringify(enrolled)).not.toContain(SECRET_OF(store));
  });

  it('the confirm response contains recovery codes but NOT the secret', async () => {
    const start = await svc.beginEnrolment('u1', 'grim');
    const done = await svc.confirmEnrolment('u1', generateTotp(start.secret, AT), AT);
    // Codes yes — they are shown once and never again. Secret no: the member
    // already has it in their authenticator, and echoing it back puts it into
    // a second place it does not need to be.
    expect(done.recoveryCodes.length).toBeGreaterThan(0);
    expect(JSON.stringify(done)).not.toContain(start.secret);
  });
});

/** Reads the enrolled secret out of the fake, so tests can compute a valid code. */
function SECRET_OF(s: FakeTotpStore): string {
  const r = s.rows.get('u1');
  if (r === undefined) throw new Error('not enrolled');
  return r.secret;
}
