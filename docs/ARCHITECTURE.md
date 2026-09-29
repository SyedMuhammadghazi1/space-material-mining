# Architecture

## Overview

A single Next.js 16 (App Router) application, TypeScript strict, deployed as a standalone Node server.
PostgreSQL is the only stateful dependency (sessions, rate-limit counters, idempotency keys and the
ledger all live there), so any number of stateless app instances can run behind a load balancer.

```
src/
  app/                 routes: (public) site, portal/ (customers), ops/ + admin/ (staff), api/
  components/          UI (server components by default; "use client" only where interactive)
  db/                  Drizzle schema + pooled client
  env.ts               Zod-validated configuration
  jobs/                idempotent background jobs (rig-health) + registry
  lib/
    models/            PURE planning models — no I/O, fully unit-tested
    sbdb.ts            JPL SBDB mapper/fetcher (fetch injectable)
    telemetry-schema.ts, scenario-input.ts, reference-data.ts, format.ts, auth.ts, mailer.ts, logger.ts,
    client-ip.ts (the only place the client IP is read from request headers)
  server/              domain services: authorization + I/O (one module per aggregate)
  proxy.ts             optimistic session-cookie gate for /ops, /admin, /portal
drizzle/               committed SQL migrations (generated + one custom integrity migration)
scripts/               migrate, seed, sim-rig, run-job
tests/integration/     Vitest against the real test database
tests/e2e/             Playwright against a production build
```

### Layering rules

1. `src/lib/models` is pure and deterministic. It never imports from `server/`, `db/` or Next.js.
2. Every exported service function in `src/server` takes an `Actor` and calls `assertRole` first;
   object-level ownership checks (customers → own quotes/orders) live in the same query (`WHERE
customer_id = actor.id`), so a foreign id is indistinguishable from a missing one (404).
3. Pages, server actions and route handlers only parse input, resolve the session (`requireRole`,
   `requireApiRole`) and call services. `proxy.ts` and layouts are conveniences, not the boundary.
4. Multi-row writes run in one transaction; audit rows are written in the same transaction.

## Data model (main tables)

