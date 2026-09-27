# Launch checklist (non-code)

Things a founder must do before real customers. Items marked ⚖️ need professional review.

## Company, legal & compliance

- [ ] ⚖️ Terms of sale for in-space deliveries: risk of loss, delivery definition at orbital nodes,
      force majeure (launch failures, debris events), liability caps, governing law.
- [ ] ⚖️ Space resources law: legal opinion on ownership/sale of extracted resources (e.g. US CSLCA
      2015, Luxembourg 2017 law, Artemis Accords principles, Outer Space Treaty Art. II/VI) for each
      jurisdiction you operate or sell in. Mission authorisation/supervision obligations of the
      launching/licensing state.
- [ ] ⚖️ Export controls (ITAR/EAR and equivalents) for technical data exposed in the portal, and
      sanctions screening of customers.
- [ ] ⚖️ Privacy policy and data-processing terms (GDPR/UK GDPR/CCPA as applicable); cookie notice
      (the app uses only strictly necessary session cookies).
- [ ] ⚖️ Review of every public claim. The product copy states that economics/physics are first-order
      planning models and composition values are nominal — keep it that way in marketing too.
- [ ] Insurance: launch/in-orbit third-party liability, cargo, professional indemnity, cyber.
- [ ] Accounting treatment of deposits (liability until delivery), tax/VAT on space deliveries.

## Engineering validation (needs domain experts)

- [ ] Independent review of the Δv, process and economics assumptions by a mission-analysis and
      ISRU team; replace nominal composition with survey data for any site you sell from.
- [ ] Refresh every NEA from JPL SBDB (Targets → "Refresh from SBDB") and document the epoch used.
- [ ] Calibrate cost bases (`material_cost_bases`) and transport costs against real contracts.

## Payments

- [ ] Activate the Stripe account (business verification), enable invoicing, bank transfers/ACH for
      large B2B deposits, branding and invoice emails. Note card payments have per-charge limits.
- [ ] Register the production webhook (`invoice.paid`) and set `STRIPE_WEBHOOK_SECRET`.
- [ ] Refund/cancellation process for deposits (admin cancellation does not refund automatically).

## Domain, DNS & email

- [ ] Register the domain; DNS with DNSSEC; TLS via the host; HSTS preload only once HTTPS is final.
- [ ] Transactional email provider on a sending subdomain with SPF, DKIM, DMARC (`p=quarantine` →
      `reject`); set `EMAIL_FROM`; test deliverability of quote/order/alert emails.
- [ ] Enable email verification and password reset in Better Auth once sending is verified.

## Operations & security

- [ ] Production secrets generated fresh (never reuse dev values); stored in the host's secret manager.
- [ ] Monitoring: uptime checks on `/api/health` and `/api/ready`, log aggregation with alerts on
      `level>=50`, error tracking (e.g. Sentry), Postgres metrics (connections, storage, slow queries).
- [ ] Schedule `/api/cron/rig-health`; route alert emails to an on-call rotation (`OPS_ALERT_EMAILS`).
- [ ] Backups + PITR verified with a real restore drill.
- [ ] Create named staff accounts; remove/never create seed demo users in production; enforce strong
      passwords and consider 2FA for staff.
- [ ] Penetration test / security review before onboarding customers; set up `security@` mailbox
      referenced in SECURITY.md.
- [ ] Accessibility review (WCAG 2.2 AA) of the customer portal.
- [ ] Status page and customer support channel.
