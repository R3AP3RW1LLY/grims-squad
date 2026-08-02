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
  /**
   * A nickname they chose instead of the convention, or null.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "if an officer overrides their name, then this is the name that stays as their discord
   * nickname it should not change from that unless they change it."
   *
   * Checked here as well as in the nightly sweep, because this path fires on every Inara call —
   * an officer who re-linked their key would otherwise be renamed back within seconds of setting
   * their override, which is the most confusing possible version of this bug.
   */
  overrideFor(userId: string): Promise<string | null>;
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
  /**
   * The rank to put in front of their name, or null if they hold none.
   *
   * Read from the Discord roles the member WEARS rather than from granted
   * internal roles: grants only appear after reconciliation for an account that
   * exists, and most of the squadron has neither.
   */
  rankFor(discordId: string): Promise<string | null>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

export interface SyncResult {
  readonly changed: boolean;
  readonly reason: string | null;
}

/*
 * ★ THE COMPOSER MOVED TO @grims/shared ★
 *
 * The daily worker sweep puts back nicknames that members changed by hand, and
 * it cannot import from this app. Three callers now need the same truncation
 * rule — this service, the settings page's preview, and that sweep — and three
 * copies would drift into a member whose name the site shows one way and the
 * guild another.
 *
 * Re-exported so callers in this app keep one import.
 */
import { composeNickname } from '@grims/shared';
export { composeNickname, MAX_NICK } from '@grims/shared';

export class NicknameSyncService {
  constructor(private readonly deps: NicknameSyncDeps) {}

  /**
   * What the nickname WOULD be, without setting it.
   *
   * ★ THE SAME FUNCTION THAT SETS IT, NOT A DESCRIPTION OF IT ★
   *
   * The settings page used to tell members their nickname was kept as
   * "RANK - COMMANDER". That is a template, and templates lie: a long name
   * drops the rank entirely to fit Discord's 32 characters, so the member being
   * shown the shape was sometimes shown a shape they would never wear.
   *
   * Computing it through `composeNickname` means the page cannot disagree with
   * the guild, because there is one implementation and this is it.
   *
   * Returns null when there is nothing to show — no verified name means no
   * nickname, and a preview of "" would render as a claim about an empty
   * string.
   */
  async preview(userId: string, discordId: string): Promise<string | null> {
    /*
     * The override is what they will actually wear, so it is what the preview shows. Previewing the
     * computed name to somebody who has overridden it would promise a rename that will never
     * happen.
     */
    const override = await (async () => this.deps.overrideFor(userId))().catch(() => null);
    if (override != null && override.trim() !== '') return override.trim();

    const verified = await this.deps.verifiedNameFor(userId);
    if (verified === null || verified.trim() === '') return null;

    // Same tolerance as the real path: a rank lookup that fails costs the
    // prefix, never the preview.
    const rank = await (async () => this.deps.rankFor(discordId))().catch(() => null);
    return composeNickname(rank, verified);
  }

  /**
   * Reconciles one member's nickname against their verified name.
   *
   * Called after a key is linked and after every refresh — that is, after
   * anything that touched Inara. Never on its own schedule and never on login.
   */
  async sync(userId: string, discordId: string): Promise<SyncResult> {
    try {
      /*
       * ★ AN OVERRIDE ENDS IT, BEFORE ANYTHING ELSE IS READ ★
       *
       * Not "set it to the override" — leave alone. Setting the override is what wrote it to the
       * guild in the first place, so re-asserting it here would be a Discord write and an audit row
       * on every Inara call for a value nothing but the member can change.
       */
      const override = await (async () => this.deps.overrideFor(userId))().catch(() => null);
      if (override != null && override.trim() !== '') {
        return { changed: false, reason: 'This member has chosen their own nickname.' };
      }

      const verified = await this.deps.verifiedNameFor(userId);

      // No key, or not verified. Their nickname is their own business, and
      // there is nothing authoritative to set it to.
      if (verified === null || verified.trim() === '') {
        return { changed: false, reason: 'No verified commander name for this member.' };
      }

      /*
       * `RANK - COMMANDER`, where the rank is whichever they actually hold:
       * their leadership appointment if they have one, otherwise their rung on
       * the tenure ladder. A failure to read it is not a reason to skip the
       * rename — the name alone is still better than a stale nickname.
       */
      /*
       * Wrapped in an async IIFE, not just `.catch()`.
       *
       * A dependency that throws SYNCHRONOUSLY — a missing implementation, a
       * null store — never produces a promise, so `.catch()` never runs and the
       * throw escapes to the outer handler. That would abandon the rename
       * entirely over a decoration, when the commander name alone is still
       * better than a stale nickname.
       */
      const rank = await (async () => this.deps.rankFor(discordId))().catch(() => null);
      const want = composeNickname(rank, verified);
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
