'use client';

import { useEffect, useRef } from 'react';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type ChartType,
  type Plugin,
} from 'chart.js';

/**
 * Every chart on the site, drawn by one library with one look.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "add a charting library so our graphs and dashboard look really good please!" — and, asked
 * whether that meant the companion app or the website: "Both apps — one library, one look."
 *
 * ★ WHY RECHARTS LEFT ★
 *
 * The dashboard was already on Recharts and it was working. It went because "one library" cannot
 * be true otherwise: the companion app is Preact, Recharts is a React component tree, and the only
 * way to share a look across both was a library that draws to a canvas and does not care what
 * framework called it. Keeping Recharts would have meant the website shipping TWO charting
 * libraries — Recharts for the dashboard, Chart.js for everything the companion also draws — which
 * is more bytes than either and two sets of tooltips that never quite match.
 *
 * So the choice was Recharts everywhere-but-the-companion, or Chart.js everywhere. The owner asked
 * for one look in both places, and this is the only arrangement that delivers it.
 *
 * ★ REGISTERED PIECEMEAL, NOT `registerables` ★
 *
 * Chart.js ships every chart type, scale and plugin it owns. `registerables` is the convenient
 * import and drags radar, polar, bubble, scatter, the time scale and its date adapter into a bundle
 * that draws lines, bars and one doughnut. Six controllers and two scales is what we use, so six
 * controllers and two scales is what registers.
 *
 * `Legend` is deliberately absent. Every legend on this site is hand-written HTML — they carry
 * values beside the names and wrap properly at ten entries, neither of which a built-in legend
 * does — so registering one would ship a plugin nothing turns on.
 */

Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
);

/**
 * ★ THE PALETTE IS READ, NOT REDECLARED ★
 *
 * A canvas takes colours as strings and cannot resolve a CSS variable, so the hex values appear
 * literally here — the one place in the app where that is true. They are pulled from the generated
 * theme, because a chart quietly drifting from the brand is exactly the kind of thing nobody
 * notices until it looks wrong beside everything else.
 */
export const BRAND = {
  orange: '#ff7100',
  orangeBright: '#ff9d3f',
  orangeDim: '#b34f00',
  cyan: '#00c8ff',
  cyanBright: '#5cd9ff',
  success: '#3dff8f',
  warning: '#ffc400',
  hostile: '#ff7a7a',
  panel: '#0b0f14',
  panelRaised: '#121820',
  hairline: 'rgba(255, 113, 0, 0.18)',
  text: '#e8eef5',
  textSecondary: '#93a4b8',
  void: '#05070a',
  /*
   * ★ TWO COLOURS ADDED FOR THE SPLIT ACTIVITY SERIES — owner, 2026-07-30 ★
   *
   * "make this line purple" for forum activity, and for voice "choose a seperate color for the
   * voice activity that doesnt match other colors used".
   *
   * Both were picked against the EXISTING palette rather than in isolation: orange, orangeBright,
   * orangeDim, cyan, cyanBright, success green, warning gold and hostile salmon are all already in
   * play. Violet and magenta are the two hue regions nothing else occupies, and they are far
   * enough apart from each other to stay distinguishable at a 2px stroke — which is the only width
   * anybody will actually see them at.
   */
  violet: '#a97bff',
  magenta: '#ff4fd8',
} as const;

/**
 * A rotation for categorical series.
 *
 * Ordered so ADJACENT entries are far apart in hue and brightness. A palette that steps evenly
 * through a gradient looks elegant in isolation and becomes unreadable the moment two neighbouring
 * slices are the same size — which is the normal case for a rank distribution.
 */
export const SERIES = [
  BRAND.orange,
  BRAND.cyan,
  BRAND.success,
  BRAND.orangeBright,
  BRAND.warning,
  BRAND.cyanBright,
  BRAND.hostile,
  BRAND.orangeDim,
] as const;

/** Picks a series colour, wrapping. Total by construction, so no undefined escapes. */
export function seriesColour(i: number): string {
  return SERIES[i % SERIES.length] ?? BRAND.orange;
}

/* ------------------------------------------------------------------ tooltips */

/**
 * The DARK tooltip, for charts where the row colour carries meaning.
 *
 * ★ TWO TOOLTIP TREATMENTS, ON PURPOSE ★
 *
 * Squadron owner, 2026-07-30: on Who showed up, What the squadron flies and Journal telemetry,
 * "make the tool tip text match the corresponding data point it represents please give it the old
 * background color too keep the others not mentioned here the same colors they currently are".
 *
 * Those are MULTI-SERIES: several lines on one chart, or a ring of coloured segments. There, the
 * colour of a tooltip row is the thing that tells you which series it belongs to — so the swatch
 * has to stay, and the surface has to be dark for those colours to be legible on.
 *
 * The orange border does the work a drop shadow used to. A canvas tooltip cannot carry a CSS
 * shadow, and it does not need one: the complaint that started all this was a surface within a few
 * percent of the panel behind it, and a branded 1px edge separates it far more definitely than a
 * blur ever did.
 */
