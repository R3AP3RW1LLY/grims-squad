'use client';

import { useState } from 'react';
import { errorFromResponse } from '../../../../lib/api-error';

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

/** Every permission, in bit order. Mirrors packages/shared/src/permissions.ts. */
const PERMISSIONS: ReadonlyArray<[string, number]> = [
  ['FORUM_VIEW_PUBLIC', 0],
  ['FORUM_POST_PUBLIC', 1],
  ['FORUM_VIEW_MEMBER', 2],
  ['FORUM_POST_MEMBER', 3],
  ['FORUM_VIEW_OFFICER', 4],
  ['FORUM_MODERATE', 5],
  ['FORUM_POST_OFFICER', 6],
  ['OPS_VIEW', 10],
  ['OPS_SIGNUP', 11],
  ['OPS_CREATE', 12],
  ['OPS_MANAGE', 13],
  ['FLEET_VIEW', 20],
  ['FLEET_EDIT_OWN', 21],
  ['CARRIER_VIEW', 22],
  ['CARRIER_MANAGE', 23],
  ['FLEET_APPROVE_DOCTRINE', 24],
  ['BGS_VIEW', 30],
  ['BGS_REPORT', 31],
  ['BGS_SET_ORDERS', 32],
  ['TRADE_QUERY', 40],
  ['TRADE_SAVE_ROUTE', 41],
  ['TRADE_MANAGE_ALERTS', 42],
  ['AI_CHAT', 50],
  ['AI_TOOLS_READ', 51],
  ['AI_TOOLS_WRITE', 52],
  ['AI_TOOLS_ADMIN', 53],
  ['MEMBER_MANAGE', 60],
  ['ROLE_MANAGE', 61],
  ['AUDIT_VIEW', 62],
  ['SITE_CONFIG', 63],
  ['TELEMETRY_WRITE', 70],
];

function readCsrf(): string {
  const jar = document.cookie.split('; ');
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const hit = jar.find((c) => c.startsWith(`${name}=`));
    if (hit !== undefined) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return '';
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': readCsrf() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // The API answers with an ENVELOPE. Reading json.message off the top level
    // always yielded undefined and threw away the real reason.
    throw new Error((await errorFromResponse(res)).message);
  }
  return (await res.json().catch(() => ({}))) as T;
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
export function RoleEditor({ roles }: { roles: RoleRow[] }) {
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
      setPreview(await post<MaskPreview>(`/v1/admin/roles/${selected.id}/preview`, {
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
      const r = await post<MaskPreview>(`/v1/admin/roles/${selected.id}`, {
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
    <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
      <nav aria-label="Roles">
        <ul className="space-y-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => choose(r)}
                className={`w-full rounded border px-4 py-2.5 text-left text-sm ${
                  selected?.id === r.id
                    ? 'border-[var(--color-brand-cyan-bright)] text-[var(--color-brand-cyan-bright)]'
                    : 'border-[var(--color-border-hairline)] text-[var(--color-text-primary)]'
                }`}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div>
        {selected === null ? (
          <p className="text-sm text-[var(--color-text-muted)]">Pick a role to edit.</p>
        ) : (
          <>
            <h3
              className="text-xl text-[var(--color-brand-orange)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {selected.name.toUpperCase()}
            </h3>

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

            <ul className="mt-6 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
              {PERMISSIONS.map(([name, bit]) => {
                const on = (mask & (1n << BigInt(bit))) !== 0n;
                return (
                  <li key={name}>
                    <label className="flex items-center gap-3 py-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(bit)}
                        className="h-4 w-4 shrink-0"
                      />
                      {name}
                    </label>
                  </li>
                );
              })}
            </ul>

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
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Nothing would change.
                  </p>
                ) : preview.affected.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">
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
