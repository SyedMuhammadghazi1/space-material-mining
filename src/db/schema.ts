/**
 * Database schema (Drizzle ORM, PostgreSQL).
 *
 * Conventions:
 *  - money columns are BIGINT integer cents (`*_cents`), read as JS numbers (safe to 2^53);
 *  - mass/quantity columns are NUMERIC(18,3): kg to the gram (or whole units for products);
 *  - Better Auth owns `user`, `session`, `account` and `verification` (text ids).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const qty = (name: string) => numeric(name, { precision: 18, scale: 3, mode: "number" });
const cents = (name: string) => bigint(name, { mode: "number" });

// ---------------------------------------------------------------------------------------------
// Better Auth tables
// ---------------------------------------------------------------------------------------------

export const USER_ROLES = ["customer", "engineer", "operator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").$type<UserRole>().notNull().default("customer"),
  company: text("company"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------------------------
// Platform infrastructure
// ---------------------------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index("rate_limit_window_idx").on(t.windowStart),
  ],
);

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingCustomers = pgTable("billing_customers", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Targets & planning
// ---------------------------------------------------------------------------------------------

export const targetKind = pgEnum("target_kind", ["lunar_site", "nea"]);
export const sourceTypeEnum = pgEnum("source_type", [
  "lunar_mare_high_ti",
  "lunar_mare_low_ti",
  "lunar_highland",
  "nea_s",
  "nea_c",
  "nea_m",
]);
export const targetDataSource = pgEnum("target_data_source", [
  "seed_approximate",
  "jpl_sbdb",
  "manual",
]);

export const targets = pgTable(
  "targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    kind: targetKind("kind").notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    designation: text("designation"),
    spectralClass: text("spectral_class"),
    latitudeDeg: doublePrecision("latitude_deg"),
    longitudeDeg: doublePrecision("longitude_deg"),
    aAu: doublePrecision("a_au"),
    e: doublePrecision("e"),
    iDeg: doublePrecision("i_deg"),
    hMag: doublePrecision("h_mag"),
    diameterKm: doublePrecision("diameter_km"),
    elementsEpoch: text("elements_epoch"),
    dataSource: targetDataSource("data_source").notNull().default("manual"),
    sourceNote: text("source_note"),
    description: text("description"),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("targets_designation_idx").on(t.designation),
    check(
      "targets_nea_elements",
      sql`${t.kind} <> 'nea' OR (${t.aAu} IS NOT NULL AND ${t.e} IS NOT NULL AND ${t.iDeg} IS NOT NULL)`,
    ),
  ],
);

export const processIdEnum = pgEnum("process_id", [
  "mre",
  "h2_ilmenite",
  "magnetic_separation",
  "volatiles",
]);
export const orbitalNodeEnum = pgEnum("orbital_node", [
  "LEO",
  "GEO",
  "EML1",
  "LLO",
  "LUNAR_SURFACE",
]);

/** Immutable planning snapshots — a DB trigger rejects UPDATEs of the computed columns. */
export const missionScenarios = pgTable(
  "mission_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "restrict" }),
    processId: processIdEnum("process_id").notNull(),
    deliveryNode: orbitalNodeEnum("delivery_node").notNull(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
    targetSnapshot: jsonb("target_snapshot").$type<Record<string, unknown>>().notNull(),
    results: jsonb("results").$type<Record<string, unknown>>().notNull(),
    modelVersion: text("model_version").notNull(),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("mission_scenarios_target_idx").on(t.targetId),
    index("mission_scenarios_created_idx").on(t.createdAt),
  ],
);

export const missionStatus = pgEnum("mission_status", ["planned", "active", "completed"]);

export const depots = pgTable("depots", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  node: orbitalNodeEnum("node").notNull(),
  description: text("description"),
  createdAt: createdAt(),
});

