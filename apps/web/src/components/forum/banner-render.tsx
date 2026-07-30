import {
  BANNER,
  type BannerAnchor,
  type BannerLayer,
  type BannerSpec,
} from '@grims/shared/forum-signature';

/**
 * The banner, drawn.
 *
 * ★ ONE RENDERER, THREE USES ★
 *
 * This same component draws the live preview in the generator, the banner under every forum post,
 * and — via canvas — the PNG somebody downloads.
 *
 * That is the whole architectural decision. The obvious build has a CSS preview in the editor and
 * a separate server-side rasteriser for the file, and those two eventually disagree: somebody
 * designs a banner that looks right in settings and wrong under their posts, and cannot tell which
 * one lied to them. One function means there is nothing to disagree with.
 *
 * ★ SVG, NOT CANVAS OR DIVS ★
 *
 * SVG is the only one of the three that is simultaneously a live DOM node (so the preview updates
 * instantly as a slider moves, with no redraw code), scalable (so it stays sharp on a retina
 * screen), and rasterisable by the browser into a PNG at any size.
 *
 * The download therefore uses the BROWSER's font rendering, which is the same rendering the member
 * has been looking at. A server-side rasteriser would have used whatever fonts the container
 * happened to have — and the first report would be "the download does not match the preview".
 *
 * ★ EVERY VALUE IS ESCAPED BY REACT ★
 *
 * Text layers carry member input. It is rendered as SVG `<text>` children, which React escapes
 * exactly as it does HTML. There is no string concatenation into markup anywhere in this file, and
 * there must never be: a hand-built SVG string is an injection surface wearing a different hat.
 */

/** Palette → real colour. The same tokens the rest of the site uses, resolved for SVG. */
const COLOUR: Record<string, string> = {
  orange: '#ff7100',
  cyan: '#5cd9ff',
  gold: '#ffc400',
  steel: '#93a4b8',
  light: '#e8eef5',
  dark: '#0b0f14',
};

/** Anchor → x/y and the SVG text-anchor that goes with it. */
function place(anchor: BannerAnchor, pad = 16): {
  x: number;
  y: number;
  textAnchor: 'start' | 'middle' | 'end';
  baseline: 'hanging' | 'middle' | 'auto';
} {
  const [vertical, horizontal] = anchor.split('-') as ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'];

  const x = horizontal === 'left' ? pad : horizontal === 'center' ? BANNER.width / 2 : BANNER.width - pad;
  const y = vertical === 'top' ? pad : vertical === 'middle' ? BANNER.height / 2 : BANNER.height - pad;

  return {
    x,
    y,
    textAnchor: horizontal === 'left' ? 'start' : horizontal === 'center' ? 'middle' : 'end',
    baseline: vertical === 'top' ? 'hanging' : vertical === 'middle' ? 'middle' : 'auto',
  };
}

/**
 * A deterministic starfield.
 *
 * ★ SEEDED, NOT RANDOM ★
 *
 * `Math.random()` here would produce a different sky on every render — the preview would shimmer
 * as sliders move, the server render would not match the client one, and React would report a
 * hydration mismatch on every page with a banner on it.
 *
 * A tiny integer hash keyed on nothing but the index gives the same sky forever, which is what a
 * background is supposed to be.
 */
function stars(count = 90): Array<{ cx: number; cy: number; r: number; o: number }> {
  const out: Array<{ cx: number; cy: number; r: number; o: number }> = [];
  let seed = 0x9e3779b9;
  const next = (): number => {
    // xorshift32 — small, fast, and identical on every platform that runs it.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0xffffffff;
  };
  for (let i = 0; i < count; i += 1) {
    out.push({
      cx: Math.round(next() * BANNER.width),
      cy: Math.round(next() * BANNER.height),
      r: next() < 0.85 ? 0.7 : 1.4,
      o: 0.25 + next() * 0.6,
    });
  }
  return out;
}

const STARS = stars();

export interface BannerIdentity {
  readonly commander: string | null;
  readonly rank: string | null;
  readonly squadron: string;
}

/** What a text layer actually says, resolved now rather than when it was saved. */
function textOf(layer: Extract<BannerLayer, { kind: 'text' }>, who: BannerIdentity): string {
  switch (layer.source) {
    case 'commander':
      // Falls back rather than rendering an empty layer — an unverified member still gets a banner.
      return who.commander === null ? 'CMDR' : `CMDR ${who.commander}`;
    case 'rank':
      return who.rank ?? '';
    case 'squadron':
      return who.squadron;
    default:
      return layer.text ?? '';
  }
}

