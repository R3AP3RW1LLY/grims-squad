import type { CSSProperties } from 'react';

/**
 * The hero backdrop: a stylised galaxy map with traffic moving through it.
 *
 * Modelled on the in-game map's actual visual grammar rather than a generic
 * star chart. The detail that makes it read as Elite Dangerous is the DROP
 * LINE — every system hangs on a vertical stalk down to the galactic plane, so
 * you can see height above and below the reference grid. Remove those and it is
 * just dots; keep them and it is instantly recognisable.
 *
 * Built as SVG with CSS motion paths, so:
 *  · it is a SERVER component — no JavaScript ships to the browser for this
 *  · it stays crisp at any zoom, unlike a canvas of the same complexity
 *  · every animation is CSS, so `prefers-reduced-motion` disables it through
 *    the existing global rule rather than needing its own JS listener
 *
 * Every coordinate below is a literal. Nothing is randomised, because a random
 * layout generated during render produces different markup on the server and
 * the client, and React reports that as a hydration mismatch.
 */

/** The galactic plane, in viewBox units. Drop lines terminate here. */
const PLANE_Y = 470;

interface StarSystem {
  x: number;
  y: number;
  r: number;
  tone: 'orange' | 'cyan' | 'white' | 'blue';
}

/**
 * A hand-placed cluster. Deliberately NOT labelled with system names: this is
 * decoration, and inventing plausible-looking system names would be presenting
 * fiction in the same visual language the real data will use later. Only the
 * home system is named, because that one is true.
 */
const SYSTEMS: readonly StarSystem[] = [
  { x: 95, y: 322, r: 2.5, tone: 'blue' },
  { x: 186, y: 402, r: 2, tone: 'white' },
  { x: 248, y: 214, r: 3.5, tone: 'orange' },
  { x: 330, y: 300, r: 2, tone: 'white' },
  { x: 392, y: 152, r: 2.5, tone: 'cyan' },
  { x: 468, y: 252, r: 3, tone: 'cyan' },
  { x: 540, y: 398, r: 2, tone: 'blue' },
  { x: 604, y: 178, r: 5, tone: 'orange' }, // home
  { x: 690, y: 268, r: 2, tone: 'white' },
  { x: 726, y: 372, r: 2.5, tone: 'blue' },
  { x: 832, y: 228, r: 3.5, tone: 'white' },
  { x: 884, y: 404, r: 2, tone: 'white' },
  { x: 952, y: 302, r: 3, tone: 'orange' },
  { x: 1012, y: 392, r: 2, tone: 'orange' },
  { x: 1064, y: 198, r: 3.5, tone: 'cyan' },
  { x: 1142, y: 286, r: 2, tone: 'blue' },
];

const HOME = { x: 604, y: 178 };

const TONE: Record<StarSystem['tone'], string> = {
  orange: 'var(--color-brand-orange)',
  cyan: 'var(--color-brand-cyan-bright)',
  white: '#e8eef5',
  blue: '#7fb4ff',
};

/**
 * Traffic lanes. Each is drawn as a faint curve AND used as the motion path for
 * a ship, so the ship provably follows the line the viewer can see — sharing
 * one string is what keeps them from drifting apart when either is tweaked.
 */
interface Lane {
  d: string;
  /** Seconds for one transit. Longer lanes get longer durations. */
  dur: number;
  delay: number;
}

const LANES: readonly Lane[] = [
  { d: 'M95,322 Q180,236 248,214', dur: 13, delay: 0 },
  { d: 'M248,214 Q368,178 468,252', dur: 17, delay: 4.5 },
  { d: 'M468,252 Q540,192 604,178', dur: 9, delay: 1.5 },
  { d: 'M604,178 Q722,196 832,228', dur: 16, delay: 7 },
  { d: 'M832,228 Q900,258 952,302', dur: 11, delay: 2.5 },
  { d: 'M952,302 Q1016,242 1064,198', dur: 12, delay: 9 },
  { d: 'M330,300 Q432,368 540,398', dur: 15, delay: 6 },
  { d: 'M726,372 Q806,392 884,404', dur: 12, delay: 11 },
];

/** Ships travel a subset of the lanes; empty lanes keep the map from feeling staged. */
const SHIP_LANES = [0, 2, 3, 4, 6, 7] as const;

