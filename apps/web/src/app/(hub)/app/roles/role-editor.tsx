'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '../../../../lib/api-client';
import { TwoFactorModal } from '../../../../components/two-factor-modal';
import type { RoleGroup } from './role-groups';

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  /** DECIMAL STRING. Above 2^53 a JSON number would round it (INV-006). */
  permMask: string;
  rankOrder: number;
}

export interface AffectedMember {
  userId: string;
  handle: string;
  gains: string[];
  losses: string[];
}

export interface MaskPreview {
  roleName: string;
  before: string;
  after: string;
  affected: AffectedMember[];
  unchanged: boolean;
  dangerous: boolean;
  warnings: string[];
}

/**
 * Every permission, grouped by the part of the site it governs.
 *
 * ★ BIT ORDER IS NOT READING ORDER ★
 *
 * This was one flat list of thirty checkboxes in numeric bit order, which is
 * the order the MASK cares about and no order a person does. Deciding "what may
 * an ordinary member do in the forums" meant finding seven boxes scattered
 * through a wall of them.
 *
 * The bit numbers are unchanged and still mirror packages/shared/src/permissions.ts
 * — only the presentation is grouped. Gaps in the numbering (7–9, 14–19, …) are
 * deliberate room to add permissions to an area without renumbering, which
 * would silently re-point every stored mask.
 *
 * The four in `Administration` are the ones that can hand somebody the site, so
 * they carry a warning rather than sitting anonymously beside FORUM_VIEW_PUBLIC.
 */
/**
 * What each permission actually lets a member do, in a sentence.
 *
 * ★ WORDED FROM THE SSOT, NOT INVENTED ★
 *
 * Every line here is a plain-English rendering of the doc comment on the same
 * constant in ssot/04-contracts/permissions.ts, which is the authority. The
 * console is where somebody decides whether to grant `BGS_SET_ORDERS`, and
 * "Ring 2. Set per-system directives" is not the sentence that helps them —
 * "this steers the whole squadron\u2019s evening" is.
 *
 * A test asserts every permission rendered on this page has an entry, so a bit
 * added later cannot appear as an unexplained checkbox.
 */
