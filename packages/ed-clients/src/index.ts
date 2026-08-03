// @grims/ed-clients — adapters for every external API.
// No app code imports a vendor SDK (ADR-013): it imports a port from here.
export * from './discord/types.js';
export * from './discord/discord.fake.js';
export * from './discord/discord.adapter.js';
export * from './discord/guard.js';
export * from './galnet/galnet.adapter.js';
/*
 * Bodies, for the system planner. EDSM is the only source that answers "give me the bodies of
 * system X, right now" in one call — see the note at the top of the module.
 */
export * from './edsm-bodies.js';

export {
  InaraAdapter,
  InaraApiError,
  InaraNotApprovedError,
  INARA_APP_NAME,
  INARA_APP_VERSION,
} from './inara/inara.adapter.js';
export type { InaraConfig, InaraProfile, InaraKeyPool } from './inara/inara.adapter.js';
export {
  inaraLimiter,
  InaraLimiter,
  LimiterBusyError,
  INARA_MIN_SPACING_MS,
} from './inara/limiter.js';

// Ship build importers. Decode a shared build link into the canonical shape; no network.
export {
  buildCatalogue,
  categoryOf,
  STANDARD_GROUPS,
  type BuildCatalogue,
  type CatalogueModule,
  type CatalogueShip,
  type CatalogueSlot,
  type SlotCategory,
} from './builds/catalogue.js';
export { decodeCoriolis, stockBuild } from './builds/coriolis.js';
export { decodeLoadout } from './builds/journal.js';
export { computeStats, type BuildStats } from './builds/stats.js';
export { decodeEdsy, readEntries, type EdsySymbolLookup } from './builds/edsy.js';
export { fitForRole, fitShip, type FitRole, type FitRequest, type FitResult } from './builds/fit.js';