| Table                                        | Notes                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user`, `session`, `account`, `verification` | Better Auth (Drizzle adapter). `user.role` ∈ customer/engineer/operator/admin, `input: false`.                                                               |
| `targets`                                    | Lunar sites and NEAs; CHECK requires a/e/i for NEAs; `data_source` = seed_approximate / jpl_sbdb / manual.                                                   |
| `mission_scenarios`                          | Inputs, target snapshot, results (JSONB) and `model_version`. Trigger rejects changes to computed columns.                                                   |
| `missions`, `rigs`, `rig_api_keys`           | Keys stored as SHA-256 hex + display prefix; `revoked_at`.                                                                                                   |
| `telemetry_readings`                         | UNIQUE (rig_id, seq) — the idempotency key. `anomalies text[]`.                                                                                              |
| `alerts`                                     | Partial unique index: one OPEN alert per (rig, kind). `emailed_at` claimed atomically.                                                                       |
| `depots`, `items`, `products`, `bom_lines`   | Items are materials (kg) or products (units, with unit mass).                                                                                                |
| `ledger_entries`                             | Append-only (trigger rejects UPDATE/DELETE). Signed quantity; CHECK ties sign to entry type; adjustments need a reason.                                      |
| `inventory_balances`                         | Projection maintained in the same transaction as each ledger write; the lockable row for withdrawals. CHECK `quantity >= 0` and `0 <= reserved <= quantity`. |
| `transfers`                                  | Transport mission name, Δv (m/s), propellant (kg), cost (cents).                                                                                             |
| `fabrication_jobs`                           | Status machine; transitions via `UPDATE … WHERE status = <expected>`.                                                                                        |
| `material_cost_bases`                        | Cost per kg at a node, published from a scenario (or manual).                                                                                                |
| `quotes`, `orders`                           | Server-side pricing JSON, validity, deposit, Stripe invoice id.                                                                                              |
| `stripe_events`                              | Processed Stripe event ids (idempotency).                                                                                                                    |
| `rate_limit_buckets`                         | Fixed-window counters keyed by (key, window_start).                                                                                                          |
| `audit_log`                                  | Sensitive actions with actor, entity and metadata.                                                                                                           |

Units: money is **integer cents** in BIGINT columns; masses are NUMERIC(18,3) kg (gram precision)
or whole units for products; Δv is integer m/s.

## Key flows

### Telemetry ingest (`POST /api/v1/telemetry`)

1. Bearer key → SHA-256 → lookup (revoked keys and retired rigs rejected). Failed auth attempts are
   rate-limited per IP; accepted rigs per rig id (`TELEMETRY_RATE_LIMIT_PER_MINUTE`).
2. Body ≤ 512 KiB, Zod-validated: 1–500 readings, unique seqs, non-negative masses, known material
   codes, processed outputs ≤ regolith processed (mass conservation).
3. One transaction: readings are sorted by `seq`, then
   `INSERT … ON CONFLICT (rig_id, seq) DO NOTHING RETURNING` → only newly inserted readings are
   summed and credited as `production` ledger entries at the rig's depot → rig
   `last_seen_at`/`last_seq` updated. Replays (even concurrent) are never credited twice. The sort
   gives every batch the same lock order on the `(rig_id, seq)` index, so overlapping batches that
   list the same seqs in different orders can't deadlock.
4. Out-of-range readings (temperature outside the process envelope, power > 110% rated, future
   timestamps) are stored with `anomalies` and picked up by the rig-health job.

### Inventory: never negative

`applyMovement` locks the balance row (`SELECT … FOR UPDATE`, creating it first if needed), checks
free stock (`quantity − reserved`), updates the projection and appends the ledger entry with
`balance_after`. Multi-row operations (`transferStock`, fabrication start) lock all rows up front in a
deterministic (depot, item) order to avoid deadlocks. CHECK constraints are a last line of defence.
`findBalanceDrift()` compares the projection with `SUM(ledger)`; integration tests assert it is empty
after concurrent operations. Displayed balances are computed from the ledger.

### Quote → order → deposit

Request (customer) → review with draft pricing (engineer/admin, `priceItem` server-side) → issue
(pricing JSON, validity) → accept (row lock; expired quotes are marked `expired`) → order
`awaiting_deposit` with `deposit = ceil(total × DEPOSIT_PERCENT%)` → Stripe invoice (customer, invoice,
invoice item, finalize, send — each with an idempotency key) → `invoice.paid` webhook → `confirmed`
→ operator reserves stock at a depot → fulfil writes a `delivery` ledger entry from reserved stock.
The order is committed before calling Stripe; if invoice creation fails it can be retried. The new
invoice id is recorded under the order's row lock (the one cancellation takes) and only while the
order still awaits its deposit; if it was cancelled while Stripe was creating the invoice, the invoice
is voided instead (audited as `order.invoice_voided`). Cancelling an order that already has an
invoice voids it too.

### Stripe webhook

Signature verified on the raw body with `STRIPE_WEBHOOK_SECRET`. The event id is inserted into
`stripe_events` in the same transaction as the business change; duplicates short-circuit, and a
failure rolls both back so Stripe's retry is safe.

### Rig-health job

Idempotent SQL: opens `silent` / `out_of_range` alerts (partial unique index prevents duplicates),
resolves cleared ones, then claims `emailed_at IS NULL` alerts with an UPDATE … RETURNING and sends a
single digest to operators/admins (+ `OPS_ALERT_EMAILS`). If sending fails the claim is released.

## Planning models

All in `src/lib/models`, versioned by `MODEL_VERSION` (stored with every scenario snapshot). They are
**first-order planning models, not flight-grade analysis**.

| Model            | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                   | Main simplifications                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delta-v.ts`     | NEA: Hohmann-type transfer from 1 AU to the target's aphelion or perihelion (cheaper wins); v∞ → Oberth burn from 400 km LEO `√(v∞²+v_esc²)−v_circ`; arrival speed-match + full plane change via `√(v₁²+v₂²−2v₁v₂cosΔi)`; return = departure by symmetry + capture to C3≈0 + 0.14 km/s to EML1. Cis-lunar map: LEO–GEO 3.90, LEO–EML1 3.77, LEO–LLO 4.04, EML1–GEO 1.38, EML1–LLO 0.64, LLO–surface 1.87 km/s (Dijkstra for other pairs). | Circular coplanar Earth, no phasing/launch windows, plane change in one burn, impulsive, no gravity assists, no aerobraking. Tens of percent vs optimised trajectories. |
| `rocket.ts`      | Tsiolkovsky; single expendable stage with tankage fraction σ: `m_prop = m_p(R−1)/(1−σ(R−1))`; gear ratio = LEO mass per delivered kg.                                                                                                                                                                                                                                                                                                     | No staging, reuse, boil-off, gravity losses.                                                                                                                            |
| `composition.ts` | Nominal wt% + low/high for Si, Ti, Fe, Al, Mg, O, H₂O for six source types; ilmenite wt%; metallic-Fe share; spectral-class mapper.                                                                                                                                                                                                                                                                                                       | Published averages / meteorite analogues; replace with survey data.                                                                                                     |
| `processes.ts`   | MRE, H₂ reduction of ilmenite (recoveries derived from ilmenite content), magnetic separation (from metallic-Fe share), volatiles extraction. `yield = mass × wt% × recovery`; throughput = power / specific energy; plant mass = base + power × (process + power-system kg/kW).                                                                                                                                                          | Order-of-magnitude literature values; products are element-equivalent masses (e.g. Ti in TiO₂-rich residue).                                                            |
| `economics.ts`   | Capex (hardware + launch × gear ratio), opex/yr, product transport (propellant × price); cost per delivered kg; Earth-launch comparison at the node; NPV with annual end-of-period discounting (pro-rated final year); breakeven price (NPV linear in price).                                                                                                                                                                             | Mass-based cost allocation across co-products; no ramp-up, degradation, tax, financing.                                                                                 |
| `pricing.ts`     | Material price = min over cost bases of (basis + transport to node); products = BOM landed at the fabrication node + energy + ops + shipping; margin; unit price rounded up; totals and deposits in integer (BigInt) arithmetic.                                                                                                                                                                                                          | Transport priced from propellant only.                                                                                                                                  |

