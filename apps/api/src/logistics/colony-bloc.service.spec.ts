import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, Permission } from '@grims/shared';
import { ColonyBlocService } from './colony-bloc.service.js';
import type { ColonyPlanService } from './colony-plan.service.js';

/**
 * Groups of our own systems, and what they can feed each other.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "a way to allow members who have multiple systems in their colonization to create a nexus that
 * will predict trade routes."
 *
 * The table existed for weeks with no service, no route and no page — and zero rows in production,
 * which is what an unreachable feature looks like from the database. What was there assumed
 * officers; these tests pin the two assumptions that had to go.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'colony-bloc.service.ts'), 'utf8');

const OFFICER = Permission.COLONY_MANAGE;
const MEMBER = 0n;

const ME = '11111111-1111-1111-1111-111111111111';
const SOMEBODY_ELSE = '22222222-2222-2222-2222-222222222222';

interface Row {
  [key: string]: unknown;
}

/**
 * A database that answers by looking at the SQL.
 *
 * Crude on purpose: the point of these tests is the RULES, and a fake that recognises queries by
 * their text cannot accidentally implement the rule under test — which is exactly how an earlier
 * regression test in this project turned out to prove nothing.
 */
class FakeDb {
  blocs: Row[] = [];
  blocSystems: Array<{ bloc_id: string; system_name: string }> = [];
  market: Row[] = [];
  executed: string[] = [];

  async $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T> {
    this.executed.push(sql);

    if (sql.includes('FROM market_entries')) {
      return this.market as unknown as T;
    }

    if (sql.includes('lower(name) = lower($2)')) {
      const [createdBy, name] = args as [string, string];
      return this.blocs.filter(
        (b) =>
          b['created_by_id'] === createdBy &&
          String(b['name']).toLowerCase() === name.toLowerCase(),
      ) as unknown as T;
    }

    if (sql.startsWith('INSERT INTO colony_blocs')) {
      const [name, note, owner, createdBy] = args as [string, string | null, string, string];
      const row = {
        id: `bloc-${this.blocs.length + 1}`,
        name,
        note,
        owner,
        visibility: 'private',
        created_by_id: createdBy,
        created_by: 'Someone',
      };
      this.blocs.push(row);
      return [{ id: row['id'] }] as unknown as T;
    }

    if (sql.includes('SELECT owner::text AS owner, created_by_id FROM colony_blocs')) {
      const [id] = args as [string];
      return this.blocs.filter((b) => b['id'] === id) as unknown as T;
    }

    if (sql.includes('FROM colony_blocs b')) {
      const callerId = sql.includes('b.id = $1::uuid') ? (args[1] as string) : (args[0] as string);
      const id = sql.includes('b.id = $1::uuid') ? (args[0] as string) : null;

      /*
       * ★ THE FAKE HONOURS THE SQL RATHER THAN REIMPLEMENTING IT ★
       *
       * The first version of this filtered by owner/creator/visibility in TypeScript no matter what
       * the query said — so deleting the entire WHERE clause from the service would have left every
       * visibility test passing. That is not a hypothetical: an earlier regression test in this
       * project failed exactly this way, and the mutation survived.
       *
       * Each clause is honoured only if it is actually IN the statement, so removing one from the
       * service changes what comes back here.
       */
      const allowsSquadron = sql.includes("b.owner = 'squadron'");
      const allowsOwn = /b\.created_by_id = \$\d::uuid/.test(sql);
      const allowsShared = sql.includes("b.visibility = 'squadron'");

      return this.blocs
        .filter((b) => (id === null ? true : b['id'] === id))
        .filter(
          (b) =>
            (allowsSquadron && b['owner'] === 'squadron') ||
            (allowsOwn && b['created_by_id'] === callerId) ||
            (allowsShared && b['visibility'] === 'squadron'),
        )
        .map((b) => ({
          ...b,
          systems: this.blocSystems
            .filter((s) => s.bloc_id === b['id'])
            .map((s) => s.system_name)
            .sort(),
        })) as unknown as T;
    }

    return [] as unknown as T;
  }

