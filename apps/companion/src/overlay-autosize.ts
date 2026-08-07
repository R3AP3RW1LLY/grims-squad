import type { OverlayId } from './overlay-config.js';

/**
 * Growing an overlay to fit what is in it.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "can we also update the build tracker overlay to expand and collapse automatically so we can
 * show the full list"
 *
 * The build tracker showed four commodities of a build's requirement, because four is what fits a
 * fixed 140px window. For a hauler deciding what to load, four of eleven with no sign the other
 * seven exist is the wrong four about as often as not.
 *
 * ★ WHY THIS IS A MODULE AND NOT THREE LINES IN THE RENDERER ★
 *
 * The renderer measures itself and asks the main process to resize the window. Resizing repaints,
 * repainting re-measures, and a measurement that came back two pixels different would resize
 * again — for ever, over the top of the game. The dead band that stops that is the whole of the
 * difficulty, and it is worth being able to test without launching Electron.
 */

export const AUTOSIZE = {
  /**
   * Movement below this is ignored.
   *
   * Text reflow, a scrollbar appearing and a font settling all shift a measured height by a pixel
   * or two. Anything inside this band is noise; anything outside it is a row appearing or leaving.
   * Deliberately smaller than one commodity row (~18px), or the list would clip silently.
   */
  deadBandPx: 8,
  /** Small enough to be unobtrusive, large enough that a member can still find and grab it. */
  minPx: 90,
  /**
   * A construction site can want dozens of commodities. Uncapped, the panel would grow taller than
   * the screen and cover the whole cockpit — so it stops here and scrolls inside itself.
   */
  maxPx: 620,
} as const;

/**
 * The overlays that size themselves to their content.
 *
 * Not all of them, deliberately. Upload status is four lines and never more; auto-sizing it would
 * move a window the member placed on purpose, for nothing. Every overlay that resizes itself is one
 * more thing moving on screen while somebody is flying, so it is opt-in per panel.
 */
const SELF_SIZING: ReadonlySet<string> = new Set<OverlayId>(['build', 'route', 'cargo']);

export function autoSizes(id: OverlayId): boolean {
  return SELF_SIZING.has(id);
}

/**
 * The height this overlay's window should become, or null to leave it alone.
 *
 * Null rather than "the current height" so the caller can skip the `setBounds` entirely — setting
 * bounds to their existing value still emits a `moved` event on some platforms, and `moved` writes
 * the config.
 */
export function nextOverlayHeight(current: number, measured: number): number | null {
  // A mid-mount measurement can be NaN. Obeying it would hand Electron a NaN window size.
  if (!Number.isFinite(measured) && !(measured === Number.POSITIVE_INFINITY)) return null;

  const wanted = Math.round(Math.min(AUTOSIZE.maxPx, Math.max(AUTOSIZE.minPx, measured)));

  // Inside the dead band: noise, not a row. Leaving it alone is what stops the resize loop.
  if (Math.abs(wanted - current) < AUTOSIZE.deadBandPx) return null;

  return wanted;
}
