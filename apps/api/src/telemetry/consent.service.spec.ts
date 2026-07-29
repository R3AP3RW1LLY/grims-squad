import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConsentService,
  DECLINABLE_CATEGORIES,
  DECLINABLE_EVENTS,
  type ConsentStore,
  type OptOutState,
} from './consent.service.js';

/**
 * What a member has switched OFF (INV-013, amended 2026-07-29).
 *
 * ★ THIS FILE USED TO TEST THE OPPOSITE ★
 *
 * Telemetry was opt-in: nothing was collected until asked for, and these tests
 * asserted that an empty list meant nothing was stored. It is opt-out now — the
 * companion app sends what it reads and this service records what a member
 * declines — so the assertions here are inverted from what they were.
 *
 * Two properties carry the weight:
 *
 *   `session` is REFUSED, loudly. Promotion eligibility is computed from it.
 *   Declining PURGES. A switch that stops new writes and leaves a year of
 *   history behind is not a choice.
 */

class FakeStore implements ConsentStore {
  state: OptOutState = { categories: [], events: [] };
  purgedCategories: string[][] = [];
  purgedEvents: string[][] = [];
  audit: Array<Record<string, unknown>> = [];
  /** How many rows each purge should claim to have deleted. */
  purgeCount = 0;

  async read(): Promise<OptOutState> {
    return this.state;
  }
  async write(_userId: string, state: OptOutState): Promise<void> {
    this.state = state;
  }
  async purgeCategories(_userId: string, categories: readonly string[]): Promise<number> {
    this.purgedCategories.push([...categories]);
    return this.purgeCount;
  }
  async purgeEvents(_userId: string, events: readonly string[]): Promise<number> {
    this.purgedEvents.push([...events]);
    return this.purgeCount;
  }
  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    this.audit.push(entry);
  }
}

let store: FakeStore;
let svc: ConsentService;

beforeEach(() => {
  store = new FakeStore();
  svc = new ConsentService(store);
});

describe('opt-out defaults', () => {
  it('MANDATORY: nothing is declined by default, so everything is kept', async () => {
    // The inversion in one line. An untouched account collects everything,
    // which is the reverse of what an empty list used to mean.
    const s = await svc.get('u1');
    expect(s.categories).toEqual([]);
    expect(s.events).toEqual([]);
  });

  it('offers every category except the required one', () => {
    expect(DECLINABLE_CATEGORIES).not.toContain('session');
    expect(DECLINABLE_CATEGORIES).toContain('combat');
    // profile and fleet were BASELINE under the old model and can be declined
    // now. That is the change, so it is asserted rather than assumed.
    expect(DECLINABLE_CATEGORIES).toContain('profile');
  });

  it('offers individual events, not just categories', () => {
    /*
     * The finer scope is the point: somebody may be happy for us to know they
     * were in a conflict zone and not what bounties they claimed.
     */
    expect(DECLINABLE_EVENTS).toContain('Bounty');
    expect(DECLINABLE_EVENTS).toContain('FSDJump');
    expect(DECLINABLE_EVENTS).not.toContain('LoadGame');
  });
});

describe('declining session', () => {
  it('MANDATORY: is refused, with a reason', async () => {
    /*
     * ★ NOT A PREFERENCE — A DEPENDENCY ★
     *
     * Promotion eligibility is computed from it. A member who switched it off
     * would silently stop qualifying for promotions they had earned and would
     * have no way to connect the two.
     */
    await expect(svc.set('u1', { categories: ['session'], events: [] })).rejects.toThrow(
      /promotion/i,
    );
  });

  it('MANDATORY: is refused rather than quietly dropped', async () => {
    /*
     * Silently removing it from the list would tell somebody their choice was
     * saved when it was not — the worse of the two failures by a distance,
     * because they would walk away believing they had switched it off.
     */
    await expect(svc.set('u1', { categories: ['session'], events: [] })).rejects.toThrow();
    expect(store.state.categories).toEqual([]);
  });

  it('refuses anything that is not declinable at all', async () => {
    await expect(svc.set('u1', { categories: ['not-a-category'], events: [] })).rejects.toThrow(
      /not something you can switch off/i,
    );
    await expect(svc.set('u1', { categories: [], events: ['NotAnEvent'] })).rejects.toThrow();
  });
});

describe('declining purges', () => {
  it('MANDATORY: switching a category off deletes what was stored under it', async () => {
    // A switch that stops new writes and leaves a year of history is not a
    // choice. The constraint says purge and the two halves are not separable.
    store.purgeCount = 42;
    const r = await svc.set('u1', { categories: ['combat'], events: [] });

    expect(store.purgedCategories).toEqual([['combat']]);
    expect(r.purged).toBe(42);
  });

  it('MANDATORY: switching one EVENT off purges only that event', async () => {
    /*
     * Purging the whole category here would delete data the member did not ask
     * to lose — worse than not purging at all, because it is irreversible and
     * they never asked for it.
     */
    store.purgeCount = 7;
    await svc.set('u1', { categories: [], events: ['Bounty'] });

    expect(store.purgedEvents).toEqual([['Bounty']]);
    expect(store.purgedCategories).toEqual([]);
  });

  it('does not purge an event twice when its category went too', async () => {
    /*
     * Declining `combat` AND `Bounty` in one save: the category purge already
     * covers the event, and running both would double-count the deletion in
     * the audit record.
     */
    store.purgeCount = 5;
    await svc.set('u1', { categories: ['combat'], events: ['Bounty'] });

    expect(store.purgedCategories).toEqual([['combat']]);
    expect(store.purgedEvents).toEqual([]);
  });

  it('does not re-purge something already declined', async () => {
    // Saving the same settings twice must not delete anything the second time
    // — there is nothing new to remove, and a purge count would be a lie.
    store.state = { categories: ['combat'], events: [] };
    await svc.set('u1', { categories: ['combat'], events: [] });

    expect(store.purgedCategories).toEqual([]);
  });

  it('switching something back ON purges nothing', async () => {
    // Turning collection back on cannot restore what was deleted, and must not
    // delete anything else either.
    store.state = { categories: ['combat'], events: [] };
    await svc.set('u1', { categories: [], events: [] });

    expect(store.purgedCategories).toEqual([]);
    expect(store.purgedEvents).toEqual([]);
    expect(store.state.categories).toEqual([]);
  });
});

describe('the audit record', () => {
  it('records what changed and how much was deleted', async () => {
    // Deletion is irreversible. An audit row is the only thing that can later
    // explain where a member's history went.
    store.purgeCount = 12;
    await svc.set('u1', { categories: ['trade'], events: [] });

    const entry = store.audit.at(-1);
    expect(entry?.['action']).toBe('telemetry.optout.set');
    expect(JSON.stringify(entry?.['after'])).toContain('12');
    expect(JSON.stringify(entry?.['after'])).toContain('trade');
  });
});
