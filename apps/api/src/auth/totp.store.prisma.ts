import type { PrismaClient } from '@grims/db';
import type { TokenCipher } from '@grims/shared/server';
import type { TotpStore, TotpRecord } from './totp.service.js';

/**
 * TOTP persistence.
 *
 * The secret is encrypted at rest with the shared keyring (INV-012), and the
 * AAD context binds the ciphertext to (purpose, subject): a row lifted from
 * this table cannot be decrypted as though it belonged to a different user or
 * a different purpose. The service never sees ciphertext and the database
 * never sees plaintext.
 */
export class PrismaTotpStore implements TotpStore {
  readonly #db: PrismaClient;
  readonly #cipher: TokenCipher;

  constructor(db: PrismaClient, cipher: TokenCipher) {
    this.#db = db;
    this.#cipher = cipher;
  }

  #context(userId: string): string {
    return `totp:${userId}`;
  }

  async get(userId: string): Promise<TotpRecord | null> {
    const row = await this.#db.twoFactorCredential.findUnique({ where: { userId } });
    if (row === null) return null;
    return {
      userId: row.userId,
      // Buffer.from(...), not row.secretEnc.toString('utf8'). Prisma 6 maps
      // Bytes to Uint8Array, whose toString takes NO encoding argument and
      // would silently produce a comma-separated list of byte values.
      secret: this.#cipher.decrypt(
        Buffer.from(row.secretEnc).toString('utf8'),
        this.#context(userId),
      ),
      confirmedAt: row.confirmedAt,
      lastUsedStep: row.lastUsedStep,
      failedCount: row.failedCount,
      lockedUntil: row.lockedUntil,
    };
  }

  async upsert(userId: string, secret: string): Promise<void> {
    const enc = Buffer.from(this.#cipher.encrypt(secret, this.#context(userId)), 'utf8');
    await this.#db.twoFactorCredential.upsert({
      where: { userId },
      // A fresh enrolment always starts UNCONFIRMED, even when replacing an
      // existing credential — otherwise re-enrolling would inherit the old
      // confirmation and grant access to a secret nobody has proven they hold.
      create: { userId, secretEnc: enc },
      update: { secretEnc: enc, confirmedAt: null, lastUsedStep: null, failedCount: 0, lockedUntil: null },
    });
  }

  async confirm(userId: string, at: Date, step: bigint): Promise<void> {
    await this.#db.twoFactorCredential.update({
      where: { userId },
      data: { confirmedAt: at, lastUsedStep: step, failedCount: 0, lockedUntil: null },
    });
  }

  async recordSuccess(userId: string, step: bigint): Promise<void> {
    await this.#db.twoFactorCredential.update({
      where: { userId },
      data: { lastUsedStep: step, failedCount: 0, lockedUntil: null },
    });
  }

  async recordFailure(userId: string, failedCount: number, lockedUntil: Date | null): Promise<void> {
    await this.#db.twoFactorCredential.update({
      where: { userId },
      data: { failedCount, lockedUntil },
    });
  }

  async replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
    // Delete then insert, in one transaction. A partial replacement would leave
    // a mix of old and new codes valid, which is the one state that must not
    // exist after someone re-enrols following a suspected compromise.
    await this.#db.$transaction([
      this.#db.twoFactorRecovery.deleteMany({ where: { userId } }),
      this.#db.twoFactorRecovery.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      }),
    ]);
  }

  async consumeRecoveryCode(userId: string, hash: string, at: Date): Promise<boolean> {
    // updateMany with usedAt: null in the WHERE is the atomic part: two
    // concurrent attempts with the same code cannot both succeed, because the
    // second matches zero rows.
    const r = await this.#db.twoFactorRecovery.updateMany({
      where: { userId, codeHash: hash, usedAt: null },
      data: { usedAt: at },
    });
    return r.count === 1;
  }

  async remove(userId: string): Promise<void> {
    // Recovery codes cascade with the credential.
    await this.#db.twoFactorCredential.deleteMany({ where: { userId } });
  }
}
