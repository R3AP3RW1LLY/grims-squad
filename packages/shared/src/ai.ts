/**
 * The AI service (P2 — moderation and the onboarding assistant).
 *
 * ★ WHAT THE OWNER ASKED FOR ★
 *
 * Squadron owner, 2026-07-30: "we want the AI service to auto moderate the forum ... it should
 * moderate for bullying, harassment, racisim, political and religous views and extremism, ect, if
 * a post is flagged, it must be submitted for human review in the moderation area", and "the ai
 * must ingest and moderate all posts before they are visible / posted to the forum!"
 *
 * It also answers questions: "a trained professional on how to join and the steps required to join
 * so it can help new members onboard".
 *
 * ★ WHY THIS RUNS ON A HOME GPU, AND WHAT THAT IMPLIES ★
 *
 * The model runs on the owner's own machine, reached over an SSH reverse tunnel. That is cheap and
 * private — no member's writing is sent to a third party — and it means the service is genuinely
 * OPTIONAL from the API's point of view: the machine may be off, the tunnel may be down, and the
 * website must keep working.
 *
 * That machine has two graphics cards and the work is split across both, which is worth knowing
 * because it explains the timeouts below:
 *
 *   RTX 3060 (12GB)     Ollama — screening and the assistant. Nothing else touches this card, so
 *                       it is always warm and always fast.
 *   RTX 5070 Ti (16GB)  ComfyUI — banner artwork. This is ALSO the card Elite Dangerous runs on,
 *                       so image work is throttled to leave the game alone. See ai-image.ts.
 *
 * The split is the reason screening can afford an eight-second timeout: it never queues behind a
 * banner being generated, because they are not on the same GPU.
 *
 * Every decision below follows from that. Timeouts are short, failure is explicit rather than
 * silent, and "unavailable" is a first-class answer rather than an exception nobody handles.
 */

/**
 * What the AI is called, everywhere a person can see it.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "please only refer to our AI as GMSD AI please dont mention any 3rd party AI models in this app
 * or website please! this is very important!"
 *
 * ★ WHY THIS IS A CONSTANT AND NOT A STYLE NOTE ★
 *
 * The leak that prompted it was not prose somebody typed — it was `GET /v1/ai/health` returning the
 * configured model name, which the moderation tab then rendered faithfully. Nobody wrote
 * "qwen2.5:7b" anywhere; the value simply travelled from an environment variable to a screen.
 *
 * So the rule is enforced at the BOUNDARY: no route returns a model identifier, and every surface
 * that names the service uses this constant. A convention would have been re-broken by the next
 * person who added a status field.
 *
 * ★ WHAT STAYS ★
 *
 * Model filenames in config, and node names in the image graphs, are how we talk to the runtime —
 * they are wiring, not copy, and renaming them would simply stop the thing working. The rule is
 * about what a member or officer READS, and none of those reach a screen.
 */
export const AI_NAME = 'GMSD AI';

/** What screening concluded about a piece of writing. */
export type ScreenVerdict = 'clear' | 'flagged' | 'unavailable';

/**
 * What the screener looks for.
 *
 * ★ NAMED, BECAUSE A VAGUE INSTRUCTION PRODUCES A VAGUE MODERATOR ★
 *
 * These are the categories the owner listed. Asking a model to "check if this is bad" produces
 * wildly inconsistent judgements between runs; asking it about a fixed list produces something a
 * human reviewer can actually audit — and something the reviewer can disagree with specifically.
 *
 * `political` and `religious` are deliberately narrow: the instruction was to catch arguments
 * being imported into a game squadron, not to flag somebody mentioning that they went to church or
 * that a faction in Elite is a dictatorship. The prompt says so explicitly.
 */
export const SCREEN_CATEGORIES = [
  'harassment',
  'bullying',
  'hate',
  'extremism',
  'sexual',
  'violence',
  'politics',
  'religion',
  'spam',
] as const;
export type ScreenCategory = (typeof SCREEN_CATEGORIES)[number];

export interface ScreenResult {
  readonly verdict: ScreenVerdict;
  /** Which categories fired. Empty for `clear`, and for `unavailable`. */
  readonly categories: readonly ScreenCategory[];
  /**
   * The model's own words, for the human reviewing it.
   *
   * ★ FOR THE REVIEWER, NEVER FOR THE AUTHOR ★
   *
   * The owner chose to tell an author only that their post is held, not why — telling somebody
   * which category fired teaches anybody determined exactly which wording gets through, and they
   * can retry freely. So this is stored and shown in the moderation queue, and never returned to
   * the person who wrote the post.
   */
  readonly reason: string | null;
  /** How long the model took. Recorded so a degrading tunnel is visible before it fails. */
  readonly tookMs: number;
}

