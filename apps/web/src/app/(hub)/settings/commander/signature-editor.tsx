'use client';

import { useEffect, useRef, useState } from 'react';
import {
  SIGNATURE_ACCENTS,
  SIGNATURE_LABEL_MAX,
  SIGNATURE_TAGLINE_MAX,
  isAllowedSignatureLink,
  SIGNATURE_LINK_HOSTS,
  type SignatureAccent,
  type SignatureView,
} from '@grims/shared';
import { apiCall } from '../../../../lib/api-client';
import { SignatureBlock } from '../../../../components/forum/signature-block';

/**
 * Building your forum signature.
 *
 * ★ THE PREVIEW IS THE REAL COMPONENT ★
 *
 * `SignatureBlock` — the same one the forum renders — is shown live above the controls. Not a
 * mock-up of it, not an approximation: the actual component, fed the actual state.
 *
 * That matters more than it sounds. A hand-built preview is a second renderer, and a second
 * renderer eventually disagrees with the first — so somebody designs a signature that looks right
 * here and wrong under their posts, and cannot work out which one lied to them.
 *
 * ★ THE AVATAR HERE DOES NOT TOUCH THEIR DISCORD PICTURE ★
 *
 * Squadron owner, 2026-07-30: it "should only be displayed on the forums and not replace their
 * global avatar that discord imports". The copy says so plainly, because a member uploading a
 * picture on a settings page will reasonably assume it is THE picture unless told otherwise.
 */

const MAX_BYTES = 8 * 1024 * 1024;

/** Reads the CSRF cookie. The name is `gs_csrf`, not `csrf` — see `image-uploader`. */
function readCsrf(): string {
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  return '';
}

const ACCENT_LABEL: Record<SignatureAccent, string> = {
  orange: 'Squadron orange',
  cyan: 'Cyan',
  gold: 'Gold',
  steel: 'Steel',
};

