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

// ── The member-facing collection drive ──────────────────────────────────────
//
// ★ SQUADRON OWNER, 2026-08-01 ★
//
// "a new side bar category called GMSD AI ... name it Help Train the Bot ... this should have a
// category based uploader, a material progression bar that shows how many images are required in
// the pool to properly train that category and what were at in collecting those images for each
// category, each image should have a slot for text description etc."
//
// ★ WHY CATEGORIES AND NOT ONE BIG PILE ★
//
// A LoRA is trained per CONCEPT. Two thousand mixed screenshots teach a model to draw an average
// of everything — a smeared hull in a smeared station. Sixty of one ship teach it that ship. So the
// pool is divided the way training divides it, and the progress bar is per category because that is
// the only number that means anything: "we have 2,000 images" is not progress towards anything.

/**
 * What we are collecting, and how much of each.
 *
 * ★ THE TARGET IS THE RELIABLE NUMBER, NOT THE FLOOR — OWNER, 2026-08-01 ★
 *
 * "upgrade the required numbers to be the reliable numbers please! we have a large pool of images,
 * lets not short hand ourselves here!"
 *
 * The floor and the target used to be two different numbers, and `min` was the floor — the point
 * below which a LoRA memorises individual screenshots and reproduces them with artefacts instead of
 * learning the concept. That floor is still real (MIN_IMAGES_PER_SHIP, twenty) and it is still the
 * honest answer to "what is the minimum". It was the wrong thing to aim a progress bar at.
 *
 * A bar that fills at the floor tells the squadron the job is done when the result would be a model
 * that draws recognisable-but-wrong ships. Aiming it at the number where the concept actually holds
 * costs nothing except a longer bar, and the squadron has the screenshots.
 *
 * `ideal` is now a genuine stretch beyond reliable: more angles, more lighting, more variety. It
 * keeps mattering after the bar is full, which is the point of showing it.
 */
export interface TrainingCategory {
  readonly key: string;
  readonly label: string;
  /** Shown under the label. Says what a GOOD submission looks like, not what the category is. */
  readonly guidance: string;
  readonly min: number;
  readonly ideal: number;
}

export const TRAINING_CATEGORIES: readonly TrainingCategory[] = [
  {
    key: 'ship-exterior',
    label: 'Ship exteriors',
    guidance:
      'The whole ship in frame, from outside. Vary the angle and the lighting — twenty shots of the same ship on the same pad from the same side teach less than six taken properly.',
    min: 60,
    ideal: 120,
  },
  {
    key: 'ship-cockpit',
    label: 'Cockpits and interiors',
    guidance: 'From the pilot seat or inside the ship. HUD is fine; a full-screen menu is not.',
    min: 50,
    ideal: 100,
  },
  {
    key: 'station',
    label: 'Stations and ports',
    guidance:
      'Approach, the mail slot, the interior bays, surface ports. Include the type in your description if you know it.',
    min: 80,
    ideal: 160,
  },
  {
    key: 'planet-surface',
    label: 'Planetary surfaces',
    guidance: 'Landed or low altitude. Terrain, canyons, ice, lava — say which planet if you know.',
    min: 80,
    ideal: 160,
  },
  {
    key: 'space',
    label: 'Deep space and phenomena',
    guidance: 'Nebulae, rings, neutron jets, black holes, notable stars. No ship needed.',
    min: 80,
    ideal: 160,
  },
  {
    key: 'combat',
    label: 'Combat',
    guidance: 'Weapons firing, shields taking hits, conflict zones, interdictions.',
    min: 60,
    ideal: 120,
  },
  {
    key: 'srv-onfoot',
    label: 'SRV and on foot',
    guidance: 'Surface vehicles, suits, settlements from the ground.',
    min: 60,
    ideal: 120,
  },
] as const;

/** Look one up. Null for anything not in the list — a caller may not invent a category. */
export function trainingCategory(key: string): TrainingCategory | null {
  return TRAINING_CATEGORIES.find((c) => c.key === key) ?? null;
}

/**
 * What the uploader accepts.
 *
 * ★ NARROWER THAN WHAT WE CAN STORE, DELIBERATELY ★
 *
 * The media pipeline handles GIF too. Training does not want it: an animated frame grab is
 * low-resolution, palette-limited and usually interlaced with motion, and it teaches the model
 * compression artefacts. Accepting a format we will silently never train on wastes a member's time
 * and their upload.
 */
