/**
 * The Discord identity port (ADR-013 — no app code imports a vendor SDK).
 *
 * Every method here is implemented twice: once against the real API and once as
 * a deterministic in-memory fake. Tests bind the fake and touch no network.
 */

/** Exactly the scopes we request. `email` is deliberately absent — see P1.1 notes. */
export const DISCORD_SCOPES = ['identify', 'guilds.members.read'] as const;
export const DISCORD_SCOPE_STRING = DISCORD_SCOPES.join(' ');

export interface DiscordTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds from issuance, as Discord reports it. */
  readonly expiresInSec: number;
  readonly scope: string;
}

export interface DiscordUser {
  readonly id: string;
  readonly username: string;
  readonly globalName: string | null;
  /** Avatar hash, not a URL. The CDN host is our concern, not the API's. */
  readonly avatar: string | null;
}

export interface DiscordGuildMember {
  /** Snowflake role ids. Mapped to internal roles through `role_mappings` (INV-008). */
  readonly roles: readonly string[];
  readonly nick: string | null;
  /** ISO-8601. The sole input to tenure rank computation (INV-047). */
  readonly joinedAt: string;
}

export interface IDiscordIdentityProvider {
  exchangeCode(code: string, redirectUri: string): Promise<DiscordTokenSet>;
  refresh(refreshToken: string): Promise<DiscordTokenSet>;
  fetchUser(accessToken: string): Promise<DiscordUser>;
  /**
   * Returns `null` when the user is not a member of the guild.
   *
   * Not-a-member is an EXPECTED outcome, not an exception: Discord answers 404
   * for it, and an adapter that throws on 404 makes the caller distinguish
   * "not in guild" from "Discord is broken" by string-matching an error. Those
   * two must never collapse together — one refuses a login, the other must not.
   */
  fetchGuildMember(accessToken: string, guildId: string): Promise<DiscordGuildMember | null>;
}

/** Thrown when Discord itself failed — never for a not-a-member result. */
export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}
