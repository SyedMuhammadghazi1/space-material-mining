## Summary

<!-- What does this change and why? -->

## Checklist

- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck` pass
- [ ] `npm test` passes (unit + integration against the test database)
- [ ] `npm run build` and `npm run test:e2e` pass (UI or API changes)
- [ ] New or changed business rules have unit tests; authorization rules have integration tests
- [ ] Schema changes: migration generated with `npm run db:generate` and committed
- [ ] Model changes that alter numeric outputs bump `MODEL_VERSION` (`src/lib/models/version.ts`)
- [ ] New env vars documented in `.env.example`, README and `src/env.ts`
- [ ] No secrets, PII or real customer data in code, fixtures or logs

## Risk & rollout

<!-- Migrations, feature flags, backfills, rollback plan. -->