  async $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number> {
    this.executed.push(sql);
    if (sql.startsWith('UPDATE colony_blocs SET visibility')) {
      const [id, visibility] = args as [string, string];
      const bloc = this.blocs.find((b) => b['id'] === id);
      if (bloc !== undefined) bloc['visibility'] = visibility;
    }
    if (sql.startsWith('INSERT INTO colony_bloc_systems')) {
      const [blocId, systemName] = args as [string, string];
      this.blocSystems.push({ bloc_id: blocId, system_name: systemName });
    }
    return 1;
  }
}

/** A plan service that returns whatever the test says the caller may see. */
function fakePlans(
  predicted: Record<string, { exports: string[]; imports: string[] }> = {},
): ColonyPlanService {
  return {
    predictedTradeFor: async (systems: readonly string[]) =>
      new Map(
        systems.filter((s) => predicted[s] !== undefined).map((s) => [s, predicted[s]!]),
      ),
  } as unknown as ColonyPlanService;
}

let db: FakeDb;
const service = (
  predicted?: Record<string, { exports: string[]; imports: string[] }>,
): ColonyBlocService =>
  new ColonyBlocService(db as never, fakePlans(predicted));

beforeEach(() => {
  db = new FakeDb();
});

describe('making a group', () => {
  it('★ MANDATORY: a member with NO officer bit can make their own ★', async () => {
    /*
     * The entire point of the change. Blocs used to be officer-only, which is why production held
     * zero of them: the members who wanted to group their systems were not allowed to.
     */
    const id = await service().create({
      name: 'Col 285 Core',
      note: null,
      owner: 'personal',
      callerId: ME,
      mask: MEMBER,
    });

    expect(id).toBe('bloc-1');
    expect(db.blocs[0]?.['visibility'], 'and it starts private').toBe('private');
  });

  it('★ MANDATORY: claiming one for the SQUADRON still needs an officer ★', async () => {
    /*
     * A squadron group is every member's and takes the name for good. That is the one thing here
     * still worth a permission.
     */
    await expect(
      service().create({
        name: 'Squadron Core',
        note: null,
        owner: 'squadron',
        callerId: ME,
        mask: MEMBER,
      }),
    ).rejects.toThrow(AppError);

    expect(db.blocs, 'and nothing was written').toHaveLength(0);
  });

  it('lets an officer make a squadron group', async () => {
    await service().create({
      name: 'Squadron Core',
      note: null,
      owner: 'squadron',
      callerId: ME,
      mask: OFFICER,
    });

    expect(db.blocs[0]?.['owner']).toBe('squadron');
  });

  it('★ MANDATORY: the same name is free for a DIFFERENT member ★', async () => {
    /*
     * The name used to be unique across the whole table. That would let the first member to use
     * "Colonia Core" take it from everybody else — and the refusal would be about a row they cannot
     * see, which is the worst kind of error message.
     */
    await service().create({
      name: 'Colonia Core',
      note: null,
      owner: 'personal',
      callerId: ME,
      mask: MEMBER,
    });

    await expect(
      service().create({
        name: 'Colonia Core',
        note: null,
        owner: 'personal',
        callerId: SOMEBODY_ELSE,
        mask: MEMBER,
      }),
    ).resolves.toBeTruthy();
  });

  it('refuses a name the SAME member has already used', async () => {
    await service().create({
      name: 'Colonia Core',
      note: null,
      owner: 'personal',
      callerId: ME,
      mask: MEMBER,
    });

    await expect(
      service().create({
        name: '  colonia core  ',
        note: null,
        owner: 'personal',
        callerId: ME,
        mask: MEMBER,
      }),
    ).rejects.toThrow(/already have a group/i);
  });

  it('refuses a blank name', async () => {
    await expect(
      service().create({ name: '   ', note: null, owner: 'personal', callerId: ME, mask: MEMBER }),
    ).rejects.toThrow(/name/i);
  });
});

