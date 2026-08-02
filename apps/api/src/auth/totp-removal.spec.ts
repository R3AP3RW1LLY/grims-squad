import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TotpService, generateTotp, type TotpStore, type TotpRecord } from './totp.service.js';
import { TotpController } from './totp.controller.js';
import { csrfCookieName } from '../common/csrf.js';

/**
 * Removing and replacing an authenticator.
 *
 * ★ SQUADRON OWNER ★
 *
 * "we need a way for our users to either add the authenticator to their profile and manage the
 * authenticator, remove and re add etc, the officers / admin roles if they remove it must be
 * prompted to re add it, and until they do, can not be able to access the admin area at all!"
 *
 * ★ THE PROPERTY THAT MATTERS MOST IS THE ONE THAT IS NOT HERE ★
 *
 * There is no test asserting that removal revokes admin access, because removal does not revoke
 * anything. `AdminGateGuard` refuses every admin route unless TOTP is enrolled, and
 * `mustSecureAccount` is "privileged AND unenrolled" — so deleting the credential closes the admin
 * console and raises the re-enrol prompt on its own.
 *
 * A second revocation path would be the bug: two answers to "may this account open the admin
 * console", one of which is a column somebody has to remember to set. The last test in this file
 * asserts that no such path was added.
 */

const STEP_MS = 30_000;

class FakeStore implements TotpStore {
  rows = new Map<string, TotpRecord>();
  recovery = new Map<string, Array<{ hash: string; usedAt: Date | null }>>();
  removed: string[] = [];

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
    if (r !== undefined) this.rows.set(userId, { ...r, confirmedAt: at, lastUsedStep: step, failedCount: 0 });
  }
  async recordSuccess(userId: string, step: bigint): Promise<void> {
    const r = this.rows.get(userId);
    if (r !== undefined) this.rows.set(userId, { ...r, lastUsedStep: step, failedCount: 0 });
  }
  async recordFailure(userId: string, failedCount: number, lockedUntil: Date | null): Promise<void> {
    const r = this.rows.get(userId);
    if (r !== undefined) this.rows.set(userId, { ...r, failedCount, lockedUntil });
  }
  async replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
    this.recovery.set(userId, hashes.map((hash) => ({ hash, usedAt: null })));
  }
  async consumeRecoveryCode(userId: string, hash: string, at: Date): Promise<boolean> {
    const rows = this.recovery.get(userId) ?? [];
    const hit = rows.find((r) => r.hash === hash && r.usedAt === null);
    if (hit === undefined) return false;
    hit.usedAt = at;
    return true;
  }
  async remove(userId: string): Promise<void> {
    this.removed.push(userId);
    this.rows.delete(userId);
    this.recovery.delete(userId);
  }
}

/** Just enough of Fastify for the controller: a CSRF-carrying request and a cookie jar. */
/*
 * A token long enough to pass `verifyCsrf`'s minimum, under the cookie name the helper actually
 * looks for — which is prefixed `__Host-` in production. Hard-coding `gs_csrf` would make this
 * suite pass locally and fail wherever NODE_ENV is production.
 */
const CSRF = 'a'.repeat(43);
const req = () =>
  ({
    method: 'POST',
    headers: { 'x-csrf-token': CSRF },
    cookies: { [csrfCookieName(process.env['NODE_ENV'] === 'production')]: CSRF },
  }) as never;

interface Jar {
  set: Array<{ name: string; value: string }>;
  cleared: string[];
}

const reply = (jar: Jar) =>
  ({
    setCookie: (name: string, value: string) => jar.set.push({ name, value }),
    clearCookie: (name: string) => jar.cleared.push(name),
  }) as never;

let store: FakeStore;
let svc: TotpService;
let ctl: TotpController;
let jar: Jar;

const USER = { userId: 'u1' } as never;

/*
 * ★ THE CLOCK IS REAL, BECAUSE THE CONTROLLER'S IS ★
 *
 * `TotpService.verify` defaults `at` to `new Date()`, and the controller does not pass one — so a
 * code generated for a fixed 2026 timestamp is simply wrong, which is what "Invalid code." meant
 * the first time this ran.
 *
 * So enrolment happens two steps in the PAST and the code is generated for now. The gap matters:
 * confirming consumes the step it was confirmed with, so enrolling and removing inside one
 * 30-second window is a genuine replay and is correctly refused.
 */
