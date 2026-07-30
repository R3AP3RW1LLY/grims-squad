'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  BANNER,
  BANNER_ANCHORS,
  BANNER_BACKGROUNDS,
  BANNER_LIMITS,
  BANNER_TEXT_SOURCES,
  defaultBannerSpec,
  type BannerAnchor,
  type BannerLayer,
  type BannerSpec,
} from '@grims/shared/forum-signature';
import { BannerRender, type BannerIdentity } from '../../../../components/forum/banner-render';

/**
 * Building a banner.
 *
 * ★ THE PREVIEW IS NOT A PREVIEW ★
 *
 * It is the real `BannerRender`, fed the real spec — the same component the forum uses and the same
 * one the PNG is rasterised from. Because it is live SVG rather than a redrawn picture, changing a
 * slider updates it in the same frame: there is no render pass to schedule, no round trip, and
 * nothing to debounce. That is what "realtime" costs here, which is nothing.
 *
 * The asynchronous part is the only part that genuinely is: an uploaded background is a network
 * fetch, so it appears when it arrives while everything else stays interactive.
 *
 * ★ WHY NOT DRAG-AND-DROP POSITIONING ★
 *
 * Because the text is not fixed. A layer says "my rank", and that renders as "Cadet" today and
 * "Chief Fleet Commander" after a promotion — a hand-placed layout tuned against the short one
 * breaks against the long one, silently, months later. Nine anchors keep every arrangement aligned
 * to the same grid whatever the words turn out to be.
 */

const ANCHOR_LABEL: Record<BannerAnchor, string> = {
  'top-left': '↖',
  'top-center': '↑',
  'top-right': '↗',
  'middle-left': '←',
  'middle-center': '•',
  'middle-right': '→',
  'bottom-left': '↙',
  'bottom-center': '↓',
  'bottom-right': '↘',
};

const SOURCE_LABEL: Record<string, string> = {
  commander: 'My CMDR name',
  rank: 'My rank',
  squadron: 'Squadron name',
  custom: 'My own words',
};

const BACKGROUND_LABEL: Record<string, string> = {
  solid: 'Solid',
  gradient: 'Gradient',
  starfield: 'Starfield',
  image: 'My image',
};

const PALETTE = ['dark', 'orange', 'cyan', 'gold', 'steel'] as const;
const TEXT_PALETTE = ['light', 'dark', 'orange', 'cyan', 'gold', 'steel'] as const;

