# Security policy

## Reporting a vulnerability

Please email **security@<your-domain>** (to be configured before launch) with a description, steps to
reproduce and impact. Do not open public issues for vulnerabilities. We aim to acknowledge within
2 business days and to provide a remediation timeline within 7 days.

## Supported versions

Only the latest `main` deployment is supported.

## Security controls (summary)

- Authentication via Better Auth (email + password ≥ 10 chars, DB-backed sessions, secure cookies
  over HTTPS). Roles are assigned only by administrators and enforced server-side on every page,
  server action and route handler; customers can only access their own quotes and orders.
- Rig API keys are 256-bit random, shown once, stored as SHA-256 hashes and revocable.
- Rate limiting (Postgres fixed window) on authentication, quote requests and telemetry.
- Stripe webhooks are signature-verified against the raw body and processed idempotently; prices are
  computed only on the server.
- Security headers (CSP, HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy,
  X-Content-Type-Options). Known gap: CSP allows inline scripts (see ARCHITECTURE "hardening backlog").
- Append-only inventory ledger and audit log enforced by database triggers.
- Secrets only via environment variables; logs redact credentials and PII.

## Dependency notes

`npm audit` reports a moderate advisory in `esbuild` pulled in by `drizzle-kit`'s legacy loader. It
affects only the local development server of esbuild, which this project never runs; drizzle-kit is a
dev-only tool and is not present in the production image. Dependabot is enabled for npm, GitHub
Actions and Docker.
