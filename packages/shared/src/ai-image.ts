/**
 * Generated banner artwork.
 *
 * ★ WHAT THE OWNER ASKED FOR ★
 *
 * Squadron owner, 2026-07-30: "when we add the AI system, please add a feature to this page that
 * creates the signature for them or generates 3 options they can choose from etc. also give them a
 * prompt to describe what they want".
 *
 * ★ THE ONE THING TO UNDERSTAND BEFORE READING ANY OF THIS ★
 *
 * The model generates the BACKDROP. It does not generate the signature.
 *
 * That is not a limitation of this implementation, it is what diffusion models are. They are very
 * good at atmosphere — nebulae, starfields, the glow off a hull — and reliably bad at exactly two
 * things this feature would otherwise want:
 *
 *   1. TEXT. Ask for "CMDR Grim" and you get mangled pseudo-lettering. Every time. This is why the
 *      banner's name, ranks and badge are drawn as real SVG layers by the generator and always have
 *      been. The artwork goes UNDERNEATH that, and the SVG stays authoritative.
 *
 *   2. ELITE DANGEROUS SHIPS. No open model knows what an Anaconda or a Krait Mk II looks like. Ask
 *      and you get a generic spaceship, or an actual snake. `PROMPT_GUIDANCE` below steers away
 *      from naming ships for this reason, rather than letting members discover it one at a time.
 *
 * So the honest framing, and the one the UI uses: describe a SCENE, get a backdrop.
 */

/**
 * How long to wait for one image.
 *
 * ★ WHY THIS IS TWENTY TIMES THE SCREENING TIMEOUT ★
 *
 * Screening is a member watching a post button; this is a member who pressed "generate" and expects
 * to wait. More to the point, the image model runs on the card the owner plays Elite Dangerous on,
 * under `--lowvram`, which streams weights from system RAM rather than taking memory the game needs.
 * That is the trade: a generation that would take ten seconds on an idle card can take a minute or
 * more mid-flight, and timing that out would mean the feature only works when nobody is playing.
 */
export const IMAGE_TIMEOUT_MS = 180_000;

/**
 * How often to ask whether the image is ready.
 *
 * ComfyUI has no completion callback — the only way to know is to ask. Two seconds is short enough
 * that a fast generation is not padded by the poll, and long enough that a three-minute wait is
 * ninety requests rather than several thousand.
 */
export const IMAGE_POLL_MS = 2_000;

/**
 * How many options a member gets from one prompt.
 *
 * Three, as asked. Generated SEQUENTIALLY, not in parallel — see the note on the client. One card,
 * shared with a running game: three at once is three times the peak VRAM, which is the one thing
 * that turns "the banner took a while" into "Elite crashed".
 */
export const IMAGE_OPTIONS = 3;

/**
 * A ceiling on the whole batch, separate from the per-image timeout.
 *
 * ★ THIS EXISTS BECAUSE OF MEASURED VARIANCE, NOT THEORY ★
 *
 * Generation was timed at 24–30 seconds typically, with one run at 66. Three options at the typical
 * rate is a ~80 second HTTP request, which is already long; three at the bad rate is over three
 * minutes, which is long enough for an intermediary to give up on a response that was going to
 * arrive.
 *
 * So the service stops STARTING new options once this much time has gone, and returns the ones it
 * has. A member who waited two and a half minutes gets two good banners instead of a timeout —
 * which is the same trade as the partial-result rule, applied to slowness rather than failure.
 *
 * Deliberately larger than two typical generations and smaller than three bad ones: it should never
 * fire on a healthy machine, and always fire before a request becomes unservable.
 */
export const IMAGE_BATCH_BUDGET_MS = 150_000;

