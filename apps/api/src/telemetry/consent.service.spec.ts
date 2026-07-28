import { describe, it, expect, beforeEach } from 'vitest';
import { ConsentService, CONSENT_CATEGORIES, type ConsentStore } from './consent.service.js';

/**
 * Telemetry consent, and the purge that goes with withdrawing it (INV-013).
 *
 * The constraint says "one-click revoke AND PURGE", and the two halves are not
 * separable. A member who withdraws consent and finds a year of their data still
 * sitting there has been given a switch, not a choice.
 */

class FakeStore implements ConsentStore {
  categories: string[] = [];
  events: Array<{ category: string }> = [];
  audits: Array<Record<string, unknown>> = [];

  async read(): Promise<readonly string[]> {
    return this.categories;
  }
  async write(_userId: string, categories: readonly string[]): Promise<void> {
    this.categories = [...categories];
  }
  async purge(_userId: string, categories: readonly string[]): Promise<number> {
    const before = this.events.length;
    this.events = this.events.filter((e) => !categories.includes(e.category));
    return before - this.events.length;
  }
  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    this.audits.push(entry);
  }
}

let store: FakeStore;
let svc: ConsentService;

beforeEach(() => {
  store = new FakeStore();
  svc = new ConsentService(store);
});

describe('consent', () => {
  it('MANDATORY: defaults to nothing', async () => {
    // Opt-in, not opt-out. A member who has never opened their privacy settings
    // has agreed to nothing, and pairing a device does not change that.
    expect(await svc.get('u1')).toEqual([]);
  });

  it('records what was chosen', async () => {
    const r = await svc.set('u1', ['session', 'fleet']);
    expect(r.categories).toEqual(['session', 'fleet']);
    expect(await svc.get('u1')).toEqual(['session', 'fleet']);
  });

  it('MANDATORY: rejects a category that does not exist', async () => {
    // Ignoring it would tell a member their choice was saved when it was not.
    await expect(svc.set('u1', ['session', 'everything'])).rejects.toThrow(/not a telemetry category/i);
  });

  it('a rejected request changes nothing', async () => {
    await svc.set('u1', ['session']);
    await expect(svc.set('u1', ['nonsense'])).rejects.toThrow();
    expect(await svc.get('u1')).toEqual(['session']);
  });

  it('takes the whole set, so two toggles in flight cannot race', async () => {
    await svc.set('u1', ['session', 'profile', 'fleet']);
    await svc.set('u1', ['session']);
    expect(await svc.get('u1')).toEqual(['session']);
  });

  it('ignores order and duplicates in the request', async () => {
    const r = await svc.set('u1', ['fleet', 'session', 'session']);
    expect(r.categories).toEqual(['session', 'fleet']);
  });
});

describe('purge on withdrawal', () => {
  beforeEach(async () => {
    await svc.set('u1', ['session', 'profile', 'fleet']);
    store.events = [
      { category: 'session' },
      { category: 'profile' },
      { category: 'profile' },
      { category: 'fleet' },
    ];
  });

  it('MANDATORY: turning a category off DELETES what was stored under it', async () => {
    const r = await svc.set('u1', ['session', 'fleet']);

    expect(r.purged).toBe(2);
    expect(store.events.map((e) => e.category)).toEqual(['session', 'fleet']);
  });

  it('MANDATORY: leaves the categories still consented to alone', async () => {
    // The failure this guards against is a purge that over-reaches and takes a
    // member's whole history because they turned off one category.
    await svc.set('u1', ['session']);
    expect(store.events.map((e) => e.category)).toEqual(['session']);
  });

  it('purges nothing when consent only widens', async () => {
    await svc.set('u1', ['session', 'profile']);
    const r = await svc.set('u1', ['session', 'profile', 'fleet']);
    expect(r.purged).toBe(0);
  });

  it('MANDATORY: withdrawing everything leaves nothing behind', async () => {
    const r = await svc.set('u1', []);
    expect(r.purged).toBe(4);
    expect(store.events).toEqual([]);
  });

  it('records the withdrawal in the audit log, with the count', async () => {
    // Not for the member's benefit — for ours. If somebody later asks why their
    // data is gone, "you turned this off on the 3rd" is an answer.
    await svc.set('u1', ['session']);
    const last = store.audits.at(-1);

    expect(last?.['action']).toBe('telemetry.consent.set');
    expect(last?.['after']).toMatchObject({ withdrawn: ['profile', 'fleet'], purgedEvents: 3 });
  });
});

describe('the offered categories', () => {
  it('are ordered least to most revealing', () => {
    // The order the settings screen renders them in. A member reading down the
    // list should be agreeing to progressively more, not scanning at random.
    expect(CONSENT_CATEGORIES).toEqual(['session', 'profile', 'fleet']);
  });
});