export function SignatureEditor({
  discordAvatarUrl,
}: {
  /** Their Discord picture, which is the default and stays the default until they change it. */
  readonly discordAvatarUrl: string | null;
}) {
  const [sig, setSig] = useState<SignatureView | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void apiCall<{ signature: SignatureView }>('GET', '/v1/forum/signature')
      .then((res) => {
        if (live) setSig(res.signature);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);

  function patch(next: Partial<SignatureView>) {
    setSig((current) => (current === null ? current : { ...current, ...next }));
    setSaved(false);
  }

  async function upload(file: File, slot: 'avatar' | 'banner') {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 8MB — crop it or save it at lower quality.`,
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/v1/media/uploads', {
        method: 'POST',
        body: file,
        headers: {
          'content-type': file.type === '' ? 'application/octet-stream' : file.type,
          'x-csrf-token': readCsrf(),
        },
        credentials: 'same-origin',
      });
      const json = (await res.json()) as { id?: string; error?: { message?: string } };
      if (!res.ok || typeof json.id !== 'string') {
        setError(json.error?.message ?? 'That upload did not work.');
        return;
      }
      /*
       * Saved IMMEDIATELY rather than held until the member presses Save. An uploaded file already
       * exists on our storage; leaving it referenced only by unsaved browser state is how it
       * becomes an orphan the moment they close the tab.
       */
      await save(slot === 'avatar' ? { avatarMediaId: json.id } : { bannerMediaId: json.id });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
      // Cleared so re-picking the SAME file fires a change event again.
      const input = slot === 'avatar' ? avatarInput.current : bannerInput.current;
      if (input !== null) input.value = '';
    }
  }

  async function save(extra: Record<string, unknown> = {}) {
    if (sig === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiCall<{ signature: SignatureView }>('PUT', '/v1/forum/signature', {
        body: {
          tagline: sig.tagline,
          bannerUrl: sig.bannerLink,
          bannerLabel: sig.bannerLabel,
          accent: sig.accent,
          showRank: sig.showRank,
          showCommander: sig.showCommander,
          enabled: sig.enabled,
          ...extra,
        },
      });
      setSig(res.signature);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (sig === null) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        {error ?? 'Loading your signature…'}
      </p>
    );
  }

  const linkLooksWrong = sig.bannerLink !== null && !isAllowedSignatureLink(sig.bannerLink);

  return (
    <div className="space-y-8">
      {/* ── the live preview ─────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
          PREVIEW
        </h2>
        <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
          <div className="flex items-center gap-3">
            <img
              src={sig.avatarUrl ?? discordAvatarUrl ?? ''}
              alt=""
              width={40}
              height={40}
              className="size-10 rounded-full object-cover"
            />
            <span className="text-sm text-[var(--color-text-primary)]">Your post</span>
          </div>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            This is roughly how a post of yours will look.
          </p>
          {/* The REAL component, not a copy of it. See the note at the top. */}
          <SignatureBlock signature={sig} />
        </div>
      </section>

      {/* ── avatar ───────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
          FORUM AVATAR
        </h2>
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {/*
            Says exactly what it does and does not do. Somebody uploading a picture on a settings
            page will assume it is THE picture unless told otherwise — and finding out by seeing
            their Discord photo unchanged on the roster is a worse way to learn it.
          */}
          This picture is used on the forums only. Your Discord photo stays as it is everywhere
          else, and keeps updating when you change it on Discord.
        </p>
        <div className="flex items-center gap-4">
          <img
            src={sig.avatarUrl ?? discordAvatarUrl ?? ''}
            alt=""
            width={56}
            height={56}
            className="size-14 rounded-full object-cover"
          />
          <input
            ref={avatarInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={saving}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) void upload(file, 'avatar');
            }}
            className="text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded file:border file:border-[var(--color-border-hairline)] file:bg-[var(--color-surface-panel-sunken)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--color-text-primary)]"
          />
          {sig.avatarUrl !== null && sig.avatarUrl !== discordAvatarUrl && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save({ avatarMediaId: null })}
              className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              USE MY DISCORD PHOTO
            </button>
          )}
        </div>
      </section>

      {/* ── tagline ──────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <label
          htmlFor="sig-tagline"
          className="block font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]"
        >
          TAGLINE
        </label>
        <input
          id="sig-tagline"
          type="text"
          value={sig.tagline ?? ''}
          maxLength={SIGNATURE_TAGLINE_MAX}
          onChange={(e) => patch({ tagline: e.target.value === '' ? null : e.target.value })}
          placeholder="o7 — Blood Brothers from Alrai"
          className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        />
        <p className="text-xs text-[var(--color-text-secondary)]">
          {(sig.tagline ?? '').length}/{SIGNATURE_TAGLINE_MAX}
        </p>
      </section>

      {/* ── banner ───────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
          BANNER
        </h2>
        <input
          ref={bannerInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={saving}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void upload(file, 'banner');
          }}
          className="text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded file:border file:border-[var(--color-border-hairline)] file:bg-[var(--color-surface-panel-sunken)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--color-text-primary)]"
        />

        <div className="space-y-2">
          <label htmlFor="sig-link" className="block text-sm text-[var(--color-text-primary)]">
            Where the banner goes when somebody clicks it
          </label>
          <input
            id="sig-link"
            type="url"
            value={sig.bannerLink ?? ''}
            onChange={(e) => patch({ bannerLink: e.target.value === '' ? null : e.target.value })}
            placeholder="https://inara.cz/elite/cmdr/…"
            aria-describedby="sig-link-hosts"
            className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          />
          <p id="sig-link-hosts" className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {/*
              The allowed hosts are LISTED, not hidden behind a rejection. Somebody pasting their
              Twitch channel and being told "invalid link" will try three variations and then
              report it as broken.
            */}
            Your commander page or your stream: {SIGNATURE_LINK_HOSTS.join(', ')}. Has to start with
            https.
          </p>
          {linkLooksWrong && (
            <p className="text-xs text-[var(--color-brand-orange-bright)]">
              That is not one of the sites above, so it will be refused when you save.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="sig-label" className="block text-sm text-[var(--color-text-primary)]">
            What the link says
          </label>
          <input
            id="sig-label"
            type="text"
            value={sig.bannerLabel ?? ''}
            maxLength={SIGNATURE_LABEL_MAX}
            onChange={(e) => patch({ bannerLabel: e.target.value === '' ? null : e.target.value })}
            placeholder="CMDR Grim on Inara"
            className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          />
        </div>

        {sig.bannerUrl !== null && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save({ bannerMediaId: null })}
            className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            REMOVE BANNER IMAGE
          </button>
        )}
      </section>

      {/* ── accent ───────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
          COLOUR
        </h2>
        <div className="flex flex-wrap gap-2">
          {SIGNATURE_ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={sig.accent === a}
              onClick={() => patch({ accent: a })}
              className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                sig.accent === a
                  ? 'border-[var(--color-border-active)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {ACCENT_LABEL[a]}
            </button>
          ))}
        </div>
      </section>

      {/* ── switches ─────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <Toggle
          label="Show my signature under my posts"
          checked={sig.enabled}
          onChange={(v) => patch({ enabled: v })}
        />
        <Toggle
          label="Show my squadron rank"
          checked={sig.showRank}
          onChange={(v) => patch({ showRank: v })}
        />
        <Toggle
          label="Show my commander name"
          checked={sig.showCommander}
          onChange={(v) => patch({ showCommander: v })}
        />
      </section>

      {error !== null && (
        <p role="alert" className="text-sm text-[var(--color-brand-orange-bright)]">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save signature'}
        </button>
        {saved && <span className="text-sm text-[var(--color-semantic-success)]">Saved.</span>}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-[var(--color-text-primary)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--color-brand-orange)]"
      />
      {label}
    </label>
  );
}
