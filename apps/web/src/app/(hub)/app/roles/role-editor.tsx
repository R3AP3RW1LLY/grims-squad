'use client';

import { useState } from 'react';
import { apiPost } from '../../../../lib/api-client';
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
    'Look up commodities, find importers and exporters, and optimise routes.',
  TRADE_SAVE_ROUTE:
    'Save routes and post them to the squadron trade board.',
  TRADE_MANAGE_ALERTS:
    'Create and manage their own price alerts.',
  AI_CHAT:
    'Talk to the squadron assistant at all. Without this the panel is not offered.',
  AI_TOOLS_READ:
    'Let the assistant look things up on their behalf — never beyond what they could see themselves.',
  AI_TOOLS_WRITE:
    'Let the assistant ATTEMPT changes. It does not grant the change itself: the underlying permission still applies and confirmation is still required.',
  AI_TOOLS_ADMIN:
    'Assistant administration: kill switches, quota overrides, and reading other members’ conversations.',
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
    title: 'Trade',
    items: [
      ['TRADE_QUERY', 40],
      ['TRADE_SAVE_ROUTE', 41],
      ['TRADE_MANAGE_ALERTS', 42],
    ],
  },
  {
    title: 'Assistant',
    items: [
      ['AI_CHAT', 50],
      ['AI_TOOLS_READ', 51],
      ['AI_TOOLS_WRITE', 52],
      ['AI_TOOLS_ADMIN', 53],
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
  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [mask, setMask] = useState(0n);
  const [preview, setPreview] = useState<MaskPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
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
        {groups.map((g) => (
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
  );
}