## Charts

The production-rate chart is a hand-rolled SVG line chart (no chart library): 2px lines, hairline
grid, clean tick steps, legend + direct end labels (≤ 4 series, extra series fold into "Other"),
crosshair tooltip with keyboard support, and a data-table fallback. Series colours follow the
material (never its rank) using a categorical order validated for colour-vision deficiency; three
slots are below 3:1 contrast on white, which is why the table view and labels are always present.

## Security design

- Better Auth email/password (min 10 chars), DB sessions, secure cookies when served over HTTPS; roles
  can only be changed by admins (never self-assigned; admins cannot change their own role).
- Postgres-backed fixed-window rate limiting on sign-in/sign-up/password endpoints (per client IP and
  per account), quote requests (per customer) and telemetry (per rig; failed keys per IP). Better
  Auth's own limiter is disabled in favour of it.
- One client-IP resolver, `src/lib/client-ip.ts`, feeds rate limits, the audit log and Better Auth
  sessions: either a single platform header (`CLIENT_IP_HEADER`) or the `X-Forwarded-For` entry
  `TRUSTED_PROXY_HOPS` from the right (never the spoofable leftmost one); invalid values → no IP.
  Without an IP, per-IP limits are skipped — never one bucket shared by every client — and
  per-account limits still apply. Better Auth reads the IP only from a header the auth route sets.
- Append-only `ledger_entries` / `audit_log` (row triggers) plus least-privilege database roles in
  production: the app connects as a runtime role without `TRUNCATE`, DDL or ownership; migrations use
  a separate owner role (`scripts/sql/app-role.sql`).
- Security headers in `next.config.ts`: CSP, HSTS, X-Frame-Options DENY, Referrer-Policy,
  Permissions-Policy, X-Content-Type-Options, COOP.
- Rig keys: 256-bit random, shown once, SHA-256 at rest, revocable; cron endpoints use a
  constant-time bearer comparison.
- Prices always computed server-side; Stripe webhooks signature-verified and idempotent;
  `PAYMENTS_MODE=test-bypass` is rejected by env validation in production and by the provider itself.
- Error boundaries and API errors never expose stack traces; pino redacts secrets/PII paths.

### Security hardening backlog

- CSP currently allows `'unsafe-inline'` scripts (Next.js bootstrap). Move to nonce-based CSP via
  `proxy.ts` when all pages are dynamic anyway.
- Email verification and password reset emails are not yet enabled in Better Auth (requires a
  verified sending domain) — see the launch checklist.
- Consider 2FA for staff accounts (Better Auth `twoFactor` plugin).
