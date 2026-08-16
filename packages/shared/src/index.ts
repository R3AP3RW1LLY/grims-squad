// @grims/shared — Zod schemas, DTOs, enums and the permission bitmask.
// Used by BOTH ends. A DTO changes here and both fail to compile until they agree.
export * from './permissions.js';
export * from './rich-document.js';
export * from './forum-signature.js';
export * from './fonts.js';
export * from './logistics.js';
export * from './ship-names.js';
export * from './ai.js';
export * from './ai-image.js';
export * from './ai-studio.js';
export * from './ai-corpus.js';
export * from './ai-learning.js';
export * from './ai-knowledge.js';
export * from './reputation.js';
export * from './job-channels.js';
export * from './promotion.js';
export * from './signature-design.js';
export * from './orphan-media.js';
export * from './errors.js';
export * from './dto/common.js';
export * from './redirect.js';
export * from './carrier.js';
export * from './station-name.js';
export * from './commodity-category.js';
export { suggestBuildOrder } from './colony-order.js';
export { rankOpportunities, STALE_DAYS, NEARLY_DONE } from './colony-opportunity.js';
export { REVIEW_PROMPT, renderPlanFacts, reviewableReason } from './colony-plan-review.js';
export { planProgress, siteProgress } from './colony-plan-progress.js';
export { systemTrade, selfSufficiency } from './colony-economy-view.js';
export { commodityKey } from './commodity-name.js';
export { commanderColour, COMMANDER_PALETTE } from './commander-colour.js';
export { needsFreshness } from './needs-freshness.js';
export { nextPoll, initialPoll, START_MS, ACTIVE_FLOOR_MS, IDLE_MS, type PollState } from './capi-cadence.js';
export { resolveClaim, type ClaimOutcome, type ExistingClaim, type ClaimMethod } from './cmdr-claim.js';
export type { Freshness, FreshnessVerdict } from './needs-freshness.js';
export { scopeHold } from './hold-scope.js';
export type { HeldLine, ProjectWant } from './hold-scope.js';
export { isOrbitalStation } from './station-orbital.js';
export { renderBuildBook } from './build-book.js';
export type { BookPlan, BookSite } from './build-book.js';
export { completedBuilds } from './build-completion-watch.js';
export type { WatchedBuild, StationSighting, CompletedBuild } from './build-completion-watch.js';
export { rankBuySources } from './buy-priority.js';
export type { BuyContext, BuySource } from './buy-priority.js';
export {
  colonyStatusOf,
  matchesColonyFilter,
  maySeeAbandoned,
  COLONY_STATUS_FILTERS,
  DEFAULT_COLONY_FILTER,
} from './colony-status.js';
export type {
  AbandonedViewer,
  ColonyStatus,
  ColonyStatusFilter,
  ColonyStatusRow,
} from './colony-status.js';
export { announcementDue, IDENTIFY_GRACE_MS } from './announce-when-identified.js';
export type { AnnounceDecision, AnnounceReason, PendingAnnouncement } from './announce-when-identified.js';
export { matchProjectToSite } from './colony-plan-link.js';
export type { LinkOutcome, LinkCandidateSite, LinkableProject } from './colony-plan-link.js';
export type { SystemTrade, SystemTradeLine, SelfSufficiency, TradeSite } from './colony-economy-view.js';
export type {
  PlanProgress,
  ProgressSite,
  SiteProgress,
  SiteState,
} from './colony-plan-progress.js';
export type { PlanFacts } from './colony-plan-review.js';
export type { Opportunity, OpportunityInput, Viewer as OpportunityViewer } from './colony-opportunity.js';
export type { OrderSuggestion } from './colony-order.js';

export {
  EARLIEST_PROMOTION_AT,
  PromotionsNotYetPermittedError,
  assertPromotionsPermitted,
  promotionsPermitted,
} from './promotion-floor.js';

export {
  GO_LIVE_AT,
  ROSTER_ARTEFACT_BEFORE,
  effectiveGrantAt,
} from './promotion-backdate.js';

/*
 * The colonisation simulation. Exported from here so the website and the companion app run the
 * IDENTICAL rules — two copies would drift, and the half that drifted would be the one deciding
 * whether a fortnight of hauling is legal.
 */
export { NO_EFFECTS, prerequisiteName, simulatePlan, surchargedCost } from './colony-simulation.js';
export type {
  PlanEconomy,
  SimBuildType,
  SimProblem,
  SimResult,
  SimSite,
  SimStep,
  SystemEffects,
} from './colony-simulation.js';

export {
  ECONOMIES,
  WEAK_LINK_STRENGTH,
  bodyBuffs,
  bodyEconomies,
  resolveEconomies,
  strongLinkStrength,
} from './colony-economy.js';
export type {
  EconAudit,
  EconBody,
  EconBuildType,
  EconSite,
  Economy,
  EconomyResult,
  EconomyScores,
  SiteEconomy,
} from './colony-economy.js';

export {
  ECONOMY_MARKETS,
  MAJOR_FRACTION,
  MARKET_COMMODITIES,
  marketScale,
  predictMarket,
} from './colony-market.js';
export type {
  EconomySlate,
  MarketStationType,
  PredictedCommodity,
  PredictedMarket,
} from './colony-market.js';

export { NonceService, formatNonce, NONCE_TTL_MS } from './nonce.service.js';
export type { NonceStore, NonceClaim, CheckResult, CheckOutcome } from './nonce.service.js';