export const missions = pgTable("missions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  targetId: uuid("target_id")
    .notNull()
    .references(() => targets.id, { onDelete: "restrict" }),
  scenarioId: uuid("scenario_id").references(() => missionScenarios.id, { onDelete: "set null" }),
  depotId: uuid("depot_id")
    .notNull()
    .references(() => depots.id, { onDelete: "restrict" }),
  status: missionStatus("status").notNull().default("planned"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Items, products, inventory ledger
// ---------------------------------------------------------------------------------------------

export const itemKind = pgEnum("item_kind", ["material", "product"]);
export const itemUnit = pgEnum("item_unit", ["kg", "unit"]);

export const items = pgTable("items", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  kind: itemKind("kind").notNull(),
  unit: itemUnit("unit").notNull(),
  unitMassKg: qty("unit_mass_kg").notNull().default(1),
  description: text("description"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: createdAt(),
});

export const products = pgTable("products", {
  itemCode: text("item_code")
    .primaryKey()
    .references(() => items.code, { onDelete: "cascade" }),
  energyKWhPerUnit: doublePrecision("energy_kwh_per_unit").notNull(),
  opsCostPerUnitCents: cents("ops_cost_per_unit_cents").notNull(),
  leadTimeDays: integer("lead_time_days").notNull().default(7),
  defaultDepotId: uuid("default_depot_id").references(() => depots.id, { onDelete: "set null" }),
});

export const bomLines = pgTable(
  "bom_lines",
  {
    productCode: text("product_code")
      .notNull()
      .references(() => products.itemCode, { onDelete: "cascade" }),
    inputCode: text("input_code")
      .notNull()
      .references(() => items.code, { onDelete: "restrict" }),
    qtyPerUnit: qty("qty_per_unit").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productCode, t.inputCode] }),
    check("bom_qty_positive", sql`${t.qtyPerUnit} > 0`),
  ],
);

/**
 * Balance projection maintained in the same transaction as every ledger write. It exists so
 * withdrawals can lock a single row (`SELECT … FOR UPDATE`); CHECK constraints are a backstop.
 */
export const inventoryBalances = pgTable(
  "inventory_balances",
  {
    depotId: uuid("depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "restrict" }),
    itemCode: text("item_code")
      .notNull()
      .references(() => items.code, { onDelete: "restrict" }),
    quantity: qty("quantity").notNull().default(0),
    reserved: qty("reserved").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.depotId, t.itemCode] }),
    check("balance_non_negative", sql`${t.quantity} >= 0`),
    check("reserved_within_balance", sql`${t.reserved} >= 0 AND ${t.reserved} <= ${t.quantity}`),
  ],
);

export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "production",
  "transfer_out",
  "transfer_in",
  "fabrication_consumption",
  "fabrication_output",
  "delivery",
  "adjustment",
]);

