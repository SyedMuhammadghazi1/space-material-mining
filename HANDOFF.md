# Handoff: project status (paused 2026-09-29)

Work on this repo is paused. This file records where things stand so the next session can resume
without re-discovering context. To resume: open a Claude Code session on this repo and ask it to
read `HANDOFF.md` and continue from "Next steps".

## What this is

Orbital Quarry (working name, set via `NEXT_PUBLIC_APP_NAME`): the operating platform for a
company that extracts silicon, titanium and other materials in space and fabricates there. It
covers target prospecting (lunar sites + NEAs, JPL SBDB importer), first-order delta-v / yield /
mission-economics models, rig telemetry ingest, an append-only material ledger across depots,
in-space fabrication jobs, and a B2B quote → order → Stripe deposit invoice flow. See `README.md`
and `docs/ARCHITECTURE.md`. All physics/economics are planning approximations, not flight-grade.

## State at pause

- `main` on GitHub is complete and green: lint, format, typecheck, 232 unit + integration tests,
  production build, 4 Playwright e2e tests and the Docker image smoke test all pass in GitHub
  Actions (CI run for `0c4db47`).
- The Deploy workflow runs after CI succeeds: it built and pushed the image to GHCR; the migrate
  and deploy steps skip with a notice until `PRODUCTION_DATABASE_URL` and `DEPLOY_HOOK_URL` are
  set as secrets in the `production` environment.
- Nothing is deployed to a live host yet. No real Stripe keys or SMTP have been used.

## History of the work

1. Built from scratch (Next.js 16, Drizzle/Postgres, Better Auth, Stripe, Vitest, Playwright).
2. Independent review fixed 5 bugs:
   - an open redirect via `?next=`;
   - an `invoice.paid` that arrives before the invoice id is stored being lost;
   - cancelled orders' invoices staying payable;
   - sub-gram quantities and impossible dates causing 500s.
3. Hardening pass:
   - spoof-resistant client IP (`CLIENT_IP_HEADER` / `TRUSTED_PROXY_HOPS`) with per-account auth
     limits;
   - `SKIP_ENV_VALIDATION` ignored at production runtime;
   - deploys gated on CI;
   - telemetry batches processed in seq order (no deadlocks);
   - invoices voided if the order is cancelled mid-creation;
   - least-privilege DB roles script (`scripts/sql/app-role.sql`).
4. Deploy skips commits that are no longer the head of `main`.

## Known gaps (not built or not verified)

- Stripe and SMTP only exercised via test doubles; Vercel deployment documented but untested.
- CSP still allows `'unsafe-inline'`; no email verification or password reset.
- The NEA delta-v model is deliberately simple (tends to be pessimistic vs. published values).
- Edge cases noted by review but not changed: Stripe idempotency keys expire after 24 h (a very
  late retry after a partial failure could duplicate an invoice); `ceilCents` loses sub-cent
  precision at unit prices of about $1B or more.
- Production must run the app as the restricted DB role and migrations as the owner role
  (see `docs/DEPLOYMENT.md`), otherwise TRUNCATE can bypass the append-only triggers.

## Before real customers (see `docs/LAUNCH_CHECKLIST.md`)

- Legal review (space-resources law, export controls such as ITAR/EAR, terms, privacy) and an
  expert review of the models; refresh seeded NEAs from JPL SBDB.
- Live Stripe keys + `invoice.paid` webhook, SMTP with SPF/DKIM/DMARC, production secrets, GitHub
  `production` environment secrets, `CRON_SECRET` + `APP_URL` for the scheduled rig-health job.

## Next steps

1. Pick a host (see `docs/DEPLOYMENT.md`), create managed Postgres + the two DB roles, deploy.
2. Wire Stripe test mode end to end, then SMTP; enable email verification / password reset.
3. Tighten CSP (nonces) and review the known gaps above.
4. Review and merge Dependabot PRs.
