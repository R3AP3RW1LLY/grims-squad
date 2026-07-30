import {
  BANNER,
  BANNER_SOURCE_LABELS,
  type BannerAlign,
  type BannerLayer,
  type BannerRow,
  type BannerSpec,
  type BannerTextSource,
} from '@grims/shared/forum-signature';
import { fontStack } from '@grims/shared/fonts';

/**
 * The banner, drawn.
 *
 * ★ ONE RENDERER, THREE USES ★
 *
 * This same component draws the live preview in the generator, the banner under every forum post,
 * and — via canvas — the PNG somebody downloads or publishes.
 *
 * That is the architectural decision. The obvious build has a CSS preview in the editor and a
 * separate server-side rasteriser for the file, and those two eventually disagree: somebody designs
 * a banner that looks right in settings and wrong under their posts, and cannot tell which one
 * lied. One function means there is nothing to disagree with.
 *
 * ★ THREE ROWS, LAID OUT BY MEASUREMENT ★
 *
 * Layers belong to line 1, 2 or 3 and to a side. Several layers can share a line — three Elite
 * ranks side by side is the normal case — so each row is packed left to right from its alignment
 * point, with the widths ESTIMATED rather than measured.
 *
 * Estimated because measurement is not available where this has to work: the forum renders on the
 * server, where there is no DOM to measure text with. An estimate that is consistent everywhere
 * beats a measurement that only one of the three consumers can take.
 *
 * ★ EVERY VALUE IS ESCAPED BY REACT ★
 *
 * Text layers carry member input, rendered as SVG `<text>` children, which React escapes exactly as
 * it does HTML. There is no string concatenation into markup anywhere in this file and there must
 * never be — a hand-built SVG string is an injection surface wearing a different hat.
 */

/** Everything a banner can say about somebody. Absent values render as nothing, never as a gap. */
export interface BannerIdentity {
  readonly commander: string | null;
  readonly squadronRank: string | null;
  readonly squadron: string;
  readonly allegiance: string | null;
  /*
   * A loose record rather than a closed key set. The API fills it from stored Inara ranks, whose
   * ladder keys are data rather than a compile-time union — and a missing key resolves to nothing,
   * which is the same outcome as a key we do not recognise.
   */
  readonly ranks: Record<string, string | null>;
  readonly ship: string | null;
  readonly memberSince: string | null;
  readonly lastPlayed: string | null;
}

/** A blank identity, so a caller with nothing to say still renders a banner. */
export const EMPTY_IDENTITY: BannerIdentity = {
  commander: null,
  squadronRank: null,
  squadron: 'GRIM’S SQUAD',
  allegiance: null,
  ranks: {},
  ship: null,
  memberSince: null,
  lastPlayed: null,
};

/**
 * A deterministic starfield.
 *
 * ★ SEEDED, NOT RANDOM ★
 *
 * `Math.random()` would produce a different sky on every render — the preview would shimmer as
 * sliders move, the server render would not match the client one, and React would report a
 * hydration mismatch on every page with a banner on it.
 */