const ENROL_AT = new Date(Date.now() - 2 * STEP_MS);

beforeEach(async () => {
  store = new FakeStore();
  svc = new TotpService(store);
  ctl = new TotpController(svc);
  jar = { set: [], cleared: [] };
});

async function enrol(): Promise<{ secret: string; recovery: string[] }> {
  const start = await svc.beginEnrolment('u1', 'grim');
  const done = await svc.confirmEnrolment('u1', generateTotp(start.secret, ENROL_AT), ENROL_AT);
  return { secret: start.secret, recovery: done.recoveryCodes };
}

const codeNow = (secret: string): string => generateTotp(secret, new Date());

describe('removing an authenticator', () => {
  it('removes it when a current code is given', async () => {
    const { secret } = await enrol();
    expect(await svc.isEnrolled('u1')).toBe(true);

    await ctl.remove(USER, { code: codeNow(secret) }, req(), reply(jar));

    expect(await svc.isEnrolled('u1')).toBe(false);
    expect(store.removed).toEqual(['u1']);
  });

  it('MANDATORY: refuses without a valid code', async () => {
    const { secret } = await enrol();

    // The wrong six digits. Removal is the most useful thing an attacker can do with a hijacked
    // session — it turns a stolen tab into a permanent hold, because everything afterwards needs
    // only Discord.
    const wrong = codeNow(secret) === '000000' ? '111111' : '000000';
    await expect(ctl.remove(USER, { code: wrong }, req(), reply(jar))).rejects.toThrow();

    expect(await svc.isEnrolled('u1')).toBe(true);
    expect(store.removed).toEqual([]);
  });

  it('accepts a recovery code, for somebody who lost the device', async () => {
    // The case the whole feature exists for: a new phone, and the old authenticator gone. Without
    // this the only route back is an officer with database access.
    const { recovery } = await enrol();

    await ctl.remove(USER, { recoveryCode: recovery[0] }, req(), reply(jar));

    expect(await svc.isEnrolled('u1')).toBe(false);
  });

  it('MANDATORY: clears the step-up cookie', async () => {
    /*
     * Otherwise a privileged member keeps browsing the admin area on the strength of a factor they
     * just deleted, until the cookie expires. The guard reads enrolment too and would refuse — but
     * the UI and the guard should agree immediately rather than one page load apart.
     */
    const { secret } = await enrol();

    await ctl.remove(USER, { code: codeNow(secret) }, req(), reply(jar));

    expect(jar.cleared).toContain('gs_2fa');
  });

  it('says so plainly when there is nothing to remove', async () => {
    // Not a silent success. "Removed" for an account that never had one is a lie that makes a
    // member think they had two-factor on.
    await expect(ctl.remove(USER, { code: '123456' }, req(), reply(jar))).rejects.toThrow(
      /do not have an authenticator/i,
    );
  });

  it('lets the same account enrol again afterwards', async () => {
    // "Remove and re add" — the round trip, not just the removal.
    const { secret } = await enrol();
    await ctl.remove(USER, { code: codeNow(secret) }, req(), reply(jar));

    const again = await svc.beginEnrolment('u1', 'grim');
    const at = new Date(Date.now() + 2 * STEP_MS);
    await svc.confirmEnrolment('u1', generateTotp(again.secret, at), at);

    expect(await svc.isEnrolled('u1')).toBe(true);
    // A NEW secret. Re-enrolling onto the old one would let a device that was removed keep working.
    expect(again.secret).not.toBe(secret);
  });
});

describe('what removal must NOT do', () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'totp.controller.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  it('MANDATORY: writes no second revocation path', () => {
    /*
     * Admin access is decided in ONE place — AdminGateGuard, reading enrolment. If removal ever
     * starts editing roles, permission masks or an "admin disabled" column, there are two answers
     * to the same question and the one nobody remembers to update wins.
     */
    for (const forbidden of ['userRole', 'permMask', 'perm_mask', 'role.update', 'roleId']) {
      expect(source, `removal touches ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('MANDATORY: never returns a secret or recovery codes from removal', () => {
    // INV-012. The remove handler's return type is the whole guarantee, so it is asserted rather
    // than assumed.
    expect(source).toMatch(/async remove\([\s\S]*?\): Promise<\{ removed: true \}>/);
  });
});
