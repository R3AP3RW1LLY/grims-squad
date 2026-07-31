/**
 * The fan art studio.
 *
 * ★ WHAT THE OWNER ASKED FOR ★
 *
 * Squadron owner, 2026-07-30: "what can we use to make some awesome fan art ... maybe we submit a
 * screenshot and it can take that and turn it into something cooler etc!"
 *
 * ★ THE IDEA THE WHOLE THING RESTS ON ★
 *
 * `ai-image.ts` explains why the model cannot draw Elite ships: no open model knows what a Krait
 * Mk II looks like, so asking for one returns a generic spaceship.
 *
 * A SCREENSHOT SOLVES THAT COMPLETELY. The member supplies the geometry — their actual ship, their
 * actual pose, their actual cockpit — and the model supplies the sky, the light and the mood. The
 * ship comes out right because it was never generated; it was preserved.
 *
 * Every operation below except `generate` starts from an image the member already has, and that is
 * not a coincidence. It is the reason this feature works at all.
 */

/**
 * What the studio can do.
 *
 * ★ FOUR OPERATIONS, ORDERED BY HOW MUCH THEY CHANGE ★
 *
 *   upscale    changes nothing, adds resolution
 *   restyle    keeps the composition, repaints it
 *   structure  keeps the SHAPES, replaces everything else
 *   instruct   does what you asked in words
 *   generate   no input image; the signature-banner path
 *
 * They are distinct rather than one operation with flags because they need genuinely different
 * graphs and different models — collapsing them would produce a function with six parameters where
 * four combinations are meaningless.
 */
export const STUDIO_OPERATIONS = [
  'generate',
  'restyle',
  'structure',
  'instruct',
  'upscale',
] as const;
export type StudioOperation = (typeof STUDIO_OPERATIONS)[number];

/**
 * How far `restyle` is allowed to travel from the original.
 *
 * ★ THE SINGLE MOST IMPORTANT NUMBER A MEMBER WILL TOUCH ★
 *
 * This is the img2img denoise strength, and it is the difference between a colour grade and an
 * unrelated picture. Members will not know that, so the UI presents these as named stops rather
 * than a bare 0–1 slider — a number with no meaning attached gets dragged to the end, and the end
 * is where their ship stops being their ship.
 */
export const RESTYLE_STRENGTHS = [
  {
    id: 'grade',
    label: 'Polish',
    strength: 0.3,
    hint: 'Same shot, better light and colour.',
  },
  {
    id: 'paint',
    label: 'Repaint',
    strength: 0.5,
    hint: 'Your scene, painted. The usual choice.',
  },
  {
    id: 'reimagine',
    label: 'Reimagine',
    strength: 0.72,
    hint: 'Loosely inspired by your shot. Your ship may not survive.',
  },
] as const;

export type RestyleStrengthId = (typeof RESTYLE_STRENGTHS)[number]['id'];

/** The default. `paint` because it is the one that produces the result people expected. */
export const DEFAULT_RESTYLE: RestyleStrengthId = 'paint';

/**
 * What `structure` locks onto.
 *
 * ★ DEPTH FOR SHIPS, EDGES FOR INTERFACES ★
 *
 * Depth understands three-dimensional form, so a hull keeps its volume and its pose while the
 * paint, lighting and background change completely. That is the right choice for a ship beauty
 * shot and it is the default.
 *
 * Canny follows hard outlines instead. Better when the source is flat or graphic — a system map, a
 * station interior, anything where the lines ARE the subject and depth would read as a flat plane.
 */
export const STRUCTURE_MODES = [
  {
    id: 'depth',
    label: 'Keep the shape',
    hint: 'Best for ships. Holds the form, changes everything else.',
  },
  {
    id: 'edges',
    label: 'Keep the outlines',
    hint: 'Best for flat or graphic shots.',
  },
] as const;

export type StructureMode = (typeof STRUCTURE_MODES)[number]['id'];

/**
 * How tightly `structure` is held to the source.
 *
 * 0.6 rather than 1.0. At full strength ControlNet reproduces the source so faithfully that the
 * restyle has nowhere to go, and members report it as "it just gave me my screenshot back". At 0.6
 * the silhouette is unmistakably theirs and the render is unmistakably new.
 */
export const STRUCTURE_STRENGTH = 0.6;

/**
 * Upscale factors offered.
 *
 * The models are 4× natively; 2× is the same model followed by a downscale, which is sharper than
 * generating at 2× directly. Anything past 4× on a 1080p source is inventing detail that was never
 * photographed and looks like it.
 */
export const UPSCALE_FACTORS = [2, 4] as const;
export type UpscaleFactor = (typeof UPSCALE_FACTORS)[number];