export function BannerGenerator({
  spec,
  onChange,
  who,
  imageHref,
  onPickImage,
  busy,
}: {
  readonly spec: BannerSpec | null;
  readonly onChange: (next: BannerSpec | null) => void;
  readonly who: BannerIdentity;
  /** The uploaded background, once it exists. Async — it appears when it arrives. */
  readonly imageHref?: string;
  readonly onPickImage: (file: File) => void;
  readonly busy: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = spec !== null;

  const set = useCallback(
    (patch: Partial<BannerSpec>) => {
      onChange({ ...(spec ?? defaultBannerSpec()), ...patch });
    },
    [spec, onChange],
  );

  const setLayer = useCallback(
    (index: number, patch: Partial<BannerLayer>) => {
      const current = spec ?? defaultBannerSpec();
      const layers = current.layers.map((l, i) =>
        i === index ? ({ ...l, ...patch } as BannerLayer) : l,
      );
      onChange({ ...current, layers });
    },
    [spec, onChange],
  );

  /**
   * Rasterises the live SVG to a PNG the member can keep.
   *
   * ★ THE BROWSER DOES THE DRAWING, NOT THE SERVER ★
   *
   * The SVG on screen is serialised, drawn to a canvas at 2× for a crisp file, and exported. It
   * therefore uses the same font rendering the member has been looking at all along.
   *
   * A server-side rasteriser would have used whatever fonts the container happened to have
   * installed, and the first bug report would have been "the download does not match the preview" —
   * with no good answer, because both would be behaving correctly.
   */
  const download = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const node = document.getElementById('banner-preview')?.querySelector('svg');
      if (node === null || node === undefined) throw new Error('Nothing to download yet.');

      const clone = node.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('width', String(BANNER.width));
      clone.setAttribute('height', String(BANNER.height));

      /*
       * Any <image> has to be INLINED as a data URI first. A canvas drawn from an SVG that
       * references a URL — even a same-origin one — is tainted, and `toBlob` then throws a security
       * error. This is the one part of the export that genuinely needs to be asynchronous.
       */
      const images = Array.from(clone.querySelectorAll('image'));
      await Promise.all(
        images.map(async (img) => {
          const href = img.getAttribute('href') ?? img.getAttribute('xlink:href');
          if (href === null || href.startsWith('data:')) return;
          const res = await fetch(href, { credentials: 'same-origin' });
          const blob = await res.blob();
          const dataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('Could not read that image.'));
            reader.readAsDataURL(blob);
          });
          img.setAttribute('href', dataUri);
          img.removeAttribute('xlink:href');
        }),
      );

      const svgText = new XMLSerializer().serializeToString(clone);
      const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not draw that banner.'));
        el.src = svgUrl;
      });

      // 2× so it stays sharp if anybody views it on a high-density screen or scales it up a little.
      const canvas = document.createElement('canvas');
      canvas.width = BANNER.width * 2;
      canvas.height = BANNER.height * 2;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('Your browser would not give us a canvas.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob === null) throw new Error('Could not make a PNG out of that.');

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'signature-banner.png';
      a.click();
      // Revoked, or the blob is held in memory until the tab closes.
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }, []);

  const preview = useMemo(
    () => (
      <BannerRender
        spec={spec ?? defaultBannerSpec()}
        who={who}
        width={BANNER.width}
        className="max-w-full"
        {...(imageHref === undefined ? {} : { imageHref })}
      />
    ),
    [spec, who, imageHref],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
          BANNER
        </h2>
        {/*
          The size, in pixels, on the page — as asked. Stated as a fact about what gets made rather
          than as a rule somebody has to satisfy, because for a BUILT banner it is not a rule at
          all: the generator produces exactly this size every time.
        */}
        <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
          {BANNER.width} × {BANNER.height} px
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(active ? null : defaultBannerSpec())}
          className={`rounded border px-3 py-1.5 text-sm transition-colors ${
            active
              ? 'border-[var(--color-border-active)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
              : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {active ? 'Using a banner I built' : 'Build a banner'}
        </button>
        {active && (
          <button
            type="button"
            onClick={() => onChange(defaultBannerSpec())}
            className="rounded border border-[var(--color-border-hairline)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            Start again
          </button>
        )}
      </div>

      {!active ? (
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Build one here, or upload a finished image below. An uploaded banner needs to be at least{' '}
          <span className="font-mono text-[var(--color-text-primary)]">
            {BANNER.minUploadWidth} × {BANNER.minUploadHeight} px
          </span>{' '}
          — anything larger is cropped to fit {BANNER.width} × {BANNER.height}.
        </p>
      ) : (
        <>
          {/* ── live preview ───────────────────────────────────────────── */}
          <div
            id="banner-preview"
            className="overflow-x-auto rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-3"
          >
            {preview}
          </div>

          {/* ── background ─────────────────────────────────────────────── */}
          <Field label="Background">
            <div className="flex flex-wrap gap-2">
              {BANNER_BACKGROUNDS.map((b) => (
                <Chip
                  key={b}
                  active={(spec?.background ?? 'gradient') === b}
                  onClick={() => set({ background: b })}
                >
                  {BACKGROUND_LABEL[b] ?? b}
                </Chip>
              ))}
            </div>
          </Field>

          {spec?.background === 'image' ? (
            <Field label={`Your image — at least ${BANNER.minUploadWidth} × ${BANNER.minUploadHeight} px`}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file !== undefined) onPickImage(file);
                  e.target.value = '';
                }}
                className="text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded file:border file:border-[var(--color-border-hairline)] file:bg-[var(--color-surface-panel-sunken)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--color-text-primary)]"
              />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Colour">
                <div className="flex flex-wrap gap-2">
                  {PALETTE.map((c) => (
                    <Chip
                      key={c}
                      active={spec?.colourA === c}
                      onClick={() => set({ colourA: c })}
                    >
                      {c}
                    </Chip>
                  ))}
                </div>
              </Field>
              {spec?.background === 'gradient' && (
                <Field label="Fading to">
                  <div className="flex flex-wrap gap-2">
                    {PALETTE.map((c) => (
                      <Chip key={c} active={spec.colourB === c} onClick={() => set({ colourB: c })}>
                        {c}
                      </Chip>
                    ))}
                  </div>
                </Field>
              )}
            </div>
          )}

          <Field label={`Darken the background — ${spec?.dim ?? 0}%`}>
            {/*
              Only useful over a picture, so it only appears over one. A slider that does nothing
              visible is a control people fiddle with and then distrust.
            */}
            <input
              type="range"
              min={0}
              max={BANNER_LIMITS.maxDim}
              value={spec?.dim ?? 0}
              onChange={(e) => set({ dim: Number(e.target.value) })}
              className="w-full accent-[var(--color-brand-orange)]"
            />
          </Field>

          {/* ── layers ─────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
                LAYERS
              </span>
              <span className="flex gap-2">
                <SmallButton
                  disabled={(spec?.layers.length ?? 0) >= BANNER_LIMITS.maxLayers}
                  onClick={() =>
                    set({
                      layers: [
                        ...(spec?.layers ?? []),
                        {
                          kind: 'text',
                          source: 'custom',
                          text: 'o7',
                          anchor: 'bottom-right',
                          size: 14,
                          bold: false,
                          colour: 'light',
                          mono: true,
                        },
                      ],
                    })
                  }
                >
                  + TEXT
                </SmallButton>
                <SmallButton
                  disabled={(spec?.layers.length ?? 0) >= BANNER_LIMITS.maxLayers}
                  onClick={() =>
                    set({
                      layers: [
                        ...(spec?.layers ?? []),
                        { kind: 'badge', badge: 'squadron', anchor: 'middle-right', size: 64 },
                      ],
                    })
                  }
                >
                  + BADGE
                </SmallButton>
              </span>
            </div>

            {(spec?.layers ?? []).map((layer, i) => (
              <div
                key={i}
                className="space-y-3 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {layer.kind === 'badge' ? 'BADGE' : 'TEXT'}
                  </span>
                  <SmallButton
                    onClick={() =>
                      set({ layers: (spec?.layers ?? []).filter((_, j) => j !== i) })
                    }
                  >
                    REMOVE
                  </SmallButton>
                </div>

                {layer.kind === 'text' && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {BANNER_TEXT_SOURCES.map((src) => (
                        <Chip
                          key={src}
                          active={layer.source === src}
                          onClick={() => setLayer(i, { source: src })}
                        >
                          {SOURCE_LABEL[src] ?? src}
                        </Chip>
                      ))}
                    </div>

                    {layer.source === 'custom' && (
                      <input
                        type="text"
                        value={layer.text ?? ''}
                        maxLength={BANNER_LIMITS.maxCustomText}
                        onChange={(e) => setLayer(i, { text: e.target.value })}
                        aria-label="Banner text"
                        className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
                      />
                    )}

                    <div className="flex flex-wrap gap-2">
                      {TEXT_PALETTE.map((c) => (
                        <Chip
                          key={c}
                          active={layer.colour === c}
                          onClick={() => setLayer(i, { colour: c })}
                        >
                          {c}
                        </Chip>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
                        <input
                          type="checkbox"
                          checked={layer.bold}
                          onChange={(e) => setLayer(i, { bold: e.target.checked })}
                          className="size-4 accent-[var(--color-brand-orange)]"
                        />
                        Bold
                      </label>
                      <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
                        <input
                          type="checkbox"
                          checked={layer.mono}
                          onChange={(e) => setLayer(i, { mono: e.target.checked })}
                          className="size-4 accent-[var(--color-brand-orange)]"
                        />
                        Console style
                      </label>
                    </div>
                  </>
                )}

                <label className="block text-xs text-[var(--color-text-secondary)]">
                  Size — {layer.size}px
                  <input
                    type="range"
                    min={
                      layer.kind === 'badge'
                        ? BANNER_LIMITS.minBadgeSize
                        : BANNER_LIMITS.minTextSize
                    }
                    max={
                      layer.kind === 'badge'
                        ? BANNER_LIMITS.maxBadgeSize
                        : BANNER_LIMITS.maxTextSize
                    }
                    value={layer.size}
                    onChange={(e) => setLayer(i, { size: Number(e.target.value) })}
                    className="mt-1 w-full accent-[var(--color-brand-orange)]"
                  />
                </label>

                <div>
                  <span className="mb-1 block text-xs text-[var(--color-text-secondary)]">
                    Position
                  </span>
                  <div className="grid w-fit grid-cols-3 gap-1">
                    {BANNER_ANCHORS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        aria-label={a.replace('-', ' ')}
                        aria-pressed={layer.anchor === a}
                        onClick={() => setLayer(i, { anchor: a })}
                        className={`size-8 rounded border text-sm transition-colors ${
                          layer.anchor === a
                            ? 'border-[var(--color-border-active)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
                            : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                        }`}
                      >
                        {ANCHOR_LABEL[a]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {error !== null && (
            <p role="alert" className="text-sm text-[var(--color-brand-orange-bright)]">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void download()}
            disabled={downloading}
            className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)] disabled:opacity-50"
          >
            {downloading ? 'Making the file…' : 'Download PNG'}
          </button>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-2 block text-xs text-[var(--color-text-secondary)]">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded border px-2.5 py-1 text-xs capitalize transition-colors ${
        active
          ? 'border-[var(--color-border-active)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
          : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

function SmallButton({
  onClick,
  disabled = false,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
