-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "cube";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive', 'banned', 'left');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('fdev_capi', 'inara_nonce', 'officer_manual');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('inbound', 'outbound', 'both');

-- CreateEnum
CREATE TYPE "RoleGrantSource" AS ENUM ('discord', 'manual', 'system');

-- CreateEnum
CREATE TYPE "ThreadKind" AS ENUM ('discussion', 'question', 'poll', 'announcement', 'ops', 'application');

-- CreateEnum
CREATE TYPE "SubscriptionLevel" AS ENUM ('watching', 'tracking', 'muted');

-- CreateEnum
CREATE TYPE "ApplicationState" AS ENUM ('submitted', 'interviewing', 'approved', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('lock', 'unlock', 'pin', 'unpin', 'move', 'delete', 'restore', 'warn', 'mute', 'ban', 'unban');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('manual', 'capi', 'edmc', 'eddn', 'bgstally', 'system');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('private', 'squadron', 'public', 'officer');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('draft', 'scheduled', 'live', 'complete', 'cancelled');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('bgs', 'combat', 'mining', 'trade', 'exploration', 'rescue', 'social', 'training');

-- CreateEnum
CREATE TYPE "SignupState" AS ENUM ('yes', 'maybe', 'no', 'standby');

-- CreateEnum
CREATE TYPE "RoleTag" AS ENUM ('combat', 'mining', 'trade', 'explore', 'rescue', 'bgs', 'ax', 'passenger');

-- CreateEnum
CREATE TYPE "BgsDirective" AS ENUM ('push', 'hold', 'suppress', 'ignore');

-- CreateEnum
CREATE TYPE "BgsActivityType" AS ENUM ('missions', 'bounties', 'cartographics', 'trade', 'bonds', 'murders', 'failed_missions', 'exploration_data', 'mining_profit');

-- CreateEnum
CREATE TYPE "TickSource" AS ENUM ('community_detector', 'inferred', 'manual');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('system', 'user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "ToolOutcome" AS ENUM ('ok', 'denied', 'error', 'needs_confirmation', 'cancelled');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('forum_post', 'wiki', 'doctrine', 'loadout', 'guide', 'galnet', 'aar');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'bot', 'ai', 'system');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'submitted', 'polling', 'complete', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "RoutePlannerKind" AS ENUM ('neutron', 'galaxy', 'fleet_carrier', 'road_to_riches', 'tourist', 'trade');

-- CreateEnum
CREATE TYPE "TelemetryCategory" AS ENUM ('location', 'combat', 'trade', 'exploration', 'bgs', 'carrier', 'fleet');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('in_app', 'discord_dm');

-- CreateEnum
CREATE TYPE "DeliveryState" AS ENUM ('pending', 'sent', 'failed', 'suppressed');

-- CreateEnum
CREATE TYPE "RankKind" AS ENUM ('tenure', 'loyalty', 'leadership', 'reserved');

-- CreateEnum
CREATE TYPE "ReferenceKind" AS ENUM ('commodity', 'module', 'ship', 'rare_commodity');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "handle" CITEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" CITEXT,
    "avatar_url" TEXT,
    "bio" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),
    "deny_mask" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_identities" (
    "user_id" UUID NOT NULL,
    "discord_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "global_name" TEXT,
    "guild_nick" TEXT,
    "guild_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "guild_joined_at" TIMESTAMPTZ(6),
    "access_token_enc" BYTEA,
    "refresh_token_enc" BYTEA,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discord_identities_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "cmdr_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "cmdr_name" CITEXT NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "trust_tier" SMALLINT NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "is_stale" BOOLEAN NOT NULL DEFAULT false,
    "fdev_refresh_enc" BYTEA,
    "fdev_access_enc" BYTEA,
    "fdev_expires_at" TIMESTAMPTZ(6),
    "claim_nonce" TEXT,
    "nonce_expires_at" TIMESTAMPTZ(6),
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmdr_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT,
    "rank_order" INTEGER NOT NULL DEFAULT 100,
    "perm_mask" DECIMAL(40,0) NOT NULL DEFAULT 0,
    "is_hierarchical" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_mappings" (
    "role_id" UUID NOT NULL,
    "discord_role_id" TEXT NOT NULL,
    "sync_direction" "SyncDirection" NOT NULL DEFAULT 'inbound',

    CONSTRAINT "role_mappings_pkey" PRIMARY KEY ("role_id","discord_role_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "source" "RoleGrantSource" NOT NULL DEFAULT 'discord',
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "refresh_token_families" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,
    "device_label" TEXT,
    "user_agent" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['telemetry:write']::TEXT[],
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_settings" (
    "user_id" UUID NOT NULL,
    "telemetry_consent" "TelemetryCategory"[] DEFAULT ARRAY[]::"TelemetryCategory"[],
    "show_location" BOOLEAN NOT NULL DEFAULT false,
    "show_credits" BOOLEAN NOT NULL DEFAULT false,
    "show_fleet" BOOLEAN NOT NULL DEFAULT false,
    "show_activity" BOOLEAN NOT NULL DEFAULT false,
    "show_on_public_roster" BOOLEAN NOT NULL DEFAULT false,
    "show_on_leaderboard" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "forum_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "view_perm" DECIMAL(40,0),
    "post_perm" DECIMAL(40,0),
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "discord_channel_id" TEXT,

    CONSTRAINT "forum_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ThreadKind" NOT NULL DEFAULT 'discussion',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "answer_post_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "post_count" INTEGER NOT NULL DEFAULT 0,
    "last_post_at" TIMESTAMPTZ(6),
    "last_post_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "forum_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "reply_to_id" UUID,
    "body_md" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "edited_at" TIMESTAMPTZ(6),
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "is_solution" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "search_tsv" tsvector,

    CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "post_id" UUID NOT NULL,
    "body_md" TEXT NOT NULL,
    "edited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_by" UUID NOT NULL,

    CONSTRAINT "post_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_reactions" (
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,

    CONSTRAINT "forum_reactions_pkey" PRIMARY KEY ("post_id","user_id","emoji")
);

-- CreateTable
CREATE TABLE "forum_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "thread_id" UUID,
    "category_id" UUID,
    "level" "SubscriptionLevel" NOT NULL DEFAULT 'watching',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reporter_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "auto_flagged" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID NOT NULL,
    "target_user_id" UUID,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "action" "ModerationActionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "appeal_thread_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "thread_id" UUID,
    "state" "ApplicationState" NOT NULL DEFAULT 'submitted',
    "answers" JSONB NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "probation_ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "systems" (
    "address" BIGINT NOT NULL,
    "name" CITEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "allegiance" TEXT,
    "government" TEXT,
    "security" TEXT,
    "economy" TEXT,
    "secondary_economy" TEXT,
    "population" BIGINT,
    "controlling_faction" TEXT,
    "power" TEXT,
    "power_state" TEXT,
    "is_tracked" BOOLEAN NOT NULL DEFAULT false,
    "last_queried_at" TIMESTAMPTZ(6),
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "systems_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "stations" (
    "market_id" BIGINT NOT NULL,
    "system_address" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "is_carrier" BOOLEAN NOT NULL DEFAULT false,
    "distance_to_arrival_ls" DOUBLE PRECISION,
    "max_landing_pad" SMALLINT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "economies" JSONB,
    "controlling_faction" TEXT,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("market_id")
);

-- CreateTable
CREATE TABLE "market_orders" (
    "market_id" BIGINT NOT NULL,
    "commodity" TEXT NOT NULL,
    "buy_price" INTEGER NOT NULL DEFAULT 0,
    "sell_price" INTEGER NOT NULL DEFAULT 0,
    "demand" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "stock_bracket" SMALLINT,
    "demand_bracket" SMALLINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_orders_pkey" PRIMARY KEY ("market_id","commodity")
);

-- CreateTable
CREATE TABLE "market_history" (
    "id" BIGSERIAL NOT NULL,
    "market_id" BIGINT NOT NULL,
    "commodity" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "buy_price" INTEGER,
    "sell_price" INTEGER,
    "demand" INTEGER,
    "stock" INTEGER,

    CONSTRAINT "market_history_pkey" PRIMARY KEY ("id","observed_at")
);

-- CreateTable
CREATE TABLE "reference_names" (
    "kind" "ReferenceKind" NOT NULL,
    "internal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "category" TEXT,
    "is_rare" BOOLEAN NOT NULL DEFAULT false,
    "avg_price" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_names_pkey" PRIMARY KEY ("kind","internal_name")
);

-- CreateTable
CREATE TABLE "ships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "ship_type" TEXT NOT NULL,
    "ship_name" TEXT,
    "ship_ident" TEXT,
    "role_tag" "RoleTag",
    "current_system" BIGINT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "source" "DataSource" NOT NULL DEFAULT 'manual',
    "synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loadouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ship_id" UUID,
    "author_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ship_type" TEXT NOT NULL,
    "role_tag" "RoleTag",
    "coriolis_json" JSONB NOT NULL,
    "coriolis_url" TEXT,
    "edsy_url" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'squadron',
    "is_doctrine" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "stats" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loadouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loadout_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loadout_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "coriolis_json" JSONB NOT NULL,
    "stats" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loadout_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loadout_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loadout_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body_md" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "loadout_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_carriers" (
    "callsign" TEXT NOT NULL,
    "market_id" BIGINT,
    "name" TEXT,
    "owner_user_id" UUID,
    "current_system" BIGINT,
    "docking_access" TEXT,
    "allow_notorious" BOOLEAN,
    "fuel_level" INTEGER,
    "services" JSONB,
    "next_jump_system" BIGINT,
    "next_jump_at" TIMESTAMPTZ(6),
    "source" "DataSource" NOT NULL DEFAULT 'eddn',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_carriers_pkey" PRIMARY KEY ("callsign")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_by_id" UUID NOT NULL,
    "thread_id" UUID,
    "title" TEXT NOT NULL,
    "description_md" TEXT,
    "op_type" "OperationType" NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "system_address" BIGINT,
    "station_market_id" BIGINT,
    "min_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_ship_roles" "RoleTag"[] DEFAULT ARRAY[]::"RoleTag"[],
    "capacity" INTEGER,
    "status" "OperationStatus" NOT NULL DEFAULT 'scheduled',
    "recurrence_rule" TEXT,
    "discord_event_id" TEXT,
    "discord_message_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_signups" (
    "operation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ship_id" UUID,
    "state" "SignupState" NOT NULL DEFAULT 'yes',
    "role_tag" "RoleTag",
    "note" TEXT,
    "signed_up_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attended" BOOLEAN,

    CONSTRAINT "operation_signups_pkey" PRIMARY KEY ("operation_id","user_id")
);

-- CreateTable
CREATE TABLE "tracked_factions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_ours" BOOLEAN NOT NULL DEFAULT false,
    "home_system" BIGINT,
    "notes_md" TEXT,

    CONSTRAINT "tracked_factions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bgs_ticks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "window_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "source" "TickSource" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bgs_ticks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faction_influence_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "faction_id" UUID NOT NULL,
    "system_address" BIGINT NOT NULL,
    "tick_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "influence" DOUBLE PRECISION NOT NULL,
    "state" TEXT,
    "pending_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recovering_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "happiness" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'eddn',

    CONSTRAINT "faction_influence_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bgs_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "system_address" BIGINT NOT NULL,
    "faction_id" UUID,
    "directive" "BgsDirective" NOT NULL,
    "priority" SMALLINT NOT NULL DEFAULT 3,
    "guidance_md" TEXT,
    "set_by_id" UUID NOT NULL,
    "active_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bgs_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bgs_activity_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "system_address" BIGINT NOT NULL,
    "faction_id" UUID,
    "activity_type" "BgsActivityType" NOT NULL,
    "value_cr" BIGINT,
    "count" INTEGER,
    "tick_id" UUID,
    "reported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "DataSource" NOT NULL DEFAULT 'manual',
    "source_event_id" TEXT,
    "import_batch_key" TEXT,

    CONSTRAINT "bgs_activity_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "RoutePlannerKind" NOT NULL,
    "param_hash" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "upstream_job_id" TEXT,
    "result_key" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "route_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "commodity" TEXT NOT NULL,
    "origin_system" BIGINT,
    "max_distance_ly" DOUBLE PRECISION,
    "min_sell_price" INTEGER,
    "max_buy_price" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_fired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_board_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "is_supply" BOOLEAN NOT NULL,
    "commodity" TEXT NOT NULL,
    "quantity_tons" INTEGER NOT NULL,
    "price_per_ton_cr" INTEGER,
    "location_note" TEXT,
    "system_address" BIGINT,
    "expires_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_board_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hauling_targets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "target_tons" INTEGER NOT NULL,
    "delivered_tons" INTEGER NOT NULL DEFAULT 0,
    "carrier_callsign" TEXT,
    "destination_system" BIGINT,
    "deadline" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hauling_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hauling_contributions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tons" INTEGER NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'manual',
    "source_event_id" TEXT,
    "import_batch_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hauling_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_events" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "device_token_id" UUID NOT NULL,
    "category" "TelemetryCategory" NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "event_key" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "telemetry_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'web',
    "title" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT,
    "tool_name" TEXT,
    "tool_args" JSONB,
    "tool_result" JSONB,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "latency_ms" INTEGER,
    "served_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_invocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "conversation_id" UUID,
    "tool_name" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "permission_checked" DECIMAL(40,0),
    "outcome" "ToolOutcome" NOT NULL,
    "error" TEXT,
    "duration_ms" INTEGER,
    "confirmation_token_hash" TEXT,
    "confirmed_args_hash" TEXT,
    "confirmation_consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_type" "KnowledgeSourceType" NOT NULL,
    "source_id" UUID,
    "visibility" "Visibility" NOT NULL,
    "view_perm_mask" DECIMAL(40,0),
    "title" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(768),
    "metadata" JSONB,
    "indexed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "actor_type" "ActorType" NOT NULL DEFAULT 'user',
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "state" "DeliveryState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "read_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_code" INTEGER NOT NULL,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id","endpoint","key")
);

