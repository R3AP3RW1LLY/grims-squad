import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, ErrorCode } from '@grims/shared';

/**
 * TOTP (RFC 6238) as the gate on the admin console.
 *
 * ★ WHY IT IS MANDATORY RATHER THAN OFFERED ★
 * The accounts worth attacking are exactly the ones that can grant roles and
 * change site config. "We recommended two-factor" is not a control.
 *
 * ★ WHY THE ALGORITHM IS HERE RATHER THAN FROM A PACKAGE ★
 * It is thirty lines of HMAC-SHA1 with a documented test vector, and the spec
 * has not changed since 2011. A dependency for this is a supply-chain surface
 * on the authentication path — the worst possible place for one — in exchange
 * for code that cannot drift. The RFC vector is asserted in the spec, so
 * "matches every authenticator app" is verified rather than assumed.
 */

const DIGITS = 6;
const STEP_SEC = 30;
/**
 * One step of tolerance, backwards only.
 *
 * Phones drift, and refusing a code that was valid four seconds ago produces
 * support requests rather than security. FORWARD tolerance is not granted: it
 * would widen the window for a code the user has not yet been shown, which
 * helps nobody legitimate.
 */
const BACKWARD_STEPS = 1;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;
const RECOVERY_CODES = 10;

export interface TotpRecord {
  readonly userId: string;
  readonly secret: string;
  readonly confirmedAt: Date | null;
  readonly lastUsedStep: bigint | null;
  readonly failedCount: number;
  readonly lockedUntil: Date | null;
}

export interface TotpStore {
  get(userId: string): Promise<TotpRecord | null>;
  upsert(userId: string, secret: string): Promise<void>;
  confirm(userId: string, at: Date, step: bigint): Promise<void>;
  recordSuccess(userId: string, step: bigint): Promise<void>;
  recordFailure(userId: string, failedCount: number, lockedUntil: Date | null): Promise<void>;
  replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void>;
  consumeRecoveryCode(userId: string, hash: string, at: Date): Promise<boolean>;
  remove(userId: string): Promise<void>;
}

