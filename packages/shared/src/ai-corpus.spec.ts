import { describe, it, expect } from 'vitest';
import {
  isTrainableImage,
  TRAINING_ACCEPT,
  TRAINING_CATEGORIES,
  MIN_IMAGES_PER_SHIP,
  categoryProgress,
} from './ai-corpus.js';

/**
 * The training corpus rules.
 *
 * ★ THE .jpg BUG IS THE REASON HALF OF THIS FILE EXISTS ★
 *
 * Reported 2026-08-01: "we need to allow .jpg files please." They were always meant to be allowed —
 * a .jpg IS image/jpeg — and the gate compared `file.type` verbatim against a three-item list. The
 * refusal was silent about its real cause and unactionable to the member.
 */

describe('what a member is allowed to send', () => {
  it('accepts an ordinary JPEG', () => {
    expect(isTrainableImage({ name: 'shot.jpg', type: 'image/jpeg' })).toBe(true);
  });

  it('MANDATORY: accepts image/jpg, which is not a real MIME type', () => {
    /*
     * Windows reports this for .jpg when a photo editor has rewritten the registry association.
     * Browsers pass it straight through, and it is in no standard list anywhere.
     */
    expect(isTrainableImage({ name: 'shot.jpg', type: 'image/jpg' })).toBe(true);
  });

  it('MANDATORY: accepts a file the browser could not type at all', () => {
    // Dragged from an archive tool or off a network share: `type` is the empty string.
    expect(isTrainableImage({ name: 'Screenshot_0042.jpg', type: '' })).toBe(true);
    expect(isTrainableImage({ name: 'shot.JPEG', type: '' })).toBe(true);
    expect(isTrainableImage({ name: 'shot.PNG', type: '' })).toBe(true);
  });

  it('still refuses what training cannot use', () => {
    // GIF is stored happily by the media pipeline. An animated frame grab is low-resolution and
    // palette-limited, and it teaches the model compression artefacts.
    expect(isTrainableImage({ name: 'clip.gif', type: 'image/gif' })).toBe(false);
    expect(isTrainableImage({ name: 'notes.pdf', type: 'application/pdf' })).toBe(false);
    expect(isTrainableImage({ name: 'noextension', type: '' })).toBe(false);
  });

  it('offers extensions in the picker, not only MIME types', () => {
    // A picker listing MIME types alone hides the very files this bug was about.
    expect(TRAINING_ACCEPT).toContain('.jpg');
    expect(TRAINING_ACCEPT).toContain('.jpeg');
    expect(TRAINING_ACCEPT).toContain('image/jpeg');
  });
});

describe('the targets', () => {
  it('MANDATORY: every category aims well above the bare technical floor', () => {
    /*
     * Squadron owner, 2026-08-01: "upgrade the required numbers to be the reliable numbers please!
     * we have a large pool of images, lets not short hand ourselves here!"
     *
     * The floor is real — below it a LoRA memorises screenshots instead of learning the concept —
     * but a bar that fills AT the floor tells the squadron the job is done when the result would be
     * a model that draws recognisable-but-wrong ships.
     */
    for (const c of TRAINING_CATEGORIES) {
      expect(c.min, c.key).toBeGreaterThanOrEqual(MIN_IMAGES_PER_SHIP * 2.5);
    }
  });

  it('keeps a stretch target beyond the bar, so more still matters', () => {
    for (const c of TRAINING_CATEGORIES) expect(c.ideal, c.key).toBeGreaterThan(c.min);
  });

  it('has a unique key per category', () => {
    const keys = TRAINING_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the progress bar', () => {
  it('MANDATORY: pending never fills the bar', () => {
    /*
     * A member who sends thirty images should not watch the bar fill and then empty when an officer
     * rejects half. It tracks what is actually usable; pending is reported beside it.
     */
    const p = categoryProgress('ship-exterior', { approved: 0, pending: 40 });
    expect(p?.fraction).toBe(0);
    expect(p?.pending).toBe(40);
    expect(p?.trainable).toBe(false);
  });

  it('clamps a finished category rather than drawing past the end', () => {
    const p = categoryProgress('ship-exterior', { approved: 10_000, pending: 0 });
    expect(p?.fraction).toBe(1);
    expect(p?.trainable).toBe(true);
  });

  it('returns null for a category nobody defined', () => {
    expect(categoryProgress('not-a-category', { approved: 5, pending: 0 })).toBeNull();
  });
});
