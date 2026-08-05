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
 * The split is why screening never queues behind a banner being generated — they are not on the
 * same GPU — and it is also why the text model is now pinned in memory permanently. Nothing else
 * wants that card. See SCREEN_TIMEOUT_MS for the bug that came from not revisiting this when the
 * split happened.
 *
 * Every decision below follows from that. Failure is explicit rather than silent, and "unavailable"
 * is a first-class answer rather than an exception nobody handles.
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
 * Screening is synchronous: the member is watching a button. With the model resident this takes
 * about a fifth of a second, so twenty is enormous — deliberately.
 *
 * ★ IT WAS EIGHT, AND EIGHT WAS WRONG BY SEVEN TENTHS OF A SECOND ★
 *
 * Measured 2026-07-31, on the machine this actually runs on:
 *
 *   model resident    0.22s
 *   model evicted     8.70s
 *   the old timeout   8.00s
 *
 * The model was being evicted after five minutes idle, so every post after a quiet spell paid the
 * cold load — and missed by a hair. Members saw their posts held for review; the log said "No
 * answer from the model", which reads like a broken GPU rather than a timeout set slightly too
 * tight.
 *
 * Both halves are fixed: the model no longer unloads (MODEL_KEEP_ALIVE, and a heartbeat), and this
 * is now generous enough to survive a genuine cold start rather than converting it into a held
 * post. In the normal case nobody waits anywhere near it.
 *
 * It is still bounded, because an unbounded wait is a member who thinks the site has frozen.
 */
export const SCREEN_TIMEOUT_MS = 20_000;

/**
 * Keeps the model resident, sent with every request.
 *
 * ★ WHY THIS IS IN THE REQUEST AND NOT LEFT TO THE SERVER'S CONFIG ★
 *
 * `tools/start-ai.cmd` also sets this, and that file is one machine's launcher — production reaches
 * the SAME model server through a tunnel, and a future instance may be started by hand, by a
 * service manager, or by somebody who has never read that file. Sending it per request means the
 * guarantee travels with the call instead of depending on how the process happened to be launched.
 *
 * -1 means never unload. See SCREEN_TIMEOUT_MS above for what evicting it cost.
 */
export const MODEL_KEEP_ALIVE = -1;

/**
 * How often to poke the model so it stays loaded.
 *
 * ★ A HEARTBEAT, BECAUSE KEEP-ALIVE IS NOT A GUARANTEE ★
 *
 * `MODEL_KEEP_ALIVE` covers the ordinary case. It does not cover the model server being restarted,
 * the machine waking from sleep, or somebody running another model that evicts ours. Any of those
 * leaves the next member to post paying the cold load — which is the exact failure this whole
 * section exists to prevent.
 *
 * Four minutes: frequent enough that nothing realistically evicts the model between pokes, rare
 * enough to be invisible. The poke is a single token, so it costs nothing.
 */
export const MODEL_WARM_INTERVAL_MS = 4 * 60_000;

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

PROFANITY IS NOT THE QUESTION. WHO IT IS AIMED AT IS.

This is an adult gaming squadron and members swear constantly. Swearing ABOUT something — the game,
a ship, a situation, themselves — is normal and must pass. Swearing AT a person is an attack, and
the attack is what you are judging, not the words used to deliver it.

PASS, profanity about a thing:
- "that run was fucking brutal, lost the ship at the last jump"
- "FIRST POST HERE Fuckers!"            (greeting the room, not attacking anyone)
- "I died like an idiot, again"
- "get rekt, that was a terrible gank"
- "the Empire are slaving scum and deserve everything they get"   (an in-game faction)

FLAG, the same words aimed at a person:
- "fuck you looser!"                     (second person IS a target, named or not)
- "you're a worthless piece of shit"
- "nobody wants you here, go away"
- "shut up and kill yourself"

The test is DIRECTION, not vocabulary. "This is fucked" passes. "You are fucked" does not.
A post addressed at "you", or at a member by name, in insulting terms, is harassment even if it is
one short line and even if the writer would call it banter. You do not need to know whether they
are friends.

Slurs, sexual content, threats and hate about a group are flagged whatever the tone, whoever the
audience, and however jokey the framing.

If you are unsure, do not flag it. A human reviews everything you flag, and false alarms cost that
human's time and the member's goodwill. Flagging ordinary banter is the WORST outcome here: it holds
a normal post, annoys a member, and teaches officers to stop reading the queue.`;

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
