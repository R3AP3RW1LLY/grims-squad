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
    const r = await svc.set('u1', ['location', 'trade']);
    expect(r.categories).toEqual(['location', 'trade']);
    expect(await svc.get('u1')).toEqual(['location', 'trade']);
  });

  it('MANDATORY: rejects a category that does not exist', async () => {
    // Ignoring it would tell a member their choice was saved when it was not.
    await expect(svc.set('u1', ['location', 'everything'])).rejects.toThrow(/not a telemetry category/i);
  });

  it('a rejected request changes nothing', async () => {
    await svc.set('u1', ['location']);
    await expect(svc.set('u1', ['nonsense'])).rejects.toThrow();
    expect(await svc.get('u1')).toEqual(['location']);
  });

  it('takes the whole set, so two toggles in flight cannot race', async () => {
    await svc.set('u1', ['location', 'combat', 'trade']);
    await svc.set('u1', ['location']);
    expect(await svc.get('u1')).toEqual(['location']);
  });

  it('ignores order and duplicates in the request', async () => {
    const r = await svc.set('u1', ['trade', 'location', 'location']);
    expect(r.categories).toEqual(['location', 'trade']);
  });
});

describe('purge on withdrawal', () => {
  beforeEach(async () => {
    await svc.set('u1', ['location', 'combat', 'trade']);
    store.events = [
      { category: 'location' },
      { category: 'combat' },
      { category: 'combat' },
      { category: 'trade' },
    ];
  });

  it('MANDATORY: turning a category off DELETES what was stored under it', async () => {
    const r = await svc.set('u1', ['location', 'trade']);

    expect(r.purged).toBe(2);
    expect(store.events.map((e) => e.category)).toEqual(['location', 'trade']);
  });

  it('MANDATORY: leaves the categories still consented to alone', async () => {
    // The failure this guards against is a purge that over-reaches and takes a
    // member's whole history because they turned off one category.
    await svc.set('u1', ['location']);
    expect(store.events.map((e) => e.category)).toEqual(['location']);
  });

  it('purges nothing when consent only widens', async () => {
    await svc.set('u1', ['location', 'combat']);
    const r = await svc.set('u1', ['location', 'combat', 'trade']);
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
    await svc.set('u1', ['location']);
    const last = store.audits.at(-1);

    expect(last?.['action']).toBe('telemetry.consent.set');
    expect(last?.['after']).toMatchObject({ withdrawn: ['combat', 'trade'], purgedEvents: 3 });
  });
});

describe('the offered categories', () => {
  it('MANDATORY: are the OPTIONAL ones only', () => {
    /*
     * The baseline is deliberately absent. Session, profile and fleet come with
     * running the app (INV-013), and offering a switch that does nothing would
     * be worse than offering none — it would tell a member they had turned
     * something off when they had not.
     */
    expect(CONSENT_CATEGORIES).toEqual([
      'location',
      'combat',
      'trade',
      'exploration',
      'bgs',
      'carrier',
    ]);

    for (const baseline of ['session', 'profile', 'fleet']) {
      expect(CONSENT_CATEGORIES, baseline).not.toContain(baseline);
    }
  });
});
