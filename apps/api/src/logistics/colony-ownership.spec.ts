import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Who owns a colonisation project, and who may remove one.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "we need to be able to delete projects if we own the project please or give admins the option
 * after the fact to turn a project into a squadron project!"
 *
 * Two separate gaps, and neither was a broken rule — both were rules with nothing wired to them.
 *
 *   DELETE existed on the server and had no honest button. The route is there, the service refuses
 *   only once somebody has HAULED to the build, and the page hid the control on `required === 0` —
 *   "has this site reported what it needs yet", which is a different and stricter question. So a
 *   member who mistyped a market id, let the site report its needs and hauled nothing was left
 *   with a project they owned and could not remove, while the server would have allowed it.
 *
 *   OWNER could never change. It was set once at creation and no route anywhere could move it, so
 *   a member's build the squadron rallied behind could not be adopted — and could never be marked
 *   the current effort, because that marker is squadron-only.
 *
 * These are source assertions rather than a wired-up service test on purpose: both halves are
 * about a control existing and being drawn on the right condition, which is exactly the class of
 * thing a service test passes while the screen stays wrong.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '../../../web/src/app/(hub)/colonisation/[id]/project-actions.tsx');

const service = readFileSync(join(HERE, 'colony.service.ts'), 'utf8');
const controller = readFileSync(join(HERE, 'colony.controller.ts'), 'utf8');
const actions = readFileSync(WEB, 'utf8');

describe('deleting a project you own', () => {
  it('MANDATORY: the button is drawn on deliveries, the same rule the server enforces', () => {
    /*
     * The server refuses when `colony_contributions` has rows, because deleting would erase
     * somebody's hauling record. Anything else the page gates on is a second, different rule that
     * will disagree with it — and did.
     */
    expect(actions).toContain('project.deliveryCount === 0');
    expect(
      actions,
      'the Delete button is gated on required again, which is not what the server checks',
    ).not.toContain('project.required === 0');
  });

  it('MANDATORY: the count the button reads is the count the server refuses on', () => {
    // Both halves of the same fact: the query counts contributions, and `remove` refuses on them.
    expect(service).toContain('FROM colony_contributions c WHERE c.project_id = p.id');
    expect(service).toContain('FROM colony_contributions WHERE project_id = $1::uuid');
  });

  it('the poster of a personal project may still direct it, and rank does not override that', () => {
    // #mayDirect: squadron projects go to COLONY_MANAGE, personal ones to whoever posted them.
    expect(service).toContain("project.owner === 'squadron'");
    expect(service).toContain('project.postedById === callerId');
  });
});

describe('turning a project into a squadron project', () => {
  it('MANDATORY: there is a route for it at all', () => {
    expect(controller).toContain("@Patch('projects/:id/owner')");
    expect(service).toContain('async setOwner(');
  });

  it('MANDATORY: officers only — adopting a build commits the squadron, not the poster', () => {
    /*
     * The same reasoning `setPriority` already uses: pointing the squadron at a build is not
     * something the person who posted it gets to decide. A poster who could adopt their own
     * project could then mark it the current effort, which is exactly what that method refuses.
     */
    const route = controller.slice(controller.indexOf("@Patch('projects/:id/owner')"));
    expect(route.slice(0, 900)).toContain('Permission.COLONY_MANAGE');
  });

  it('MANDATORY: handing it back clears the current-effort flag', () => {
    /*
     * Priority is squadron-only — `setPriority` refuses to set it on a personal project. Leaving
     * the flag set on the way back out would put a badge on the board that nothing could have put
     * there, and that nobody could remove without making it a squadron project again.
     */
    const method = service.slice(service.indexOf('async setOwner('));
    expect(method.slice(0, 2_500)).toContain("owner === 'personal' ? { isPriority: false } : {}");
  });

  it('the poster keeps the credit — adoption does not rewrite who found the site', () => {
    const method = service.slice(service.indexOf('async setOwner('), service.indexOf('async setOwner(') + 2_500);
    expect(method, 'setOwner reassigns postedById, erasing who actually found the site').not.toMatch(
      /postedById:\s/,
    );
  });

  it('it is written to the audit log, because it changes who controls a build', () => {
    const method = service.slice(service.indexOf('async setOwner('), service.indexOf('async setOwner(') + 2_500);
    expect(method).toContain("action: 'colony.project.owner'");
  });
});
