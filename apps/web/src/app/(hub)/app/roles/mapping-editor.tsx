'use client';

import { useState } from 'react';
import type { RoleRow } from './role-editor';
import { apiPost, apiDelete } from '../../../../lib/api-client';

export interface MappingRow {
  roleId: string;
  roleName: string;
  discordRoleId: string;
}

/**
 * The Discord mapping editor.
 *
 * The shape is validated in the browser too — not as security, which happens on
 * the server, but because the most common mistake is pasting the MENTION form
 * you get from copying a role out of a Discord message, and saying so
 * immediately is kinder than a round trip that comes back with an error.
 */
const SNOWFLAKE = /^[0-9]{17,20}$/;

export function MappingEditor({ roles, mappings }: { roles: RoleRow[]; mappings: MappingRow[] }) {
  const [rows, setRows] = useState(mappings);
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [snowflake, setSnowflake] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shapeOk = SNOWFLAKE.test(snowflake.trim());

  async function add() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Was reading `j.message` off the top level; the API answers with an
      // envelope, so the real reason was always discarded.
      await apiPost('/v1/admin/mappings', { roleId, discordRoleId: snowflake.trim() });

      const role = roles.find((r) => r.id === roleId);
      setRows((r) => [
        ...r,
        { roleId, roleName: role?.name ?? '', discordRoleId: snowflake.trim() },
      ]);
      setSnowflake('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: MappingRow) {
    setBusy(true);
    setError(null);
    try {
      const j = await apiDelete<{ warning?: string }>(
        `/v1/admin/mappings/${encodeURIComponent(m.roleId)}/${encodeURIComponent(m.discordRoleId)}`,
      );

      setRows((r) =>
        r.filter((x) => !(x.roleId === m.roleId && x.discordRoleId === m.discordRoleId)),
      );
      // Surfaced rather than swallowed: removing a mapping makes the nightly
      // reconciliation revoke the role from everyone holding it, and that
      // should not arrive as a surprise the following morning.
      if (j.warning !== undefined) setNotice(j.warning);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      {error !== null && (
        <p
          role="alert"
          className="mb-6 rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <p className="mb-6 rounded border border-[var(--color-brand-cyan-bright)] px-4 py-3 text-sm text-[var(--color-brand-cyan-bright)]">
          {notice}
        </p>
      )}

      <ul className="space-y-1">
        {rows.map((m) => (
          <li
            key={`${m.roleId}-${m.discordRoleId}`}
            className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[var(--color-border-hairline)] py-3"
          >
            <span className="text-sm text-[var(--color-text-primary)]">
              {m.roleName}
              <span className="ml-4 font-mono text-xs text-[var(--color-text-secondary)]">
                {m.discordRoleId}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void remove(m)}
              disabled={busy}
              className="rounded border border-[var(--color-border-hairline)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] hover:border-[var(--color-brand-orange)] hover:text-[var(--color-brand-orange)] disabled:opacity-50"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {rows.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">No mappings yet.</p>}

      <div className="mt-8 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="map-role" className="block text-xs text-[var(--color-text-secondary)]">
            Platform role
          </label>
          <select
            id="map-role"
            value={roleId}
            onChange={(e) => setRoleId(e.currentTarget.value)}
            className="mt-1 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="map-snowflake" className="block text-xs text-[var(--color-text-secondary)]">
            Discord role ID
          </label>
          <input
            id="map-snowflake"
            value={snowflake}
            onChange={(e) => setSnowflake(e.currentTarget.value)}
            // A DESCRIPTION, not an example id. A real-looking snowflake in
            // source is exactly what the INV-008 lint rule exists to stop, and
            // it caught this — correctly, even though it is only a placeholder.
            placeholder="17-20 digits"
            aria-describedby="map-help"
            className="mt-1 w-64 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
          />
        </div>

        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || !shapeOk}
          className="rounded border border-[var(--color-brand-cyan-bright)] px-5 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] disabled:opacity-40"
        >
          Add mapping
        </button>
      </div>

      <p id="map-help" className="mt-3 max-w-[70ch] text-xs text-[var(--color-text-secondary)]">
        {snowflake.trim() !== '' && !shapeOk
          ? 'That is not a role ID. Copying a role out of a message gives you a mention, not an id — use Server Settings → Roles → right-click → Copy Role ID instead, with Developer Mode enabled.'
          : 'Server Settings → Roles → right-click a role → Copy Role ID, with Developer Mode enabled.'}
      </p>
    </div>
  );
}