describe('who can see a group', () => {
  beforeEach(() => {
    db.blocs = [
      { id: 'mine', name: 'Mine', owner: 'personal', visibility: 'private', created_by_id: ME, created_by: 'Me' },
      { id: 'theirs', name: 'Theirs', owner: 'personal', visibility: 'private', created_by_id: SOMEBODY_ELSE, created_by: 'Them' },
      { id: 'shared', name: 'Shared', owner: 'personal', visibility: 'squadron', created_by_id: SOMEBODY_ELSE, created_by: 'Them' },
      { id: 'squadron', name: 'Squadron', owner: 'squadron', visibility: 'private', created_by_id: SOMEBODY_ELSE, created_by: 'Them' },
    ];
  });

  it("★ MANDATORY: another member's PRIVATE group is invisible ★", async () => {
    /*
     * What a bloc discloses is its SYSTEM LIST — where a member is quietly building, months before
     * anything is standing there. In this game that is the information people most want kept.
     */
    const ids = (await service().list(ME, MEMBER)).map((b) => b.id);

    expect(ids).not.toContain('theirs');
    expect(ids.sort()).toEqual(['mine', 'shared', 'squadron']);
  });

  it('★ MANDATORY: a squadron group is visible even though its column says private ★', async () => {
    /*
     * `visibility` defaults to private and nothing backfilled it. Reading that column alone would
     * hide the squadron's own groups from every member.
     */
    expect((await service().list(ME, MEMBER)).map((b) => b.id)).toContain('squadron');
  });

  it('★ MANDATORY: byId refuses exactly what the list refuses ★', async () => {
    // A group you can see listed and cannot open would be the worst of both.
    expect(await service().byId('theirs', ME, MEMBER)).toBeNull();
    expect(await service().byId('shared', ME, MEMBER)).not.toBeNull();
  });

  it('★ MANDATORY: seeing a shared group never means editing it ★', async () => {
    /*
     * Sharing is read-only. `owner` decides editing, exactly as it does for a plan — the two columns
     * answer two different questions and conflating them is the mistake this shape exists to avoid.
     */
    const shared = await service().byId('shared', ME, MEMBER);
    expect(shared?.mayEdit).toBe(false);
  });

  it('lets the creator edit their own, and an officer edit the squadron’s', async () => {
    expect((await service().byId('mine', ME, MEMBER))?.mayEdit).toBe(true);
    expect((await service().byId('squadron', ME, MEMBER))?.mayEdit).toBe(false);
    expect((await service().byId('squadron', ME, OFFICER))?.mayEdit).toBe(true);
  });

  it('refuses to share a group that is not yours', async () => {
    await expect(
      service().setVisibility({ blocId: 'theirs', callerId: ME, shared: true }),
    ).rejects.toThrow(/no such group/i);
  });

  it('refuses to share a squadron group, which every member already sees', async () => {
    await expect(
      service().setVisibility({ blocId: 'squadron', callerId: SOMEBODY_ELSE, shared: true }),
    ).rejects.toThrow(/already visible/i);
  });
});