/**
 * What is actually generated, before downscaling.
 *
 * ★ WHY NOT SIMPLY 600×160, THE SIZE OF THE BANNER ★
 *
 * Two reasons.
 *
 * FLUX works in a latent space downscaled by eight and then patched by two, so both dimensions must
 * be multiples of sixteen. 160 is not. Handing it an unsupported size does not error — it silently
 * rounds, and the image comes back a slightly different shape to the one the layout expects.
 *
 * And generating at roughly double and downscaling is simply better. Diffusion detail is grainy at
 * the pixel level; a 2× box-down averages that away and produces the crisp result the owner asked
 * for ("higher quality render"). Generating AT 600×160 looks soft and noisy by comparison.
 *
 * 1200×320 is a multiple of sixteen on both axes AND exactly twice the banner, so the downscale is
 * a clean 2:1 with no crop and no distortion — nothing the member saw in the preview is lost or
 * stretched.
 *
 * The "exactly twice" is load-bearing and easy to break. 1216 was the first candidate here — also a
 * multiple of sixteen, and wrong: 1216÷320 is 3.80 against the banner's 3.75, so every generated
 * image would have been stretched by about one percent on the way down. Invisible in review,
 * permanent in the output. `image-size.spec.ts` asserts the ratio so the next edit cannot
 * reintroduce it.
 */
export const IMAGE_GEN_WIDTH = 1200;
export const IMAGE_GEN_HEIGHT = 320;

/** Where it ends up: the published banner size. Downscaled from the above with sharp. */
export const BANNER_WIDTH = 600;
export const BANNER_HEIGHT = 160;

/**
 * Sampling settings for FLUX.1-schnell.
 *
 * ★ FOUR STEPS AND NO GUIDANCE IS NOT A CORNER BEING CUT ★
 *
 * Schnell is the step-distilled and guidance-distilled variant: it is TRAINED to land in four steps
 * with the classifier-free guidance scale at 1.0. Turning either up does not improve the image, it
 * degrades it — higher cfg on a distilled model produces the blown-out, over-saturated look people
 * mistake for a bad prompt.
 *
 * It also means a negative prompt does nothing here. At cfg 1.0 there is no unconditional branch for
 * it to steer, so the field is deliberately absent from the request type below rather than accepted
 * and quietly ignored.
 */
export const IMAGE_STEPS = 4;
export const IMAGE_CFG = 1.0;
export const IMAGE_SAMPLER = 'euler';
export const IMAGE_SCHEDULER = 'simple';

/**
 * Prepended to whatever the member types.
 *
 * ★ IT STEERS AWAY FROM THE TWO KNOWN FAILURES ★
 *
 * See the header. Members will ask for their ship by name and for their commander name in the
 * image, because both are obvious things to want. Both come back wrong. Saying so in the prompt is
 * cheaper than a support conversation per member, and much cheaper than a banner going out with
 * "CMDR GRIN" rendered into the artwork.
 *
 * "wide cinematic banner" and "empty space on the left" are here because the signature layout draws
 * the commander's name over the left third. Artwork with its subject dead-centre fights that text
 * every time; artwork with a quiet left side reads as though it was designed for it.
 */
export const PROMPT_GUIDANCE = [
  'wide cinematic space banner, digital art, dramatic lighting, atmospheric',
  'no text, no words, no lettering, no logos, no watermark',
  'empty darker space on the left third for a name overlay',
].join(', ');

/** The whole prompt sent to the model. Exported so a test can assert the guidance survives. */
export function buildImagePrompt(memberPrompt: string): string {
  const cleaned = memberPrompt.trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT_LENGTH);
  return cleaned === '' ? PROMPT_GUIDANCE : `${cleaned}, ${PROMPT_GUIDANCE}`;
}

/**
 * How much a member may type.
 *
 * Long enough for a real description, short enough that the prompt is not a vehicle for smuggling
 * instructions at the model. 400 characters is roughly four sentences.
 */
export const MAX_PROMPT_LENGTH = 400;

/**
 * Three prompts offered as starting points.
 *
 * ★ WHY THE UI SHOWS EXAMPLES RATHER THAN AN EMPTY BOX ★
 *
 * An empty prompt box gets "cool space banner" and returns something disappointing, and the member
 * concludes the feature is bad rather than that the prompt was thin. Examples teach the shape of a
 * good prompt — a subject, a palette, a mood — in the two seconds somebody spends reading them.
 *
 * All three are scenes rather than objects, for the reason in the header.
 */
