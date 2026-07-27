import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../auth/auth.guard.js';
import { STATS_STORE } from './stats.tokens.js';
import type { StatsStore, SquadronStats } from './stats.store.js';

/**
 * Public squadron statistics (P1.9).
 *
 * ★ FROM OUR OWN DATABASE, NEVER A THIRD PARTY ★
 *
 * The acceptance criterion is explicit about this, and the reason is that the
 * landing page is the first thing anyone sees. Reading it live from Inara or
 * EDSM would put their availability, their rate limits and their latency in
 * front of the squadron's front door — and every one of those numbers already
 * exists here.
 *
 * ★ WHAT IS AND IS NOT PUBLIC ★
 *
 * Counts are public: the squadron's size is on Inara anyway, and "how many of
 * us are active" says nothing about any individual. WHO those people are is
 * private and is governed by INV-027 — which is why nothing here returns a
 * name, a handle or an id.
 */
@Controller('v1/public')
export class StatsController {
  constructor(@Inject(STATS_STORE) private readonly store: StatsStore) {}

  @Public()
  @Get('stats')
  async stats(): Promise<SquadronStats> {
    return this.store.stats();
  }
}
