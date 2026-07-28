import { AppError, ErrorCode, OPTIONAL_CATEGORIES, type TelemetryCategoryName } from '@grims/shared';

/**
 * Telemetry consent for the OPTIONAL categories (INV-013).
 *
 * ★ WHAT THIS DOES NOT COVER ★
 *
 * The baseline — that they played, their ranks, their ships — is not on this
 * list, because it comes with running the app rather than with a checkbox. This
 * governs the leaderboard data: where they went, what they fought, what they
 * hauled. All of it off until asked for.
 *
 * ★ REVOKING PURGES ★
 *
 * Turning a category off deletes what was already stored under it, rather than
 * merely stopping new writes. The constraint says "revoke and purge" and the two
 * halves are not separable — a member who withdraws consent and finds a year of
 * their data still sitting there has not been given a choice, only a switch.
 *
 * The purge is why this is a service rather than a column update.
 */

/**
 * The categories a member can choose.
 *
 * The BASELINE is deliberately absent: session, profile and fleet come with
 * running the app, and offering a switch that does nothing would be worse than
 * offering none. See BASELINE_CATEGORIES and INV-013.
 */
export const CONSENT_CATEGORIES: readonly TelemetryCategoryName[] = OPTIONAL_CATEGORIES;

export interface ConsentStore {
  read(userId: string): Promise<readonly string[]>;
  write(userId: string, categories: readonly string[]): Promise<void>;
  /** Deletes every stored event in these categories. Returns how many. */
  purge(userId: string, categories: readonly string[]): Promise<number>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

export class ConsentService {
  constructor(private readonly store: ConsentStore) {}

  async get(userId: string): Promise<readonly TelemetryCategoryName[]> {
    const stored = await this.store.read(userId);
    // Filtered against the known set, so a category retired from the app cannot
    // keep appearing in a member's settings as an option they cannot turn off.
    return CONSENT_CATEGORIES.filter((c) => stored.includes(c));
  }

  /**
   * Replaces the member's consent, purging anything they turned off.
   *
   * Takes the WHOLE set rather than a single toggle. A settings screen that
   * sends one flag at a time can race itself — two toggles in flight, and the
   * second overwrites the first with a stale view of the rest.
   */
  async set(userId: string, requested: readonly string[]): Promise<{
    categories: readonly TelemetryCategoryName[];
    purged: number;
  }> {
    const unknown = requested.filter(
      (c) => !CONSENT_CATEGORIES.includes(c as TelemetryCategoryName),
    );
    if (unknown.length > 0) {
      // Rejected rather than ignored. Silently dropping an unrecognised category
      // would tell a member their choice was saved when it was not.
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Not a telemetry category: ${unknown.join(', ')}.`,
      );
    }

    const before = await this.get(userId);
    const after = CONSENT_CATEGORIES.filter((c) => requested.includes(c));
    const withdrawn = before.filter((c) => !after.includes(c));

    await this.store.write(userId, after);

    /*
     * Purge AFTER the write, so a failure part-way through leaves consent
     * already withdrawn and some data still present — recoverable by trying
     * again. The other order would leave data deleted while consent still reads
     * as granted, which is the same outcome dressed as a lie.
     */
    const purged = withdrawn.length === 0 ? 0 : await this.store.purge(userId, withdrawn);

    await this.store.writeAudit({
      actorId: userId,
      action: 'telemetry.consent.set',
      targetType: 'user',
      targetId: userId,
      before: { categories: [...before] },
      after: { categories: [...after], withdrawn, purgedEvents: purged },
    });

    return { categories: after, purged };
  }
}