// ------------------------------------------------------------------ base32
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new AppError(ErrorCode.VALIDATION_FAILED, 'Malformed TOTP secret.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export const stepAt = (at: Date): bigint => BigInt(Math.floor(at.getTime() / 1000 / STEP_SEC));

/** RFC 6238 / RFC 4226. HMAC-SHA1, dynamic truncation, six digits. */
export function generateTotpForStep(secretBase32: string, step: bigint): string {
  const key = base32Decode(secretBase32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);

  const mac = createHmac('sha1', key).update(counter).digest();
  // Dynamic truncation: the low nibble of the last byte picks the offset.
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const bin =
    (((mac[offset] as number) & 0x7f) << 24) |
    (((mac[offset + 1] as number) & 0xff) << 16) |
    (((mac[offset + 2] as number) & 0xff) << 8) |
    ((mac[offset + 3] as number) & 0xff);

  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export const generateTotp = (secretBase32: string, at: Date): string =>
  generateTotpForStep(secretBase32, stepAt(at));

/** Constant-time comparison. A timing oracle on a six-digit code is a real one. */
function codesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const hashCode = (code: string): string =>
  createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

export interface EnrolmentStart {
  readonly secret: string;
  readonly otpauthUri: string;
}

export interface EnrolmentResult {
  /** Shown ONCE. Never retrievable afterwards — only hashes are stored. */
  readonly recoveryCodes: string[];
}

export class TotpService {
  constructor(private readonly store: TotpStore) {}

  async beginEnrolment(userId: string, handle: string): Promise<EnrolmentStart> {
    // 160 bits, the RFC 4226 recommendation for HMAC-SHA1.
    const secret = base32Encode(randomBytes(20));
    await this.store.upsert(userId, secret);
    const label = encodeURIComponent(`Grim's Squad:${handle}`);
    return {
      secret,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Grim's Squad")}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`,
    };
  }

  /**
   * Completes enrolment by proving possession.
   *
   * Until this succeeds the credential grants NOTHING — otherwise merely
   * starting enrolment would satisfy the forced-enrolment rule, which anyone
   * could do by clicking begin and closing the tab.
   */
  async confirmEnrolment(userId: string, code: string, at: Date = new Date()): Promise<EnrolmentResult> {
    const rec = await this.store.get(userId);
    if (rec === null) throw new AppError(ErrorCode.VALIDATION_FAILED, 'Start enrolment first.');

    const step = this.#matchStep(rec.secret, code, at);
    if (step === null) {
      throw new AppError(ErrorCode.TWO_FACTOR_REQUIRED, 'That code is invalid. Try the next one.');
    }

    await this.store.confirm(userId, at, step);

    const codes = Array.from({ length: RECOVERY_CODES }, () =>
      randomBytes(5).toString('hex').toUpperCase(),
    );
    // Hashes only. A recovery code is a password equivalent — storing it
    // recoverably would make the table a bypass of the control it backs up.
    // This REPLACES any previous set, so re-enrolling after a suspected
    // compromise does not leave the compromised codes working.
    await this.store.replaceRecoveryCodes(userId, codes.map(hashCode));

    // The secret is deliberately NOT echoed back. The member already has it in
    // their authenticator; returning it puts it somewhere it need not be.
    return { recoveryCodes: codes };
  }

  async isEnrolled(userId: string): Promise<boolean> {
    const rec = await this.store.get(userId);
    return rec !== null && rec.confirmedAt !== null;
  }

  async verify(userId: string, code: string, at: Date = new Date()): Promise<boolean> {
    const rec = await this.store.get(userId);
    if (rec === null || rec.confirmedAt === null) {
      throw new AppError(ErrorCode.TWO_FACTOR_REQUIRED, 'Two-factor is not enrolled.');
    }

    if (rec.lockedUntil !== null && rec.lockedUntil.getTime() > at.getTime()) {
      // The correct code is refused too. A lockout that the right code bypasses
      // is not a lockout.
      throw new AppError(
        ErrorCode.TWO_FACTOR_REQUIRED,
        'Too many incorrect codes. This account is locked for a few minutes.',
      );
    }

    if (!/^\d{6}$/.test(code)) {
      // Rejected without consulting the store — malformed input is not an
      // authentication attempt worth counting or timing.
      throw new AppError(ErrorCode.TWO_FACTOR_REQUIRED, 'Invalid code.');
    }

    const step = this.#matchStep(rec.secret, code, at);

    if (step === null || (rec.lastUsedStep !== null && step <= rec.lastUsedStep)) {
      /*
       * SINGLE USE. A code already accepted — or any code from a step at or
       * before the last accepted one — is refused even while still inside its
       * own 30-second window. Six digits is not much protection if the same
       * digits keep working after being read over a shoulder or caught in a
       * screen share.
       */
      const failed = rec.failedCount + 1;
      const locked = failed >= MAX_FAILURES ? new Date(at.getTime() + LOCKOUT_MS) : null;
      await this.store.recordFailure(userId, failed, locked);
      throw new AppError(
        ErrorCode.TWO_FACTOR_REQUIRED,
        step === null ? 'Invalid code.' : 'That code has already been used.',
      );
    }

    await this.store.recordSuccess(userId, step);
    return true;
  }

  async verifyRecovery(userId: string, code: string, at: Date = new Date()): Promise<boolean> {
    const ok = await this.store.consumeRecoveryCode(userId, hashCode(code), at);
    if (!ok) throw new AppError(ErrorCode.TWO_FACTOR_REQUIRED, 'Invalid recovery code.');
    return true;
  }

  async remove(userId: string): Promise<void> {
    await this.store.remove(userId);
  }

  /** The step this code belongs to, or null. Checks now, then one step back. */
  #matchStep(secret: string, code: string, at: Date): bigint | null {
    const now = stepAt(at);
    for (let back = 0; back <= BACKWARD_STEPS; back += 1) {
      const step = now - BigInt(back);
      if (codesEqual(generateTotpForStep(secret, step), code)) return step;
    }
    return null;
  }
}
