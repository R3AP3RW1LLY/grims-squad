/**
 * The screenshot corpus, and training a model on it.
 *
 * ★ WHAT THE OWNER ASKED FOR ★
 *
 * Squadron owner, 2026-07-30: "can i have our members save these to our object storage and train
 * from there?"
 *
 * Yes, and it is the right shape. The fan art studio needs members to upload screenshots anyway, so
 * the corpus accumulates as a side effect of people using a tool they already wanted — rather than
 * as a separate chore nobody does.
 *
 * ★ THE THING THIS FILE EXISTS TO GET RIGHT: CONSENT ★
 *
 * Training a model on other people's work without asking is the single most resented practice in
 * this field, and a squadron of a hundred people is exactly the scale at which doing it quietly
 * would poison the well permanently.
 *
 * So training use is a SEPARATE, EXPLICIT, REVOCABLE opt-in — not bundled into the upload, not
 * implied by posting to the forum, and not defaulted on. A member can use the whole studio forever
 * and never contribute a single image, and nothing about their experience changes.
 *
 * ★ AND THE PART THAT MUST BE SAID OUT LOUD AT CONSENT TIME ★
 *
 * Withdrawal removes images from FUTURE training. It cannot remove them from a model already
 * trained — that is not a policy choice, it is how the weights work, and there is no button that
 * changes it. `CONSENT_WITHDRAWAL_NOTE` below is shown at the moment somebody opts in, because
 * discovering it afterwards is how trust is lost.
 */

/** Where a corpus image came from. Kept because it changes how much the label can be trusted. */
export const CORPUS_SOURCES = ['studio-upload', 'companion-import', 'officer-upload'] as const;
export type CorpusSource = (typeof CORPUS_SOURCES)[number];

/** Whether an image may be used to train. */
export const CORPUS_STATES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type CorpusState = (typeof CORPUS_STATES)[number];

/**
 * An image in the corpus.
 *
 * ★ THE LABEL IS THE WHOLE VALUE ★
 *
 * A thousand unlabelled screenshots teach a model nothing useful. A hundred labelled
 * "Krait Mk II, exterior, docked" teach it to draw a Krait Mk II. Everything below except `key`
 * exists to make the label trustworthy.
 */
export interface CorpusImage {
  /** Object-store key. The image itself never leaves the bucket until training pulls it. */
  readonly key: string;
  readonly userId: string;
  readonly source: CorpusSource;
  readonly state: CorpusState;
  /**
   * The ship, when we know it.
   *
   * ★ USUALLY DERIVED, NOT ASKED ★
   *
   * See `shipAtTime`. Members will not reliably tell us what they were flying, and a wrong label is
   * worse than no label — it teaches the model that a Python is a Krait. So the journal answers it
   * where it can, and this is null where it cannot.
   */
  readonly ship: string | null;
  /** Free-text caption used for training. Built by `buildCaption`. */
  readonly caption: string;
  readonly width: number;
  readonly height: number;
  readonly createdAt: Date;
}

/**
 * The smallest image worth training on.
 *
 * ★ IT IS A QUALITY FILTER, NOT A STORAGE ONE ★
 *
 * A LoRA trained on 720p screenshots learns 720p detail and produces mush at any size. 1280 on the
 * long edge is the floor at which fine detail — panel lines, engine glow, cockpit instruments —
 * actually survives into the weights.
 *
 * Below this the image is still stored and still usable in the studio; it is simply not offered for
 * training. Two different questions, deliberately.
 */
export const MIN_TRAINING_EDGE = 1280;

/**
 * Images needed before a ship LoRA is worth training.
 *
 * Twenty is the floor where a concept starts to hold; forty to sixty is where it becomes reliable.
 * Below twenty the LoRA memorises the individual screenshots instead of learning the ship, and the
 * output is those exact frames with artefacts.
 */
export const MIN_IMAGES_PER_SHIP = 20;
export const IDEAL_IMAGES_PER_SHIP = 60;

/**
 * How close a screenshot must be to a journal event for the ship to be inferred from it.
 *
 * ★ WHY THIS IS TIGHT ★
 *
 * The companion already knows what everybody is flying, moment to moment. A screenshot carries a
 * timestamp. So the ship can be READ rather than asked for — which is both less friction and more
 * accurate than a dropdown somebody picks wrong.
 *
 * Ten minutes because that is comfortably inside a session but well short of a swap at a station.
 * A wrong label is worse than none, so a screenshot taken further than this from any known position
 * gets `ship: null` and waits for a human rather than guessing.
 */
export const SHIP_INFERENCE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Builds the training caption.
 *
 * ★ WHY THE PREFIX ★
 *
 * A LoRA is invoked by a trigger phrase. Every caption starting with the same token is what binds
 * the learned concept to something a member can actually type later — without it the LoRA leaks
 * into every prompt, and "a photo of a dog" starts coming out as a spaceship.
 */
export const LORA_TRIGGER = 'edshot';

export function buildCaption(parts: {
  ship: string | null;
  tags: readonly string[];
}): string {
  const bits = [LORA_TRIGGER];
  if (parts.ship !== null && parts.ship !== '') bits.push(parts.ship);
  for (const t of parts.tags) {
    const clean = t.trim().toLowerCase();
    if (clean !== '') bits.push(clean);
  }
  return bits.join(', ');
}

/** Tags an officer or member can attach. A fixed set: free text produces a hundred spellings. */
export const CORPUS_TAGS = [
  'exterior',
  'cockpit',
  'docked',
  'landed',
  'in flight',
  'combat',
  'station',
  'planet surface',
  'deep space',
  'nebula',
  'srv',
  'on foot',
] as const;
export type CorpusTag = (typeof CORPUS_TAGS)[number];

/**
 * Shown at the moment somebody opts in. Not in a policy page they will not read.
 *
 * ★ IT LEADS WITH THE IRREVERSIBLE PART ★
 *
 * Everything else here is reversible and unremarkable. The one fact somebody could later feel
 * misled about is that withdrawal does not reach into a model already trained, so that is the
 * sentence that goes first rather than the one buried at the end.
 */
export const CONSENT_WITHDRAWAL_NOTE =
  'You can withdraw at any time, and your screenshots will be left out of future training. ' +
  'Anything already trained cannot be untrained — that is how these models work, and we would ' +
  'rather say so now than surprise you later. Your screenshots stay on our own storage and are ' +
  'never sold or sent to another company.';

/** The opt-in itself. Deliberately one sentence and deliberately not pre-ticked. */
export const CONSENT_PROMPT =
  'Let the squadron use my screenshots to train our own Elite Dangerous art model.';

/**
 * Prefix under which corpus objects live.
 *
 * Separate from `uploads/` so the training corpus can be enumerated, synced and audited without
 * walking every avatar and forum attachment in the bucket — and so a mistake in a training script
 * cannot reach anything else.
 */
export const CORPUS_PREFIX = 'corpus/';

/** Key for one corpus image. Keyed by hash so the same screenshot uploaded twice stores once. */
export function corpusKey(sha256: string): string {
  return `${CORPUS_PREFIX}${sha256}.png`;
}
