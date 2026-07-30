'use client';

import { useCallback, useState } from 'react';
import {
  BANNER,
  BANNER_ALIGNS,
  BANNER_BACKGROUNDS,
  BANNER_LIMITS,
  BANNER_PALETTE,
  BANNER_ROWS,
  BANNER_SOURCE_LABELS,
  BANNER_TEXT_SOURCES,
  HEX_COLOUR,
  defaultBannerSpec,
  signatureBBCode,
  signatureHtml,
  signatureMarkdown,
  type BannerAlign,
  type BannerLayer,
  type BannerRow,
  type BannerSpec,
  type BannerTextSource,
} from '@grims/shared/forum-signature';

/**
 * Building a banner — the CONTROLS half.
 *
 * ★ THE PREVIEW LIVES IN THE OTHER COLUMN ★
 *
 * Squadron owner, 2026-07-30: "with the post header and banner generators always visible in
 * realtime", and then "we need to utilize more of the page, can we make this two colums".
 *
 * So the preview moved OUT of this component and into `SignatureEditor`, which owns both columns.
 * That is not just layout: there is now ONE preview of the whole signature — avatar, banner,
 * tagline — rather than a banner preview here and a signature preview elsewhere, which were two
 * views of the same thing that could disagree about what it looked like.
 *
 * `rasterise` still finds the SVG by id, so the download and the publish both draw exactly what is
 * on screen.
 *
 * ★ THREE ROWS RATHER THAN FREE POSITIONING ★
 *
 * A layer says "my Combat rank", which reads "Harmless" today and "Elite V" later. A hand-placed
 * layout tuned against the short one breaks against the long one, silently. Rows reflow: layers
 * sharing a line pack side by side, so adding a fourth rank pushes the others along instead of
 * landing on top of them.
 */

const BACKGROUND_LABEL: Record<string, string> = {
  solid: 'Solid',
  gradient: 'Gradient',
  starfield: 'Starfield',
  image: 'My image',
};

/** Reads the CSRF cookie. The name is `gs_csrf`, not `csrf` — see `image-uploader`. */
function readCsrfCookie(): string {
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  return '';
}