describe('the nexus for a group', () => {
  beforeEach(() => {
    db.blocs = [
      { id: 'mine', name: 'Mine', owner: 'personal', visibility: 'private', created_by_id: ME, created_by: 'Me' },
    ];
    db.blocSystems = [
      { bloc_id: 'mine', system_name: 'Alpha' },
      { bloc_id: 'mine', system_name: 'Beta' },
    ];
  });

  it('★ MANDATORY: a real market is used where we have one, and marked flyable ★', async () => {
    db.market = [
      { system_name: 'Alpha', commodity: 'Steel', supply: 500, demand: 0 },
      { system_name: 'Beta', commodity: 'Steel', supply: 0, demand: 900 },
    ];

    const nexus = await service().nexus('mine', ME, MEMBER);

    expect(nexus?.bases).toEqual([
      { systemName: 'Alpha', basis: 'measured' },
      { systemName: 'Beta', basis: 'measured' },
    ]);
    expect(nexus?.report.links).toEqual([
      { commodity: 'Steel', from: 'Alpha', to: 'Beta', flyableNow: true },
    ]);
  });

  it('★ MANDATORY: a planned route is NOT marked flyable ★', async () => {
    /*
     * Presenting a predicted route identically to a real one sends somebody to a station that does
     * not exist — the most expensive way this feature could be wrong, because a wasted trip is
     * measured in hours.
     */
    const nexus = await service({
      Alpha: { exports: ['Steel'], imports: [] },
      Beta: { exports: [], imports: ['Steel'] },
    }).nexus('mine', ME, MEMBER);

    expect(nexus?.report.links[0]?.flyableNow).toBe(false);
    expect(nexus?.bases.every((b) => b.basis === 'predicted')).toBe(true);
  });

  it('★ MANDATORY: a system whose plan the caller cannot see is `unknown`, not invented ★', async () => {
    /*
     * The plan service enforces visibility and simply omits what the caller may not read. The
     * truthful answer is that WE have nothing to go on — not a guess, and not a silent omission.
     */
    const nexus = await service({ Alpha: { exports: ['Steel'], imports: [] } }).nexus(
      'mine',
      ME,
      MEMBER,
    );

    expect(nexus?.report.unplanned).toEqual(['Beta']);
    expect(nexus?.bases.find((b) => b.systemName === 'Beta')?.basis).toBe('unknown');
  });

  it('names what nothing in the group produces, and puts it first', async () => {
    const nexus = await service({
      Alpha: { exports: [], imports: ['Beryllium'] },
      Beta: { exports: [], imports: ['Beryllium'] },
    }).nexus('mine', ME, MEMBER);

    expect(nexus?.report.gaps).toEqual([
      { commodity: 'Beryllium', wantedBy: ['Alpha', 'Beta'] },
    ]);
    expect(nexus?.summary[0]).toMatch(/permanent haul from outside/i);
  });

  it('returns null for a group the caller may not see', async () => {
    expect(await service().nexus('mine', SOMEBODY_ELSE, MEMBER)).toBeNull();
  });
});

describe('the market read', () => {
  it('★ MANDATORY: reads market_entries, never the empty market_orders ★', async () => {
    /*
     * `market_orders` and `stations` are both EMPTY in production — the Prisma models are vestigial.
     * Querying the models the schema advertises would return nothing for every system, forever, and
     * look exactly like "none of our systems are built yet".
     */
    expect(SOURCE).toMatch(/^\s*`SELECT system_name, commodity,/m);
    expect(SOURCE).toMatch(/^\s*FROM market_entries$/m);
    expect(SOURCE, 'the vestigial table is not read here').not.toMatch(/FROM market_orders/);
  });

  it('★ MANDATORY: excludes carriers by PATTERN, because the obvious literal is wrong ★', async () => {
    /*
     * A parked fleet carrier is somebody's mobile shop, not something the system produces. The first
     * version excluded `station_type = 'FleetCarrier'` — a value this table never contains. Real
     * carriers are stored as `Drake-Class Carrier`, so that filter matched nothing and six carrier
     * rows in our own systems would have been reported as production.
     */
    expect(SOURCE).toMatch(/^\s*AND COALESCE\(station_type, ''\) NOT ILIKE '%carrier%'$/m);
    /*
     * Anchored to a SQL line, not searched for anywhere in the file: the paragraph above NAMES the
     * wrong literal in order to explain it, and an unanchored search matches that comment and fails.
     * This project has now caught that same mistake seven times.
     */
    expect(SOURCE, 'the literal that silently matched nothing').not.toMatch(
      /^\s*AND .*'FleetCarrier'/m,
    );
  });
});
