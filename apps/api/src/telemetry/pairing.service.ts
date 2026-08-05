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
  /**
   * The companion version this device last reported. Null until it checks in.
   *
   * The website stops offering an update once the member is running it, and
   * nothing else could answer that: the release bucket knows what the newest
   * version IS, and the account knew nothing about what was actually installed.
   */
  readonly appVersion?: string | null;
}

export interface PairingStore {
  create(userId: string, label: string, tokenHash: string): Promise<DeviceTokenRecord>;
  findByHash(tokenHash: string): Promise<DeviceTokenRecord | null>;
  listFor(userId: string): Promise<DeviceTokenRecord[]>;
  revoke(id: string, at: Date): Promise<void>;
  /**
   * Records that the device was used, and what it is running.
   *
   * One write rather than two. `appVersion` rides along because `touch` already
   * runs on every authenticated call — a separate update would double the
   * writes on the app's five-minute poll for a single short string, and could
   * drift from `lastUsedAt` if one succeeded and the other did not.
   *
   * Undefined means "the caller did not say", which must LEAVE the stored value
   * alone. Overwriting with null on a route that happens not to send the header
   * would make a member's version flicker between known and unknown.
   */
  touch(id: string, at: Date, appVersion?: string | null): Promise<void>;
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

/**
 * Tells the account owner about a device transition — pairing completed, or a device revoked.
 *
 * ★ A CALLBACK, NOT A CLIENT ★
 *
 * The service is deliberately store-shaped (see the header), and both device doors — the token a
 * member pastes themselves, and the browser-approved link flow — come through `pair` and
 * `revoke` here. Putting the announcement behind this seam keeps that single-point property
 * without teaching the service about databases or SSE. The caller's implementation must never
 * throw; a device notice is decoration on a credential change that has already happened.
 */
export type DeviceSecurityNotice = (
  userId: string,
  event: 'paired' | 'revoked',
  label: string,
) => Promise<void>;

export class PairingService {
  constructor(
    private readonly store: PairingStore,
    /** Optional so every existing test constructs the service exactly as before. */
    private readonly security?: DeviceSecurityNotice,
  ) {}

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

    /*
     * The owner is told their account grew a credential. Both pairing doors — the pasted token
     * and the browser-approved link — pass through here, so this is one notice however the
     * device arrived. Never allowed to fail the pairing that already succeeded.
     */
    await this.security?.(userId, 'paired', label).catch(() => undefined);

    return { token, deviceId: record.id, label };
  }

  /**
   * Resolves a bearer token to the member it belongs to.
   *
   * Returns null for anything wrong — unknown, revoked, or wrongly scoped —
   * rather than distinguishing them. A caller holding a bad token learns only
   * that it is bad, which is all they are entitled to know.
   */
  async authenticate(
    token: string,
    now: Date = new Date(),
    appVersion?: string | null,
  ): Promise<DeviceTokenRecord | null> {
    if (!token.startsWith('gsq_')) return null;

    const record = await this.store.findByHash(hash(token));
    if (record === null) return null;
    if (record.revokedAt !== null) return null;

    // Scope is checked HERE rather than at the route, so a token that somehow
    // acquired a different scope cannot be used for telemetry at all.
    if (!record.scopes.includes(TELEMETRY_SCOPE)) return null;

    /*
     * Recorded so a member can see which devices are actually in use, and spot
     * one that has gone quiet or one that should not be running at all.
     *
     * The version travels with it: the app sends it on the settings poll it
     * already makes, so the website can stop offering an update the moment the
     * member is running it — without a second request or a second credential.
     */
    await this.store.touch(record.id, now, appVersion);
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
  async revoke(
    userId: string,
    deviceId: string,
    now: Date = new Date(),
    /**
     * `silent` exists for exactly one caller: the link flow's compensating revoke, where a
     * device minted a moment ago loses a race and is unwound before its token was ever handed
     * out. Telling the member "a device was unlinked" about a device they never knew existed
     * would read as somebody else acting on their account — the opposite of a security notice.
     */
    options: { silent?: boolean } = {},
  ): Promise<void> {
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

    // Gated on the row having been live: re-revoking a dead device is not a second transition.
    if (options.silent !== true && mine.revokedAt === null) {
      await this.security?.(userId, 'revoked', mine.label).catch(() => undefined);
    }
  }
}
