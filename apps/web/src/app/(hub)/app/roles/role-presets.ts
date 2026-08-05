import { HIERARCHICAL_ROLES, ROLE_PRESETS, maskToString, type RoleKey } from '@grims/shared';
import type { RolePreset } from './role-editor';

/**
 * The named permission bundles, prepared on the SERVER for the role editor.
 *
 * ★ WHY THIS FILE EXISTS AT ALL ★
 *
 * The editor offers ~50 individual checkboxes. Setting "member" by hand is thirty correct ticks
 * from memory, and a wrong tick in a permissions console is a security decision made by
 * accident — the migration that created `grims_squad_members`, `allies` and `unranked` left every
 * mask at zero precisely so the bundles would be chosen here, deliberately, rather than granted
 * by a migration nobody read.
 *
 * ★ AND WHY IT IS NOT IMPORTED BY THE EDITOR ★
 *
 * `role-editor.tsx` is a client component. `@grims/shared`'s barrel re-exports `nonce.service`,
 * which imports `node:crypto`; a client module that reaches it fails the webpack build with
 * `UnhandledSchemeError` and takes every hub page to a 500 (see lib/client-imports.spec.ts).
 * The editor already follows this rule for the permission list itself — `ALL_PERMISSIONS` is a
 * local literal in role-editor.tsx, not an import.
 *
 * So the presets are resolved HERE, in a module only the server component imports, and travel to
 * the browser as props. Nothing in this file may ever be imported from a `'use client'` module,
 * directly or through a relative chain.
 *
 * ★ MASKS TRAVEL AS DECIMAL STRINGS (INV-006) ★
 *
 * `sysadmin` holds SITE_CONFIG, which is `1n << 63n` — nine thousand times past the largest
 * integer a JSON number carries exactly. Serialised as a number it would arrive rounded, and a
 * rounded mask is a different set of permissions that still looks plausible. `maskToString` is
 * the one conversion; the editor parses it back with `BigInt` and never touches `Number`.
 */

/**
 * What each preset is CALLED on screen.
 *
 * A `Record<RoleKey, …>` rather than a lookup with a fallback: a preset added to the SSOT and not
 * named here fails the typecheck, instead of appearing on the page as `wing_lead`.
 */
const PRESET_NAMES: Record<RoleKey, string> = {
  guest: 'Guest',
  applicant: 'Applicant',
  member: 'Member',
  wing_lead: 'Wing lead',
  officer: 'Officer',
  commander: 'Commander',
  sysadmin: 'Sysadmin',
  bgs_team: 'BGS team',
  carrier_owner: 'Carrier owner',
  miner: 'Miner',
  combat_wing: 'Combat wing',
  explorer: 'Explorer',
};

/**
 * What each preset actually confers, in a sentence.
 *
 * Written from the doc comments on the presets themselves in ssot/04-contracts/permissions.ts,
 * the same discipline as `DESCRIBES` in the editor: somebody choosing a bundle for a hundred
 * members needs the sentence, not the constant name.
 *
 * The four tags that grant nothing say so plainly. Applying one CLEARS a role, because a preset
 * is the whole bundle rather than an addition, and a control that quietly wipes a mask while
 * reading like a label is the exact shape this page exists to prevent.
 */
const PRESET_BLURBS: Record<RoleKey, string> = {
  guest:
    'What a signed-out visitor already holds: the public forum, the outfitter, and the commodities market and Freight Office.',
  applicant:
    'An application in flight — the public forum, and the ability to post in it. Their own application thread is reached by ownership, not by a bit.',
  member:
    'The main body of the squadron: member forums, operations, the fleet, carrier and BGS boards, trade, the shipyard, colonisation, the assistant, and device telemetry.',
  wing_lead:
    'Everything a member holds, plus creating and running operations. That one permission is the whole difference.',
  officer:
    'Moderation, member management, BGS orders, doctrine, the audit log, the support console, the AI review and training queues, and squadron colonisation projects.',
  commander:
    'An officer who may also edit roles — which is the ability to grant any permission on this page, including to their own account.',
  sysadmin:
    'A commander plus site configuration, integration keys and the assistant kill switches. Everything the platform has.',
  bgs_team:
    'A tag rather than a rank: BGS reporting, and the tick digest routed to whoever wears it.',
  carrier_owner:
    'A tag. It carries carrier visibility and drives notification routing — owners manage their OWN carriers through ownership, never through this.',
  miner:
    'A tag for matchmaking and notification routing. It grants nothing, so applying it clears every permission on this role.',
  combat_wing:
    'A tag for matchmaking and notification routing. It grants nothing, so applying it clears every permission on this role.',
  explorer:
    'A tag for matchmaking and notification routing. It grants nothing, so applying it clears every permission on this role.',
};

/**
 * Every preset the SSOT defines, in the order it defines them — ladder first, tags after.
 *
 * Derived from `ROLE_PRESETS` rather than listed, so a bundle added to the permission model
 * appears here without anybody remembering to add it. A preset the console cannot offer is a
 * bundle that has to be ticked out by hand, which is the problem this control removes.
 */
export function rolePresets(): RolePreset[] {
  return (Object.keys(ROLE_PRESETS) as RoleKey[]).map((key) => ({
    key,
    name: PRESET_NAMES[key],
    blurb: PRESET_BLURBS[key],
    mask: maskToString(ROLE_PRESETS[key]),
    hierarchical: HIERARCHICAL_ROLES.includes(key),
  }));
}
