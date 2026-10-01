CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_deleted_at" timestamp with time zone,
	CONSTRAINT "evidence_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "payout_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"adapter" text NOT NULL,
	"sender" text NOT NULL,
	"nonce" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"raw_tx" text NOT NULL,
	"state" text NOT NULL,
	"error" text,
	"block_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_attempts_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "payout_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"allocation_id" text NOT NULL,
	"state" text NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_jobs_allocation_id_unique" UNIQUE("allocation_id")
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "policy_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "pool_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"allocation_id" text,
	"note" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_week_usage" (
	"ticker" text NOT NULL,
	"week_start" text NOT NULL,
	"reserved" numeric(78, 0) DEFAULT '0' NOT NULL,
	CONSTRAINT "pool_week_usage_ticker_week_start_pk" PRIMARY KEY("ticker","week_start")
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"reviewer" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"revision" integer NOT NULL,
	"usage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"user_id" text NOT NULL,
	"recipient" text NOT NULL,
	"ticker" text NOT NULL,
	"token_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"decimals" integer NOT NULL,
	"week_start" text NOT NULL,
	"eligible_minutes" integer NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"policy_version_id" text NOT NULL,
	"state" text NOT NULL,
	"hold_reason" text,
	"reserved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_pools" (
	"ticker" text PRIMARY KEY NOT NULL,
	"funded" numeric(78, 0) DEFAULT '0' NOT NULL,
	"reserved" numeric(78, 0) DEFAULT '0' NOT NULL,
	"paid" numeric(78, 0) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"kind" text DEFAULT 'wallet' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"week_start" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"policy_version_id" text,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"reviewer_note" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "verified_usage" (
	"submission_id" text NOT NULL,
	"app" text NOT NULL,
	"minutes" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verified_usage_submission_id_app_pk" PRIMARY KEY("submission_id","app")
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_job_id_payout_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."payout_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_jobs" ADD CONSTRAINT "payout_jobs_allocation_id_reward_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."reward_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_allocations" ADD CONSTRAINT "reward_allocations_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_allocations" ADD CONSTRAINT "reward_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_allocations" ADD CONSTRAINT "reward_allocations_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_usage" ADD CONSTRAINT "verified_usage_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "evidence_submission_idx" ON "evidence" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "payout_attempts_job_idx" ON "payout_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_attempts_open_uq" ON "payout_attempts" USING btree ("job_id") WHERE state in ('signed','broadcast');--> statement-breakpoint
CREATE INDEX "payout_jobs_state_idx" ON "payout_jobs" USING btree ("state","next_run_at");--> statement-breakpoint
CREATE INDEX "pool_movements_ticker_idx" ON "pool_movements" USING btree ("ticker","created_at");--> statement-breakpoint
CREATE INDEX "review_decisions_submission_idx" ON "review_decisions" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_submission_ticker_uq" ON "reward_allocations" USING btree ("submission_id","ticker");--> statement-breakpoint
CREATE INDEX "allocations_user_idx" ON "reward_allocations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "allocations_state_idx" ON "reward_allocations" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_user_week_uq" ON "submissions" USING btree ("user_id","week_start");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "submissions" USING btree ("status","submitted_at");