/** Append-only: a DB trigger rejects UPDATE and DELETE. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    depotId: uuid("depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "restrict" }),
    itemCode: text("item_code")
      .notNull()
      .references(() => items.code, { onDelete: "restrict" }),
    entryType: ledgerEntryType("entry_type").notNull(),
    quantity: qty("quantity").notNull(),
    balanceAfter: qty("balance_after").notNull(),
    reason: text("reason"),
    rigId: uuid("rig_id").references(() => rigs.id, { onDelete: "restrict" }),
    transferId: uuid("transfer_id").references(() => transfers.id, { onDelete: "restrict" }),
    fabricationJobId: uuid("fabrication_job_id").references(() => fabricationJobs.id, {
      onDelete: "restrict",
    }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_depot_item_idx").on(t.depotId, t.itemCode),
    index("ledger_created_idx").on(t.createdAt),
    check("ledger_quantity_nonzero", sql`${t.quantity} <> 0`),
    check(
      "ledger_sign_matches_type",
      sql`(${t.entryType} IN ('production','transfer_in','fabrication_output') AND ${t.quantity} > 0)
        OR (${t.entryType} IN ('transfer_out','fabrication_consumption','delivery') AND ${t.quantity} < 0)
        OR (${t.entryType} = 'adjustment' AND ${t.reason} IS NOT NULL)`,
    ),
  ],
);

export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromDepotId: uuid("from_depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "restrict" }),
    toDepotId: uuid("to_depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "restrict" }),
    itemCode: text("item_code")
      .notNull()
      .references(() => items.code, { onDelete: "restrict" }),
    quantity: qty("quantity").notNull(),
    transportMission: text("transport_mission").notNull(),
    deltaVMs: integer("delta_v_m_s").notNull(),
    propellantKg: qty("propellant_kg").notNull(),
    costCents: cents("cost_cents").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("transfer_distinct_depots", sql`${t.fromDepotId} <> ${t.toDepotId}`),
    check("transfer_qty_positive", sql`${t.quantity} > 0`),
  ],
);

export const fabricationStatus = pgEnum("fabrication_status", [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);

export const fabricationJobs = pgTable(
  "fabrication_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productCode: text("product_code")
      .notNull()
      .references(() => products.itemCode, { onDelete: "restrict" }),
    depotId: uuid("depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    status: fabricationStatus("status").notNull().default("queued"),
    failureReason: text("failure_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("fabrication_qty_positive", sql`${t.quantity} > 0`),
    index("fabrication_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------------------------
// Operations: rigs, API keys, telemetry, alerts
// ---------------------------------------------------------------------------------------------

export const rigStatus = pgEnum("rig_status", ["active", "retired"]);

export const rigs = pgTable("rigs", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id")
    .notNull()
    .references(() => missions.id, { onDelete: "restrict" }),
  depotId: uuid("depot_id")
    .notNull()
    .references(() => depots.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  processId: processIdEnum("process_id").notNull(),
  ratedPowerKw: doublePrecision("rated_power_kw").notNull(),
  tempMinC: doublePrecision("temp_min_c").notNull(),
  tempMaxC: doublePrecision("temp_max_c").notNull(),
  status: rigStatus("status").notNull().default("active"),
  lastSeq: bigint("last_seq", { mode: "number" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const rigApiKeys = pgTable(
  "rig_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rigId: uuid("rig_id")
      .notNull()
      .references(() => rigs.id, { onDelete: "cascade" }),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    label: text("label"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("rig_api_keys_rig_idx").on(t.rigId)],
);

export const telemetryReadings = pgTable(
  "telemetry_readings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rigId: uuid("rig_id")
      .notNull()
      .references(() => rigs.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    regolithProcessedKg: qty("regolith_processed_kg").notNull(),
    powerKw: doublePrecision("power_kw").notNull(),
    temperatureC: doublePrecision("temperature_c").notNull(),
    output: jsonb("output").$type<Record<string, number>>().notNull(),
    anomalies: text("anomalies")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    uniqueIndex("telemetry_rig_seq_idx").on(t.rigId, t.seq),
    index("telemetry_rig_recorded_idx").on(t.rigId, t.recordedAt),
    index("telemetry_recorded_idx").on(t.recordedAt),
  ],
);

export const alertKind = pgEnum("alert_kind", ["silent", "out_of_range"]);
export const alertStatus = pgEnum("alert_status", ["open", "resolved"]);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rigId: uuid("rig_id")
      .notNull()
      .references(() => rigs.id, { onDelete: "cascade" }),
    kind: alertKind("kind").notNull(),
    status: alertStatus("status").notNull().default("open"),
    message: text("message").notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("alerts_one_open_per_kind")
      .on(t.rigId, t.kind)
      .where(sql`${t.status} = 'open'`),
    index("alerts_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------------------------
// Commercial: cost bases, quotes, orders
// ---------------------------------------------------------------------------------------------

export const materialCostBases = pgTable(
  "material_cost_bases",
  {
    itemCode: text("item_code")
      .notNull()
      .references(() => items.code, { onDelete: "cascade" }),
    node: orbitalNodeEnum("node").notNull(),
    costPerKgCents: cents("cost_per_kg_cents").notNull(),
    sourceScenarioId: uuid("source_scenario_id").references(() => missionScenarios.id, {
      onDelete: "set null",
    }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.itemCode, t.node] }),
    check("cost_basis_non_negative", sql`${t.costPerKgCents} >= 0`),
  ],
);

export const quoteStatus = pgEnum("quote_status", [
  "requested",
  "issued",
  "accepted",
  "declined",
  "expired",
]);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    itemCode: text("item_code")
      .notNull()
      .references(() => items.code, { onDelete: "restrict" }),
    quantity: qty("quantity").notNull(),
    deliveryNode: orbitalNodeEnum("delivery_node").notNull(),
    targetDate: date("target_date", { mode: "string" }),
    customerNotes: text("customer_notes"),
    status: quoteStatus("status").notNull().default("requested"),
    pricing: jsonb("pricing").$type<Record<string, unknown>>(),
    unitPriceCents: cents("unit_price_cents"),
    totalCents: cents("total_cents"),
    marginPercent: doublePrecision("margin_percent"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    reviewerNotes: text("reviewer_notes"),
    issuedBy: text("issued_by").references(() => user.id, { onDelete: "set null" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("quotes_customer_idx").on(t.customerId),
    index("quotes_status_idx").on(t.status),
    check("quote_qty_positive", sql`${t.quantity} > 0`),
  ],
);

export const orderStatus = pgEnum("order_status", [
  "awaiting_deposit",
  "confirmed",
  "reserved",
  "fulfilled",
  "cancelled",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    quoteId: uuid("quote_id")
      .notNull()
      .unique()
      .references(() => quotes.id, { onDelete: "restrict" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    itemCode: text("item_code")
      .notNull()
      .references(() => items.code, { onDelete: "restrict" }),
    quantity: qty("quantity").notNull(),
    deliveryNode: orbitalNodeEnum("delivery_node").notNull(),
    totalCents: cents("total_cents").notNull(),
    depositCents: cents("deposit_cents").notNull(),
    status: orderStatus("status").notNull().default("awaiting_deposit"),
    invoiceId: text("invoice_id").unique(),
    invoiceUrl: text("invoice_url"),
    reservedDepotId: uuid("reserved_depot_id").references(() => depots.id, {
      onDelete: "restrict",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("orders_customer_idx").on(t.customerId), index("orders_status_idx").on(t.status)],
);
