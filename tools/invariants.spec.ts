import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(resolve(REPO, p), 'utf8');
const sourceFiles = (): string[] =>
  (globSync('{apps,packages}/*/src/**/*.ts', { cwd: REPO }) as string[]).filter(
    (f) => !f.endsWith('.spec.ts') && !f.includes('.fake.'),
  );

/**
 * Invariants that are properties of the CODEBASE rather than of one module, so
 * they have no natural home in a unit test next to an implementation.
 */

describe('@INV-008 Discord identifiers are data, never source', () => {
  it('no Discord snowflake is hard-coded in application source', () => {
    // Role and channel ids belong in role_mappings or configuration. Hard-coding
    // one means renaming or recreating a role in Discord needs a code change and
    // a deploy — and the failure appears as members silently losing access.
    //
    // My own lint rule caught this twice during P1: once in the onboarding
    // intents, once in the join flow. This is the same check as a test, so it
    // survives someone disabling the rule.
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const body = read(f);
      for (const m of body.matchAll(/\b\d{17,20}\b/g)) {
        const line = body.slice(0, m.index).split('\n').length;
        const context = body.split('\n')[line - 1] ?? '';
        // A snowflake inside a comment is documentation, not a dependency.
        if (/^\s*(\/\/|\*|\/\*)/.test(context)) continue;
        offenders.push(`${f}:${line}  ${context.trim().slice(0, 72)}`);
      }
    }
    expect(offenders, `hard-coded snowflakes:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the role mappings live in the SSOT as data', () => {
    const yaml = read('ssot/02-domain/discord-roles.yaml');
    expect(yaml).toMatch(/discordRoleId/);
    expect(yaml).toMatch(/permissionTiers/);
  });
});

describe('@INV-031 no synchronous cAPI call on a request path', () => {
  it('no controller or guard reaches Frontier', () => {
    // cAPI is slow, rate-limited, and its refresh tokens expire roughly every
    // 25 days — surfacing as an HTTP 422 mid-request. A synchronous call on a
    // request path turns Frontier's availability into ours.
    const requestPath = sourceFiles().filter(
      (f) => f.includes('.controller.') || f.includes('.guard.') || f.includes('middleware'),
    );
    expect(requestPath.length).toBeGreaterThan(0);
    for (const f of requestPath) {
      const body = read(f);
      expect(body, `${f} must not call Frontier on a request path`).not.toMatch(
        /companion\.orerve\.net|auth\.frontierstore\.net/i,
      );
    }
  });

  it('the cAPI adapter does not exist on the request path at all yet', () => {
    // Recorded honestly: cAPI is not built (P1.8 is blocked on a Frontier
    // application). This test will keep meaning something once it is — it
    // asserts WHERE the call may live, not whether it exists.
    const controllers = sourceFiles().filter((f) => f.includes('.controller.'));
    for (const f of controllers) {
      expect(read(f)).not.toMatch(/CapiAdapter|frontierProfile/i);
    }
  });
});

describe('@INV-047 one ladder rank at a time, and every change audited', () => {
  it('the ladder is declared in the SSOT with explicit month requirements', () => {
    const yaml = read('ssot/02-domain/rank-progression.yaml');
    expect(yaml).toMatch(/qualifyingMonthsRequired/);
    // The two deliberate gaps: 2 months before Lord General, 3 before GMG.
    expect(yaml).toMatch(/qualifyingMonthsRequired:\s*2/);
    expect(yaml).toMatch(/qualifyingMonthsRequired:\s*3/);
  });

  it('single_rank and audited are stated as rules, not left implied', () => {
    const yaml = read('ssot/02-domain/rank-progression.yaml');
    expect(yaml).toMatch(/id:\s*single_rank/);
    expect(yaml).toMatch(/id:\s*audited/);
  });

  it('no tenure rank column exists on users — rank is stored as a GRANT', () => {
    // INV-047 was rewritten when ranks became earned rather than computed. What
    // must not come back is a denormalised rank column that can drift from the
    // grants and the audit trail.
    const schema = read('ssot/03-data/schema.prisma');
    const user = /model User \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';
    expect(user).not.toMatch(/tenureRank|tenure_rank|currentRank/);
  });

  it('promotions cannot run before the floor', () => {
    const floor = read('apps/bot/src/promotion-floor.ts');
    expect(floor).toContain('2026-08-01T00:00:00.000Z');
    expect(floor).toMatch(/assertPromotionsPermitted/);
  });
});