export const DESCRIBES: Readonly<Record<string, string>> = {
  FORUM_VIEW_PUBLIC:
    'Read the public forum categories. The only thing a signed-out visitor can do.',
  FORUM_POST_PUBLIC:
    'Write and reply in the public categories.',
  FORUM_VIEW_MEMBER:
    'Read the members-only categories. In practice, this is what "is a member" means.',
  FORUM_POST_MEMBER:
    'Write and reply in the members-only categories.',
  FORUM_VIEW_OFFICER:
    'Read the officer categories: Command Deck, Applications, Member Concerns.',
  FORUM_POST_OFFICER:
    'Post in the officer categories, and in public ones only officers may post to — Announcements and the Squadron Log.',
  FORUM_POST_GUIDE:
    'Write and edit the Guides board — the joining guide and other site documentation. Held by officers AND by the webmaster, which is why it is a separate permission from posting in officer categories.',
  FORUM_MODERATE:
    'Lock, pin, move, delete and restore threads, and warn, mute or ban members. Every action is audited.',
  OPS_VIEW:
    'See the operations board and the calendar.',
  OPS_SIGNUP:
    'Sign up for an operation, change their state and pick a ship.',
  OPS_CREATE:
    'Create and edit operations. This is what makes somebody a wing lead rather than a member.',
  OPS_MANAGE:
    'Manage ANY operation, mark attendance, and send squadron-wide Discord messages.',
  FLEET_VIEW:
    'See the squadron fleet and the loadouts members have shared.',
  FLEET_EDIT_OWN:
    'Create and edit their OWN ships and loadouts. Nobody else’s.',
  CARRIER_VIEW:
    'See the carrier registry, jump schedule and fuel state.',
  CARRIER_MANAGE:
    'Manage any carrier record. A carrier owner manages their own without this — owning one does not make somebody an officer.',
  FLEET_APPROVE_DOCTRINE:
    'Mark a loadout as doctrine: the officer-approved standard build for a role.',
  BGS_VIEW:
    'See influence charts, the control board and the current orders.',
  BGS_REPORT:
    'Submit background-simulation activity reports, by hand or through the companion app.',
  BGS_SET_ORDERS:
    'Set the per-system directives the whole squadron flies to. This steers everybody’s evening.',
  TRADE_QUERY:
    'Open the commodities market and the Freight Office: look up any commodity, see where it is bought and sold, and plan routes. Signed-out visitors hold this too, so taking it from a rank hides the pages from members while the public keeps them.',
  TRADE_SAVE_ROUTE:
    'Keep a planned route against their own account, and post it to the squadron trade board.',
  TRADE_MANAGE_ALERTS:
    'Create and manage their own price alerts.',
  COLONY_VIEW:
    'See the colonisation boards — what the squadron is building, and what members have asked for help with. Members only: a project board says who is building what and where.',
  COLONY_POST:
    'Post their own colonisation project and ask the squadron for help with it. Their companion app then keeps its needs and deliveries current.',
  COLONY_SHARE_PUBLIC:
    'Publish one of their own projects on a link that works without signing in. The only action here that cannot be taken back once somebody has copied the link.',
  COLONY_MANAGE:
    'Create SQUADRON projects and mark which one is the current effort. This is a claim on everybody’s playing time, so it sits with officers.',
  SHIPYARD_VIEW:
    'Open the outfitter and the assisted builder. Everything behind it is Frontier’s own module data — working out what to save for is not a privileged act.',
  SHIPYARD_SAVE:
    'Keep builds against their own account, so a ship planned on Tuesday is still there on Friday.',
  SHIPYARD_SHARE:
    'Publish a build to the squadron. Every signed-in member can then open it, with the author’s name on it.',
  SHIPYARD_SHARE_PUBLIC:
    'Publish a build on a link that works without signing in. The only action here that cannot be taken back once somebody has copied the link — and anyone holding it must carry a second factor.',
  AI_CHAT:
    'Talk to the squadron assistant at all. Without this the panel is not offered.',
  AI_TOOLS_READ:
    'Let the assistant look things up on their behalf — never beyond what they could see themselves.',
  AI_TOOLS_WRITE:
    'Let the assistant ATTEMPT changes. It does not grant the change itself: the underlying permission still applies and confirmation is still required.',
  AI_TOOLS_ADMIN:
    'Assistant administration: kill switches, quota overrides, and reading other members’ conversations.',
  AI_REVIEW:
    'Work the screening queue — release or refuse posts the AI held — and read the log of what the AI was asked and what it answered.',
  AI_TRAINING:
    'See what the assistant has learned and when it next will, and approve the screenshots members submit for it to train on.',
  AI_TRAIN_SUBMIT:
    'Offer their own screenshots on Help Train the Bot. On for every member — switch it off for somebody flooding the pool, without touching anything else they can do.',
  MEMBER_MANAGE:
    'Search and filter members, keep notes, set probation and activity flags, and deactivate accounts.',
  AUDIT_VIEW:
    'Read the audit log. Read-only by construction — the log cannot be edited by anyone.',
  ROLE_MANAGE:
    'Create and edit roles, their permissions, and the Discord mappings. Effectively the ability to grant anybody any permission, including to themselves.',
  SITE_CONFIG:
    'Site configuration, integration keys, feature flags and the assistant kill switches.',
  TELEMETRY_WRITE:
    'Pair a device and send journal data. Gates the CAPABILITY only — what is actually stored is decided by the member’s own settings.',
  SUPPORT_AGENT:
    'Work the Help & Support console: read every help conversation — members’ and guests’ — and answer under their own name. Asking for help needs no permission at all; this is the other side of the desk.',
};

interface PermissionGroup {
  readonly title: string;
  readonly note?: string;
  readonly danger?: boolean;
  readonly items: ReadonlyArray<[string, number]>;
}

