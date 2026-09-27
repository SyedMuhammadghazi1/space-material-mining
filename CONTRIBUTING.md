# Contributing

## Setup

Follow the README quickstart (Node 22, `docker compose up -d db mailpit`, `npm ci`, `npm run db:migrate`,
`npm run db:seed`, `npm run dev`).

## Workflow

1. Branch from `main` (`feature/…`, `fix/…`). Keep PRs focused; fill in the PR template.
2. Before pushing run: `npm run lint && npm run format:check && npm run typecheck && npm test`.
   For UI/API changes also `npm run build && npm run test:e2e`.
3. CI must be green; at least one review is required before merge.

## Conventions

- Business rules live in pure functions (`src/lib/models`, schemas in `src/lib/*`) with unit tests;
  I/O and authorization live in `src/server/*` services that take an `Actor` and call `assertRole`.
- Every object read by customers is filtered by ownership in the query itself; add an integration test
  for any new customer-facing read.
- Money is integer cents (BIGINT); masses are NUMERIC(18,3) kg; never use floats for stored money.
- Schema changes: edit `src/db/schema.ts`, `npm run db:generate`, commit the SQL. Migrations must be
  backwards compatible with the previous release.
- Model changes that alter numeric outputs must bump `MODEL_VERSION` and update docs/ARCHITECTURE.md.
- Keep UI copy honest about model limitations; never present planning estimates as guarantees.
- No secrets, personal data or real customer data in code, fixtures, screenshots or logs.
- Commit messages: imperative subject ≤ 72 chars, body explaining why.
