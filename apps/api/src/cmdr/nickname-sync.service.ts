/**
 * Keeps a member's Discord nickname equal to their verified in-game name.
 *
 * Human decision, refined 2026-07-27: the nickname is set when the Inara key is
 * FIRST ADDED, and re-checked every time we call Inara for anything. It is not
 * driven by sign-in — signing in tells us nothing new about their commander
 * name, so renaming on it would be a Discord write per login for 108 people
 * that could only ever produce the same answer.
 *
 * ★ IT SELF-HEALS ★
 *
 * Because every check compares the CURRENT nickname against the verified name,
 * a member who renames themselves in Discord is put back at the next Inara
 * call. That is deliberate: the whole point is that the member list reads as
 * commander names, and a nickname that drifts silently defeats it.
 *
 * ★ IT MUST NEVER BREAK ITS CALLER ★
 *
 * It hangs off a verification flow that the member is waiting on, and every way
 * it can fail is an ordinary fact about the guild rather than a fault:
 *
 *   - the GUILD OWNER cannot be renamed by a bot, ever, by Discord's design
 *   - a member whose highest role outranks the bot cannot be renamed
 *   - the bot may not hold MANAGE_NICKNAMES
 *   - Discord may be rate limiting us
 *
 * Any of those turning a successful key-link into an error would be absurd —
 * the verification worked; only the cosmetic rename did not. So nothing here
 * throws, and the result explains what happened.
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
  /**
   * Records the nickname we just set, so the next check sees it.
   *
   * ★ DESIGN-ADV FINDING, 2026-07-27 ★
   *
   * `currentNickFor` reads our STORED copy of the guild nickname, which was
   * only ever written by the OAuth callback. After we renamed somebody our copy
   * stayed stale, so every subsequent check compared the OLD nickname against
   * the verified name, saw a mismatch, and issued the same rename again — on
   * every Inara call, forever. The "does nothing when it matches" path could
   * never fire after the first rename, and the guild audit log would fill with
   * identical renames.
   */
  rememberNickname(discordId: string, nickname: string): Promise<void>;
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

  /**
   * Reconciles one member's nickname against their verified name.
   *
   * Called after a key is linked and after every refresh — that is, after
   * anything that touched Inara. Never on its own schedule and never on login.
   */
  async sync(userId: string, discordId: string): Promise<SyncResult> {
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

      // Write our copy forward. Without this the next check reads the OLD value,
      // sees a mismatch it just fixed, and renames again — every time.
      await this.deps.rememberNickname(discordId, want);

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
       * A socket hang-up while renaming somebody must not fail the
       * verification they were actually doing. The cause is not re-thrown and
       * not interpolated into the reason: the failing call carries a bot token,
       * and upstream error payloads have a habit of echoing request context.
       */
      return { changed: false, reason: 'Could not update the Discord nickname this time.' };
    }
  }
}
