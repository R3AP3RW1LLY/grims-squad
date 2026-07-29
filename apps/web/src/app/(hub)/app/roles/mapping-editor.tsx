'use client';

import { useState } from 'react';
import type { RoleRow } from './role-editor';
import { apiPost, apiDelete } from '../../../../lib/api-client';

export interface MappingRow {
  roleId: string;
  roleName: string;
  discordRoleId: string;
  /**
   * The role's name and colour IN DISCORD.
   *
   * Null when the guild catalogue has no such role — it has been deleted in
   * Discord, or the bot's sync has not run. Either way that mapping now grants
   * nobody anything, which is worth saying out loud rather than leaving as a
   * row that looks exactly like a working one.
   */
  discordName?: string | null;
  discordColour?: string | null;
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
      /*
       * `discordName: undefined`, NOT null. Null means "the catalogue was asked
       * and had nothing", which renders the warning. This row has simply never
       * been resolved — a refresh fills it in — and flagging it as broken the
       * instant it is created would be alarming and wrong.
       */
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

      {/*
        THE DISCORD ROLE, SHOWN AS DISCORD SHOWS IT.

        This listed `Sector Overseer -> 1513749464458723469`. Nobody can read a
        snowflake, so the one question this page exists to answer — is this
        pointing at the role I think it is — could only be checked by opening
        Discord and comparing twenty digits by eye.

        The name and its colour come from the guild catalogue the bot syncs, and
        the dot carries the colour at full strength exactly as the roster chips
        do, so the same role is recognisable in both places.
      */}
      <ul className="space-y-1">
        {rows.map((m) => {
          const missing = m.discordName === null || m.discordName === undefined;
          return (
            <li
              key={`${m.roleId}-${m.discordRoleId}`}
              className={`flex flex-wrap items-center justify-between gap-4 rounded border px-4 py-3 ${
                missing
                  ? 'border-[var(--color-semantic-warning)]'
                  : 'border-[var(--color-border-hairline)]'
              }`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <span className="text-sm text-[var(--color-text-primary)]">{m.roleName}</span>
                <span aria-hidden="true" className="text-[var(--color-text-dim)]">
                  &larr;
                </span>

                {missing ? (
                  /*
                    Says the CACHE has no name for it, not that Discord has no
                    such role. Those are different claims and the second one is
                    an accusation — it fired for every mapping on a fresh
                    deployment while nothing in Discord had changed.
                  */
                  <span
                    className="text-sm text-[var(--color-semantic-warning)]"
                    title="Role names come from our nightly Discord sync. Until it has run, or if this role really was deleted, there is no name to show."
                  >
                    Name not synced
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[12px]"
                    style={{
                      borderColor:
                        m.discordColour == null
                          ? 'var(--color-border-hairline)'
                          : `${m.discordColour}66`,
                    }}
                  >
                    {m.discordColour != null && (
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: m.discordColour }}
                      />
                    )}
                    <span className="text-[var(--color-text-primary)]">{m.discordName}</span>
                  </span>
                )}

                <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                  {m.discordRoleId}
                </span>
              </div>

              <button
                type="button"
                onClick={() => void remove(m)}
                disabled={busy}
                className="shrink-0 rounded border border-[var(--color-border-hairline)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] hover:border-[var(--color-brand-orange)] hover:text-[var(--color-brand-orange)] disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          );
        })}
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