export function BannerGenerator({
  spec,
  onChange,
  onPickImage,
  busy,
  onPublish,
  publishedUrl,
  link,
  tagline,
}: {
  readonly spec: BannerSpec | null;
  readonly onChange: (next: BannerSpec | null) => void;
  readonly onPickImage: (file: File) => void;
  readonly busy: boolean;
  readonly onPublish: (mediaId: string) => Promise<void>;
  readonly publishedUrl: string | null;
  readonly link: string | null;
  readonly tagline: string | null;
}) {
  const [downloading, setDownloading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = spec !== null;
  const current = spec ?? defaultBannerSpec();

  const set = useCallback(
    (patch: Partial<BannerSpec>) => onChange({ ...current, ...patch }),
    [current, onChange],
  );

  const setLayer = useCallback(
    (index: number, patch: Partial<BannerLayer>) =>
      onChange({
        ...current,
        layers: current.layers.map((l, i) =>
          i === index ? ({ ...l, ...patch } as BannerLayer) : l,
        ),
      }),
    [current, onChange],
  );

  const removeLayer = useCallback(
    (index: number) => onChange({ ...current, layers: current.layers.filter((_, i) => i !== index) }),
    [current, onChange],
  );

  const addLayer = useCallback(
    (layer: BannerLayer) => onChange({ ...current, layers: [...current.layers, layer] }),
    [current, onChange],
  );

  /**
   * Rasterises the live SVG to a PNG.
   *
   * ★ THE BROWSER DRAWS IT, NOT THE SERVER ★
   *
   * The SVG on screen is serialised, drawn to a canvas at 2×, and exported — so it uses the same
   * font rendering the member has been looking at. A server-side rasteriser would use whatever
   * fonts the container happened to have, and a download that differs from the preview is a bug
   * nobody can diagnose from either end.
   */
  const rasterise = useCallback(async (): Promise<Blob> => {
    const node = document.getElementById('banner-preview')?.querySelector('svg');
    if (node === null || node === undefined) throw new Error('Nothing to render yet.');

    const clone = node.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(BANNER.width));
    clone.setAttribute('height', String(BANNER.height));

    /*
     * Any <image> has to be INLINED as a data URI first. A canvas drawn from an SVG that references
     * a URL — even a same-origin one — is tainted, and `toBlob` then throws a security error. This
     * is the one part of the export that genuinely needs to be asynchronous.
     */
    await Promise.all(
      Array.from(clone.querySelectorAll('image')).map(async (img) => {
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
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not draw that banner.'));
      el.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    });

    // 2× so it stays sharp on a high-density screen or scaled up a little.
    const canvas = document.createElement('canvas');
    canvas.width = BANNER.width * 2;
    canvas.height = BANNER.height * 2;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('Your browser would not give us a canvas.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob === null) throw new Error('Could not make a PNG out of that.');
    return blob;
  }, []);

  const download = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const blob = await rasterise();
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
  }, [rasterise]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setError(null);
    try {
      const blob = await rasterise();
      const res = await fetch('/v1/media/uploads', {
        method: 'POST',
        body: blob,
        headers: { 'content-type': 'image/png', 'x-csrf-token': readCsrfCookie() },
        credentials: 'same-origin',
      });
      const json = (await res.json()) as { id?: string; error?: { message?: string } };
      if (!res.ok || typeof json.id !== 'string') {
        throw new Error(json.error?.message ?? 'That did not upload.');
      }
      await onPublish(json.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }, [rasterise, onPublish]);

  return (
    <div className="space-y-6">
      {/* ── on / off ────────────────────────────────────────────────────── */}
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
          {/* ── background ───────────────────────────────────────────────── */}
          <Section title="BACKGROUND">
            <div className="flex flex-wrap gap-2">
              {BANNER_BACKGROUNDS.map((b) => (
                <Chip
                  key={b}
                  active={current.background === b}
                  onClick={() => set({ background: b })}
                >
                  {BACKGROUND_LABEL[b] ?? b}
                </Chip>
              ))}
            </div>

            {current.background === 'image' ? (
              <div className="mt-3 space-y-2">
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
                <p className="text-xs text-[var(--color-text-secondary)]">
                  At least{' '}
                  <span className="font-mono text-[var(--color-text-primary)]">
                    {BANNER.minUploadWidth} × {BANNER.minUploadHeight} px
                  </span>
                  . Cropped to fill {BANNER.width} × {BANNER.height}.
                </p>
              </div>
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <ColourPicker
                  label={current.background === 'gradient' ? 'From' : 'Colour'}
                  value={current.colourA}
                  onChange={(v) => set({ colourA: v })}
                />
                {current.background === 'gradient' && (
                  <ColourPicker
                    label="To"
                    value={current.colourB}
                    onChange={(v) => set({ colourB: v })}
                  />
                )}
              </div>
            )}

            <label className="mt-4 block text-xs text-[var(--color-text-secondary)]">
              Darken the background — {current.dim}%
              <input
                type="range"
                min={0}
                max={BANNER_LIMITS.maxDim}
                value={current.dim}
                onChange={(e) => set({ dim: Number(e.target.value) })}
                className="mt-1 w-full accent-[var(--color-brand-orange)]"
              />
            </label>
          </Section>

          {/* ── the three lines ──────────────────────────────────────────── */}
          {BANNER_ROWS.map((row) => (
            <Section key={row} title={`LINE ${row}`}>
              <RowEditor
                row={row}
                spec={current}
                onSetLayer={setLayer}
                onRemove={removeLayer}
                onAdd={addLayer}
              />
            </Section>
          ))}

          {error !== null && (
            <p role="alert" className="text-sm text-[var(--color-brand-orange-bright)]">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void download()}
              disabled={downloading}
              className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)] disabled:opacity-50"
            >
              {downloading ? 'Making the file…' : 'Download PNG'}
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={publishing}
              className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)] disabled:opacity-50"
            >
              {publishing
                ? 'Publishing…'
                : publishedUrl === null
                  ? 'Publish for other forums'
                  : 'Publish my changes'}
            </button>
          </div>

          <ShareCodes
            publishedUrl={publishedUrl}
            link={link}
            tagline={tagline}
            copied={copied}
            onCopied={setCopied}
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- one line */