/**
 * Longest edge accepted as an input, in pixels.
 *
 * ★ NOT THE SAME LIMIT AS AN ORDINARY UPLOAD ★
 *
 * `MAX_EDGE` in the media pipeline is 2400 and exists to bound what we STORE. This bounds what the
 * GPU is asked to encode into a latent, which is a different and much sharper cost: VAE-encoding a
 * 4K image under `--lowvram` is minutes, not seconds.
 *
 * 1920 covers every screenshot anybody actually takes. Larger inputs are downscaled rather than
 * refused — somebody's 4K screenshot is a perfectly good source and telling them to resize it
 * themselves is a worse answer than doing it for them.
 */
export const MAX_INPUT_EDGE = 1920;

/**
 * Output dimensions are rounded to a multiple of this.
 *
 * FLUX's latent is downscaled by 8 then patched by 2. An unsupported size is silently rounded, and
 * the image comes back a slightly different shape to the input — which for a restyle means the
 * result no longer lines up with the source the member is comparing it against.
 */
export const SIZE_GRANULARITY = 16;

/** Rounds a dimension to something FLUX will accept without silently changing it. */
export function toValidSize(n: number): number {
  const rounded = Math.round(n / SIZE_GRANULARITY) * SIZE_GRANULARITY;
  return Math.max(SIZE_GRANULARITY, rounded);
}

/**
 * Fits a source image inside `MAX_INPUT_EDGE`, on the FLUX size grid, preserving aspect.
 *
 * Returns the size to encode at. Never enlarges: upscaling a small screenshot before generating
 * wastes GPU time on pixels the source never had, and the upscale operation exists for that.
 */
export function fitInputSize(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  const scale = longest > MAX_INPUT_EDGE ? MAX_INPUT_EDGE / longest : 1;
  return {
    width: toValidSize(width * scale),
    height: toValidSize(height * scale),
  };
}

/**
 * Guidance added to a restyle or structure prompt.
 *
 * ★ SHORTER THAN THE BANNER'S, AND DELIBERATELY ★
 *
 * `PROMPT_GUIDANCE` in ai-image.ts fights hard for a specific shape — a wide banner with a quiet
 * left third — because the output has one job. Fan art has no such constraint, and a heavy preamble
 * would flatten everything members ask for into the same picture.
 *
 * What survives is only the part that is always true: no lettering. A model writing garbled words
 * across somebody's ship is the one failure that ruins an image regardless of what they wanted.
 */
export const ART_GUIDANCE = 'no text, no words, no watermark, no logos';

/** The whole prompt for a restyle or structure job. */
export function buildArtPrompt(memberPrompt: string): string {
  const cleaned = memberPrompt.trim().replace(/\s+/g, ' ').slice(0, MAX_ART_PROMPT);
  return cleaned === '' ? ART_GUIDANCE : `${cleaned}, ${ART_GUIDANCE}`;
}

/** Longer than the banner's 400: fan art descriptions are genuinely more detailed. */
export const MAX_ART_PROMPT = 800;

/**
 * Starting points, per operation.
 *
 * An empty prompt box gets "make it cool" and returns something disappointing, and the member
 * concludes the tool is bad rather than that the prompt was thin. These teach the shape of a good
 * prompt — a subject, a palette, a mood — in the two seconds somebody spends reading them.
 */
export const STUDIO_EXAMPLES: Readonly<Record<StudioOperation, readonly string[]>> = {
  generate: [
    'deep blue nebula with drifting dust, distant cold stars',
    'orange gas giant at sunrise, ring shadow across the clouds',
  ],
  restyle: [
    'dramatic concept art, volumetric light, deep shadows, cinematic',
    'oil painting, thick brushwork, warm palette',
    'cold hard sci-fi realism, harsh sunlight, long shadows',
  ],
  structure: [
    'dramatic concept art, nebula behind, rim lighting on the hull',
    'sunrise over a ringed gas giant, warm rim light, deep shadow',
  ],
  instruct: [
    'make this a dramatic sunset with warm light',
    'add a large nebula in the background',
    'turn this into painted concept art',
    'remove the HUD and interface elements',
  ],
  upscale: [],
};

/**
 * How long the whole studio job may take before it is abandoned.
 *
 * ★ MUCH LONGER THAN A BANNER, BECAUSE IT IS A QUEUED JOB ★
 *
 * `IMAGE_TIMEOUT_MS` is three minutes because a member is holding an HTTP request open. Studio work
 * is submitted to a queue and collected later, so nobody is waiting on a socket — which means the
 * limit can be set by what is REASONABLE rather than by what a proxy tolerates.
 *
 * Ten minutes covers a structure job followed by a 4× upscale on a card that is also running a
 * game, with room to spare. Past that something is wrong rather than slow.
 */
export const STUDIO_TIMEOUT_MS = 600_000;

/**
 * How many studio jobs a member may submit per hour.
 *
 * Tighter than banner generation counts images, because a studio job can be minutes of GPU rather
 * than seconds — and unlike a banner, nobody is sitting watching it, so there is no natural brake
 * on submitting more.
 */
export const STUDIO_RATE_LIMITS = {
  memberPerHour: 8,
  globalPerHour: 40,
  /** Queued-but-unfinished jobs one member may have. Stops one person filling the queue. */
  memberQueued: 3,
} as const;