export function GalaxyMap() {
  return (
    <div className="galaxy-map" aria-hidden="true">
      <svg
        viewBox="0 0 1240 640"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        role="presentation"
      >
        <defs>
          {/* Soft bloom for stars and ships. stdDeviation stays small: a wide
              blur on a dozen elements is the one thing here that would actually
              cost frames on an integrated GPU. */}
          <filter id="gm-bloom" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="gm-bloom-lg" x="-160%" y="-160%" width="420%" height="420%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Drop lines fade out as they approach the plane, so the grid stays
              readable underneath instead of being fenced off by hard verticals. */}
          <linearGradient id="gm-drop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-orange)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--color-brand-orange)" stopOpacity="0.04" />
          </linearGradient>

          <linearGradient id="gm-lane" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-brand-cyan)" stopOpacity="0.05" />
            <stop offset="50%" stopColor="var(--color-brand-cyan)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--color-brand-cyan)" stopOpacity="0.05" />
          </linearGradient>

          {/* The reference plane. Two line sets, converging toward the horizon
              in the y-scale to fake perspective without a 3D transform. */}
          <pattern id="gm-grid" width="62" height="62" patternUnits="userSpaceOnUse">
            <path
              d="M62 0H0V62"
              fill="none"
              stroke="var(--color-brand-orange)"
              strokeOpacity="0.18"
              strokeWidth="1"
            />
          </pattern>

          <radialGradient id="gm-core" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="45%" stopColor="var(--color-brand-orange)" />
            <stop offset="100%" stopColor="var(--color-brand-orange)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ---------------------------------------------- the galactic plane */}
        <g className="gm-plane">
          <rect x="-200" y={PLANE_Y} width="1640" height="240" fill="url(#gm-grid)" />
          {/* The plane's leading edge, brighter than the grid itself. */}
          <line
            x1="-200"
            y1={PLANE_Y}
            x2="1440"
            y2={PLANE_Y}
            stroke="var(--color-brand-orange)"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        </g>

        {/* ------------------------------------------------------ drop lines */}
        <g>
          {SYSTEMS.map((s) => (
            <line
              key={`d-${s.x}-${s.y}`}
              x1={s.x}
              y1={s.y}
              x2={s.x}
              y2={PLANE_Y}
              stroke="url(#gm-drop)"
              strokeWidth={s.r >= 3.5 ? 1.2 : 0.8}
            />
          ))}
          {/* Where each stalk meets the plane, a small footprint marker —
              exactly how the in-game map shows a system's plane position. */}
          {SYSTEMS.map((s) => (
            <circle
              key={`f-${s.x}-${s.y}`}
              cx={s.x}
              cy={PLANE_Y}
              r="1.4"
              fill="var(--color-brand-orange)"
              fillOpacity="0.4"
            />
          ))}
        </g>

        {/* ----------------------------------------------------------- lanes */}
        <g>
          {LANES.map((l) => (
            <path
              key={l.d}
              d={l.d}
              fill="none"
              stroke="url(#gm-lane)"
              strokeWidth="1"
              strokeDasharray="3 5"
              className="gm-lane"
            />
          ))}
        </g>

        {/* --------------------------------------------------------- systems */}
        <g>
          {SYSTEMS.map((s) => (
            <circle
              key={`s-${s.x}-${s.y}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill={TONE[s.tone]}
              filter="url(#gm-bloom)"
              className="gm-star"
            />
          ))}
        </g>

        {/* ------------------------------------------------- the home system */}
        <g className="gm-home">
          <circle cx={HOME.x} cy={HOME.y} r="26" fill="url(#gm-core)" opacity="0.5" />
          {/* Rotating selection reticle, as the map draws around a target. */}
          <g className="gm-reticle" style={{ transformOrigin: `${HOME.x}px ${HOME.y}px` }}>
            <circle
              cx={HOME.x}
              cy={HOME.y}
              r="19"
              fill="none"
              stroke="var(--color-brand-orange)"
              strokeOpacity="0.85"
              strokeWidth="1"
              strokeDasharray="4 6"
            />
          </g>
          {/* Static corner brackets — the actual selection indicator. */}
          <path
            d={`M${HOME.x - 26},${HOME.y - 16} v-10 h10 M${HOME.x + 26},${HOME.y - 16} v-10 h-10
                M${HOME.x - 26},${HOME.y + 16} v10 h10 M${HOME.x + 26},${HOME.y + 16} v10 h-10`}
            fill="none"
            stroke="var(--color-brand-orange)"
            strokeWidth="1.5"
          />
          <circle cx={HOME.x} cy={HOME.y} r="5" fill="#fff" filter="url(#gm-bloom-lg)" />

          <text
            x={HOME.x + 40}
            y={HOME.y - 20}
            className="gm-label"
            fill="var(--color-brand-orange-bright)"
          >
            HYADES SECTOR AV-W b2-4
          </text>
          <line
            x1={HOME.x + 28}
            y1={HOME.y - 24}
            x2={HOME.x + 36}
            y2={HOME.y - 24}
            stroke="var(--color-brand-orange)"
            strokeWidth="1"
          />
        </g>

        {/* ----------------------------------------------------------- ships */}
        {/*
          A ship fades in at the origin (arriving from witchspace), runs the
          lane, then flares and drops out at the far end — a hyperspace jump.
          The flare shares the lane's duration and delay, so it fires exactly as
          the ship reaches the destination without any timing bookkeeping.
        */}
        <g className="gm-traffic">
          {SHIP_LANES.map((i) => {
            const lane = LANES[i];
            if (lane === undefined) return null;
            const style = {
              '--gm-path': `path("${lane.d}")`,
              animationDuration: `${lane.dur}s`,
              animationDelay: `${lane.delay}s`,
            } as CSSProperties;

            return (
              <g key={`ship-${i}`}>
                <g className="gm-ship" style={style}>
                  {/* Frame-shift trail, drawn behind the hull. */}
                  <path
                    d="M-16,0 L-2,-1.6 L-2,1.6 Z"
                    fill="var(--color-brand-cyan-bright)"
                    opacity="0.35"
                  />
                  <path
                    d="M9,0 L-4,-4.2 L-1,0 L-4,4.2 Z"
                    fill="var(--color-brand-cyan-bright)"
                    filter="url(#gm-bloom)"
                  />
                </g>
                <circle
                  className="gm-jump"
                  style={style}
                  cx={endX(lane.d)}
                  cy={endY(lane.d)}
                  r="7"
                  fill="none"
                  stroke="var(--color-brand-cyan-bright)"
                  strokeWidth="1.5"
                />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/**
 * Pulls the final coordinate pair out of a quadratic path.
 *
 * Parsed from the same string the ship travels rather than duplicated as
 * separate props: two hand-maintained copies of the same coordinate drift the
 * first time a lane is nudged, and the symptom — a jump flare firing slightly
 * off the end of the lane — is subtle enough to survive review.
 */
function endPoint(d: string): readonly [number, number] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (nums === null || nums.length < 2) return [0, 0];
  const y = Number(nums[nums.length - 1]);
  const x = Number(nums[nums.length - 2]);
  return [x, y];
}

const endX = (d: string): number => endPoint(d)[0];
const endY = (d: string): number => endPoint(d)[1];