export {
  JOURNAL_EVENTS,
  EVENT_FIELDS,
  isAllowedEvent,
  pickAllowedFields,
  isLiveGameVersion,
  telemetryCategoryFor,
  isBaselineCategory,
  BASELINE_CATEGORIES,
  OPTIONAL_CATEGORIES,
  canonicalJson,
  NEVER_SENT,
  isSendable,
} from './journal/journal-events.js';
/*
 * Reading a journal event for what it says about the galaxy. The WRITERS are in @grims/db; these
 * are pure, so the ingest service can parse an event without depending on a database.
 */
export { readSystemSighting, readDockSighting } from './journal/sightings.js';
export type { SystemSighting, DockSighting } from './journal/sightings.js';
export {
  ELITE_RANK_LADDERS,
  ELITE_RANK_LABELS,
  eliteRankName,
  describeEliteRanks,
  describeInaraRanks,
  allEliteRanks,
} from './journal/elite-ranks.js';
export type { EliteRankKey, EliteRankStanding } from './journal/elite-ranks.js';

export type {
  JournalEventName,
  JournalCategory,
  TelemetryCategoryName,
} from './journal/journal-events.js';
export {
  journalPathCandidates,
  noJournalsAdvice,
  isJournalFile,
  JOURNAL_FILE_PATTERN,
} from './journal/journal-paths.js';
export type { Platform, PathContext } from './journal/journal-paths.js';
export {
  expectedSquadronName,
  sameSquadron,
  evaluateSquadron,
  type SquadronCheckOutcome,
} from './squadron.js';
export {
  composeNickname,
  humanizeCommanderName,
  overrideActionFor,
  rankForDisplay,
  resolveMemberRank,
  MAX_NICK,
  LEADERSHIP_CEILING,
  type HeldRole,
  type OverrideAction,
} from './nickname.js';
export {
  TELEMETRY_CATALOGUE,
  REQUIRED_CATEGORY,
  undescribedEvents,
  categoryOf,
  type CatalogueGroup,
  type CatalogueEntry,
} from './journal/telemetry-catalogue.js';
export { tenureBetween, formatTenure, tenureFrom, type Tenure } from './tenure.js';
export {
  VIEW_AS_COOKIE,
  VIEW_AS_MAX_AGE_SEC,
  VIEW_AS_REFUSAL,
  VIEW_AS_EXEMPT_PATHS,
  PREVIEW_UNKNOWN_ROLE_MASK,
  previewMask,
  previewAllows,
  isExemptFromPreview,
  isWrite,
  readPreviewRoleId,
} from './view-as.js';
export {
  BUILD_HOSTS,
  SUPPORTED_BUILD_HOSTS,
  sourceOf,
  coverageOf,
  type BuildSource,
  type SlotGroup,
  type FittedModule,
  type Engineering,
  type ShipBuild,
  type ImportResult,
  type ImportCoverage,
  BUILD_ROLES,
  BUILD_ROLE_LABELS,
  BUILD_ROLE_TARGETS,
  classifyBuild,
  buildProgress,
  type BuildRole,
  type BuildRoleProgress,
  BUILD_VISIBILITIES,
  BUILD_VISIBILITY_LABELS,
  BUILD_VISIBILITY_NOTES,
  isBuildVisibility,
  isShareToken,
  SHARE_TOKEN_ALPHABET,
  SHARE_TOKEN_LENGTH,
  type BuildVisibility,
} from './ship-build.js';

export { PLATFORM_VERSION } from './version.js';

export {
  LEADERBOARD_BADGES,
  COLONY_LINE_CLOSER_BONUS,
  COLONY_PRIORITY_MULTIPLIER,
  LEADERBOARDS,
  TIER_LADDERS,
  TRADE_CREDITS_PER_POINT,
  badgeByKey,
  badgeDisplay,
  showcase,
  tiersEarned,
  type BadgeDef,
  type BadgeDisplay,
  type BadgeTier,
  type TierStep,
  type LeaderboardDef,
  type LeaderboardKey,
} from './leaderboards.js';

export {
  MINING_WEIGHTS,
  DEFAULT_MINING_WEIGHT,
  CORE_ONLY_MATERIALS,
  DEFAULT_PROSPECT_THRESHOLD,
  materialWeight,
  miningPoints,
  worthShooting,
  MINING_SESSION_GAP_MINUTES,
  continuesSession,
  readRock,
} from './mining.js';
export type { ProspectThresholds, Rock, RockMaterial } from './mining.js';

export { openProjectCounts } from './colony-badge.js';
export type { CountableProject, OpenProjectCounts } from './colony-badge.js';

export {
  pipsOf,
  readFactionEffects,
  scoreContribution,
  BGS_POINTS_PER_PIP,
  HOLD_MULTIPLIER,
  BGS_STANCES,
} from './bgs.js';
export type { BgsStance, BgsOrder, FactionEffect } from './bgs.js';

export { depthOf, DEPTH_COMFORTABLE } from './market-depth.js';
export type { MarketDepth } from './market-depth.js';

export { planManifest } from './manifest.js';
export type {
  Pick as ManifestPick,
  ManifestLine,
  ManifestOptions,
  Manifest,
  Stop as ManifestStop,
  Coords as ManifestCoords,
} from './manifest.js';

export { canMintInvite, milestonePoints, RECRUIT_MILESTONES } from './recruit.js';
export type { RecruitMilestone, MintCheck, MintVerdict, MintRefusal } from './recruit.js';
