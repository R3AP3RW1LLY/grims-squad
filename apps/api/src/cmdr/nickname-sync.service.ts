/**
 * Keeps a member's Discord nickname equal to their verified in-game name.
 *
 * Human decision: on sign-in, if the member has an Inara key on file, their
 * server nickname becomes the commander name Inara reports — across the board.
 * It means the member list reads as commander names rather than as whatever
 * someone set their Discord handle to in 2019.
 *
 * ★ IT MUST NEVER BREAK SIGN-IN ★
 *
 * This runs inside the OAuth callback, and every way it can fail is an ordinary
 * fact about the guild rather than a fault:
 *
 *   - the GUILD OWNER cannot be renamed by a bot, ever, by Discord's design
 *   - a member whose highest role outranks the bot cannot be renamed
 *   - the bot may not hold MANAGE_NICKNAMES
 *   - Discord may be rate limiting us
 *
 * Any of those turning a successful login into an error page would be absurd.
 * So nothing here throws: the member signs in, and the result explains why the
 * nickname did not change.
 */

export interface NicknameSyncDeps {
  readonly guildId: string;
  /** The member's VERIFIED commander name, or null. Never a name they typed. */
  verifiedNameFor(userId: string): Promise<string | null>;
  /** Their current guild nickname, so an unchanged one costs nothing. */
  currentNickFor(discordId: string): Promise<string | null>;
  setNickname(
    guildId: string,
    discordId: string,
    nickname: string,
  ): Promise<{ ok: boolean; reason: string | null }>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

export interface SyncResult {
  readonly changed: boolean;
  readonly reason: string | null;
}

/** Discord's hard ceiling on a nickname. */
const MAX_NICK = 32;

export class NicknameSyncService {
  constructor(private readonly deps: NicknameSyncDeps) {}

  async syncOnLogin(userId: string, discordId: string): Promise<SyncResult> {
    try {
      const verified = await this.deps.verifiedNameFor(userId);

      // No key, or not verified. Their nickname is their own business, and
      // there is nothing authoritative to set it to.
      if (verified === null || verified.trim() === '') {
        return { changed: false, reason: 'No verified commander name for this member.' };
      }

      // Truncated rather than rejected: a commander with a long name should get
      // a shortened nickname, not none and an error.
      const want = verified.trim().slice(0, MAX_NICK);
      const current = await this.deps.currentNickFor(discordId);

      /*
       * Case-insensitive comparison, because Elite is. Rewriting "Grim" to
       * "GRIM" on every sign-in would be a Discord write and an audit row per
       * login for 108 people — and a guild audit log full of no-op renames is
       * one nobody reads.
       */
      if (current !== null && current.trim().toLowerCase() === want.toLowerCase()) {
        return { changed: false, reason: null };
      }

      const result = await this.deps.setNickname(this.deps.guildId, discordId, want);
      if (!result.ok) return { changed: false, reason: result.reason };

      await this.deps.writeAudit({
        // No actor. The member signed in; they did not ask for this, and
        // recording them as the actor would read as a self-rename.
        actorId: null,
        action: 'discord.nickname.sync',
        targetType: 'user',
        targetId: userId,
        before: { nickname: current },
        after: { nickname: want, source: 'inara_verified_name' },
      });

      return { changed: true, reason: null };
    } catch {
      /*
       * Swallowed deliberately, and this is the whole point of the file.
       *
       * A socket hang-up while renaming somebody must not turn a successful
       * login into an error page. The cause is not re-thrown and not
       * interpolated into the reason: the failing call carries a bot token, and
       * upstream error payloads have a habit of echoing request context.
       */
      return { changed: false, reason: 'Could not update the Discord nickname this time.' };
    }
  }
}