const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    title: 'Forums',
    items: [
      ['FORUM_VIEW_PUBLIC', 0],
      ['FORUM_POST_PUBLIC', 1],
      ['FORUM_VIEW_MEMBER', 2],
      ['FORUM_POST_MEMBER', 3],
      ['FORUM_VIEW_OFFICER', 4],
      ['FORUM_POST_OFFICER', 6],
      ['FORUM_POST_GUIDE', 7],
      ['FORUM_MODERATE', 5],
    ],
  },
  {
    title: 'Operations',
    items: [
      ['OPS_VIEW', 10],
      ['OPS_SIGNUP', 11],
      ['OPS_CREATE', 12],
      ['OPS_MANAGE', 13],
    ],
  },
  {
    title: 'Fleet and carriers',
    items: [
      ['FLEET_VIEW', 20],
      ['FLEET_EDIT_OWN', 21],
      ['CARRIER_VIEW', 22],
      ['CARRIER_MANAGE', 23],
      ['FLEET_APPROVE_DOCTRINE', 24],
    ],
  },
  {
    title: 'Background simulation',
    items: [
      ['BGS_VIEW', 30],
      ['BGS_REPORT', 31],
      ['BGS_SET_ORDERS', 32],
    ],
  },
  {
    /*
     * ★ NAMED FOR THE SUBCATEGORY IT GATES — SQUADRON OWNER, 2026-08-02 ★
     *
     * "create another subcategory under Squadron called Logistics & Trade". The heading was
     * "Trade", which is now the name of neither the section in the sidebar nor either page inside
     * it — and the GMSD AI group above is here precisely because a heading that does not match what
     * the site calls the thing reads as missing.
     */
    title: 'Logistics & Trade',
    note: 'The commodities market and the Freight Office. Signed-out visitors can already open both, so removing the first of these hides them from a rank while the public keeps them.',
    items: [
      ['TRADE_QUERY', 40],
      ['TRADE_SAVE_ROUTE', 41],
      ['TRADE_MANAGE_ALERTS', 42],
    ],
  },
  {
    /*
     * ★ ITS OWN GROUP — SQUADRON OWNER, 2026-08-02 ★
     *
     * Colonisation sits under Logistics & Trade in the sidebar, but its permissions are not the
     * market's: one of these is an officer power over everybody's evening, and one publishes to the
     * open web. Folded into the group above, both would be buried among three read permissions that
     * do nothing of the sort.
     */
    title: 'Colonisation',
    note: 'Who can see the project boards, who can post their own, and who decides what the whole squadron is hauling for.',
    items: [
      ['COLONY_VIEW', 71],
      ['COLONY_POST', 72],
      ['COLONY_SHARE_PUBLIC', 73],
      ['COLONY_MANAGE', 74],
    ],
  },
  {
    /*
     * ★ 'GMSD AI', NOT 'Assistant' — squadron owner, 2026-08-01 ★
     *
     * "give AI its own category! we can assign to each rank please!"
     *
     * The permissions were already one group and had been since P1. The group was called
     * "Assistant", which is not what anybody on this platform calls it: the sidebar says GMSD AI,
     * the admin page says AI training, the owner says AI. A heading nobody searching for "AI"
     * would read as AI is a heading that looks missing — which is exactly how it was reported.
     */
    title: 'GMSD AI',
    note: 'What each rank may do with the assistant — including whether they can send screenshots on Help Train the Bot, and whether they can approve what other people send.',
    items: [
      ['AI_CHAT', 50],
      ['AI_TOOLS_READ', 51],
      ['AI_TOOLS_WRITE', 52],
      ['AI_TOOLS_ADMIN', 53],
      ['AI_REVIEW', 54],
      /*
       * The two that govern Help Train the Bot, and they are deliberately separate:
       *
       *   AI_TRAIN_SUBMIT  turns the PAGE on for a rank. Off means the sidebar entry is gone —
       *                    `navFor` gates on this exact bit, so nobody is shown a door that
       *                    refuses them.
       *   AI_TRAINING      approve or reject what other people send, and read the training status.
       *
       * One bit for both would mean the only way to stop a rank submitting is to take away its
       * ability to review, and the only way to let a rank review is to let it submit.
       */
      ['AI_TRAINING', 55],
      ['AI_TRAIN_SUBMIT', 56],
    ],
  },
  {
    /*
     * ★ ITS OWN CATEGORY — SQUADRON OWNER, 2026-08-01 ★
     *
     * "create the permissions for the Shipyard category and add them to the roles page make them
     * work the same as all other categories."
     *
     * Not folded into Fleet, though the two are about ships. Fleet is a record of what the squadron
     * OWNS; the Shipyard is a tool for planning what somebody might buy. A rank can reasonably have
     * one and not the other, and a heading that merges them makes that impossible to express.
     */
    title: 'Shipyard',
    note: 'Who may plan ships, keep what they plan, and show it to other people. Sharing to the squadron and publishing to the open web are separate on purpose — only the second is permanent.',
    items: [
      ['SHIPYARD_VIEW', 43],
      ['SHIPYARD_SAVE', 44],
      ['SHIPYARD_SHARE', 45],
      ['SHIPYARD_SHARE_PUBLIC', 46],
    ],
  },
  {
    title: 'Administration',
    note: 'Anyone holding these can change what everybody else may do.',
    danger: true,
    items: [
      ['MEMBER_MANAGE', 60],
      ['AUDIT_VIEW', 62],
      ['ROLE_MANAGE', 61],
      ['SITE_CONFIG', 63],
    ],
  },
  {
    title: 'Devices',
    items: [['TELEMETRY_WRITE', 70]],
  },
  {
    /*
     * ★ ITS OWN GROUP, AND NOT UNDER ADMINISTRATION ★
     *
     * Answering the help chat reads other people's private conversations, which earns the bit a
     * two-factor obligation — but it changes nothing about what anybody else may do, which is
     * what the Administration group's warning says. A support role somebody creates later should
     * be grantable without the word "danger" appearing beside it.
     */
    title: 'Support',
    note: 'Who answers the help chat. The chat itself is open to everyone, guests included — this gates the console that reads and answers it.',
    items: [['SUPPORT_AGENT', 80]],
  },
];

