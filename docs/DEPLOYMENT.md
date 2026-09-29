# Deployment

The application is one stateless container plus PostgreSQL 16. Everything stateful (sessions,
rate-limit counters, webhook idempotency, the ledger) lives in Postgres, so you can run several
instances behind a load balancer.

## 1. Prerequisites

- PostgreSQL 16 (managed: Neon, Supabase, RDS, Cloud SQL, Render/Railway Postgres …) with automated
  backups and point-in-time recovery enabled.
- Secrets (see `.env.example`): `DATABASE_URL`, `BETTER_AUTH_SECRET` (`openssl rand -hex 32`),
  `CRON_SECRET` (`openssl rand -hex 24`), `APP_URL`, SMTP credentials, and for payments
  `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` with `PAYMENTS_MODE=stripe`.
- `NEXT_PUBLIC_APP_NAME` is inlined at **build** time (Docker build arg / Vercel env var).
- `SKIP_ENV_VALIDATION=1` is only for `next build` (the Dockerfile sets it in the build stage). A
  production server ignores it — it applies only while `NEXT_PHASE=phase-production-build` — so a
  missing or invalid secret always stops the app instead of being replaced by a build placeholder.
- Behind a load balancer that sets `X-Forwarded-For`, set `TRUST_PROXY=true` so rate limits key on
  the real client IP.

## 2. Container hosts (Render, Fly.io, Railway, ECS, Kubernetes …)

```bash
docker build -t orbital-quarry --build-arg NEXT_PUBLIC_APP_NAME="Orbital Quarry" .
docker run --rm -e DATABASE_URL=… orbital-quarry node migrate.mjs      # apply migrations
docker run -p 3000:3000 --env-file prod.env orbital-quarry              # serve on :3000
```

- The image runs as a non-root user, listens on `$PORT` (default 3000) and has a `HEALTHCHECK` on
  `/api/health`. Point the platform's liveness probe at `/api/health` and readiness at `/api/ready`
  (checks the database).
- **Render**: Docker web service; add a "pre-deploy command" `node migrate.mjs`; copy the service's
  deploy hook URL into the GitHub secret `DEPLOY_HOOK_URL`.
- **Fly.io**: `fly launch --no-deploy`, set secrets with `fly secrets set`, add
  `[deploy] release_command = "node migrate.mjs"` in `fly.toml`.
- **Railway**: deploy from the image or Dockerfile; set the pre-deploy command to `node migrate.mjs`.
- Behind a corporate TLS-intercepting proxy, build with
  `docker build --network host --build-arg HTTPS_PROXY=… --secret id=extra_ca,src=ca.crt .`
  (the CA is used only for `npm ci` and never written to a layer).

### GitHub Actions (`.github/workflows/deploy.yml`)

Only commits that passed CI are deployed: the workflow is triggered by `workflow_run` when the `CI`
workflow completes on `main`, and its first job runs only if that CI run **succeeded** for a **push**
from this repository (never for pull requests, forks or failed runs). It then checks out exactly the
commit CI tested (`workflow_run.head_sha`), builds and pushes `ghcr.io/<owner>/<repo>:<sha>` and
`:latest`; runs `node migrate.mjs` from that exact image against `secrets.PRODUCTION_DATABASE_URL`;
then `POST secrets.DEPLOY_HOOK_URL` (with `image=<name>:<sha>`). A manual `workflow_dispatch` deploys
the selected branch's head. The migrate and deploy jobs run in the `production` environment (add
required reviewers there for a manual gate). Missing secrets produce a notice instead of a failure.
If you rename the CI workflow, update `workflows: [CI]` in `deploy.yml` to match its `name:`.

Configure: repository secrets `PRODUCTION_DATABASE_URL`, `DEPLOY_HOOK_URL`; optional variable
`NEXT_PUBLIC_APP_NAME`. The GHCR package may need its visibility/permissions adjusted so your host
can pull it (or give the host a read-only token).

## 3. Vercel + managed Postgres (e.g. Neon)

1. Create a Neon project; copy the **pooled** connection string (PgBouncer) as `DATABASE_URL`.
   Keep `DATABASE_POOL_MAX` small (e.g. 3) because serverless functions each open their own pool.
2. Import the repo in Vercel (framework: Next.js). Set all env vars for Production (and Preview with
   a separate database/branch). `output: "standalone"` is ignored by Vercel and harmless.
3. Migrations: run `npm run db:migrate` from CI (the `migrate` job with `PRODUCTION_DATABASE_URL` =
   Neon's **direct**, non-pooled URL) before promoting, or locally with the production URL.
4. Cron: add `vercel.json`
   ```json
   { "crons": [{ "path": "/api/cron/rig-health", "schedule": "*/10 * * * *" }] }
   ```
   Vercel Cron sends `GET` with `Authorization: Bearer $CRON_SECRET`; this app exposes `POST`, so either
   keep the GitHub Actions scheduler (`.github/workflows/cron.yml`) or add a `GET` export that calls
   the same handler.
5. Telemetry volume: serverless is fine for modest rig counts; for high-rate telemetry prefer a
   long-running container.

## 4. Database migrations

- Author schema changes in `src/db/schema.ts`, run `npm run db:generate`, review and **commit** the SQL
  in `drizzle/`. Custom SQL (triggers) goes in `drizzle-kit generate --custom` migrations.
- Apply with `npm run db:migrate` (dev) or `node migrate.mjs` (image). The runner is idempotent and
  records applied migrations in `drizzle.__drizzle_migrations`.
- Keep migrations backwards compatible with the previous app version (expand → deploy → contract) so
  rolling deploys and rollbacks are safe.

## 5. Stripe (deposit invoices)

1. In the Stripe Dashboard create restricted/secret keys; set `STRIPE_SECRET_KEY` and
   `PAYMENTS_MODE=stripe`.
2. Add a webhook endpoint `https://<your-domain>/api/webhooks/stripe` subscribed to at least
   `invoice.paid`; copy its signing secret to `STRIPE_WEBHOOK_SECRET`.
3. Configure invoice settings (branding, payment methods — enable bank transfers/ACH for large B2B
   deposits; card payments are capped per charge) and customer emails in the Dashboard.
4. Local testing: `stripe listen --forward-to localhost:3002/api/webhooks/stripe` and use the printed
   `whsec_…`. Without Stripe, use `PAYMENTS_MODE=test-bypass` in development only.

## 6. Scheduled jobs

`POST /api/cron/rig-health` with `Authorization: Bearer $CRON_SECRET`, every 5–10 minutes. Options:
`.github/workflows/cron.yml` (set repository variable `APP_URL` and secret `CRON_SECRET`), your
platform's cron (Render Cron Job, Fly machines schedule, Kubernetes CronJob running
`node -e "fetch(…)"`), or `npm run job:rig-health` from any box with DB access. The job is idempotent.

## 7. Email

Use a transactional provider over SMTP (Postmark, SES, Resend, Mailgun …) with SPF, DKIM and DMARC on
the sending domain. Without `SMTP_HOST` emails are only logged. Locally, Mailpit (docker compose)
captures mail at http://localhost:8026.

## 8. Backups

- Enable the provider's automated backups + PITR (≥ 7 days; 30 recommended for financial records).
- Nightly logical backup for off-provider retention:
  `pg_dump --format=custom --no-owner "$DATABASE_URL" > oq-$(date +%F).dump`, encrypted at rest.
- Test a restore at least quarterly (see RUNBOOK). The ledger and audit log are append-only by design;
  never "fix" them by editing rows — use adjustment entries.