-- CreateTable
CREATE TABLE "site_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "site_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "squadron_ranks" (
    "key" TEXT NOT NULL,
    "kind" "RankKind" NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "tenure_months" INTEGER,
    "role_key" TEXT,
    "is_single_holder" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,

    CONSTRAINT "squadron_ranks_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "rank_awards" (
    "user_id" UUID NOT NULL,
    "rank_key" TEXT NOT NULL,
    "awarded_by_id" UUID,
    "note" TEXT,
    "awarded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "rank_awards_pkey" PRIMARY KEY ("user_id","rank_key")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon_url" TEXT,
    "auto_rule" TEXT,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_awards" (
    "achievement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "awarded_by_id" UUID,
    "note" TEXT,
    "awarded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievement_awards_pkey" PRIMARY KEY ("achievement_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_last_seen_at_idx" ON "users"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "discord_identities_discord_id_key" ON "discord_identities"("discord_id");

-- CreateIndex
CREATE INDEX "discord_identities_synced_at_idx" ON "discord_identities"("synced_at");

-- CreateIndex
CREATE INDEX "cmdr_verifications_user_id_idx" ON "cmdr_verifications"("user_id");

-- CreateIndex
CREATE INDEX "cmdr_verifications_cmdr_name_idx" ON "cmdr_verifications"("cmdr_name");

-- CreateIndex
CREATE INDEX "cmdr_verifications_expires_at_idx" ON "cmdr_verifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "roles_rank_order_idx" ON "roles"("rank_order");

-- CreateIndex
CREATE INDEX "role_mappings_discord_role_id_idx" ON "role_mappings"("discord_role_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "refresh_token_families_user_id_revoked_at_idx" ON "refresh_token_families"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_hash_key" ON "device_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_revoked_at_idx" ON "device_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "forum_categories_slug_key" ON "forum_categories"("slug");

-- CreateIndex
CREATE INDEX "forum_categories_parent_id_position_idx" ON "forum_categories"("parent_id", "position");

-- CreateIndex
CREATE INDEX "forum_threads_author_id_idx" ON "forum_threads"("author_id");

-- CreateIndex
CREATE INDEX "forum_threads_category_id_is_pinned_last_post_at_idx" ON "forum_threads"("category_id", "is_pinned", "last_post_at");

-- CreateIndex
CREATE UNIQUE INDEX "forum_threads_category_id_slug_key" ON "forum_threads"("category_id", "slug");

-- CreateIndex
CREATE INDEX "forum_posts_thread_id_created_at_idx" ON "forum_posts"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "forum_posts_author_id_created_at_idx" ON "forum_posts"("author_id", "created_at");

-- CreateIndex
CREATE INDEX "forum_posts_reply_to_id_idx" ON "forum_posts"("reply_to_id");

-- CreateIndex
CREATE INDEX "post_revisions_post_id_edited_at_idx" ON "post_revisions"("post_id", "edited_at");

-- CreateIndex
CREATE INDEX "forum_reactions_user_id_idx" ON "forum_reactions"("user_id");

-- CreateIndex
CREATE INDEX "forum_subscriptions_thread_id_idx" ON "forum_subscriptions"("thread_id");

-- CreateIndex
CREATE INDEX "forum_subscriptions_category_id_idx" ON "forum_subscriptions"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_subscriptions_user_id_thread_id_key" ON "forum_subscriptions"("user_id", "thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_subscriptions_user_id_category_id_key" ON "forum_subscriptions"("user_id", "category_id");

-- CreateIndex
CREATE INDEX "content_reports_resolved_at_created_at_idx" ON "content_reports"("resolved_at", "created_at");

-- CreateIndex
CREATE INDEX "content_reports_target_type_target_id_idx" ON "content_reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "moderation_actions_target_user_id_created_at_idx" ON "moderation_actions"("target_user_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_actions_created_at_idx" ON "moderation_actions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "applications_user_id_key" ON "applications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_thread_id_key" ON "applications"("thread_id");

-- CreateIndex
CREATE INDEX "applications_state_created_at_idx" ON "applications"("state", "created_at");

-- CreateIndex
CREATE INDEX "applications_probation_ends_at_idx" ON "applications"("probation_ends_at");

-- CreateIndex
CREATE INDEX "systems_name_idx" ON "systems"("name");

-- CreateIndex
CREATE INDEX "systems_is_tracked_idx" ON "systems"("is_tracked");

-- CreateIndex
CREATE INDEX "stations_system_address_idx" ON "stations"("system_address");

-- CreateIndex
CREATE INDEX "stations_is_carrier_idx" ON "stations"("is_carrier");

-- CreateIndex
CREATE INDEX "stations_services_idx" ON "stations" USING GIN ("services");

-- CreateIndex
CREATE INDEX "market_orders_commodity_idx" ON "market_orders"("commodity");

-- CreateIndex
CREATE INDEX "market_orders_updated_at_idx" ON "market_orders"("updated_at");

-- CreateIndex
CREATE INDEX "market_history_market_id_commodity_observed_at_idx" ON "market_history"("market_id", "commodity", "observed_at");

-- CreateIndex
CREATE INDEX "market_history_observed_at_idx" ON "market_history"("observed_at");

-- CreateIndex
CREATE INDEX "reference_names_kind_display_name_idx" ON "reference_names"("kind", "display_name");

-- CreateIndex
CREATE INDEX "ships_owner_id_idx" ON "ships"("owner_id");

-- CreateIndex
CREATE INDEX "ships_ship_type_idx" ON "ships"("ship_type");

-- CreateIndex
CREATE INDEX "ships_current_system_idx" ON "ships"("current_system");

-- CreateIndex
CREATE INDEX "loadouts_author_id_idx" ON "loadouts"("author_id");

-- CreateIndex
CREATE INDEX "loadouts_ship_type_role_tag_idx" ON "loadouts"("ship_type", "role_tag");

-- CreateIndex
CREATE INDEX "loadouts_is_doctrine_idx" ON "loadouts"("is_doctrine");

-- CreateIndex
CREATE INDEX "loadouts_visibility_idx" ON "loadouts"("visibility");

-- CreateIndex
CREATE UNIQUE INDEX "loadout_revisions_loadout_id_version_key" ON "loadout_revisions"("loadout_id", "version");

-- CreateIndex
CREATE INDEX "loadout_comments_loadout_id_created_at_idx" ON "loadout_comments"("loadout_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_carriers_market_id_key" ON "fleet_carriers"("market_id");

-- CreateIndex
CREATE INDEX "fleet_carriers_owner_user_id_idx" ON "fleet_carriers"("owner_user_id");

-- CreateIndex
CREATE INDEX "fleet_carriers_current_system_idx" ON "fleet_carriers"("current_system");

-- CreateIndex
CREATE INDEX "fleet_carriers_next_jump_at_idx" ON "fleet_carriers"("next_jump_at");

-- CreateIndex
CREATE UNIQUE INDEX "operations_thread_id_key" ON "operations"("thread_id");

-- CreateIndex
CREATE INDEX "operations_starts_at_status_idx" ON "operations"("starts_at", "status");

-- CreateIndex
CREATE INDEX "operations_op_type_idx" ON "operations"("op_type");

-- CreateIndex
CREATE INDEX "operations_created_by_id_idx" ON "operations"("created_by_id");

-- CreateIndex
CREATE INDEX "operation_signups_user_id_idx" ON "operation_signups"("user_id");

-- CreateIndex
CREATE INDEX "operation_signups_operation_id_state_signed_up_at_idx" ON "operation_signups"("operation_id", "state", "signed_up_at");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_factions_name_key" ON "tracked_factions"("name");

-- CreateIndex
CREATE INDEX "tracked_factions_is_ours_idx" ON "tracked_factions"("is_ours");

-- CreateIndex
CREATE UNIQUE INDEX "bgs_ticks_window_key_key" ON "bgs_ticks"("window_key");

-- CreateIndex
CREATE INDEX "bgs_ticks_occurred_at_idx" ON "bgs_ticks"("occurred_at");

-- CreateIndex
CREATE INDEX "faction_influence_snapshots_system_address_observed_at_idx" ON "faction_influence_snapshots"("system_address", "observed_at");

-- CreateIndex
CREATE INDEX "faction_influence_snapshots_faction_id_observed_at_idx" ON "faction_influence_snapshots"("faction_id", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "faction_influence_snapshots_faction_id_system_address_tick__key" ON "faction_influence_snapshots"("faction_id", "system_address", "tick_id");

-- CreateIndex
CREATE INDEX "bgs_orders_active_from_active_until_idx" ON "bgs_orders"("active_from", "active_until");

-- CreateIndex
CREATE INDEX "bgs_orders_system_address_idx" ON "bgs_orders"("system_address");

-- CreateIndex
CREATE INDEX "bgs_orders_priority_idx" ON "bgs_orders"("priority");

-- CreateIndex
CREATE INDEX "bgs_activity_reports_user_id_reported_at_idx" ON "bgs_activity_reports"("user_id", "reported_at");

-- CreateIndex
CREATE INDEX "bgs_activity_reports_system_address_tick_id_idx" ON "bgs_activity_reports"("system_address", "tick_id");

-- CreateIndex
CREATE INDEX "bgs_activity_reports_faction_id_tick_id_idx" ON "bgs_activity_reports"("faction_id", "tick_id");

-- CreateIndex
CREATE UNIQUE INDEX "bgs_activity_reports_user_id_source_event_id_key" ON "bgs_activity_reports"("user_id", "source_event_id");

-- CreateIndex
CREATE INDEX "route_jobs_param_hash_status_idx" ON "route_jobs"("param_hash", "status");

-- CreateIndex
CREATE INDEX "route_jobs_user_id_created_at_idx" ON "route_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "route_jobs_status_created_at_idx" ON "route_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "saved_routes_user_id_created_at_idx" ON "saved_routes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "trade_alerts_is_active_commodity_idx" ON "trade_alerts"("is_active", "commodity");

-- CreateIndex
CREATE INDEX "trade_alerts_user_id_idx" ON "trade_alerts"("user_id");

-- CreateIndex
CREATE INDEX "trade_board_offers_commodity_is_supply_closed_at_idx" ON "trade_board_offers"("commodity", "is_supply", "closed_at");

-- CreateIndex
CREATE INDEX "trade_board_offers_user_id_idx" ON "trade_board_offers"("user_id");

-- CreateIndex
CREATE INDEX "hauling_targets_closed_at_deadline_idx" ON "hauling_targets"("closed_at", "deadline");

-- CreateIndex
CREATE INDEX "hauling_contributions_target_id_created_at_idx" ON "hauling_contributions"("target_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "hauling_contributions_user_id_source_event_id_key" ON "hauling_contributions"("user_id", "source_event_id");

-- CreateIndex
CREATE INDEX "telemetry_events_user_id_occurred_at_idx" ON "telemetry_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "telemetry_events_category_occurred_at_idx" ON "telemetry_events"("category", "occurred_at");

-- CreateIndex
CREATE INDEX "telemetry_events_processed_at_idx" ON "telemetry_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_events_event_key_key" ON "telemetry_events"("event_key");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_created_at_idx" ON "ai_conversations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_created_at_idx" ON "ai_tool_invocations"("created_at");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_user_id_created_at_idx" ON "ai_tool_invocations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_tool_name_outcome_idx" ON "ai_tool_invocations"("tool_name", "outcome");

-- CreateIndex
CREATE INDEX "knowledge_chunks_visibility_idx" ON "knowledge_chunks"("visibility");

-- CreateIndex
CREATE INDEX "knowledge_chunks_source_type_source_id_idx" ON "knowledge_chunks"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_state_created_at_idx" ON "notifications"("state", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "squadron_ranks_kind_order_idx" ON "squadron_ranks"("kind", "order");

-- CreateIndex
CREATE INDEX "rank_awards_rank_key_idx" ON "rank_awards"("rank_key");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_key_key" ON "achievements"("key");

-- CreateIndex
CREATE INDEX "achievement_awards_user_id_awarded_at_idx" ON "achievement_awards"("user_id", "awarded_at");

-- AddForeignKey
ALTER TABLE "discord_identities" ADD CONSTRAINT "discord_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cmdr_verifications" ADD CONSTRAINT "cmdr_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_mappings" ADD CONSTRAINT "role_mappings_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token_families" ADD CONSTRAINT "refresh_token_families_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "refresh_token_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_categories" ADD CONSTRAINT "forum_categories_parent_fkey" FOREIGN KEY ("parent_id") REFERENCES "forum_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "forum_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_last_post_by_fkey" FOREIGN KEY ("last_post_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "forum_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_reactions" ADD CONSTRAINT "forum_reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_reactions" ADD CONSTRAINT "forum_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_subscriptions" ADD CONSTRAINT "forum_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_subscriptions" ADD CONSTRAINT "forum_subscriptions_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_subscriptions" ADD CONSTRAINT "forum_subscriptions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "forum_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stations" ADD CONSTRAINT "stations_system_address_fkey" FOREIGN KEY ("system_address") REFERENCES "systems"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "stations"("market_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ships" ADD CONSTRAINT "ships_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ships" ADD CONSTRAINT "ships_current_system_fkey" FOREIGN KEY ("current_system") REFERENCES "systems"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadouts" ADD CONSTRAINT "loadouts_ship_id_fkey" FOREIGN KEY ("ship_id") REFERENCES "ships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadouts" ADD CONSTRAINT "loadouts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadouts" ADD CONSTRAINT "loadouts_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout_revisions" ADD CONSTRAINT "loadout_revisions_loadout_id_fkey" FOREIGN KEY ("loadout_id") REFERENCES "loadouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout_comments" ADD CONSTRAINT "loadout_comments_loadout_id_fkey" FOREIGN KEY ("loadout_id") REFERENCES "loadouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout_comments" ADD CONSTRAINT "loadout_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_carriers" ADD CONSTRAINT "fleet_carriers_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_carriers" ADD CONSTRAINT "fleet_carriers_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "stations"("market_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_carriers" ADD CONSTRAINT "fleet_carriers_current_system_fkey" FOREIGN KEY ("current_system") REFERENCES "systems"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_carriers" ADD CONSTRAINT "fleet_carriers_next_jump_system_fkey" FOREIGN KEY ("next_jump_system") REFERENCES "systems"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_system_address_fkey" FOREIGN KEY ("system_address") REFERENCES "systems"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_station_market_id_fkey" FOREIGN KEY ("station_market_id") REFERENCES "stations"("market_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_signups" ADD CONSTRAINT "operation_signups_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_signups" ADD CONSTRAINT "operation_signups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_signups" ADD CONSTRAINT "operation_signups_ship_id_fkey" FOREIGN KEY ("ship_id") REFERENCES "ships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_factions" ADD CONSTRAINT "tracked_factions_home_system_fkey" FOREIGN KEY ("home_system") REFERENCES "systems"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_influence_snapshots" ADD CONSTRAINT "faction_influence_snapshots_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "tracked_factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_influence_snapshots" ADD CONSTRAINT "faction_influence_snapshots_system_address_fkey" FOREIGN KEY ("system_address") REFERENCES "systems"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_influence_snapshots" ADD CONSTRAINT "faction_influence_snapshots_tick_id_fkey" FOREIGN KEY ("tick_id") REFERENCES "bgs_ticks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bgs_orders" ADD CONSTRAINT "bgs_orders_system_address_fkey" FOREIGN KEY ("system_address") REFERENCES "systems"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bgs_orders" ADD CONSTRAINT "bgs_orders_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "tracked_factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bgs_orders" ADD CONSTRAINT "bgs_orders_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bgs_activity_reports" ADD CONSTRAINT "bgs_activity_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bgs_activity_reports" ADD CONSTRAINT "bgs_activity_reports_system_address_fkey" FOREIGN KEY ("system_address") REFERENCES "systems"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bgs_activity_reports" ADD CONSTRAINT "bgs_activity_reports_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "tracked_factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bgs_activity_reports" ADD CONSTRAINT "bgs_activity_reports_tick_id_fkey" FOREIGN KEY ("tick_id") REFERENCES "bgs_ticks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_jobs" ADD CONSTRAINT "route_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_routes" ADD CONSTRAINT "saved_routes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_alerts" ADD CONSTRAINT "trade_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_board_offers" ADD CONSTRAINT "trade_board_offers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hauling_targets" ADD CONSTRAINT "hauling_targets_carrier_callsign_fkey" FOREIGN KEY ("carrier_callsign") REFERENCES "fleet_carriers"("callsign") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hauling_contributions" ADD CONSTRAINT "hauling_contributions_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "hauling_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hauling_contributions" ADD CONSTRAINT "hauling_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_device_token_id_fkey" FOREIGN KEY ("device_token_id") REFERENCES "device_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tool_invocations" ADD CONSTRAINT "ai_tool_invocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tool_invocations" ADD CONSTRAINT "ai_tool_invocations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rank_awards" ADD CONSTRAINT "rank_awards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rank_awards" ADD CONSTRAINT "rank_awards_awarded_by_id_fkey" FOREIGN KEY ("awarded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rank_awards" ADD CONSTRAINT "rank_awards_rank_key_fkey" FOREIGN KEY ("rank_key") REFERENCES "squadron_ranks"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_awards" ADD CONSTRAINT "achievement_awards_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_awards" ADD CONSTRAINT "achievement_awards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_awards" ADD CONSTRAINT "achievement_awards_awarded_by_id_fkey" FOREIGN KEY ("awarded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- HAND-WRITTEN DDL
--
-- Everything below is a construct Postgres supports and Prisma cannot express.
-- It is NOT optional and it is NOT tuning: several of these are correctness
-- controls that enforce invariants (INV-005, INV-019, INV-042), and the rest are
-- the difference between an indexed lookup and a sequential scan over the galaxy.
--
-- Source of truth: ssot/03-data/indexes.md
-- =============================================================================

-- TimescaleDB. Prisma's extension support does not emit this one, so it is
-- created by hand. It must exist before create_hypertable() below.
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- -----------------------------------------------------------------------------
-- systems: the spatial workhorse
-- Every "nearby X" query - trade routes, carrier routing, alert radii, the BGS
-- sphere - depends on this. Without it each one is a sequential scan over every
-- system we hold.
--
-- NOTE: queries must use the cube distance operator, NOT an inline
-- sqrt(power(...)) expression. The latter cannot use this index (ARCH-ADV B2).
-- -----------------------------------------------------------------------------
CREATE INDEX systems_xyz_idx ON systems USING GIST (cube(ARRAY[x, y, z]));

-- Un-track sweep: the prefilter's "queried in the last 30 days" clause needs an
-- expiry or the tracked set is monotonic and the >95% saving decays to zero.
CREATE INDEX systems_untrack_idx ON systems (last_queried_at)
  WHERE is_tracked = true AND last_queried_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- market_orders: the two hot partial indexes
-- Partial because rows with no demand (or no stock) are useless to the
-- respective query and are a large fraction of the table.
-- -----------------------------------------------------------------------------
CREATE INDEX market_orders_sell_idx ON market_orders (commodity, sell_price DESC)
  WHERE demand > 0;
CREATE INDEX market_orders_buy_idx ON market_orders (commodity, buy_price ASC)
  WHERE stock > 0;

-- -----------------------------------------------------------------------------
-- cmdr_verifications: INV-005, a correctness control rather than an optimisation
--
-- `is_verified = true` is load-bearing. Keyed on revoked_at alone, merely
-- STARTING a claim took the lock, so any member could permanently squat any CMDR
-- name - including every officer's - by opening a claim and never finishing it
-- (RED-TEAM R7).
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX cmdr_verifications_active_name_uniq
  ON cmdr_verifications (cmdr_name)
  WHERE revoked_at IS NULL AND is_verified = true;

CREATE INDEX cmdr_verifications_pending_expiry_idx
  ON cmdr_verifications (nonce_expires_at)
  WHERE is_verified = false AND revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- bgs_activity_reports / hauling_contributions: INV-042
--
-- Prisma's @@unique([userId, sourceEventId]) enforces NOTHING on the manual and
-- BGS-Tally paths, because those rows leave source_event_id NULL and Postgres
-- treats NULLs as distinct. One partial unique index per ingestion path.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX bgs_reports_event_uniq
  ON bgs_activity_reports (user_id, source_event_id) WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX bgs_reports_import_uniq
  ON bgs_activity_reports (user_id, import_batch_key) WHERE import_batch_key IS NOT NULL;

CREATE UNIQUE INDEX hauling_event_uniq
  ON hauling_contributions (user_id, source_event_id) WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX hauling_import_uniq
  ON hauling_contributions (user_id, import_batch_key) WHERE import_batch_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- forum: soft-deleted rows are never listed, so the indexes are partial
-- -----------------------------------------------------------------------------
CREATE INDEX forum_threads_listing_idx
  ON forum_threads (category_id, is_pinned DESC, last_post_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX forum_posts_thread_live_idx
  ON forum_posts (thread_id, created_at)
  WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- forum_posts.search_tsv: a GENERATED column
-- Prisma creates it as a plain tsvector, so it is replaced here. Generated means
-- it cannot drift from body_md - there is no code path that can forget to update it.
-- -----------------------------------------------------------------------------
ALTER TABLE forum_posts DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE forum_posts
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', body_md)) STORED;

CREATE INDEX forum_posts_search_idx ON forum_posts USING GIN (search_tsv);

-- -----------------------------------------------------------------------------
-- audit_log: append-only, always read newest-first
-- -----------------------------------------------------------------------------
CREATE INDEX audit_log_recent_idx ON audit_log (created_at DESC);

-- -----------------------------------------------------------------------------
-- telemetry_events: the processing queue is a small fraction of a 30-day table
-- -----------------------------------------------------------------------------
CREATE INDEX telemetry_events_unprocessed_idx ON telemetry_events (received_at)
  WHERE processed_at IS NULL;

-- -----------------------------------------------------------------------------
-- knowledge_chunks: HNSW for approximate nearest neighbour
--
-- Built here because the table is empty. On a populated table, build the index
-- AFTER the bulk load - building HNSW empty then inserting is dramatically slower.
-- Dimension 768 matches nomic-embed-text, which is pinned forever (decision D16).
-- -----------------------------------------------------------------------------
CREATE INDEX knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- market_history: TimescaleDB hypertable (decision D10)
--
-- The composite primary key (id, observed_at) exists because Timescale requires
-- the partitioning column in every unique index, including the PK.
--
-- The retention policy REPLACES a nightly retention job - running both would race.
-- -----------------------------------------------------------------------------
SELECT create_hypertable('market_history', 'observed_at', migrate_data => true);

ALTER TABLE market_history SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'market_id, commodity'
);

SELECT add_compression_policy('market_history', INTERVAL '7 days');
SELECT add_retention_policy('market_history', INTERVAL '90 days');
