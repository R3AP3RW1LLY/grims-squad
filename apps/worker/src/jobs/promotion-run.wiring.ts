/**
 * The promotion wiring, which now lives in the packages both apps share.
 *
 * ★ SPLIT 2026-08-02 ★
 *
 * The website needs to run promotions too — a button per month, and a promote control on the
 * members page — and the API cannot import from the worker.
 *
 * `readLadderFromSsot` reads a file, so it belongs in `@grims/shared/server`. `PrismaPromotionStore`
 * is where the RULES live, which months count toward a rank, so it belongs in `@grims/db` alongside
 * the other stores both apps use. A second copy of either would be two answers to "has this member
 * earned Sergeant".
 *
 * Re-exported here so the monthly job, `index.ts` and the ladder spec carry on unchanged.
 */
export { readLadderFromSsot } from '@grims/shared/server';
export { PrismaPromotionStore } from '@grims/db';
