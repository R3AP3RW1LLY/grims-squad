// @grims/ed-clients — adapters for every external API.
// No app code imports a vendor SDK (ADR-013): it imports a port from here.
export * from './discord/types.js';
export * from './discord/discord.fake.js';
export * from './discord/discord.adapter.js';
export * from './discord/guard.js';
export * from './galnet/galnet.adapter.js';

export { InaraAdapter, InaraApiError, InaraNotApprovedError } from './inara/inara.adapter.js';
export type { InaraConfig, InaraProfile } from './inara/inara.adapter.js';
export { inaraLimiter, InaraLimiter, INARA_MIN_SPACING_MS } from './inara/limiter.js';