export const TRAINING_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * What the file picker offers.
 *
 * ★ EXTENSIONS AS WELL AS MIME TYPES, AND .jpg IS THE REASON ★
 *
 * Reported 2026-08-01: "we need to allow .jpg files please."
 *
 * They were always meant to be allowed — a .jpg IS image/jpeg. The failure was that the picker
 * listed MIME types only, and the browser gate compared `file.type` verbatim. Both break on the
 * same file depending on where it came from:
 *
 *   - Windows reports `image/jpg` for .jpg when the registry association has been rewritten by a
 *     photo editor. Not a real MIME type, and not in the list above.
 *   - A file dragged from some archive tools, or off a network share, arrives with `type` set to
 *     the EMPTY STRING. The browser simply does not know.
 *
 * In both cases a perfectly good JPEG was refused with "that file type cannot be used", which is
 * both wrong and unactionable — there is nothing the member can do about their registry.
 *
 * Naming the extensions fixes the picker; `isTrainableImage` below fixes the gate.
 */
export const TRAINING_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';

/**
 * Whether a chosen file can be used, judged on type OR extension.
 *
 * ★ THIS IS COURTESY, NOT SECURITY ★
 *
 * The server decides the real format by DECODING the bytes — a PNG announced as JPEG is stored
 * correctly as a PNG, and nothing here is trusted. This exists so a member is told instantly rather
 * than after a twelve-megabyte upload, and so a browser that is vague about a file's type does not
 * cost them a screenshot.
 */
export function isTrainableImage(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  // `image/jpg` is not a real MIME type. Browsers emit it anyway.
  if (type === 'image/jpg') return true;
  if ((TRAINING_IMAGE_TYPES as readonly string[]).includes(type)) return true;

  // Type absent or unrecognised: fall back to the name. The decode still has the final say.
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

/** Said to the member, in the words they need rather than as a MIME list. */
export const TRAINING_TYPES_NOTE = 'PNG, JPG or WebP, at least 1280px on the long edge.';

/**
 * How long a description has to be.
 *
 * ★ THE DESCRIPTION IS THE ENTIRE VALUE OF THE UPLOAD ★
 *
 * A thousand unlabelled screenshots teach a model nothing. A hundred labelled "Krait Mk II,
 * exterior, docked at an orbis starport, night side" teach it to draw a Krait Mk II. An image with
 * "cool shot" attached is worse than no image, because it dilutes the ones that are labelled.
 *
 * Twenty characters is low enough not to be a chore and high enough to exclude "nice".
 */
export const MIN_DESCRIPTION_CHARS = 20;
export const MAX_DESCRIPTION_CHARS = 500;

/** Where a category stands. What the progress bar draws. */
export interface CategoryProgress {
  readonly key: string;
  readonly label: string;
  readonly guidance: string;
  /** Approved and usable for training. */
  readonly approved: number;
  /** Submitted, awaiting an officer. Shown separately — see below. */
  readonly pending: number;
  readonly min: number;
  readonly ideal: number;
  /** 0-1 against `min`. Clamped, so a finished category does not draw past the end of its bar. */
  readonly fraction: number;
  /** True once `min` is met — the category can be trained, even if more would help. */
  readonly trainable: boolean;
}

/**
 * Turns counts into what the page draws.
 *
 * ★ PENDING IS COUNTED SEPARATELY AND NEVER TOWARDS THE BAR ★
 *
 * A member who uploads thirty images should not see the bar fill and then empty again when an
 * officer rejects half of them. The bar tracks what is actually usable; pending is shown beside it
 * as "awaiting review", which is honest about both.
 */
export function categoryProgress(
  key: string,
  counts: { approved: number; pending: number },
): CategoryProgress | null {
  const c = trainingCategory(key);
  if (c === null) return null;

  return {
    key: c.key,
    label: c.label,
    guidance: c.guidance,
    approved: counts.approved,
    pending: counts.pending,
    min: c.min,
    ideal: c.ideal,
    fraction: Math.min(1, counts.approved / c.min),
    trainable: counts.approved >= c.min,
  };
}
