/**
 * The promotion engine, which now lives in `@grims/shared`.
 *
 * ★ MOVED 2026-08-02, AND THIS SHIM IS WHY NOTHING ELSE CHANGED ★
 *
 * Squadron owner: "add a button to each month, that will trigger promotions ... also add a promote
 * feature to the /app/members page."
 *
 * Both of those are the WEBSITE deciding who gets promoted, and the API cannot import from the
 * worker. The alternative was a second implementation of the ladder rules behind the buttons — two
 * answers to "has this member earned Sergeant", diverging the first time either was touched.
 *
 * The engine was already portable: one import, `assertPromotionsPermitted`, and a store interface
 * it is handed. So it moved wholesale and each app keeps its own wiring.
 *
 * This file re-exports it so the monthly job, `index.ts` and three spec files carry on importing
 * from where they always did.
 */
export {
  PromotionEngine,
  formatReport,
  type LadderRung,
  type MemberStanding,
  type PromotionStore,
  type WouldPromote,
  type RankApplier,
  type Failed,
  type Skipped,
  type PromotionReport,
  type RunOptions,
} from '@grims/shared';
