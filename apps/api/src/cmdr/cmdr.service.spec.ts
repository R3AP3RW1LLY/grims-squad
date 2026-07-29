import { describe, it, expect, beforeEach } from 'vitest';
import { CmdrService, type CmdrStore, type ClaimRecord } from './cmdr.service.js';

/**
 * P1.8b — CMDR verification by officer approval.
 *
 * The member declares a name; an officer approves it. This is the manual path,
 * built FIRST because the automatic one (Frontier cAPI, P1.8) is blocked on an
 * application to Frontier that takes weeks and may never be granted. A trust
 * tier of 1 is recorded honestly rather than dressed up as proof.
 *
 * ★ INV-005, AND THE RED-TEAM FINDING THAT SHAPED IT ★
 *
 * The uniqueness lock applies ONLY to rows where isVerified = true. An earlier
 * version keyed the partial unique index on `revokedAt IS NULL` alone, which
 * meant merely STARTING a claim locked a CMDR name permanently — any member
 * could deny any name, including every officer's, by opening a claim and never
 * finishing it. A pending claim takes NO lock. The tests below state that
 * directly, because it is the sort of rule that gets "simplified" back.
 */

const NOW = new Date('2026-07-27T12:00:00Z');

class FakeCmdrStore implements CmdrStore {
  claims: ClaimRecord[] = [];
  audit: Array<Record<string, unknown>> = [];
  #id = 0;

  async pendingFor(userId: string): Promise<ClaimRecord | null> {
    return this.claims.find((c) => c.userId === userId && !c.isVerified && c.revokedAt === null) ?? null;
  }
  async verifiedFor(userId: string): Promise<ClaimRecord | null> {
    return this.claims.find((c) => c.userId === userId && c.isVerified && c.revokedAt === null) ?? null;
  }
  async verifiedHolderOf(cmdrName: string): Promise<ClaimRecord | null> {
    return (
      this.claims.find(
        (c) =>
          c.cmdrName.toLowerCase() === cmdrName.toLowerCase() &&
          c.isVerified &&
          c.revokedAt === null,
      ) ?? null
    );
  }
  async byId(id: string): Promise<ClaimRecord | null> {
    return this.claims.find((c) => c.id === id) ?? null;
  }
  async listPending(): Promise<ClaimRecord[]> {
    return this.claims.filter((c) => !c.isVerified && c.revokedAt === null);
  }
  async createPending(userId: string, cmdrName: string, at: Date): Promise<ClaimRecord> {
    this.#id += 1;
    const row: ClaimRecord = {
      id: `c${this.#id}`,
      userId,
      cmdrName,
      isVerified: false,
      trustTier: 1,
      method: 'officer_manual',
      verifiedAt: at,
      revokedAt: null,
      createdAt: at,
    };
    this.claims.push(row);
    return row;
  }
  async markVerified(id: string, at: Date): Promise<void> {
    const c = this.claims.find((x) => x.id === id);
    if (c !== undefined) {
      (c as { isVerified: boolean }).isVerified = true;
      (c as { verifiedAt: Date }).verifiedAt = at;
    }
  }
  async revoke(id: string, at: Date): Promise<void> {
    const c = this.claims.find((x) => x.id === id);
    if (c !== undefined) (c as { revokedAt: Date | null }).revokedAt = at;
  }
  async writeAudit(e: Record<string, unknown>): Promise<void> {
    this.audit.push(e);
  }
}

let store: FakeCmdrStore;
let svc: CmdrService;

beforeEach(() => {
  store = new FakeCmdrStore();
  svc = new CmdrService(store);
});

describe('declaring a CMDR name', () => {
  it('creates a PENDING claim, not a verified one', async () => {
    const c = await svc.declare('u1', 'GRIM', NOW);
    expect(c.isVerified).toBe(false);
    // Tier 1 from the outset. An officer's approval is a human vouching, which
    // is genuinely weaker than cAPI, and recording it as anything else would
    // make the trust tier meaningless.
    expect(c.trustTier).toBe(1);
    expect(c.method).toBe('officer_manual');
  });

  it('MANDATORY: a pending claim does NOT lock the name against anyone else', async () => {
    // RED-TEAM R7. If a pending claim locked the name, any member could deny
    // every officer their own CMDR name by opening a claim and walking away.
    await svc.declare('squatter', 'GRIM', NOW);
    await expect(svc.declare('u1', 'GRIM', NOW)).resolves.toMatchObject({ userId: 'u1' });
  });

  it('MANDATORY: refuses a name already VERIFIED by someone else', async () => {
    await svc.declare('u1', 'GRIM', NOW);
    await svc.approve('c1', 'officer-1', NOW);
    await expect(svc.declare('u2', 'GRIM', NOW)).rejects.toThrow(/already/i);
  });

  it('is case-insensitive about who holds a name', async () => {
    // Elite treats CMDR names case-insensitively, and so does the citext column.
    await svc.declare('u1', 'GRIM', NOW);
    await svc.approve('c1', 'officer-1', NOW);
    await expect(svc.declare('u2', 'grim', NOW)).rejects.toThrow(/already/i);
  });

  it('replaces the member’s own earlier pending claim rather than stacking', async () => {
    // Someone correcting a typo should not leave two claims in the officer
    // queue, one of which is wrong.
    await svc.declare('u1', 'GRMI', NOW);
    await svc.declare('u1', 'GRIM', NOW);
    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.cmdrName).toBe('GRIM');
  });

  it('rejects an empty or obviously invalid name', async () => {
    await expect(svc.declare('u1', '   ', NOW)).rejects.toThrow(/name/i);
    await expect(svc.declare('u1', 'x'.repeat(200), NOW)).rejects.toThrow(/name/i);
  });

  it('trims surrounding whitespace', async () => {
    const c = await svc.declare('u1', '  GRIM  ', NOW);
    expect(c.cmdrName).toBe('GRIM');
  });
});

