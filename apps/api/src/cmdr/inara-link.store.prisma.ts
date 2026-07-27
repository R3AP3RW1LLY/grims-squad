import { AppError, ErrorCode } from '@grims/shared';
import type { PrismaClient } from '@grims/db';
import type { TokenCipher } from '@grims/shared/server';
import type { InaraLinkStore, LinkRecord } from './inara-link.service.js';

/**
 * Inara key persistence.
 *
 * The key is encrypted with the shared keyring and the AAD bound to
 * (purpose, subject), so a row lifted from this table cannot be decrypted as
 * another member's (INV-012). The service never sees ciphertext; the database
 * never sees plaintext.
 */
export class PrismaInaraLinkStore implements InaraLinkStore {
  readonly #db: PrismaClient;
  readonly #cipher: TokenCipher;

  constructor(db: PrismaClient, cipher: TokenCipher) {
    this.#db = db;
    this.#cipher = cipher;
  }

  #context(userId: string): string {
    return `inara-key:${userId}`;
  }

  async get(userId: string): Promise<LinkRecord | null> {
    const row = await this.#db.inaraLink.findUnique({ where: { userId } });
    if (row === null) return null;
    return {
      userId: row.userId,
      // Buffer.from(...), not .toString('utf8') on the raw value: Prisma 6 maps
      // Bytes to Uint8Array, whose toString takes NO encoding argument and
      // would silently yield a comma-separated list of byte values.
      apiKey: this.#cipher.decrypt(Buffer.from(row.apiKeyEnc).toString('utf8'), this.#context(userId)),
      cmdrName: row.cmdrName,
      verifiedAt: row.verifiedAt,
      lastCheckedAt: row.lastCheckedAt,
      lastError: row.lastError,
      source: row.source,
    };
  }

  async saveKey(userId: string, apiKey: string, source: string): Promise<void> {
    const enc = Buffer.from(this.#cipher.encrypt(apiKey, this.#context(userId)), 'utf8');
    await this.#db.inaraLink.upsert({
      where: { userId },
      create: { userId, apiKeyEnc: enc, source },
      // A replacement key clears the previous error and verification stamp: the
      // new key has not been checked yet, and showing yesterday's failure beside
      // a key entered thirty seconds ago is confusing.
      update: { apiKeyEnc: enc, source, lastError: null, verifiedAt: null },
    });
  }

  async recordSuccess(userId: string, cmdrName: string, at: Date): Promise<void> {
    await this.#db.inaraLink.update({
      where: { userId },
      data: { cmdrName, verifiedAt: at, lastCheckedAt: at, lastError: null },
    });
  }

  async recordFailure(userId: string, error: string, at: Date): Promise<void> {
    // verifiedAt is deliberately untouched. A failed check is not evidence the
    // member is lying, and revoking on somebody else's outage would demote
    // people who did nothing wrong.
    await this.#db.inaraLink.update({
      where: { userId },
      data: { lastCheckedAt: at, lastError: error },
    });
  }

  async remove(userId: string): Promise<void> {
    await this.#db.inaraLink.deleteMany({ where: { userId } });
  }

  async verifiedHolderOf(cmdrName: string): Promise<string | null> {
    // citext column — the database compares case-insensitively, exactly as the
    // partial unique index does. Passing mode: 'insensitive' here would build a
    // DIFFERENT comparison from the one being enforced.
    const v = await this.#db.cmdrVerification.findFirst({
      where: { cmdrName, isVerified: true, revokedAt: null },
      select: { userId: true },
    });
    return v?.userId ?? null;
  }

  /**
   * Records the verification itself.
   *
   * Revokes the member's previous verified claim first: one active verified
   * claim per member, or an old name keeps holding a lock nobody is using
   * (INV-005).
   */
  async upsertVerification(userId: string, cmdrName: string, trustTier: number): Promise<void> {
    const now = new Date();
    await this.#db.$transaction(async (tx) => {
      const existing = await tx.cmdrVerification.findFirst({
        where: { userId, isVerified: true, revokedAt: null },
        select: { id: true, cmdrName: true },
      });

      // Same name already verified — nothing to do, and re-inserting would
      // violate the partial unique index.
      if (existing !== null && existing.cmdrName.toLowerCase() === cmdrName.toLowerCase()) return;
      if (existing !== null) {
        await tx.cmdrVerification.update({ where: { id: existing.id }, data: { revokedAt: now } });
      }

      /*
       * @DATA-ADV FINDING, 2026-07-27 — this could raise a raw constraint error.
       *
       * The partial unique index on (cmdr_name) WHERE is_verified AND NOT
       * revoked is the real enforcement, and it fires when two members link
       * keys for the SAME commander — which sounds impossible until you
       * remember that two people can share one Inara account, and that the
       * application-level check runs before the write rather than inside it.
       *
       * Unhandled, that surfaced as a 500 with a Postgres constraint name in
       * it. Caught here it becomes the same clean CMDR_ALREADY_CLAIMED the
       * pre-check produces, so the member is told something they can act on
       * rather than being shown a database error.
       */
      try {
        await tx.cmdrVerification.create({
          data: {
            userId,
            cmdrName,
            method: 'inara_nonce',
            trustTier,
            isVerified: true,
            verifiedAt: now,
          },
        });
      } catch (cause) {
        const code = (cause as { code?: string }).code;
        // P2002 is Prisma's unique-constraint violation. Anything else is a
        // genuine fault and must keep propagating.
        if (code !== 'P2002') throw cause;
        throw new AppError(
          ErrorCode.CMDR_ALREADY_CLAIMED,
          `CMDR ${cmdrName} was verified by another member a moment ago. Speak to an officer if that is wrong.`,
        );
      }
    });
  }

  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    await this.#db.auditLog.create({
      data: {
        actorId: entry['actorId'] as string | null,
        actorType: entry['actorId'] === null ? 'system' : 'user',
        action: String(entry['action']),
        targetType: String(entry['targetType']),
        targetId: String(entry['targetId']),
        before: entry['before'] as never,
        after: entry['after'] as never,
      },
    });
  }
}
