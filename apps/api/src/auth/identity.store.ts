/**
 * The persistence port for Discord identities.
 *
 * Defined as an interface so the login FLOW can be tested without a database.
 * The Prisma-backed implementation lands alongside P1.3, where the ACL extension
 * it must go through also lands.
 */

export interface IdentityUpsertInput {
  readonly discordUserId: string;
  readonly username: string;
  /**
   * The member's SERVER PROFILE nickname, if they set one. The squadron asks
   * members to set this to their in-game CMDR name, which makes it both the
   * most accurate identity available and the safest — a Discord global name
   * frequently carries a real name, whereas a nickname is chosen for this
   * server specifically.
   */
  readonly guildNick: string | null;
  readonly displayName: string;
  readonly avatar: string | null;
  readonly guildRoles: readonly string[];
  readonly guildJoinedAt: Date;
  readonly accessTokenEnc: string;
  readonly refreshTokenEnc: string;
  readonly tokenExpiresAt: Date;
}

export interface IdentityUpsertResult {
  readonly userId: string;
  readonly isNewUser: boolean;
}

export interface StoredIdentity {
  readonly userId: string;
  readonly discordUserId: string;
  readonly refreshTokenEnc: string;
}

export interface IIdentityStore {
  /**
   * Creates the user and identity, or updates the identity in place.
   *
   * Upsert rather than insert because a member logs in many times and each login
   * carries a fresh snapshot of username, avatar and — critically — guild roles.
   * A role removed in Discord must not survive in our copy until a nightly job
   * happens to notice.
   */
  upsertOnLogin(input: IdentityUpsertInput): Promise<IdentityUpsertResult>;

  findByUserId(userId: string): Promise<StoredIdentity | null>;

  /**
   * Claims the Discord activity recorded before this account existed.
   *
   * ★ WHY THIS IS NEEDED AT ALL ★
   *
   * `member_activity_months` is keyed on the DISCORD id, because the bot counts
   * messages for everyone in the guild — most of whom have never visited the
   * site. `user_id` is filled in when they do.
   *
   * Nothing was filling it in. A member who had been talking in Discord for
   * months would sign in, verify their commander, and still appear on the
   * activity table as having done none of it — because the row the table reads
   * had no account attached. Reported from production for a member who had
   * done both.
   *
   * Retroactive on purpose: their history is theirs from the day the bot saw
   * it, not from the day they got round to signing in.
   */
  linkActivityHistory(discordId: string, userId: string): Promise<number>;
}