/** Flat, for counting. Derived so the two can never fall out of step. */
export const ALL_PERMISSIONS: ReadonlyArray<[string, number]> = PERMISSION_GROUPS.flatMap((g) => g.items);

/** How many permissions a mask actually turns on. */
export function countPermissions(mask: bigint): number {
  return ALL_PERMISSIONS.filter(([, bit]) => (mask & (1n << BigInt(bit))) !== 0n).length;
}

/**
 * The role editor.
 *
 * ★ THE PREVIEW IS NOT OPTIONAL ★
 *
 * You cannot save from here without asking what the change does first. That is
 * deliberate: a mask is a 70-bit number, nobody can read one, and "grant
 * SITE_CONFIG to eleven people" looks exactly like any other edit until
 * something is listing the names.
 *
 * All arithmetic is BigInt. A permission mask above 2^53 loses precision as a
 * JavaScript number, and SITE_CONFIG alone is 1n<<63n.
 */
export function RoleEditor({ groups }: { groups: readonly RoleGroup[] }) {
  const router = useRouter();
  /*
   * ★ THE ROLE LIST IS STATE, NOT A PROP READ STRAIGHT THROUGH ★
   *
   * Squadron owner, 2026-08-01: "when we update permissions etc, can we make sure everything
   * updates on the page asyncronously please. we need this to happen so we can see the changes have
   * been made as they happen".
   *
   * Rendering `groups` directly meant saving a mask left the permission count in the left-hand list
   * showing the OLD number — the save had worked, the server knew, and the only thing on screen
   * that could confirm it was a sentence saying so. Somebody checking their work would reasonably
   * conclude nothing had happened.
   *
   * So the saved mask is written back here the moment the API accepts it, and `router.refresh()`
   * re-pulls the server's copy behind that. The local write is what makes it instant; the refresh is
   * what makes it right — if the two ever disagreed, the server's answer arrives a moment later and
   * wins.
   */
  const [rows, setRows] = useState<readonly RoleGroup[]>(groups);

  // A refresh replaces the prop. Without this the server's copy would arrive and be ignored, and
  // the page would drift from the database in exactly the way the local write exists to avoid.
  useEffect(() => {
    setRows(groups);
  }, [groups]);

  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [mask, setMask] = useState(0n);
  const [preview, setPreview] = useState<MaskPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * True only after a save was refused for a STALE step-up. Not derived from the error
   * string at render time — an error can be many things, and a code box appearing next to
   * "you do not hold ROLE_MANAGE" would repeat the exact mistake this release fixes.
   */
  const [needsCode, setNeedsCode] = useState(false);

  function choose(role: RoleRow) {
    setSelected(role);
    setMask(BigInt(role.permMask));
    setPreview(null);
    setSaved(null);
    setError(null);
  }

  function toggle(bit: number) {
    const b = 1n << BigInt(bit);
    setMask((m) => (m & b) === b ? m & ~b : m | b);
    // Any edit invalidates the preview. Leaving a stale one on screen next to
    // a Save button is how somebody saves a change they never previewed.
    setPreview(null);
    setSaved(null);
  }

  async function doPreview() {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await apiPost<MaskPreview>(`/v1/admin/roles/${selected.id}/preview`, {
        permMask: mask.toString(),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doSave() {
    if (selected === null || preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<MaskPreview>(`/v1/admin/roles/${selected.id}`, {
        permMask: mask.toString(),
      });
      setSaved(`Saved. ${r.affected.length} member(s) affected.`);
      setPreview(null);
      setNeedsCode(false);

      /*
       * The list updates NOW, and the server confirms behind it.
       *
       * `mask.toString()` rather than re-reading the response: it is the exact value the API just
       * accepted, so the count beside the role name changes in the same frame as the confirmation
       * sentence. `router.refresh()` then re-renders the page from the database, which corrects
       * anything else the save touched — member counts, other roles — without a full reload.
       */
      const saved = mask.toString();
      setRows((current) =>
        current.map((g) => ({
          ...g,
          roles: g.roles.map((role) =>
            role.id === selected.id ? { ...role, permMask: saved } : role,
          ),
        })),
      );
      setSelected((current) => (current === null ? null : { ...current, permMask: saved }));
      router.refresh();
    } catch (e) {
      /*
       * ★ A FRESH-CODE REFUSAL IS ACTIONABLE, SO IT GETS AN ACTION ★
       *
       * Saving a mask is a tier-3 action: it needs a step-up confirmed within the last two
       * minutes, not the general two-hour window. Reads pass on the long window, so the page
       * renders normally and the ONLY thing that fails is the save.
       *
       * That used to surface as bare text — "This change needs a fresh authenticator code.
       * Confirm it again to continue." — on a screen with no code box anywhere. The only way
       * to satisfy it was to leave for /settings/security, confirm, come back, and redo the
       * whole selection before the two minutes ran out. Told to confirm a code with nothing
       * to type it into, the reasonable conclusion is that two-factor is broken.
       *
       * Now the prompt appears in place, and the editor's state survives it: the role, the
       * checkboxes and the preview are all still there when the code is accepted.
       */
      const message = (e as Error).message;
      setError(message);
      if (/authenticator code/i.test(message)) setNeedsCode(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/*
        ★ THE CODE PROMPT IS A MODAL — SQUADRON OWNER, 2026-08-01 ★

        "the 2FA confirmation, should pop up in a modal please and it should auto submit after the
        6th digit is entered like the official authenticator does when we first sign in etc"

        It used to be a small input wedged between the permission checkboxes and Save. It worked,
        and it read as one more field on a long form rather than as "everything has stopped until
        you do this" — so an officer hunting for why Save appeared to do nothing could scroll
        straight past the thing asking them for a code.

        The selection, the mask and the preview all survive it, and the save is retried the moment
        the code is accepted — confirming and then asking somebody to press Save again would restart
        the two-minute clock against them for no reason.
      */}
      <TwoFactorModal
        open={needsCode}
        title="Confirm this change"
        explanation="Changing permissions needs a code from the last two minutes. Nothing you have selected is lost."
        onConfirmed={async () => {
          setNeedsCode(false);
          await doSave();
        }}
        onCancel={() => setNeedsCode(false)}
      />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[300px_1fr]">
      {/*
        CATEGORISED, AND IN LADDER ORDER WITHIN EACH.

        One flat list of seventeen roles gave no clue that six are leadership
        appointments, ten are the promotion ladder and the rest are neither —
        and the two ladders run in OPPOSITE directions, so a single sorted list
        is wrong for one of them whichever way you sort it.

        The permission count sits beside each name because it is the one fact
        somebody scanning for "who can do too much" is looking for, and a 70-bit
        mask is unreadable.
      */}
      <nav aria-label="Roles" className="space-y-6">
        {rows.map((g) => (
          <div key={g.key}>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)]">
              {g.title}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
              {g.blurb}
            </p>
            <ul className="mt-2.5 space-y-1">
              {g.roles.map((r) => {
                const count = countPermissions(BigInt(r.permMask));
                const active = selected?.id === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => choose(r)}
                      className={`flex w-full items-center justify-between gap-3 rounded border px-3.5 py-2 text-left text-sm transition-colors ${
                        active
                          ? 'border-[var(--color-brand-cyan-bright)] bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_10%,transparent)] text-[var(--color-brand-cyan-bright)]'
                          : 'border-[var(--color-border-hairline)] text-[var(--color-text-primary)] hover:border-[var(--color-border-active)]'
                      }`}
                    >
                      <span className="min-w-0 truncate">{r.name}</span>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] ${
                          count === 0
                            ? 'border-[var(--color-border-hairline)] text-[var(--color-text-dim)]'
                            : 'border-[var(--color-brand-cyan)] text-[var(--color-brand-cyan-bright)]'
                        }`}
                        title={`${count} of ${ALL_PERMISSIONS.length} permissions`}
                      >
                        {count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div>
        {selected === null ? (
          <p className="rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Pick a role to see and change what it may do. Every role on this page
            is editable, including the floor that applies to a member holding no
            rank at all.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3
                className="text-2xl text-[var(--color-brand-orange)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {selected.name.toUpperCase()}
              </h3>
              <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                {countPermissions(mask)} of {ALL_PERMISSIONS.length} permissions
                {countPermissions(mask) !== countPermissions(BigInt(selected.permMask)) && (
                  <span className="ml-2 text-[var(--color-brand-orange)]">unsaved</span>
                )}
              </span>
            </div>

            {error !== null && (
              <p
                role="alert"
                className="mt-4 rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
              >
                {error}
              </p>
            )}

            {/*
              ★ THE CODE BOX APPEARS WHERE THE REFUSAL HAPPENED ★

              Saving a mask needs a step-up confirmed in the last two minutes. Reads pass on
              the two-hour window, so the page looks fine and only the save fails — and the
              message said "confirm it again" on a screen with nowhere to do that.

              Confirming here keeps the role, the checkboxes and the preview intact, and
              retries the save straight away. The alternative was a round trip to
              /settings/security and redoing the whole selection inside two minutes.
            */}
            {saved !== null && (
              <p className="mt-4 rounded border border-[var(--color-brand-cyan-bright)] px-4 py-3 text-sm text-[var(--color-brand-cyan-bright)]">
                {saved}
              </p>
            )}

            <div className="mt-6 space-y-5">
              {PERMISSION_GROUPS.map((group) => {
                const on = group.items.filter(([, b]) => (mask & (1n << BigInt(b))) !== 0n).length;
                return (
                  <fieldset
                    key={group.title}
                    className={`rounded-lg border p-4 ${
                      group.danger === true && on > 0
                        ? 'border-[var(--color-brand-orange)]'
                        : 'border-[var(--color-border-hairline)]'
                    }`}
                  >
                    <legend className="flex items-center gap-2.5 px-1.5">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                        {group.title}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                        {on}/{group.items.length}
                      </span>
                    </legend>

                    {/*
                      The warning shows only when something in the group is
                      actually ON. A standing red box beside four unchecked boxes
                      is decoration, and decoration is what people stop reading.
                    */}
                    {group.note !== undefined && (
                      <p
                        className={`mb-2 text-[11px] leading-relaxed ${
                          on > 0
                            ? 'text-[var(--color-brand-orange)]'
                            : 'text-[var(--color-text-secondary)]'
                        }`}
                      >
                        {group.note}
                      </p>
                    )}

                    <ul className="grid grid-cols-1 gap-x-8 xl:grid-cols-2">
                      {group.items.map(([name, bit]) => {
                        const checked = (mask & (1n << BigInt(bit))) !== 0n;
                        return (
                          <li key={name}>
                            {/*
                              The description is the label's `title`, so it
                              appears on hover AND on keyboard focus, and is read
                              out by a screen reader — which a tooltip built from
                              a div and a hover handler would not be.
                            */}
                            <label
                              className="flex cursor-help items-start gap-3 py-1.5"
                              title={DESCRIBES[name] ?? name}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(bit)}
                                className="mt-0.5 h-4 w-4 shrink-0"
                              />
                              <span className="min-w-0">
                                <span
                                  className={`block font-mono text-xs ${
                                    checked
                                      ? 'text-[var(--color-text-primary)]'
                                      : 'text-[var(--color-text-secondary)]'
                                  }`}
                                >
                                  {name}
                                </span>
                                {/*
                                  Shown as well as tooltipped. A tooltip is
                                  invisible on a touch screen and invisible to
                                  anybody who does not think to hover, and this
                                  is the text that makes the checkbox decidable.
                                */}
                                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-text-dim)]">
                                  {DESCRIBES[name] ?? ''}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>

            <div className="mt-8 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => void doPreview()}
                disabled={busy}
                className="rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
              >
                Preview changes
              </button>
              <button
                type="button"
                onClick={() => void doSave()}
                // Cannot save without previewing FIRST. The whole point.
                disabled={busy || preview === null || preview.unchanged}
                className="rounded border border-[var(--color-brand-orange)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)] disabled:opacity-40"
              >
                {preview === null ? 'Preview first' : 'Save'}
              </button>
            </div>

            {preview !== null && (
              <section aria-live="polite" className="mt-8">
                {preview.dangerous && (
                  <div
                    role="alert"
                    className="mb-6 rounded border-2 border-[var(--color-brand-orange)] p-5"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)]">
                      Read this before saving
                    </p>
                    {preview.warnings.map((w) => (
                      <p key={w} className="mt-2 text-[var(--color-text-primary)]">
                        {w}
                      </p>
                    ))}
                  </div>
                )}

                {preview.unchanged ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Nothing would change.
                  </p>
                ) : preview.affected.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    The mask changes, but no current member&rsquo;s effective permissions do — they
                    hold these through another role, or their deny mask removes them.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-[var(--color-text-primary)]">
                      <strong>{preview.affected.length}</strong> member(s) affected:
                    </p>
                    <ul className="mt-4 space-y-2">
                      {preview.affected.map((a) => (
                        <li
                          key={a.userId}
                          className="border-b border-[var(--color-border-hairline)] py-2 text-sm"
                        >
                          <span className="text-[var(--color-text-primary)]">{a.handle}</span>
                          {a.gains.length > 0 && (
                            <span className="ml-3 font-mono text-xs text-[var(--color-brand-cyan-bright)]">
                              + {a.gains.join(', ')}
                            </span>
                          )}
                          {a.losses.length > 0 && (
                            <span className="ml-3 font-mono text-xs text-[var(--color-brand-orange)]">
                              − {a.losses.join(', ')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
      </div>
    </>
  );
}