/**
 * How long to wait for a verdict before treating the screener as unavailable.
 *
 * ★ WHY SO SHORT ★
 *
 * Screening is synchronous: the member is watching a button. A 7B model on a 3060 Ti answers a
 * short classification in one to three seconds, so anything past eight has gone wrong — the GPU is
 * busy generating banner artwork, the tunnel is stalling, or the machine is asleep.
 *
 * Waiting longer does not produce an answer, it produces a member who thinks the site is broken.
 * Timing out into "held for review" is both faster and more honest.
 */
export const SCREEN_TIMEOUT_MS = 8_000;

/** Assistant replies may run longer — somebody asking a question expects to wait a moment. */
export const ASSISTANT_TIMEOUT_MS = 30_000;

/**
 * The system prompt for screening.
 *
 * ★ IT ASKS FOR JSON AND NOTHING ELSE ★
 *
 * A model asked to "explain your reasoning" will, at length, and then the parser has to find a
 * verdict inside prose. Constraining the output shape is what makes the result mechanically usable
 * rather than something a regex guesses at.
 *
 * ★ AND IT IS TOLD THE CONTEXT ★
 *
 * Without it, a model flags "I destroyed him in that CZ" as violence and "the Empire are slavers"
 * as hate speech — both of which are ordinary Elite Dangerous conversation. A screener that cries
 * wolf on normal play is one officers stop reading, which is worse than no screener.
 */
export const SCREEN_SYSTEM_PROMPT = `You screen forum posts for a video game squadron (Elite Dangerous).

Return ONLY a JSON object, no prose:
{"flagged": boolean, "categories": string[], "reason": string}

Categories: ${SCREEN_CATEGORIES.join(', ')}.

Flag content that is genuinely harmful to a community:
- harassment or bullying aimed at a person
- hateful content about a group (race, religion, sex, sexuality, nationality, disability)
- extremist material or its promotion
- sexual content
- real-world political or religious argument imported into the squadron
- spam or advertising

Do NOT flag ordinary Elite Dangerous conversation. In this game, players destroy ships, fight wars,
run blockades, commit piracy, and criticise in-game factions such as the Empire, the Federation and
the Alliance. In-game violence, in-game politics and in-game slavery are SETTING, not content.
Swearing on its own is not a reason to flag.

If you are unsure, do not flag it. A human reviews everything you flag, and false alarms cost that
human's time and the member's goodwill.`;

/**
 * The system prompt for the assistant.
 *
 * ★ THREE HARD RULES, AND WHY EACH IS HERE ★
 *
 * Squadron owner, 2026-07-30, chose the guardrails: scoped to the squadron and the game, and it
 * must never state rank, permissions or moderation decisions.
 *
 * The last one matters most. A model guessing "you look eligible for promotion" or "your post was
 * probably removed for X" creates an argument an officer then has to unpick — and the member will
 * reasonably believe the site told them so. Those are human decisions and the assistant says so.
 */
export const ASSISTANT_SYSTEM_PROMPT = `You are the assistant for Grim's Squad, an Elite Dangerous squadron.

You help with:
- joining the squadron and the steps involved
- using this website and the companion app
- general Elite Dangerous questions

Rules you must never break:
- Never tell anybody what rank they hold or should hold, whether they qualify for a promotion, or
  what permissions they have. Those are officer decisions. Say an officer can answer it.
- Never explain or guess why a post was held, removed or moderated. Say an officer will be in touch.
- Never invent squadron policy, requirements or deadlines. If the guides do not say it, say you do
  not know and point them at the guides or an officer.
- Stay on the squadron, this website, and Elite Dangerous. Politely decline anything else.

Be brief. Two or three sentences unless they asked for steps, in which case number them.`;

/** Rate limits. Generous for members, tight for anonymous — see the note. */
export const AI_RATE_LIMITS = {
  /** Questions per signed-in member per hour. */
  memberPerHour: 30,
  /**
   * Questions per anonymous caller per hour, keyed on IP.
   *
   * Tighter because it is an unauthenticated door to somebody's home GPU. The people who most need
   * joining help have not signed in yet, so it cannot be zero — but it can be small.
   */
  anonymousPerHour: 8,
  /**
   * Across everybody, per hour.
   *
   * A backstop against the squadron collectively — or one determined person with a lot of IP
   * addresses — occupying the machine. Reached means the assistant politely says it is busy.
   */
  globalPerHour: 300,
} as const;

/** How a logged conversation is classified, so the review screen can filter. */
export type AiCallKind = 'screen' | 'assistant' | 'signature';