export const TOOLTIP_DARK = {
  backgroundColor: BRAND.panelRaised,
  borderColor: BRAND.orange,
  borderWidth: 1,
  cornerRadius: 4,
  titleColor: BRAND.text,
  bodyColor: BRAND.text,
  padding: 10,
  usePointStyle: true,
  boxPadding: 4,
} as const;

/**
 * The LIGHT tooltip, for single-series charts.
 *
 * Squadron owner, 2026-07-30: "the tool tip color is a dark color, the dark colors are hard to
 * read, can we lighten this up". On a single-series chart nothing is distinguished by colour, so
 * inverting costs nothing and reads better against a near-black panel.
 *
 * `displayColors: false` because the swatch would be the only colour in the box and it identifies
 * a series there is only one of.
 */
export const TOOLTIP_LIGHT = {
  backgroundColor: BRAND.text,
  borderColor: BRAND.orange,
  borderWidth: 1,
  cornerRadius: 4,
  titleColor: BRAND.void,
  bodyColor: BRAND.void,
  padding: 10,
  displayColors: false,
} as const;

/* --------------------------------------------------------------------- axes */

/** Axis ticks, muted. Data is what should be loud; the scale is scaffolding. */
export const TICKS = { color: BRAND.textSecondary, font: { size: 10 } } as const;

/**
 * Horizontal gridlines only.
 *
 * Vertical ones on a time series draw a cage: they add a line per bucket, none of which anybody
 * reads, over the shape that is the entire point of the chart.
 */
export const GRID = { color: 'rgba(147,164,184,0.08)', drawTicks: false } as const;

/* ---------------------------------------------------------------- crosshair */

/**
 * The dashed vertical line under the cursor.
 *
 * Recharts drew one for free and losing it would have been a real regression: on a five-series
 * chart it is what ties the tooltip to a point on the x-axis. Chart.js has no built-in cursor, so
 * it is eleven lines of canvas here rather than a second dependency.
 *
 * Opt-in per chart — it is meaningless on a horizontal bar chart or a doughnut.
 */
export const crosshair: Plugin<'line'> = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements() ?? [];
    const first = active[0];
    if (first === undefined) return;

    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = BRAND.orange;
    ctx.lineWidth = 1;
    ctx.moveTo(first.element.x, chartArea.top);
    ctx.lineTo(first.element.x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/* --------------------------------------------------------------------- hook */

/**
 * Draws a chart onto a canvas, and rebuilds it whenever the configuration changes.
 *
 * ★ DESTROYED AND REBUILT, NOT UPDATED IN PLACE ★
 *
 * Chart.js keeps a registry keyed on the canvas element and THROWS if a second chart is created on
 * one it already owns. A component that re-renders without cleaning up dies on its second render
 * with an error naming the canvas rather than the cause, which is a miserable half-hour for
 * whoever meets it. Tearing down in the effect's cleanup makes that structurally impossible.
 *
 * The caller passes a factory rather than a config object so the config is built inside the effect
 * — a fresh object literal on every render would otherwise be a new dependency every render, and
 * the chart would rebuild on each one.
 */
export function useChart<T extends ChartType>(
  make: () => ChartConfiguration<T>,
  deps: readonly unknown[],
): React.RefObject<HTMLCanvasElement | null> {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const made = useRef(make);
  made.current = make;

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;

    const chart = new Chart(element, made.current());
    return () => chart.destroy();
    // The factory is deliberately not a dependency — it closes over the data, and the caller
    // declares what actually changed. See the note above.
  }, deps);

  return canvas;
}

/**
 * The box a responsive chart lives in.
 *
 * `maintainAspectRatio: false` means the canvas fills its parent, and a parent with no height
 * collapses to nothing — a blank panel that reads as broken. The height is always stated here so
 * that cannot happen by omission.
 */
export function ChartBox({
  height,
  label,
  canvasRef,
}: {
  height: number;
  /** Read out in place of the picture. A canvas is opaque to a screen reader without one. */
  label: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  return (
    <div style={{ height: `${height}px` }} className="relative w-full">
      <canvas ref={canvasRef} role="img" aria-label={label} />
    </div>
  );
}

/** Shared base: responsive, filling its box, with the hover behaviour every chart here wants. */
export const RESPONSIVE = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 320 },
} as const;
