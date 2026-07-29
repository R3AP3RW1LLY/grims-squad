import {
  AppError,
  ErrorCode,
  REQUIRED_CATEGORY,
  TELEMETRY_CATALOGUE,
  categoryOf,
  type TelemetryCategoryName,
} from '@grims/shared';

/**
 * What a member has switched OFF (INV-013, amended 2026-07-29).
 *
 * ★ OPT-OUT, WHICH IS THE REVERSE OF WHAT THIS USED TO BE ★
 *
 * The companion app no longer filters: it sends what it reads, and this is
 * where a member's decision is recorded and applied. Empty means everything is
 * kept, which is the default.
 *
 * Two scopes, because one is not enough. A category is coarse — "combat" is
 * bounties AND conflict zones AND PVP AND your own losses — and somebody may be
 * happy for us to know they were in a conflict zone and not what bounties they
 * claimed. So an individual event can be declined on its own.
 *
 * ★ DECLINING PURGES ★
 *
 * Switching something off deletes what was already stored under it rather than
 * merely stopping new writes. A member who declines and finds a year of their
 * data still sitting there has been given a switch, not a choice. The purge is
 * why this is a service rather than a column update.
 */

/** Every category a member could decline. */
export const DECLINABLE_CATEGORIES: readonly TelemetryCategoryName[] = TELEMETRY_CATALOGUE.filter(
  (g) => !g.required,
).map((g) => g.category);

/** Every event a member could decline, by name. */
export const DECLINABLE_EVENTS: readonly string[] = TELEMETRY_CATALOGUE.filter(
  (g) => !g.required,
).flatMap((g) => g.entries.map((e) => e.event));

export interface OptOutState {
  readonly categories: readonly TelemetryCategoryName[];
  readonly events: readonly string[];
}

export interface ConsentStore {
  read(userId: string): Promise<OptOutState>;
  write(userId: string, state: OptOutState): Promise<void>;
  /** Deletes every stored event in these categories. Returns how many. */
  purgeCategories(userId: string, categories: readonly string[]): Promise<number>;
  /** Deletes every stored event with these names. Returns how many. */
  purgeEvents(userId: string, events: readonly string[]): Promise<number>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

export class ConsentService {
  constructor(private readonly store: ConsentStore) {}

  async get(userId: string): Promise<OptOutState> {
    const stored = await this.store.read(userId);

    /*
     * Filtered against what is currently declinable, so a category retired from
     * the app cannot keep appearing in a member's settings — and so `session`
     * cannot linger as an opt-out if one were ever written by an older build.
     */
    return {
      categories: DECLINABLE_CATEGORIES.filter((c) => stored.categories.includes(c)),
      events: DECLINABLE_EVENTS.filter((e) => stored.events.includes(e)),
    };
  }

  /**
   * Replaces the member's choices, purging anything newly declined.
   *
   * Takes the WHOLE set rather than a single toggle. A settings screen that
   * sends one flag at a time can race itself — two toggles in flight, and the
   * second overwrites the first with a stale view of the rest.
   */
  async set(
    userId: string,
    requested: { categories: readonly string[]; events: readonly string[] },
  ): Promise<{ state: OptOutState; purged: number }> {
    /*
     * ★ `session` IS REFUSED, LOUDLY ★
     *
     * Promotion eligibility is computed from it, so a member who switched it
     * off would silently stop qualifying for promotions they had earned and
     * would have no way to connect the two.
     *
     * Rejected with an explanation rather than quietly dropped from the list:
     * silently ignoring it would tell somebody their choice was saved when it
     * was not, which is the worse of the two failures by a distance.
     */
    if (requested.categories.includes(REQUIRED_CATEGORY)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Session data cannot be switched off: the monthly promotion check reads it, and turning ' +
          'it off would stop you qualifying for promotions without telling you why.',
      );
    }

    const unknownCategories = requested.categories.filter(
      (c) => !DECLINABLE_CATEGORIES.includes(c as TelemetryCategoryName),
    );
    const unknownEvents = requested.events.filter((e) => !DECLINABLE_EVENTS.includes(e));

    if (unknownCategories.length > 0 || unknownEvents.length > 0) {
      // Rejected rather than ignored, for the same reason as above.
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Not something you can switch off: ${[...unknownCategories, ...unknownEvents].join(', ')}.`,
      );
    }

    const before = await this.get(userId);
    const after: OptOutState = {
      categories: DECLINABLE_CATEGORIES.filter((c) => requested.categories.includes(c)),
      events: DECLINABLE_EVENTS.filter((e) => requested.events.includes(e)),
    };

    const newCategories = after.categories.filter((c) => !before.categories.includes(c));

    /*
     * Events newly declined, EXCLUDING any whose whole category was also just
     * declined — those are already covered by the category purge, and doing
     * both would double-count the deletion in the audit record.
     */
    const newEvents = after.events.filter(
      (e) =>
        !before.events.includes(e) &&
        !newCategories.includes(categoryOf(e) as TelemetryCategoryName),
    );

    await this.store.write(userId, after);

    /*
     * Purge AFTER the write, so a failure part-way through leaves the choice
     * recorded and some data still present — recoverable by trying again. The
     * other order would leave data deleted while the setting still read as on,
     * which is the same outcome dressed as a lie.
     */
    const purgedCategories =
      newCategories.length === 0 ? 0 : await this.store.purgeCategories(userId, newCategories);
    const purgedEvents =
      newEvents.length === 0 ? 0 : await this.store.purgeEvents(userId, newEvents);

    const purged = purgedCategories + purgedEvents;

    await this.store.writeAudit({
      actorId: userId,
      action: 'telemetry.optout.set',
      targetType: 'user',
      targetId: userId,
      before: { categories: [...before.categories], events: [...before.events] },
      after: {
        categories: [...after.categories],
        events: [...after.events],
        newlyDeclined: { categories: newCategories, events: newEvents },
        purgedEvents: purged,
      },
    });

    return { state: after, purged };
  }
}
