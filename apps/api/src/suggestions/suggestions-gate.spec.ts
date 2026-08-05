import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The webmaster doors are behind SITE_CONFIG — source text, the support-console-gate shape.
 *
 * ★ WHY THE GATES ARE WORTH A SPEC OF THEIR OWN ★
 *
 * The inbox reads members' private suggestions before any verdict; the manage board decides
 * what the whole squadron is told is being built. Each gate is one class-level decorator, which
 * is exactly the kind of line a refactor moves — and nothing about losing it is visible to the
 * compiler: the file typechecks, the routes work, and every signed-in member can suddenly read
 * the inbox. Reading the file is what catches it.
 */

const REPO = join(process.cwd(), '..', '..');

const INBOX = 'apps/api/src/suggestions/suggestions-inbox.controller.ts';
const MANAGE = 'apps/api/src/roadmap/roadmap.controller.ts';

describe('the suggestion inbox is gated at the class', () => {
  const source = readFileSync(join(REPO, INBOX), 'utf8');

  it('MANDATORY: @RequiresPermission(Permission.SITE_CONFIG) sits on the controller', () => {
    /*
     * Adjacency, not mere presence: the decorator must be in the block directly above the class
     * declaration, where it gates every route the class will ever grow.
     */
    expect(source).toMatch(
      /@Controller\('v1\/suggestions\/inbox'\)\s*\n@RequiresPermission\(Permission\.SITE_CONFIG\)\s*\nexport class SuggestionsInboxController/,
    );
  });

  it('MANDATORY: and behind the second factor — the admin console idiom, on the class', () => {
    /*
     * The inbox reads members' private words; enrolment alone is what a stolen session cookie
     * has. The pair must sit together directly above the @Controller line, where they cover
     * every route — the same adjacency rule as the permission gate below them.
     */
    expect(source).toMatch(
      /@UseGuards\(AdminGateGuard\)\s*\n@RequiresTwoFactor\(\)\s*\n@Controller\('v1\/suggestions\/inbox'\)/,
    );
  });

  it('holds exactly one controller class, so the class gate covers every route in the file', () => {
    expect(source.match(/@Controller\(/g)).toHaveLength(1);
    expect(source.match(/export class /g)).toHaveLength(1);
  });
});

describe('the roadmap manage board is gated at the class', () => {
  const source = readFileSync(join(REPO, MANAGE), 'utf8');

  it('MANDATORY: @RequiresPermission(Permission.SITE_CONFIG) sits on the manage controller', () => {
    expect(source).toMatch(
      /@Controller\('v1\/roadmap\/manage'\)\s*\n@RequiresPermission\(Permission\.SITE_CONFIG\)\s*\nexport class RoadmapManageController/,
    );
  });

  it('MANDATORY: and behind the second factor — the admin console idiom, on the class', () => {
    // What this board says is what the squadron is told is being built. Same pair, same
    // adjacency, same reason as the inbox.
    expect(source).toMatch(
      /@UseGuards\(AdminGateGuard\)\s*\n@RequiresTwoFactor\(\)\s*\n@Controller\('v1\/roadmap\/manage'\)/,
    );
  });

  it('the member-facing read carries NO permission decorator — every signed-in member may look', () => {
    /*
     * The other direction matters too: /roadmap is the squadron's window onto the plan, and a
     * gate quietly appearing on it would hide the board from the very people it reports to.
     * Asserted by ADJACENCY, like the gates above: the read controller's class declaration sits
     * directly under its bare @Controller line, with no decorator between them — no permission
     * bit and NO second factor, because reading the roadmap is every member's — and it still
     * authenticates.
     */
    expect(source).toMatch(/@Controller\('v1\/roadmap'\)\s*\nexport class RoadmapController/);
    expect(source).toContain('Sign in first');
  });
});
