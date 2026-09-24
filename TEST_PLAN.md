# Test and Release Plan

## Baseline commands

Claude must discover and record the exact commands supported by the repository. At minimum evaluate:

- Clean dependency install
- Formatting/linting
- Type checking
- Unit tests
- Integration tests
- End-to-end tests
- Production build
- Migration validation

## Critical beta scenarios

1. Admin creates/configures products and pricing.
2. Customer or salesperson creates a quote.
3. Accepted quote becomes an order without losing pricing or customer context.
4. Customer uploads artwork safely.
5. Designer and customer collaborate and preserve version history.
6. Customer approves a specific proof; approval is attributable and immutable.
7. Roster/personalization is validated before production readiness.
8. Payment or available credit is enforced server-side.
9. Order moves through production and shipment with auditable status history.
10. Authorized customer reorders a stored design.

## Required negative tests

- Cross-tenant record access
- Unauthorized role changes
- Price/discount tampering
- Credit-limit bypass
- Approval of the wrong artwork version
- Unsafe or oversized upload
- Order/status mutation by an unauthorized user
- Access to another customer's messages, files, roster, or saved design

## Release gate

No release candidate passes unless critical tests, lint, typecheck, production build, migration review, permission review, and smoke tests pass. Known failures must be documented with severity and owner.