export const PROMPT_EXAMPLES = [
  'deep blue nebula with drifting dust, distant cold stars, quiet and vast',
  'orange gas giant at sunrise, ring shadow across the clouds, warm haze',
  'green aurora over a dark ice planet, sharp starfield above, cold and still',
] as const;

/** A generation request, after validation. */
export interface ImageRequest {
  /** The member's own words. Already trimmed and bounded; guidance is added by `buildImagePrompt`. */
  readonly prompt: string;
  /**
   * Seed, or null to let the server choose.
   *
   * Exposed because reproducibility is genuinely useful here: a member who liked option two and
   * wants it "the same but bluer" needs the same seed, or they get an unrelated image.
   */
  readonly seed: number | null;
}

/** One generated option. */
export interface ImageResult {
  /** PNG bytes at BANNER_WIDTH × BANNER_HEIGHT. */
  readonly png: Uint8Array;
  /** The seed used, so the member can ask for a variation on the one they liked. */
  readonly seed: number;
  readonly tookMs: number;
}

/**
 * How often a member may generate.
 *
 * ★ COUNTED IN CALLS, NOT IMAGES ★
 *
 * One entry in `ai_calls` is one request to the generator. The signature builder asks for
 * `IMAGE_OPTIONS` images in a call; the AI designer asks for one, five times.
 *
 * ★ RAISED FROM 5 ON 2026-08-01, AGAINST A MEASUREMENT ★
 *
 * These numbers were sized on the belief that a banner costs "about thirty seconds of the card
 * Elite Dangerous is running on", which put five generations at roughly ten minutes of GPU.
 *
 * Measured on the squadron's own 5070 Ti, through the real ComfyUI workflow: **4.1 seconds** for a
 * 579 KB banner. The estimate was out by a factor of seven, and everything built on it was wrong in
 * the same direction.
 *
 * The consequence was not theoretical. The AI signature designer asks for five backplates per press
 * — one per design — so a single press consumed an entire hour's quota and every press after it was
 * refused. The squadron owner saw no artwork, no progress and no GPU activity, and the reason was a
 * limit doing exactly what it was told.
 *
 * ★ RAISED AGAIN, SAME DAY, BECAUSE TWENTY WAS STILL TOO MEAN ★
 *
 * Twenty allowed four presses of the AI designer an hour, and the owner hit the wall while simply
 * trying the feature: "we cant limit to like 8 images on a signature people may want to run this a
 * few times."
 *
 * Right — a member designing a signature does not get it on the first attempt, and a limit that
 * assumes they will is a limit that only ever fires on somebody using the feature properly.
 *
 * Sixty calls is twelve presses, or about four minutes of GPU an hour per member. That is still
 * well inside the ~450 seconds the original limit meant to allow, because the original was priced
 * at seven times the real cost.
 *
 * ★ WHY IT IS STILL TIGHTER THAN THE ASSISTANT'S LIMIT ★
 *
 * A question costs a second or two and holds no VRAM afterwards. An image holds a diffusion model
 * resident on a card that is also serving post screening, embeddings and, quite often, Elite.
 *
 * There is no anonymous limit because there is no anonymous access: both surfaces are behind a
 * login. An unauthenticated door to a home GPU is not something to rate-limit, it is something not
 * to build.
 */
export const IMAGE_RATE_LIMITS = {
  /** Calls (not images) per signed-in member per hour. One AI-designer press is five. */
  memberPerHour: 60,
  /**
   * Across everybody. A backstop against the squadron collectively occupying the machine.
   *
   * 240 is about sixteen minutes of GPU an hour at the measured rate — a real ceiling on a card
   * that also serves post screening, embeddings and, most evenings, Elite Dangerous.
   */
  globalPerHour: 240,
} as const;

/**
 * Seeds are drawn from this range.
 *
 * ComfyUI accepts a 64-bit seed, but JavaScript integers stop being exact above 2^53 — a seed that
 * cannot survive a round trip through JSON is a seed that does not reproduce, which defeats the
 * point of exposing it. Capped where the arithmetic is still exact.
 */
export const MAX_SEED = Number.MAX_SAFE_INTEGER;
