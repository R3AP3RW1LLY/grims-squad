import { createHash, randomBytes } from 'node:crypto';
import { AppError, ErrorCode } from '@grims/shared';

/**
 * Pairing the companion app to a member's account (P1.11).
 *
 * ★ HOW IT WORKS, AND WHY THIS SHAPE ★
 *
 * The member is signed in on the website. They click "pair", we mint a token,
 * they paste it into the app. From then on the app authenticates with that
 * token and never sees their password, their Discord session, or anything else.
 *
 * The token is the app's whole identity, so:
 *
 *  - It is shown ONCE and stored only as a SHA-256 hash. We cannot show it
 *    again, and a database dump does not yield a working credential.
 *  - It is scoped to `telemetry:write` and nothing else. A stolen device token
 *    can submit journal events. It cannot read the forum, change privacy
 *    settings, or reach the admin console.
 *  - It is revocable independently, per device, so losing a laptop costs one
 *    token rather than the account.
 */

export interface DeviceTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly label: string;
  readonly scopes: readonly string[];
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface PairingStore {
  create(userId: string, label: string, tokenHash: string): Promise<DeviceTokenRecord>;
  findByHash(tokenHash: string): Promise<DeviceTokenRecord | null>;
  listFor(userId: string): Promise<DeviceTokenRecord[]>;
  revoke(id: string, at: Date): Promise<void>;
  touch(id: string, at: Date): Promise<void>;
  countActiveFor(userId: string): Promise<number>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

/** The only scope a companion token may hold. */
export const TELEMETRY_SCOPE = 'telemetry:write';

/**
 * How many devices one member may pair.
 *
 * Not a security boundary — it is a ceiling on accident. Somebody re-pairing
 * repeatedly because they lost the first token should not accumulate fifty live
 * credentials, each of which is a thing that can leak.
 */
export const MAX_DEVICES_PER_MEMBER = 5;

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Formats a token as `gsq_` plus 32 bytes of base64url.
 *
 * The prefix is not decoration: it lets a secret scanner recognise one of ours
 * in a paste, a log or a public repository. A bare random string is
 * indistinguishable from noise until somebody tries it.
 */
function mintToken(): string {
  return `gsq_${randomBytes(32).toString('base64url')}`;
}

export interface PairingResult {
  readonly token: string;
  readonly deviceId: string;
  readonly label: string;
}

export class PairingService {
  constructor(private readonly store: PairingStore) {}

  /**
   * Issues a device token. The plaintext is returned ONCE and never again.
   */
  async pair(userId: string, rawLabel: string): Promise<PairingResult> {
    const label = rawLabel.trim().slice(0, 60);
    if (label === '') {
      // A label is how a member tells "the laptop I sold" from "this desktop"
      // when revoking. Without one the device list is a row of uuids.
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Give the device a name, like "desktop".');
    }

    if ((await this.store.countActiveFor(userId)) >= MAX_DEVICES_PER_MEMBER) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `You already have ${MAX_DEVICES_PER_MEMBER} paired devices. Remove one first.`,
      );
    }

    const token = mintToken();
    const record = await this.store.create(userId, label, hash(token));

    await this.store.writeAudit({
      actorId: userId,
      action: 'device.pair',
      targetType: 'device_token',
      targetId: record.id,
      before: null,
      // The token is NOT in here. An audit log is exactly the sort of place a
      // credential gets copied to and then forgotten about.
      after: { label, scopes: [TELEMETRY_SCOPE] },
    });

    return { token, deviceId: record.id, label };
  }

  /**
   * Resolves a bearer token to the member it belongs to.
   *
   * Returns null for anything wrong — unknown, revoked, or wrongly scoped —
   * rather than distinguishing them. A caller holding a bad token learns only
   * that it is bad, which is all they are entitled to know.
   */
  async authenticate(token: string, now: Date = new Date()): Promise<DeviceTokenRecord | null> {
    if (!token.startsWith('gsq_')) return null;

    const record = await this.store.findByHash(hash(token));
    if (record === null) return null;
    if (record.revokedAt !== null) return null;

    // Scope is checked HERE rather than at the route, so a token that somehow
    // acquired a different scope cannot be used for telemetry at all.
    if (!record.scopes.includes(TELEMETRY_SCOPE)) return null;

    // Recorded so a member can see which devices are actually in use, and spot
    // one that has gone quiet or one that should not be running at all.
    await this.store.touch(record.id, now);
    return record;
  }

  async listDevices(userId: string): Promise<DeviceTokenRecord[]> {
    return this.store.listFor(userId);
  }

  /**
   * Revokes one device.
   *
   * Ownership is checked, and a device belonging to somebody else answers
   * exactly as an unknown one does — distinguishing them would confirm that a
   * given id exists.
   */
  async revoke(userId: string, deviceId: string, now: Date = new Date()): Promise<void> {
    const devices = await this.store.listFor(userId);
    const mine = devices.find((d) => d.id === deviceId);
    if (mine === undefined) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Device not found.');
    }

    await this.store.revoke(deviceId, now);
    await this.store.writeAudit({
      actorId: userId,
      action: 'device.revoke',
      targetType: 'device_token',
      targetId: deviceId,
      before: { label: mine.label, active: true },
      after: { active: false },
    });
  }
}