function stars(count = 110): Array<{ cx: number; cy: number; r: number; o: number }> {
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

/** What a text layer says right now, resolved rather than stored. */
export function textOf(
  layer: Extract<BannerLayer, { kind: 'text' }>,
  who: BannerIdentity,
): string {
  const value = ((): string | null => {
    switch (layer.source) {
      case 'commander':
        return who.commander === null ? null : `CMDR ${who.commander}`;
      case 'squadronRank':
        return who.squadronRank;
      case 'squadron':
        return who.squadron;
      case 'allegiance':
        return who.allegiance;
      case 'ship':
        return who.ship;
      case 'memberSince':
        return who.memberSince;
      case 'lastPlayed':
        return who.lastPlayed;
      case 'custom':
        return layer.text ?? null;
      default:
        return who.ranks[layer.source as keyof BannerIdentity['ranks']] ?? null;
    }
  })();

  if (value === null || value === '') return '';
  // The label is a prefix, not a separate layer: they move together or the banner stops making sense.
  return layer.label === undefined ? value : `${layer.label} ${value}`;
}

/**
 * Roughly how wide a string renders.
 *
 * ★ AN ESTIMATE, ON PURPOSE ★
 *
 * The forum renders this on the SERVER, where there is no DOM and no way to measure text. A layout
 * that measured in the browser and guessed on the server would put the same banner in two places
 * and have them disagree — which is the exact failure this whole component exists to avoid.
 *
 * So both sides guess, identically. 0.58em per character is close for the UI sans at these sizes,
 * and monospace with our tracking runs wider.
 */
function widthOf(text: string, size: number, mono: boolean): number {
  return text.length * size * (mono ? 0.72 : 0.55);
}

/*
 * ★ THE ESTIMATE IS DELIBERATELY NOT PER-FONT ★
 *
 * A display face is wider than a condensed sans, so a truly accurate estimate would need a table
 * of average character widths per family — thirty numbers that would have to be measured and would
 * drift the moment a family is added. The banner is 600px wide with generous padding, so being a
 * few percent out shifts a layer rather than clipping it, and the packing still never overlaps.
 */

/*
 * Margins, widened from 18. Owner: the finished product "looks sloppy and thrown together ...
 * they need to render in a higher quality, with margins".
 *
 * A banner is 600 wide and read at a glance under a post; text starting 18px from the edge reads
 * as text that ran out of room. 28 gives it somewhere to sit.
 */
const PAD = 28;
/** Gap between two layers sharing a row. */
const GAP = 16;

export function BannerRender({
  spec,
  who = EMPTY_IDENTITY,
  width = BANNER.width,
  className,
  imageHref,
  badgeHref,
}: {
  readonly spec: BannerSpec;
  readonly who?: BannerIdentity;
  /** Rendered width. The viewBox keeps the geometry at 600×160 whatever this is. */
  readonly width?: number;
  readonly className?: string;
  readonly imageHref?: string;
  readonly badgeHref?: string;
}) {
  /*
   * A per-instance id for the gradient. Two banners on one page both defining `#bannerFill` would
   * make the second silently steal the first's fill — the classic SVG-in-a-list bug.
   */
  const stops = spec.stops ?? [];
  const spread = spec.spread ?? 100;
  const radius = spec.radius ?? 0;

  /*
   * A per-instance id covering every value the gradient depends on. Two banners on one page both
   * defining `#bannerFill` would make the second silently steal the first's — the classic
   * SVG-in-a-list bug — and an id that ignored the stops would do the same between two banners
   * that share their end colours.
   */
  const gradientId = `bg-${[spec.colourA, spec.colourB, ...stops, spec.angle ?? 0, spread]
    .join('-')
    .replace(/#/g, '')}`;

  /*
   * ★ SPREAD IS THE TRANSITION WIDTH, NOT THE GRADIENT WIDTH ★
   *
   * Owner asked to "widen or narrow the gradient". Scaling the gradient itself would just move
   * where it ends; what they want is control over how ABRUPT it is. So the stops are packed into a
   * band of `spread` percent centred on the middle, leaving flat colour either side — 100 is the
   * old edge-to-edge wash, 20 is a deliberate stripe.
   */
  const band = (i: number, count: number): number => {
    const start = (100 - spread) / 2;
    return count <= 1 ? start : start + (spread * i) / (count - 1);
  };
  const ramp = [spec.colourA, ...stops, spec.colourB];

  /* The gradient direction, as a unit vector — SVG wants x1/y1/x2/y2 rather than an angle. */
  const rad = ((spec.angle ?? 0) * Math.PI) / 180;
  const gx = Math.cos(rad);
  const gy = Math.sin(rad);

  /*
   * Rounded corners are a CLIP, applied to everything. Putting a radius only on the background
   * rect would leave a full-bleed image and any layer near an edge poking out of the corners.
   */
  const clipId = `clip-${radius}`;

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
        <rect x={0} y={0} width={BANNER.width} height={BANNER.height} fill={spec.colourA} />
        {STARS.map((s, i) => (
          <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="#ffffff" opacity={s.o} />
        ))}
      </>
    ) : spec.background === 'solid' ? (
      <rect x={0} y={0} width={BANNER.width} height={BANNER.height} fill={spec.colourA} />
    ) : (
      <rect x={0} y={0} width={BANNER.width} height={BANNER.height} fill={`url(#${gradientId})`} />
    );

  /*
   * Rows are laid out independently, and each side of a row packs outward from its own edge. A
   * badge is measured by its size, text by its estimated width, so a rank list and a badge sharing
   * a line do not sit on top of each other.
   */
  const rowHeight = BANNER.height / BANNER.rows;

  const placed: Array<{ layer: BannerLayer; x: number; y: number; anchor: 'start' | 'middle' | 'end' }> = [];

  for (const row of [1, 2, 3] as BannerRow[]) {
    for (const align of ['left', 'center', 'right'] as BannerAlign[]) {
      const inRow = spec.layers.filter((l) => l.row === row && l.align === align);
      if (inRow.length === 0) continue;

      const sizes = inRow.map((l) =>
        l.kind === 'badge' ? l.size : widthOf(textOf(l, who), l.size, l.mono || l.font !== undefined),
      );
      const total = sizes.reduce((a, b) => a + b, 0) + GAP * (inRow.length - 1);

      // Where the GROUP starts, so a centred group is centred as a whole rather than per layer.
      let cursor =
        align === 'left'
          ? PAD
          : align === 'center'
            ? BANNER.width / 2 - total / 2
            : BANNER.width - PAD - total;

      const y = rowHeight * (row - 1) + rowHeight / 2;

      inRow.forEach((layer, i) => {
        placed.push({ layer, x: cursor, y, anchor: 'start' });
        cursor += (sizes[i] ?? 0) + GAP;
      });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${BANNER.width} ${BANNER.height}`}
      width={width}
      height={(width / BANNER.width) * BANNER.height}
      className={className}
      /* Announced by its purpose — the text inside is decorative repetition of what is on the page. */
      role="img"
      aria-label="Signature banner"
      xmlns="http://www.w3.org/2000/svg"
      /*
       * The whole banner is clipped to the corner radius, so nothing — background, image, or a
       * layer sitting near an edge — pokes out of a rounded corner.
       */
      style={{ borderRadius: radius }}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1={`${50 - gx * 50}%`}
          y1={`${50 - gy * 50}%`}
          x2={`${50 + gx * 50}%`}
          y2={`${50 + gy * 50}%`}
        >
          {/* Flat colour up to the band, the ramp inside it, flat colour after. */}
          <stop offset="0%" stopColor={spec.colourA} />
          {ramp.map((c, i) => (
            <stop key={i} offset={`${band(i, ramp.length)}%`} stopColor={c} />
          ))}
          <stop offset="100%" stopColor={spec.colourB} />
        </linearGradient>

        <clipPath id={clipId}>
          <rect
            x={0}
            y={0}
            width={BANNER.width}
            height={BANNER.height}
            rx={radius}
            ry={radius}
          />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>{bg}</g>

      {/*
        The dimming veil sits between background and layers, so it darkens the picture WITHOUT
        washing out the text on top.
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

      {placed.map(({ layer, x, y }, i) => {
        if (layer.kind === 'badge') {
          return (
            <image
              key={i}
              /*
               * The transparent variant, so a badge over a gradient does not arrive inside a black
               * square. 512px scaled down rather than the 64px asset scaled up — a badge at 140px
               * from a 64px source is visibly soft on exactly the screens people care about.
               */
              /*
               * Their own badge when they uploaded one, otherwise ours. The transparent variant,
               * so a badge over a gradient does not arrive inside a black square — and 512px
               * scaled down rather than the 64px asset scaled up, which is visibly soft at 140px
               * on exactly the screens people care about.
               */
              href={
                layer.mediaId === undefined
                  ? (badgeHref ?? '/brand/badge-512-transparent.png')
                  : `/v1/media/uploads/${layer.mediaId}`
              }
              x={x}
              y={y - layer.size / 2}
              width={layer.size}
              height={layer.size}
              opacity={0.95}
            />
          );
        }

        const value = textOf(layer, who);
        // A source nobody has data for renders as NOTHING rather than as an empty slot.
        if (value === '') return null;

        return (
          <text
            key={i}
            x={x}
            y={y}
            dominantBaseline="middle"
            fontSize={layer.size}
            fontWeight={layer.bold ? 700 : 400}
            fill={layer.colour}
            /*
             * The layer's own font when it has one, otherwise the mono/sans default. `fontStack`
             * resolves an ID against the catalogue, so an unknown value renders as `inherit`
             * rather than as whatever string happened to be stored.
             */
            fontFamily={
              layer.font === undefined
                ? layer.mono
                  ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
                  : 'system-ui, -apple-system, Segoe UI, sans-serif'
                : fontStack(layer.font)
            }
            letterSpacing={layer.mono ? layer.size * 0.12 : 0}
            /*
              A dark outline on every text layer, always.

              The colour is a free hex value now — the owner asked for pickers and overruled the
              closed palette — so light text over a light background is reachable in one click.
              The outline means the worst case is text with a halo rather than text nobody can see.
            */
            style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 3 }}
          >
            {value}
          </text>
        );
      })}
    </svg>
  );
}

/** The label the editor shows for a source. Re-exported so the form and the renderer agree. */
export function sourceLabel(source: BannerTextSource): string {
  return BANNER_SOURCE_LABELS[source];
}
