# Runbook (on-call)

## Health checks

| Check                | Expectation                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`    | `200 {"status":"ok"}` — process alive (no DB). Failing → container crash-loop; check logs.                                         |
| `GET /api/ready`     | `200 {"database":"ok"}`; `503` → database unreachable (credentials, network, pool exhaustion, provider outage).                    |
| Docker `HEALTHCHECK` | Uses `/api/health` every 30 s.                                                                                                     |
| Rig alerts           | `/ops/alerts`; the job runs every 5–10 min. No new alerts for hours while rigs are silent → check the scheduler and `CRON_SECRET`. |

## Logs

JSON lines via pino (`service: "orbital-quarry"`). Useful queries:

- `msg:"unhandled error"` — 500s (the client only sees a generic message).
- `msg:"stripe webhook signature verification failed"` — wrong `STRIPE_WEBHOOK_SECRET` or a probe.
- `msg:"deposit invoice creation failed; can be retried"` — Stripe API/config problem; customers see a
  "Create deposit invoice" retry button.
- `msg:"rig-health job finished"` — counts of opened/resolved/emailed alerts.
  Secrets, cookies, API keys and emails are redacted; request bodies are never logged.

## Common incidents

**Telemetry rejected (401)** — key revoked, rig retired, or wrong key. Issue a new key on
`/ops/rigs/<id>` (shown once) and update the rig. **422** — payload fails validation (response lists
fields). **429** — rig exceeds `TELEMETRY_RATE_LIMIT_PER_MINUTE`; the simulator/rig should back off
using `Retry-After`. Re-sending the same readings is always safe (idempotent on rig + seq).

**Inventory looks wrong** — run in psql:

```sql
SELECT b.depot_id, b.item_code, b.quantity, COALESCE(SUM(l.quantity),0) AS ledger
FROM inventory_balances b LEFT JOIN ledger_entries l USING (depot_id, item_code)
GROUP BY 1,2,3 HAVING COALESCE(SUM(l.quantity),0) <> b.quantity;
```

Expected: no rows. Never edit ledger rows (a trigger forbids it); correct stock with an **adjustment**
(operator UI, reason required, audit-logged).

**Order stuck in "awaiting deposit"** — check the invoice in Stripe. If paid but not confirmed, the
webhook failed: see "Replaying webhooks". If no invoice exists, the customer (or an admin) can press
"Create deposit invoice" on the order.

**Fabrication job stuck "in progress"** — inputs were consumed at start. Complete it (credits output)
or mark failed with a reason (inputs scrapped). There is no automatic rollback by design.

## Rolling back

1. Redeploy the previous image tag (`ghcr.io/<owner>/<repo>:<previous-sha>`) via your platform or by
   re-running the deploy workflow for that commit.
2. Migrations are forward-only. Because they are written expand/contract-style, the previous app
   version runs against the newer schema. If a migration itself must be reverted, write a new forward
   migration; restore from backup only for data corruption.

## Rotating secrets

| Secret                  | Procedure                                                                                                 | Impact                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`    | Set new value, redeploy.                                                                                  | All sessions invalidated; users sign in again.               |
| `CRON_SECRET`           | Update app env and the scheduler secret together.                                                         | Cron calls 401 in between (jobs are idempotent; just rerun). |
| `STRIPE_SECRET_KEY`     | Roll in Stripe Dashboard, update env, redeploy, revoke old key.                                           | None if done in that order.                                  |
| `STRIPE_WEBHOOK_SECRET` | Roll the endpoint secret in Stripe (old one stays valid up to 24 h), update env, redeploy.                | None.                                                        |
| Database password       | Create new credential, update `DATABASE_URL` (+ `PRODUCTION_DATABASE_URL` in GitHub), redeploy, drop old. | Brief reconnects.                                            |
| Rig API keys            | Issue a new key per rig, deploy to the rig, revoke the old key in `/ops/rigs/<id>`.                       | None if overlapped.                                          |

All key issue/revoke and role changes appear in `/admin/audit`.

## Restoring the database

1. Prefer provider PITR to a new instance/branch at a timestamp just before the incident.
2. Or from a logical dump: `createdb oq_restore && pg_restore --no-owner -d oq_restore oq-YYYY-MM-DD.dump`.
3. Verify: `GET /api/ready`, the drift query above returns no rows, spot-check recent orders/quotes.
4. Point `DATABASE_URL` at the restored database and redeploy. Reconcile anything after the restore
   point: replay Stripe events (below) and let rigs resend telemetry (idempotent).

## Replaying webhooks

- Stripe Dashboard → Developers → Webhooks → endpoint → select event → **Resend**; or
  `stripe events resend evt_…`. Processing is idempotent (`stripe_events`), so resending an already
  processed event is a no-op.
- To force reprocessing after a bug fix (event recorded but order not updated), delete that row from
  `stripe_events` first, then resend.

## Manual job runs

`npm run job:rig-health` (needs `DATABASE_URL`) or
`curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/rig-health`.
