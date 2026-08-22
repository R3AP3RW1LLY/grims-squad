import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The build picker refuses what the plan checker would refuse, at the moment of choosing.
 *
 * ★ SQUADRON OWNER, 2026-08-22 ★
 *
 * "the warnings are not visible enough — the rules fire but the results are buried"
 *
 * He was right, and the gap was narrower than "add more warnings". Every rule already existed and
 * already fired. They fired in a VERDICT at the top of the page, after the site had been added.
 *
 * The picker itself asked neither question. It filtered by orbital-versus-surface and then offered
 * fifteen settlements for a gas giant, and the member found out by scrolling. A rule met as a
 * correction teaches a member the tool is fussy; the same rule met as guidance teaches them the
 * game.
 *
 * ★ WHY A SOURCE SCAN ★
 *
 * The thing under test is a Preact-free React component nested six levels inside a server-rendered
 * page, and what can be got wrong is that somebody stops passing a prop. Reading for that is both
 * cheaper and closer to the mistake than rendering the tree.
 */

const HERE = join(process.cwd(), 'src', 'app', '(hub)', 'colonisation', 'planning', '[id]');
const TREE = readFileSync(join(HERE, 'system-tree.tsx'), 'utf8');

describe('the picker knows what the body can take', () => {
  it('found the picker, so this file cannot pass by matching nothing', () => {
    expect(TREE).toContain('function AddSite(');
    expect(TREE).toContain('<AddSite');
  });

  it('★ MANDATORY: no surface builds are offered on a body nobody can land on ★', () => {
    /*
     * The exact case that produced a hand-written plan telling members to build on a water world.
     * Offering a picker that can only produce an invalid plan is worse than offering none: it reads
     * as permission.
     */
    expect(TREE, 'the picker is told whether the body is landable').toContain('landable={body.isLandable}');
    expect(TREE, 'and refuses the surface list when it is not').toMatch(
      /where === 'surface' && !landable/,
    );
  });

  it('★ MANDATORY: the tier cost is shown against what is banked ★', () => {
    /*
     * "Step 6 needs a tier-2 point and none are banked" was only ever said after step 6 existed.
     * The picker knew the whole catalogue and nothing about what the plan could afford.
     */
    expect(TREE, 'the picker is told what is banked').toContain('banked={banked}');
    expect(TREE, 'and compares the two').toMatch(/have < b\.needsPoints/);
  });

  it('★ MANDATORY: banked points come from the LAST step, where a new build lands ★', () => {
    /*
     * A new build is appended to the end of the order, so the last step's balance is the one it
     * meets. Taking the first — or the largest — would tell a member they can afford something the
     * game will refuse, which is this whole defect restated one level down.
     */
    expect(TREE).toContain('plan.simulation.steps[plan.simulation.steps.length - 1]');
  });
});
