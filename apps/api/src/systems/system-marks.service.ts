import type { PrismaClient } from '@grims/db';
import { RECENT_KEEP, type SystemChoice } from '@grims/shared/system-picker';

/**
 * The systems a member has pinned, and the ones they used lately.
 *
 * ★ SQUADRON OWNER, 2026-08-08 ★
 *
 * "any where that asks to enter a system ... saves entries and keeps them in a dropdown or a
 * 'book mark' system so that they can just find stuff they have entered quick instead of constantly
 * having to type this information in"
 *
 * Fourteen fields ask for a system across the website and the app — seven each. This is the only
 * piece of that feature that did not already exist: the galaxy type-ahead is already served by
 * `GET /v1/market/systems`, and where a commander is standing is already served by the position
 * endpoint. What was missing was memory.
 *
 * ★ NAMES ARE STORED AS THE GALAXY SPELLS THEM ★
 *
 * Not as they were typed. A member who types `col 285 sector gl-w c2-12` and another who pastes
 * the real spelling must land on one row, or the dropdown fills with near-duplicates of the same
 * system and the feature makes the problem worse. The unique index is on (user_id, system_name),
 * so the canonicalisation has to happen before it reaches here.
 */
export class SystemMarksService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Everything this member has marked, newest first.
   *
   * Pins and recents come back together because the caller ranks them with the shared
   * `rankSystemChoices` — the ordering is a product rule that the website and the app share, and
   * splitting it across two queries would invite two different answers.
   */
  async list(userId: string): Promise<SystemChoice[]> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{
        system_name: string;
        system_id64: bigint | null;
        kind: string;
        label: string | null;
        last_used_at: Date;
        use_count: number;
      }>
    >(
      `SELECT system_name, system_id64, kind, label, last_used_at, use_count
         FROM member_system_marks
        WHERE user_id = $1::uuid
        ORDER BY last_used_at DESC`,
      userId,
    );

    return rows.map((r) => ({
      name: r.system_name,
      // INV-006: an id64 is a 64-bit address and never becomes a number.
      systemId64: r.system_id64 === null ? null : String(r.system_id64),
      source: r.kind === 'pinned' ? 'pinned' : 'recent',
      label: r.label,
      lastUsedAt: r.last_used_at.getTime(),
      useCount: r.use_count,
    }));
  }

  /**
   * Record that a member actually used a system.
   *
   * Called on a SUCCESSFUL search rather than on every keystroke: a list of things somebody
   * half-typed is not a shortcut, it is clutter.
   */
  async use(userId: string, systemName: string, systemId64?: string | null): Promise<void> {
    const name = systemName.trim();
    if (name === '') return;

    await this.db.$executeRawUnsafe(
      `INSERT INTO member_system_marks (user_id, system_name, system_id64, kind, last_used_at, use_count)
       VALUES ($1::uuid, $2, $3::bigint, 'recent', now(), 1)
       ON CONFLICT (user_id, system_name) DO UPDATE
         SET last_used_at = now(),
             use_count    = member_system_marks.use_count + 1,
             -- Learn the address the first time we see one, and never unlearn it: a later visit
             -- from a page that does not know the id64 must not blank a good value.
             system_id64  = COALESCE(member_system_marks.system_id64, EXCLUDED.system_id64)
             -- The kind column is deliberately untouched. Using a pinned system is not how it
             -- stops being pinned.`,
      userId,
      name,
      systemId64 ?? null,
    );

    await this.#trim(userId);
  }

  /** Bookmark a system, optionally under the member's own name for it. */
  async pin(userId: string, systemName: string, label?: string | null): Promise<void> {
    const name = systemName.trim();
    if (name === '') return;

    await this.db.$executeRawUnsafe(
      `INSERT INTO member_system_marks (user_id, system_name, kind, label, last_used_at, use_count)
       VALUES ($1::uuid, $2, 'pinned', $3, now(), 1)
       ON CONFLICT (user_id, system_name) DO UPDATE
         SET kind = 'pinned', label = EXCLUDED.label`,
      userId,
      name,
      label?.trim() === '' ? null : (label ?? null),
    );
  }

  /**
   * Unpin, which demotes rather than deletes.
   *
   * A member unpinning something they used ten minutes ago still wants it in their recents. Deleting
   * the row would take away a shortcut they did not ask to lose.
   */
  async unpin(userId: string, systemName: string): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE member_system_marks SET kind = 'recent', label = NULL
        WHERE user_id = $1::uuid AND system_name = $2`,
      userId,
      systemName.trim(),
    );
  }

  /**
   * Keep the recents list to a length that is still a shortcut.
   *
   * ★ PINS ARE NEVER TRIMMED ★
   *
   * A pin is something the member asked for; a recent is a side effect of them working. Trimming by
   * age alone would quietly delete the first to make room for the second, which is the single
   * behaviour that would make this feature untrustworthy. The `kind <> 'pinned'` is the whole point
   * of the statement.
   */
  async #trim(userId: string): Promise<void> {
    await this.db.$executeRawUnsafe(
      `DELETE FROM member_system_marks
        WHERE user_id = $1::uuid
          AND kind <> 'pinned'
          AND system_name NOT IN (
            SELECT system_name FROM member_system_marks
             WHERE user_id = $1::uuid AND kind <> 'pinned'
             ORDER BY last_used_at DESC
             LIMIT ${RECENT_KEEP}
          )`,
      userId,
    );
  }
}