function RowEditor({
  row,
  spec,
  onSetLayer,
  onRemove,
  onAdd,
}: {
  readonly row: BannerRow;
  readonly spec: BannerSpec;
  readonly onSetLayer: (index: number, patch: Partial<BannerLayer>) => void;
  readonly onRemove: (index: number) => void;
  readonly onAdd: (layer: BannerLayer) => void;
}) {
  /*
   * Indices into the FULL layer list, not into a filtered copy. Editing a filtered array and
   * writing it back is how the wrong layer gets changed the moment somebody has two lines in use.
   */
  const entries = spec.layers
    .map((layer, index) => ({ layer, index }))
    .filter((e) => e.layer.row === row);

  const full = spec.layers.length >= BANNER_LIMITS.maxLayers;

  return (
    <div className="space-y-3">
      {entries.length === 0 && (
        <p className="text-xs text-[var(--color-text-secondary)]">Nothing on this line yet.</p>
      )}

      {entries.map(({ layer, index }) => (
        <div
          key={index}
          className="space-y-3 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
              {layer.kind === 'badge' ? 'BADGE' : BANNER_SOURCE_LABELS[layer.source].toUpperCase()}
            </span>
            <span className="flex items-center gap-2">
              {/* Moving between lines is a row change, so it belongs here rather than in a menu. */}
              {BANNER_ROWS.filter((r) => r !== layer.row).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onSetLayer(index, { row: r })}
                  className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                >
                  &rarr; LINE {r}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-brand-orange-bright)]"
              >
                REMOVE
              </button>
            </span>
          </div>

          {layer.kind === 'text' && (
            <>
              <label className="block text-xs text-[var(--color-text-secondary)]">
                Shows
                <select
                  value={layer.source}
                  onChange={(e) => onSetLayer(index, { source: e.target.value as BannerTextSource })}
                  className="mt-1 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                >
                  {BANNER_TEXT_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {BANNER_SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>

              {layer.source === 'custom' ? (
                <input
                  type="text"
                  value={layer.text ?? ''}
                  maxLength={BANNER_LIMITS.maxCustomText}
                  onChange={(e) => onSetLayer(index, { text: e.target.value })}
                  aria-label="Banner text"
                  placeholder="Anything you like"
                  className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                />
              ) : (
                <input
                  type="text"
                  value={layer.label ?? ''}
                  maxLength={BANNER_LIMITS.maxLabel}
                  onChange={(e) => onSetLayer(index, { label: e.target.value })}
                  aria-label="Label before the value"
                  placeholder="Label before it, e.g. CMB"
                  className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                />
              )}

              <ColourPicker
                label="Colour"
                value={layer.colour}
                onChange={(v) => onSetLayer(index, { colour: v })}
              />

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={layer.bold}
                    onChange={(e) => onSetLayer(index, { bold: e.target.checked })}
                    className="size-4 accent-[var(--color-brand-orange)]"
                  />
                  Bold
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={layer.mono}
                    onChange={(e) => onSetLayer(index, { mono: e.target.checked })}
                    className="size-4 accent-[var(--color-brand-orange)]"
                  />
                  Console style
                </label>
              </div>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-[var(--color-text-secondary)]">
              Size &mdash; {layer.size}px
              <input
                type="range"
                min={layer.kind === 'badge' ? BANNER_LIMITS.minBadgeSize : BANNER_LIMITS.minTextSize}
                max={layer.kind === 'badge' ? BANNER_LIMITS.maxBadgeSize : BANNER_LIMITS.maxTextSize}
                value={layer.size}
                onChange={(e) => onSetLayer(index, { size: Number(e.target.value) })}
                className="mt-1 w-full accent-[var(--color-brand-orange)]"
              />
            </label>
            <div>
              <span className="mb-1 block text-xs text-[var(--color-text-secondary)]">Side</span>
              <div className="flex gap-1">
                {BANNER_ALIGNS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={layer.align === a}
                    onClick={() => onSetLayer(index, { align: a as BannerAlign })}
                    className={`flex-1 rounded border px-2 py-1 text-xs capitalize transition-colors ${
                      layer.align === a
                        ? 'border-[var(--color-border-active)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
                        : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={full}
          onClick={() =>
            onAdd({
              kind: 'text',
              source: 'custom',
              text: 'o7',
              row,
              align: 'left',
              size: 14,
              bold: false,
              colour: '#e8eef5',
              mono: true,
            })
          }
          className="rounded border border-[var(--color-border-hairline)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-40"
        >
          + TEXT
        </button>
        <button
          type="button"
          disabled={full}
          onClick={() => onAdd({ kind: 'badge', badge: 'squadron', row, align: 'right', size: 72 })}
          className="rounded border border-[var(--color-border-hairline)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-40"
        >
          + BADGE
        </button>
        {full && (
          <span className="self-center text-[11px] text-[var(--color-text-secondary)]">
            That is {BANNER_LIMITS.maxLayers} layers &mdash; the most a banner this size stays
            readable at.
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- controls */

/**
 * A colour, as a native picker plus a hex box plus swatches.
 *
 * ★ ALL THREE, BECAUSE THEY ANSWER DIFFERENT QUESTIONS ★
 *
 * Owner asked for "color pickers with hex code input". The swatches are the fast path for somebody
 * who just wants squadron orange; the picker is for choosing by eye; the hex box is for somebody
 * matching a colour they already have.
 *
 * The hex box keeps a DRAFT of what is typed and only commits a value that parses, so clearing it
 * to retype does not blank the banner mid-keystroke. The border turns warm while the draft is not
 * yet a colour, which is feedback rather than an error.
 */
function ColourPicker({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  return (
    <div>
      <span className="mb-1 block text-xs text-[var(--color-text-secondary)]">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour picker`}
          className="size-8 cursor-pointer rounded border border-[var(--color-border-hairline)] bg-transparent"
        />
        <input
          type="text"
          value={shown}
          spellCheck={false}
          aria-label={`${label} hex code`}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            if (HEX_COLOUR.test(next)) onChange(next.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
          className={`w-24 rounded border bg-[var(--color-surface-panel-sunken)] px-2 py-1 font-mono text-xs text-[var(--color-text-primary)] ${
            HEX_COLOUR.test(shown)
              ? 'border-[var(--color-border-hairline)]'
              : 'border-[var(--color-brand-orange-bright)]'
          }`}
        />
        <span className="flex flex-wrap gap-1">
          {BANNER_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => {
                setDraft(null);
                onChange(c);
              }}
              style={{ backgroundColor: c }}
              className={`size-5 rounded border transition-transform hover:scale-110 ${
                value === c
                  ? 'border-[var(--color-text-primary)]'
                  : 'border-[var(--color-border-hairline)]'
              }`}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-4">
      <h3 className="mb-3 font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
        {title}
      </h3>
      {children}
    </section>
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
      className={`rounded border px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'border-[var(--color-border-active)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
          : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------- share codes */

/**
 * The share codes, once a banner has been published.
 *
 * ★ WHY PUBLISHING IS A SEPARATE STEP ★
 *
 * A signature here is live: a layer saying "my Combat rank" is resolved when it is drawn, so a
 * promotion updates every banner the member has ever posted. BBCode cannot do that — `[img]` takes
 * a URL and shows a picture.
 *
 * So sharing means freezing, and the copy says so. Somebody promoted who does not re-publish has a
 * correct banner here and a stale one everywhere else, and finding that out from a squadmate is
 * worse than reading it now.
 */
function ShareCodes({
  publishedUrl,
  link,
  tagline,
  copied,
  onCopied,
}: {
  readonly publishedUrl: string | null;
  readonly link: string | null;
  readonly tagline: string | null;
  readonly copied: string | null;
  readonly onCopied: (which: string | null) => void;
}) {
  if (publishedUrl === null) {
    return (
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Publish it to get a BBCode block you can paste into other forums. Your banner here stays live
        and updates itself; a published copy is a snapshot, so re-publish after a promotion or a
        redesign.
      </p>
    );
  }

  const share = { bannerUrl: publishedUrl, link, tagline };

  const blocks: ReadonlyArray<{ key: string; label: string; hint: string; value: string }> = [
    {
      key: 'bbcode',
      label: 'BBCode',
      hint: 'Most forums — paste into your signature box.',
      value: signatureBBCode(share),
    },
    {
      key: 'markdown',
      label: 'Markdown',
      hint: 'Discord, GitHub, anywhere that speaks Markdown.',
      value: signatureMarkdown(share),
    },
    {
      key: 'html',
      label: 'HTML',
      hint: 'Forums that accept raw HTML.',
      value: signatureHtml(share),
    },
    { key: 'url', label: 'Image URL', hint: 'Just the picture.', value: publishedUrl },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
          SHARE IT ELSEWHERE
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          This is a snapshot taken when you published. Your banner here keeps updating on its own —
          the copy on another forum will not, so publish again after a promotion or a redesign.
        </p>
      </div>

      {blocks.map((b) => (
        <div key={b.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-xs text-[var(--color-text-primary)]">{b.label}</span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(b.value).then(
                  () => onCopied(b.key),
                  // Clipboard access can be refused. Saying nothing would look like a dead button.
                  () => onCopied(`${b.key}:failed`),
                );
              }}
              className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              {copied === b.key
                ? 'COPIED'
                : copied === `${b.key}:failed`
                  ? 'SELECT AND COPY'
                  : 'COPY'}
            </button>
          </div>
          <textarea
            readOnly
            rows={b.key === 'url' ? 1 : 2}
            value={b.value}
            aria-label={`${b.label} for your signature`}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-primary)]"
          />
          <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">{b.hint}</p>
        </div>
      ))}
    </div>
  );
}
