import { describe, expect, it } from 'vitest';
import { nextOverlayHeight, AUTOSIZE, autoSizes } from './overlay-autosize.js';

/**
 * Growing an overlay to fit what is in it.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "can we also update the build tracker overlay to expand and collapse automatically so we can
 * show the full list"
 *
 * The build tracker showed four commodities out of a build's requirement because that is what fits
 * a fixed 140px window. Four of eleven, with no indication the other seven exist — which for a
 * hauler deciding what to load is the wrong four as often as not.
 *
 * ★ HYSTERESIS IS THE WHOLE PROBLEM ★
 *
 * The renderer measures itself and asks the main process to resize. Text reflow, a scrollbar
 * appearing, a font settling — all of them move the measured height by a pixel or two, and each
 * resize triggers a repaint that measures again. Without a dead band that is an infinite loop of
 * window resizes over the top of a game.
 */

describe('deciding a new overlay height', () => {
  it('MANDATORY: grows to fit content that does not fit', () => {
    expect(nextOverlayHeight(140, 320)).toBe(320);
  });

  it('MANDATORY: shrinks back when the content goes away', () => {
    // "expand AND collapse" — a panel left tall after its list emptied covers the game for nothing.
    expect(nextOverlayHeight(320, 120)).toBe(120);
  });

  it('MANDATORY: a small difference changes nothing', () => {
    /*
     * ★ THE INFINITE LOOP THIS PREVENTS ★
     *
     * Resizing repaints, repainting re-measures, and a measurement that differs by a pixel would
     * resize again — for ever, over the top of the game. Anything inside the dead band is left
     * alone.
     */
    expect(nextOverlayHeight(300, 302)).toBeNull();
    expect(nextOverlayHeight(300, 298)).toBeNull();
  });

  it('MANDATORY: the dead band is not so wide it ignores a real row', () => {
    // A commodity row is around 18px. If the band swallowed one, the list would silently clip.
    expect(AUTOSIZE.deadBandPx).toBeLessThan(18);
  });

  it('MANDATORY: never smaller than something a member can see and grab', () => {
    /*
     * An overlay measured at zero — mid-mount, or with every field switched off — must not become
     * an invisible window. The member would have no way to find it to fix it.
     */
    expect(nextOverlayHeight(300, 0)).toBe(AUTOSIZE.minPx);
    expect(nextOverlayHeight(300, -50)).toBe(AUTOSIZE.minPx);
  });

  it('MANDATORY: never taller than the cap, however long the list', () => {
    /*
     * A construction site wants dozens of commodities. Uncapped, the panel would be taller than the
     * screen and cover the whole cockpit — so it stops, and the panel scrolls inside itself.
     */
    expect(nextOverlayHeight(300, 5_000)).toBe(AUTOSIZE.maxPx);
  });

  it('MANDATORY: a nonsense measurement is ignored, not obeyed', () => {
    // A NaN from a mid-mount measurement would become a NaN window size, which Electron rejects
    // and which would leave the panel at whatever it happened to be.
    expect(nextOverlayHeight(300, Number.NaN)).toBeNull();
    expect(nextOverlayHeight(300, Number.POSITIVE_INFINITY)).toBe(AUTOSIZE.maxPx);
  });

  it('MANDATORY: already at the cap and still overflowing changes nothing', () => {
    // Otherwise a very long list would resize to the cap on every single measurement.
    expect(nextOverlayHeight(AUTOSIZE.maxPx, 5_000)).toBeNull();
  });

  it('MANDATORY: already at the floor and still empty changes nothing', () => {
    expect(nextOverlayHeight(AUTOSIZE.minPx, 0)).toBeNull();
  });
});

describe('which overlays size themselves', () => {
  it('MANDATORY: the build tracker does', () => {
    // The one the owner asked for, and the one with a genuinely variable-length list.
    expect(autoSizes('build')).toBe(true);
  });

  it('MANDATORY: the fixed-shape panels do not', () => {
    /*
     * Upload status is four lines and never more. Auto-sizing it would move a window the member
     * placed deliberately, to no benefit — and every overlay that resizes itself is one more thing
     * moving on screen while somebody is flying.
     */
    expect(autoSizes('status')).toBe(false);
  });
});
