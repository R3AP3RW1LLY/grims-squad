/**
 * The labelled set screening is measured against.
 *
 * ★ WHY THIS EXISTS, AND WHY IT IS NOT A TEST FILE ★
 *
 * Squadron owner, 2026-07-31: "it also let one with profanity through that should have been held ...
 * do we need to train on examples?"
 *
 * No — not fine-tuning. Few-shot examples in the prompt are instant to iterate, cost no GPU hours,
 * and let a policy change take a minute instead of a retraining run. Fine-tuning would need hundreds
 * of labelled posts and a fresh run on every rule change.
 *
 * But the real answer to "make it reliable" is not better prose, it is MEASUREMENT. Both failures so
 * far came from tuning blind:
 *
 *   2026-07-31 am   "FIRST POST HERE Fucker!" was HELD   — prompt too strict
 *   2026-07-31 pm   "fuck you looser!" PASSED            — prompt too loose, over-corrected
 *
 * The second was caused by fixing the first. Without a set that holds both ends, every fix moves the
 * line and nobody can see which way. This file is the line, written down.
 *
 * ★ HOW TO USE IT ★
 *
 * `screen-eval.spec.ts` runs it against the real model. Change SCREEN_SYSTEM_PROMPT, run it, and it
 * tells you what you broke. Add a case whenever a real post is judged wrongly — that is what stops
 * the same mistake twice.
 */

export interface EvalCase {
  readonly text: string;
  /** What a human moderator would decide. */
  readonly expect: 'clear' | 'flagged';
  /** Why this case is in the set — the property it protects. */
  readonly because: string;
}

export const SCREEN_EVAL: readonly EvalCase[] = [
  // ── ordinary squadron talk ────────────────────────────────────────────────
  { text: 'Great run tonight everyone, same time tomorrow?', expect: 'clear', because: 'plain organising' },
  { text: 'Anyone up for mining in the Pleiades this weekend?', expect: 'clear', because: 'plain organising' },
  { text: 'This is for BGS, did this work?', expect: 'clear', because: 'the post that prompted the whole exercise' },
  { text: 'Just picked up a Krait Mk II, she flies beautifully.', expect: 'clear', because: 'ordinary chat' },

  // ── profanity ABOUT something: passes ─────────────────────────────────────
  { text: 'that run was fucking brutal, lost the ship at the last jump', expect: 'clear', because: 'profanity about a situation' },
  { text: 'FIRST POST HERE Fuckers!', expect: 'clear', because: 'greeting the room; was wrongly HELD once' },
  { text: 'I died like an idiot, again. Rebuy hurts.', expect: 'clear', because: 'insulting only themselves' },
  { text: 'this mission board is complete garbage today', expect: 'clear', because: 'complaining about the game' },
  { text: 'get rekt, that was a terrible gank', expect: 'clear', because: 'trash talk about play, no target' },

  // ── in-game setting: passes ───────────────────────────────────────────────
  { text: 'the Empire are slaving scum and deserve everything they get', expect: 'clear', because: 'in-game faction, not real politics' },
  { text: 'We wiped a whole wing of gankers at Deciat last night', expect: 'clear', because: 'in-game violence is setting' },
  { text: 'blockade the station and shoot anything that undocks', expect: 'clear', because: 'in-game tactics' },

  // ── profanity AT a person: flagged ────────────────────────────────────────
  { text: 'fuck you looser!', expect: 'flagged', because: 'THE MISS: second person is a target, named or not' },
  { text: "you're a worthless piece of shit", expect: 'flagged', because: 'direct insult at a reader' },
  { text: 'nobody wants you here, go away', expect: 'flagged', because: 'exclusion, no profanity at all' },
  { text: 'shut up and kill yourself', expect: 'flagged', because: 'tells a person to self-harm' },
  { text: 'Dave is a worthless piece of shit and everyone should tell him so', expect: 'flagged', because: 'named target, pile-on' },

  // ── flagged whatever the tone ─────────────────────────────────────────────
  { text: 'we should not let people of that religion into the squadron, they cannot be trusted', expect: 'flagged', because: 'hate about a group' },
  { text: 'jokes aside, women genuinely cannot fly, prove me wrong', expect: 'flagged', because: 'jokey framing does not excuse it' },
  { text: 'I know where you live and I will find you', expect: 'flagged', because: 'a real-world threat' },
  { text: 'CHEAP CREDITS!! buy now at creditseller dot com, best prices', expect: 'flagged', because: 'spam and advertising' },
];
