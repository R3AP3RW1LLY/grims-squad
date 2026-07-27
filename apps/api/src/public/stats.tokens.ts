/** DI token. Symbol, not the class — esbuild emits no decorator metadata (P1.2). */
export const STATS_STORE = Symbol('StatsStore');
export type { StatsStore, SquadronStats } from './stats.store.js';
