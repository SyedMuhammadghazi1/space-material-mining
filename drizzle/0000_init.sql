CREATE TYPE "public"."alert_kind" AS ENUM('silent', 'out_of_range');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."fabrication_status" AS ENUM('queued', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('material', 'product');--> statement-breakpoint
CREATE TYPE "public"."item_unit" AS ENUM('kg', 'unit');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('production', 'transfer_out', 'transfer_in', 'fabrication_consumption', 'fabrication_output', 'delivery', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."mission_status" AS ENUM('planned', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."orbital_node" AS ENUM('LEO', 'GEO', 'EML1', 'LLO', 'LUNAR_SURFACE');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_deposit', 'confirmed', 'reserved', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."process_id" AS ENUM('mre', 'h2_ilmenite', 'magnetic_separation', 'volatiles');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('requested', 'issued', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."rig_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('lunar_mare_high_ti', 'lunar_mare_low_ti', 'lunar_highland', 'nea_s', 'nea_c', 'nea_m');--> statement-breakpoint
CREATE TYPE "public"."target_data_source" AS ENUM('seed_approximate', 'jpl_sbdb', 'manual');--> statement-breakpoint
CREATE TYPE "public"."target_kind" AS ENUM('lunar_site', 'nea');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_label" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "bom_lines" (
	"product_code" text NOT NULL,
	"input_code" text NOT NULL,
	"qty_per_unit" numeric(18, 3) NOT NULL,
	CONSTRAINT "bom_lines_product_code_input_code_pk" PRIMARY KEY("product_code","input_code"),
	CONSTRAINT "bom_qty_positive" CHECK ("bom_lines"."qty_per_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"node" "orbital_node" NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depots_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "fabrication_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_code" text NOT NULL,
	"depot_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "fabrication_status" DEFAULT 'queued' NOT NULL,
	"failure_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "fabrication_qty_positive" CHECK ("fabrication_jobs"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"depot_id" uuid NOT NULL,
	"item_code" text NOT NULL,
	"quantity" numeric(18, 3) DEFAULT 0 NOT NULL,
	"reserved" numeric(18, 3) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_depot_id_item_code_pk" PRIMARY KEY("depot_id","item_code"),
	CONSTRAINT "balance_non_negative" CHECK ("inventory_balances"."quantity" >= 0),
	CONSTRAINT "reserved_within_balance" CHECK ("inventory_balances"."reserved" >= 0 AND "inventory_balances"."reserved" <= "inventory_balances"."quantity")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "item_kind" NOT NULL,
	"unit" "item_unit" NOT NULL,
	"unit_mass_kg" numeric(18, 3) DEFAULT 1 NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"depot_id" uuid NOT NULL,
	"item_code" text NOT NULL,
	"entry_type" "ledger_entry_type" NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"balance_after" numeric(18, 3) NOT NULL,
	"reason" text,
	"rig_id" uuid,
	"transfer_id" uuid,
	"fabrication_job_id" uuid,
	"order_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_quantity_nonzero" CHECK ("ledger_entries"."quantity" <> 0),
	CONSTRAINT "ledger_sign_matches_type" CHECK (("ledger_entries"."entry_type" IN ('production','transfer_in','fabrication_output') AND "ledger_entries"."quantity" > 0)
        OR ("ledger_entries"."entry_type" IN ('transfer_out','fabrication_consumption','delivery') AND "ledger_entries"."quantity" < 0)
        OR ("ledger_entries"."entry_type" = 'adjustment' AND "ledger_entries"."reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "material_cost_bases" (
	"item_code" text NOT NULL,
	"node" "orbital_node" NOT NULL,
	"cost_per_kg_cents" bigint NOT NULL,
	"source_scenario_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_cost_bases_item_code_node_pk" PRIMARY KEY("item_code","node"),
	CONSTRAINT "cost_basis_non_negative" CHECK ("material_cost_bases"."cost_per_kg_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mission_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target_id" uuid NOT NULL,
	"process_id" "process_id" NOT NULL,
	"delivery_node" "orbital_node" NOT NULL,
	"inputs" jsonb NOT NULL,
	"target_snapshot" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"model_version" text NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target_id" uuid NOT NULL,
	"scenario_id" uuid,
	"depot_id" uuid NOT NULL,
	"status" "mission_status" DEFAULT 'planned' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"item_code" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"delivery_node" "orbital_node" NOT NULL,
	"total_cents" bigint NOT NULL,
	"deposit_cents" bigint NOT NULL,
	"status" "order_status" DEFAULT 'awaiting_deposit' NOT NULL,
	"invoice_id" text,
	"invoice_url" text,
	"reserved_depot_id" uuid,
	"confirmed_at" timestamp with time zone,
	"reserved_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_reference_unique" UNIQUE("reference"),
	CONSTRAINT "orders_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "orders_invoice_id_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"item_code" text PRIMARY KEY NOT NULL,
	"energy_kwh_per_unit" double precision NOT NULL,
	"ops_cost_per_unit_cents" bigint NOT NULL,
	"lead_time_days" integer DEFAULT 7 NOT NULL,
	"default_depot_id" uuid
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"customer_id" text NOT NULL,
	"item_code" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"delivery_node" "orbital_node" NOT NULL,
	"target_date" date,
	"customer_notes" text,
	"status" "quote_status" DEFAULT 'requested' NOT NULL,
	"pricing" jsonb,
	"unit_price_cents" bigint,
	"total_cents" bigint,
	"margin_percent" double precision,
	"valid_until" timestamp with time zone,
	"reviewer_notes" text,
	"issued_by" text,
	"issued_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_reference_unique" UNIQUE("reference"),
	CONSTRAINT "quote_qty_positive" CHECK ("quotes"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_buckets_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "rig_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"label" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "rig_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "rigs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"process_id" "process_id" NOT NULL,
	"rated_power_kw" double precision NOT NULL,
	"temp_min_c" double precision NOT NULL,
	"temp_max_c" double precision NOT NULL,
	"status" "rig_status" DEFAULT 'active' NOT NULL,
	"last_seq" bigint,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "target_kind" NOT NULL,
	"source_type" "source_type" NOT NULL,
	"designation" text,
	"spectral_class" text,
	"latitude_deg" double precision,
	"longitude_deg" double precision,
	"a_au" double precision,
	"e" double precision,
	"i_deg" double precision,
	"h_mag" double precision,
	"diameter_km" double precision,
	"elements_epoch" text,
	"data_source" "target_data_source" DEFAULT 'manual' NOT NULL,
	"source_note" text,
	"description" text,
	"refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "targets_slug_unique" UNIQUE("slug"),
	CONSTRAINT "targets_nea_elements" CHECK ("targets"."kind" <> 'nea' OR ("targets"."a_au" IS NOT NULL AND "targets"."e" IS NOT NULL AND "targets"."i_deg" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "telemetry_readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rig_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"regolith_processed_kg" numeric(18, 3) NOT NULL,
	"power_kw" double precision NOT NULL,
	"temperature_c" double precision NOT NULL,
	"output" jsonb NOT NULL,
	"anomalies" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_depot_id" uuid NOT NULL,
	"to_depot_id" uuid NOT NULL,
	"item_code" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"transport_mission" text NOT NULL,
	"delta_v_m_s" integer NOT NULL,
	"propellant_kg" numeric(18, 3) NOT NULL,
	"cost_cents" bigint NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_distinct_depots" CHECK ("transfers"."from_depot_id" <> "transfers"."to_depot_id"),
	CONSTRAINT "transfer_qty_positive" CHECK ("transfers"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'customer' NOT NULL,
	"company" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_product_code_products_item_code_fk" FOREIGN KEY ("product_code") REFERENCES "public"."products"("item_code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_input_code_items_code_fk" FOREIGN KEY ("input_code") REFERENCES "public"."items"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabrication_jobs" ADD CONSTRAINT "fabrication_jobs_product_code_products_item_code_fk" FOREIGN KEY ("product_code") REFERENCES "public"."products"("item_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabrication_jobs" ADD CONSTRAINT "fabrication_jobs_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabrication_jobs" ADD CONSTRAINT "fabrication_jobs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_item_code_items_code_fk" FOREIGN KEY ("item_code") REFERENCES "public"."items"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_item_code_items_code_fk" FOREIGN KEY ("item_code") REFERENCES "public"."items"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fabrication_job_id_fabrication_jobs_id_fk" FOREIGN KEY ("fabrication_job_id") REFERENCES "public"."fabrication_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_cost_bases" ADD CONSTRAINT "material_cost_bases_item_code_items_code_fk" FOREIGN KEY ("item_code") REFERENCES "public"."items"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_cost_bases" ADD CONSTRAINT "material_cost_bases_source_scenario_id_mission_scenarios_id_fk" FOREIGN KEY ("source_scenario_id") REFERENCES "public"."mission_scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_scenarios" ADD CONSTRAINT "mission_scenarios_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_scenarios" ADD CONSTRAINT "mission_scenarios_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_scenario_id_mission_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."mission_scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_item_code_items_code_fk" FOREIGN KEY ("item_code") REFERENCES "public"."items"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_reserved_depot_id_depots_id_fk" FOREIGN KEY ("reserved_depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_item_code_items_code_fk" FOREIGN KEY ("item_code") REFERENCES "public"."items"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_default_depot_id_depots_id_fk" FOREIGN KEY ("default_depot_id") REFERENCES "public"."depots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_item_code_items_code_fk" FOREIGN KEY ("item_code") REFERENCES "public"."items"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rig_api_keys" ADD CONSTRAINT "rig_api_keys_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rig_api_keys" ADD CONSTRAINT "rig_api_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rigs" ADD CONSTRAINT "rigs_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rigs" ADD CONSTRAINT "rigs_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_readings" ADD CONSTRAINT "telemetry_readings_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_depot_id_depots_id_fk" FOREIGN KEY ("from_depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_depot_id_depots_id_fk" FOREIGN KEY ("to_depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_item_code_items_code_fk" FOREIGN KEY ("item_code") REFERENCES "public"."items"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_one_open_per_kind" ON "alerts" USING btree ("rig_id","kind") WHERE "alerts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "fabrication_status_idx" ON "fabrication_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ledger_depot_item_idx" ON "ledger_entries" USING btree ("depot_id","item_code");--> statement-breakpoint
CREATE INDEX "ledger_created_idx" ON "ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mission_scenarios_target_idx" ON "mission_scenarios" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "mission_scenarios_created_idx" ON "mission_scenarios" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quotes_customer_idx" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rate_limit_window_idx" ON "rate_limit_buckets" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "rig_api_keys_rig_idx" ON "rig_api_keys" USING btree ("rig_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_designation_idx" ON "targets" USING btree ("designation");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_rig_seq_idx" ON "telemetry_readings" USING btree ("rig_id","seq");--> statement-breakpoint
CREATE INDEX "telemetry_rig_recorded_idx" ON "telemetry_readings" USING btree ("rig_id","recorded_at");--> statement-breakpoint
CREATE INDEX "telemetry_recorded_idx" ON "telemetry_readings" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");