export function BannerRender({
  spec,
  who,
  /** Rendered width. The viewBox keeps the geometry at 600×120 whatever this is. */
  width = BANNER.width,
  className,
  /** Set for the download path, where the image must be inlined rather than fetched. */
  imageHref,
  badgeHref,
}: {
  readonly spec: BannerSpec;
  readonly who: BannerIdentity;
  readonly width?: number;
  readonly className?: string;
  readonly imageHref?: string;
  readonly badgeHref?: string;
}) {
  const a = COLOUR[spec.colourA] ?? COLOUR.dark;
  const b = COLOUR[spec.colourB] ?? COLOUR.orange;

  /*
   * A per-instance id for the gradient. Two banners on one page both defining `#bannerFill` would
   * make the second silently steal the first's fill — the classic SVG-in-a-list bug.
   */
  const gradientId = `bg-${spec.colourA}-${spec.colourB}-${spec.background}`;

  const bg =
    spec.background === 'image' && (imageHref ?? '') !== '' ? (
      <image
        href={imageHref}
        x={0}
        y={0}
        width={BANNER.width}
        height={BANNER.height}
        preserveAspectRatio="xMidYMid slice"
      />
    ) : spec.background === 'starfield' ? (
      <>
        <rect x={0} y={0} width={BANNER.width} height={BANNER.height} fill={COLOUR.dark} />
        {STARS.map((s, i) => (
          <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="#ffffff" opacity={s.o} />
        ))}
      </>
    ) : spec.background === 'solid' ? (
      <rect x={0} y={0} width={BANNER.width} height={BANNER.height} fill={a} />
    ) : (
      <rect x={0} y={0} width={BANNER.width} height={BANNER.height} fill={`url(#${gradientId})`} />
    );

  return (
    <svg
      viewBox={`0 0 ${BANNER.width} ${BANNER.height}`}
      width={width}
      height={(width / BANNER.width) * BANNER.height}
      className={className}
      /* Announced by its purpose, not by its contents — the text is decorative repetition here. */
      role="img"
      aria-label="Signature banner"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
      </defs>

      {bg}

      {/*
        The dimming veil sits between background and layers, so it darkens the picture WITHOUT
        washing out the text on top. Applied to the whole rect rather than per-layer: a member
        adjusting readability is thinking about the image, not about each caption.
      */}
      {spec.dim > 0 && (
        <rect
          x={0}
          y={0}
          width={BANNER.width}
          height={BANNER.height}
          fill="#000000"
          opacity={spec.dim / 100}
        />
      )}

      {spec.layers.map((layer, i) => {
        const p = place(layer.anchor);

        if (layer.kind === 'badge') {
          // Anchored so the badge is CENTRED on its point rather than hanging off it.
          const half = layer.size / 2;
          const bx = p.textAnchor === 'start' ? p.x : p.textAnchor === 'middle' ? p.x - half : p.x - layer.size;
          const by = p.baseline === 'hanging' ? p.y : p.baseline === 'middle' ? p.y - half : p.y - layer.size;
          return (
            <image
              key={i}
              /*
               * The transparent variant, so a badge on a gradient does not arrive inside a black
               * square. 512px scaled down rather than the 64px asset scaled up — a badge at 96px
               * from a 64px source is visibly soft on the exact screens people care about.
               */
              href={badgeHref ?? '/brand/badge-512-transparent.png'}
              x={bx}
              y={by}
              width={layer.size}
              height={layer.size}
              opacity={0.95}
            />
          );
        }

        const value = textOf(layer, who);
        if (value === '') return null;

        return (
          <text
            key={i}
            x={p.x}
            y={p.y}
            textAnchor={p.textAnchor}
            dominantBaseline={p.baseline}
            fontSize={layer.size}
            fontWeight={layer.bold ? 700 : 400}
            fill={COLOUR[layer.colour] ?? COLOUR.light}
            fontFamily={
              layer.mono
                ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
                : 'system-ui, -apple-system, Segoe UI, sans-serif'
            }
            letterSpacing={layer.mono ? layer.size * 0.18 : 0}
            /*
              A shadow, always. Text over a member-supplied screenshot is otherwise legible or not
              depending on what they uploaded, and "my name disappeared" is a bug report we would
              have no answer to.
            */
            style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 3 }}
          >
            {value}
          </text>
        );
      })}
    </svg>
  );
}