describe('officer approval', () => {
  it('marks the claim verified and audits who approved it', async () => {
    await svc.declare('u1', 'GRIM', NOW);
    await svc.approve('c1', 'officer-1', NOW);

    expect((await store.byId('c1'))?.isVerified).toBe(true);
    const entry = store.audit.at(-1);
    // The officer IS the actor here — unlike reconciliation, a human chose this.
    expect(entry?.['actorId']).toBe('officer-1');
    expect(JSON.stringify(entry)).toContain('GRIM');
  });

  it('MANDATORY: an officer cannot approve their OWN claim', async () => {
    // Self-approval turns a two-party check into a formality. The officer can
    // still get verified — another officer approves them.
    await svc.declare('officer-1', 'GRIM', NOW);
    await expect(svc.approve('c1', 'officer-1', NOW)).rejects.toThrow(/own claim/i);
    expect((await store.byId('c1'))?.isVerified).toBe(false);
  });

  it('MANDATORY: refuses to approve a name someone else already holds', async () => {
    // The race that matters: two members declare the same name while it is
    // free, and an officer works through the queue later. The check must run at
    // APPROVAL time, not only at declaration time.
    await svc.declare('u1', 'GRIM', NOW);
    await svc.declare('u2', 'GRIM', NOW);
    await svc.approve('c1', 'officer-1', NOW);

    await expect(svc.approve('c2', 'officer-1', NOW)).rejects.toThrow(/already/i);
    expect((await store.byId('c2'))?.isVerified).toBe(false);
  });

  it('revokes the member’s previous verified claim when they change name', async () => {
    // One active verified claim per member. Leaving the old one verified would
    // hold a lock on a name they no longer use.
    await svc.declare('u1', 'GRIM', NOW);
    await svc.approve('c1', 'officer-1', NOW);
    await svc.declare('u1', 'GRIMLIER', NOW);
    await svc.approve('c2', 'officer-1', NOW);

    expect((await store.byId('c1'))?.revokedAt).not.toBeNull();
    expect((await store.byId('c2'))?.isVerified).toBe(true);
  });

  it('is idempotent — approving twice does not double-audit', async () => {
    await svc.declare('u1', 'GRIM', NOW);
    await svc.approve('c1', 'officer-1', NOW);
    const before = store.audit.length;
    await svc.approve('c1', 'officer-1', NOW);
    expect(store.audit.length).toBe(before);
  });

  it('404s on an unknown claim', async () => {
    await expect(svc.approve('nope', 'officer-1', NOW)).rejects.toThrow(/not found/i);
  });
});

describe('officer rejection', () => {
  it('revokes the claim and records the reason', async () => {
    await svc.declare('u1', 'GRIM', NOW);
    await svc.reject('c1', 'officer-1', 'Screenshot did not match', NOW);

    expect((await store.byId('c1'))?.revokedAt).not.toBeNull();
    expect(JSON.stringify(store.audit.at(-1))).toContain('Screenshot did not match');
  });

  it('MANDATORY: a rejected name is free for the real owner to claim', async () => {
    // A rejection must not leave the name locked. Whoever actually owns it
    // still has to be able to get verified.
    await svc.declare('squatter', 'GRIM', NOW);
    await svc.reject('c1', 'officer-1', 'Not their commander', NOW);
    await svc.declare('u1', 'GRIM', NOW);
    // Resolving at all is the assertion — it must not throw CMDR_ALREADY_CLAIMED.
    // It now also names the member it verified, so the caller can tell them.
    await expect(svc.approve('c2', 'officer-1', NOW)).resolves.toEqual({ userId: 'u1' });
  });

  it('requires a reason — a rejection with no explanation is not reviewable', async () => {
    await svc.declare('u1', 'GRIM', NOW);
    await expect(svc.reject('c1', 'officer-1', '  ', NOW)).rejects.toThrow(/reason/i);
  });
});

describe('the officer queue', () => {
  it('lists pending claims and excludes settled ones', async () => {
    await svc.declare('u1', 'GRIM', NOW);
    await svc.declare('u2', 'HALO', NOW);
    await svc.approve('c1', 'officer-1', NOW);

    const queue = await svc.pendingQueue();
    expect(queue.map((c) => c.cmdrName)).toEqual(['HALO']);
  });

  it('flags a pending claim whose name is already held, so it is not approved by reflex', async () => {
    // The officer sees the conflict BEFORE clicking approve, rather than
    // meeting an error afterwards.
    //
    // Note the ORDER. Declaring against an already-verified name is refused
    // outright, so the only way a conflicting pending claim exists is for both
    // to be declared while the name is still free and for one to be approved
    // afterwards. That is exactly the race this flag is for.
    await svc.declare('u1', 'GRIM', NOW);
    await svc.declare('u2', 'GRIM', NOW);
    await svc.approve('c1', 'officer-1', NOW);

    const queue = await svc.pendingQueue();
    expect(queue[0]?.conflictsWithVerified).toBe(true);
  });
});
