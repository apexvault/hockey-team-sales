# Hockey Beta Backlog — Dependency-Aware Tasks

Derived from `BETA_BACKLOG.md` reconciled against the Day 0 audit evidence in
`DAY_0_AUDIT.md`. Each task carries business outcome, acceptance criteria,
dependencies, risk, files affected, test plan, review owner, and definition of done.

**Review rule (AGENT_RULES):** implementers never approve their own security,
permission, schema, or release-critical work. `Review owner` names a role other
than the implementer.

**Sequencing rule:** P0-SEC-* and P0-INF-* gate everything else. Every hockey
concept (roster, artwork, proof, credit) hangs off `Company`, and the company
boundary is not currently enforced server-side.

---

## Legend

| Field | Meaning |
|---|---|
| Blocks | Tasks that cannot start until this completes |
| Risk | H/M/L — likelihood × blast radius |
| Review | Role that must independently sign off |

---

# WAVE 0 — Make the baseline trustworthy

These are prerequisites to *all* feature work. Nothing below Wave 0 should start
until Wave 0 passes independent review.

---

### P0-1 · Restore a working production build ✅ DONE (this branch)

- **Outcome:** `pnpm build` succeeds on a clean checkout.
- **Problem:** `apps/storefront/src/lib/search-client.ts:4` imports
  `@medusajs/instantsearch-adapter`, absent from `package.json` and the lockfile.
- **Fix applied:** added `@medusajs/instantsearch-adapter@2.21.1`.
- **Acceptance:** `pnpm build` exits 0 for both apps.
- **Note:** the storefront build additionally requires a **live backend** — Next.js
  collects page data at build time (`ECONNREFUSED` without it). This constrains CI
  design (see P0-INF-1) and must be documented for staging.
- **Review:** QA/Release.

---

### P0-INF-1 · Continuous integration

- **Outcome:** no commit reaches `main` without install/lint/build/test passing.
- **Why first:** the absence of CI is the direct cause of P0-1 and P0-2 shipping undetected.
- **Scope:** `.github/workflows/ci.yml` on `push` + `pull_request`:
  `corepack enable` → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build`
  → backend tests, with a **Postgres service container** and a step that boots the
  backend before the storefront build (per P0-1's constraint).
- **Acceptance:** a deliberately broken import fails CI; a clean branch passes.
- **Dependencies:** P0-1, P0-INF-2. **Blocks:** everything after Wave 0.
- **Risk:** M · **Files:** `.github/workflows/` · **Review:** DevOps + QA.

---

### P0-INF-2 · Reproducible toolchain

- **Outcome:** a new contributor or CI runner can build without tribal knowledge.
- **Scope:** document `corepack enable` (pnpm 9.15.0 is **not on PATH**; only
  corepack resolves it); correct README's stale "pnpm v10+" claim; add a
  `docker-compose.yml` for Postgres; add a root `typecheck` script (`tsc --noEmit`
  per app) and a turbo task — **none exists today**; add `cross-env` to the backend
  test scripts, which currently fail on Windows with `'TEST_TYPE' is not recognized`.
- **Acceptance:** documented steps work from a clean clone on Windows and Linux;
  `pnpm typecheck` runs and reports.
- **Blocks:** P0-INF-1. **Risk:** L · **Review:** DevOps.

---

### P0-SEC-1 · Company-scoped authorization (fixes F-01, F-07, F-10, F-11)

- **Outcome:** a team can only ever act on its own records.
- **Problem:** `ensure-role.ts:25` waives the check for companies with 0 employees,
  and the storefront signup flow creates exactly that state — **so every user who
  registers becomes a `company_admin` over every team on the platform**.
  `ensure-role.ts:37` compares a global role string and never binds the caller to
  `req.params.id`.
- **Scope:** replace `ensureRole` with `ensureCompanyAccess({ admin? })` resolving
  `req.auth_context.actor_id → customer → employee → company_id`, comparing against
  the path, and writing a trusted `req.company_id`. Delete the bootstrap bypass;
  create the first employee inside `createCompaniesWorkflow` server-side. Stop
  treating `user_metadata.role` as an authorization source. Null-guard
  `providerIdentity` (today it throws → **500 instead of 403**).
- **Acceptance:** negative tests prove Team A cannot read/modify/delete Team B for
  **every** `/store/companies/**` and `/store/approvals/**` route; a brand-new
  registrant has authority over their own company only; missing provider identity
  returns 403, not 500.
- **Risk:** **H** · **Files:** `api/middlewares/ensure-role.ts`,
  `api/store/companies/middlewares.ts`, `api/store/approvals/middlewares.ts`,
  `workflows/company/`, `workflows/employee/`
- **Review:** **Security reviewer + QA — implementer may not self-approve.**

---

### P0-SEC-2 · Authorize every exported route verb (fixes F-02, F-03, F-04, F-16)

- **Outcome:** no HTTP verb is reachable without an explicit authorization entry.
- **Problem:** Medusa registers any verb exported from `route.ts` regardless of
  middleware coverage. `DELETE /store/companies/:id` and
  `DELETE /store/companies/:id/employees/:employeeId` have handlers and **no
  middleware entry** — any authenticated user can delete any team or any player.
  `POST /store/companies/:id` has neither role check nor body validation and
  spreads raw `req.body`. `POST /store/carts/:id/line-items/bulk` has **no
  `authenticate` at all**.
- **Scope:** add explicit entries for every exported verb; apply the unused
  `StoreUpdateCompany` validator; remove `DELETE` from the store surface (team
  deletion belongs to `/admin`); add a **CI check that fails when a `route.ts`
  exports a verb with no matching authorization entry** — this bug class will
  otherwise recur.
- **Acceptance:** negative tests for each verb; the CI check fails on a
  deliberately unguarded verb.
- **Dependencies:** P0-SEC-1 · **Risk:** **H** · **Review:** **Security + QA.**

---

### P0-SEC-3 · Server-side approval enforcement (fixes F-06)

- **Outcome:** a required approval cannot be bypassed.
- **Problem:** the server only asks "is there a pending approval record?" — never
  "does this company require approval?". The decision to create one lives in a
  React branch (`payment-button/index.tsx:60`). Skipping that call and posting
  straight to `/store/carts/:id/complete` completes the order with zero approvals.
- **Scope:** in `completeCartWorkflow.hooks.validate`, load
  `cart.company.approval_settings` and require a matching **APPROVED** approval for
  each required type. **Absence must fail closed.**
- **Acceptance:** a test that never calls the approvals endpoint and attempts
  completion is rejected; approval-not-required companies still complete.
- **Dependencies:** P0-SEC-1 · **Risk:** **H**
- **Files:** `workflows/hooks/validate-cart-completion.ts`, `utils/get-cart-approval-status.ts`
- **Review:** **Security + QA.**

---

### P0-SEC-4 · Scope quote routes to their owner (fixes F-05, F-12, F-15)

- **Outcome:** only the owning customer can act on a quote.
- **Problem:** `GET /store/quotes/:id` correctly filters by `actor_id`, but
  `accept`, `reject`, `messages`, and `preview` **do not**. Anyone with a quote ID
  can accept a quote — committing another team to a live payable order — or read
  its negotiated pricing.
- **Acceptance:** negative tests for accept/reject/messages/preview as a
  non-owning customer.
- **Dependencies:** P0-SEC-1 · **Risk:** **H** · **Review:** **Security + QA.**

---

### P0-SEC-5 · Cart-freeze and spend-cap defects (fixes F-13, F-14)

- **Outcome:** approvals cannot be weaponised; spend caps actually cap spend.
- **Problems:** (a) anyone can create a PENDING approval on any cart, after which
  all three cart hooks throw — **permanently freezing that team's checkout**.
  (b) `validate-cart-completion.ts:31` never fetches `customer.orders`, so prior
  spend is always `0` — a $500 monthly cap permits unlimited $499 orders.
- **Scope:** verify cart company ownership before creating an approval; add
  `orders.total`, `orders.created_at`, and `employee.company.spending_limit_reset_frequency`
  to the graph query.
- **Acceptance:** a test proving cumulative spend across multiple orders is what's
  compared; a non-member cannot create an approval on another team's cart.
- **Dependencies:** P0-SEC-1 · **Risk:** **H** · **Review:** **Security + QA.**

---

### P0-2 · Repair the integration test suite

- **Outcome:** `test:integration:http` passes, giving CI something to protect.
- **Problem:** 15/15 tests fail on a clean checkout. `regionSeeder` creates a region
  with **no `countries`**, then `cartSeeder` posts `country_code: "us"` → 400.
- **Scope:** fix the fixtures (add `countries`); decouple `admin.ts` from the
  hardcoded `"supersecret"` JWT value; remove committed debug logging
  (`console.log("vic logs …")` in `companies.spec.ts:35,37`).
- **Constraint:** **do not weaken assertions to force a pass.**
- **Acceptance:** 15/15 pass locally and in CI.
- **Dependencies:** P0-INF-2 · **Blocks:** P0-INF-1 · **Risk:** M
- **Review:** QA — **implementer may not self-approve.**

---

### P0-SEC-6 · Secrets hygiene

- **Outcome:** no secret can be committed by accident.
- **Scope:** broaden `.gitignore` to `**/.env*` with `!**/.env.template` — today
  `.env.test`, `.env.production`, `.env.staging` are **not ignored**, and Medusa's
  jest setup loads `.env.test`. Fail fast in `medusa-config.ts` when
  `JWT_SECRET`/`COOKIE_SECRET` are empty: Medusa currently **falls back silently to
  the literal `"supersecret"`** outside production. Add `NEXT_PUBLIC_STRIPE_KEY` and
  `NEXT_PUBLIC_PAYPAL_CLIENT_ID` to `.env.template` (read by code, absent from the
  template); blank the committed `REVALIDATE_SECRET=supersecret`.
- **Acceptance:** an empty secret fails startup in every environment; a test
  `.env.*` file cannot be staged.
- **Risk:** M · **Review:** Security.

---

# WAVE 1 — Hockey domain foundations

Start only after Wave 0 passes independent review.

---

### P0-DATA-1 · Team account model

- **Outcome:** a Company can represent a team, league, school, or wholesale store.
- **Scope:** EXTEND `Company` — `account_type`, `sport`, team colours,
  `assigned_salesperson_id`, `lifetime_spend`, credit fields. Preserve the existing
  8 module links; they are the starter's most valuable asset.
- **Acceptance:** migration applies to a clean DB and is reversible; existing
  company tests still pass.
- **Dependencies:** P0-SEC-1 · **Risk:** M
- **Review:** Data/integrations + **independent schema review**.

---

### P0-INF-3 · File storage + upload pipeline

- **Outcome:** artwork can be uploaded safely. **Currently no upload capability
  exists at all** — only a `TODO` comment, and no File Module is registered.
- **Owner gate:** storage provider choice (S3 vs. other).
- **Security controls (specify up front):** authenticated + company-scoped route;
  server-side **magic-byte MIME sniffing** (never trust `Content-Type` or
  extension); explicit allowlist; **SVG sanitised or rejected** — it executes
  script when served same-origin; hard byte cap at the body-parser; **randomised
  storage keys** so one team cannot guess another's artwork URL; serve with
  `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`; persist
  the owning `company_id` for tenant-filtered retrieval.
- **Acceptance:** negative tests for oversized, wrong-type, disguised-extension,
  malicious-SVG, and cross-tenant retrieval.
- **Dependencies:** P0-SEC-1, P0-DATA-1 · **Blocks:** P0-DATA-2, roster, reorder
- **Risk:** **H** · **Review:** **Security + QA.**

---

### P0-INF-4 · Notification provider

- **Outcome:** email actually sends. MASTER_SPEC makes designer↔customer email
  **mandatory**; today **no notification provider is registered** and
  `src/subscribers/` is empty, so nothing can be delivered.
- **Owner gate:** provider choice.
- **Dependencies:** P0-DATA-1 · **Blocks:** invitations, reminders, order comms
- **Risk:** M · **Review:** DevOps + QA.

---

### P0-DATA-2 · Artwork, versions, and proof approval

- **Outcome:** artwork is versioned; a specific proof version is approved, and the
  approval is attributable and immutable.
- **Scope:** new `artwork` module (`Artwork` + versions), modelled on the
  `Quote`+`Message` parent/revision shape. **Extend the `approval` *pattern*, not
  its table** — `Approval` is hard-keyed to `cart_id`; proof approval must key on an
  artwork **version**. Reuse the `validate-cart-completion` hook pattern to gate
  production on proof approval.
- **Acceptance:** TEST_PLAN scenario 6 passes, including the negative test
  "approval of the wrong artwork version"; approval records are append-only.
- **Dependencies:** P0-INF-3 · **Risk:** **H** · **Review:** **Security + QA.**

---

### P0-DATA-3 · Roster and personalization

- **Outcome:** per-player name, number, and size collected and validated.
- **Scope:** new `roster` module with `Roster` + `RosterEntry`. **Do not overload
  `Employee`** — a roster player usually has no login and belongs to an *order*,
  not an account. Enforce number uniqueness per roster; constrain sizes to real SKUs.
- **UI:** extend the existing `ProductVariantsTable` + `BulkTableQuantity` pattern
  with free-text per-row cells and CSV **import** (export already exists via
  `cart-to-csv-button`). **Must ship a responsive treatment** — card-per-player
  below the `small` breakpoint; the current table only scrolls horizontally, which
  fails MASTER_SPEC's mobile requirement for 20+ row rosters.
- **Acceptance:** TEST_PLAN scenario 7; duplicate-number rejection; CSV import
  reports per-row errors; usable on a phone viewport.
- **Dependencies:** P0-DATA-1 · **Risk:** M · **Review:** Product + UI/UX + QA.

---

### P0-DATA-4 · Order pipeline and status history

- **Outcome:** the 10 MASTER_SPEC statuses are representable with auditable history.
- **Problem:** only ~3 of 10 statuses have any representation and 2 carry the wrong
  meaning. `NEEDS_ARTWORK`, `IN_DESIGN`, `IN_PRODUCTION`, `QUALITY_CHECK`,
  `READY_TO_SHIP` have none.
- **Scope:** **do not extend Medusa's core `OrderStatus`** — it drives
  fulfillment/payment logic. Add a separate `OrderPipeline` model plus an
  **append-only `OrderStatusHistory`** (`order_id, from, to, actor_id, actor_type,
  reason, created_at`), linked via `defineLink` following `links/order-company.ts`.
  Enforce legal transitions in a workflow step, not in route handlers.
  Mapping contract: `SHIPPED` derives from core `fulfillment_status`;
  `CLOSED` ⇄ `OrderStatus.COMPLETED`; the other 8 are pipeline-only.
- **Owner gate:** migration strategy approval.
- **Acceptance:** TEST_PLAN scenario 9; illegal transitions rejected; history immutable.
- **Dependencies:** P0-DATA-1 · **Risk:** **H** · **Review:** **Data + Security + QA.**

---

### P0-ROLE-1 · Salesperson, Designer, Production roles

- **Outcome:** the MASTER_SPEC role model exists. Today **only three identities
  exist**; Salesperson, Designer, and Production/Operations are entirely absent —
  and `ApprovalType.SALES_MANAGER` is a **dangling enum no actor consumes**.
- **Scope:** staff sub-roles with scoped permissions; designer assignment;
  production queue access; resolve the `employee.is_admin` vs `user_metadata.role`
  **dual source of truth** (they drift — `is_admin: true` never calls
  `setAdminRoleStep`).
- **Acceptance:** negative tests per role; one authoritative role store.
- **Dependencies:** P0-SEC-1 · **Risk:** **H** · **Review:** **Security + QA.**

---

# WAVE 2 — Commercial rules

| ID | Task | Dependencies | Risk | Review |
|---|---|---|---|---|
| P1-COM-1 | **Invite-only wholesale access** — the invite button is literally `toast.info("Not implemented")`; signup is currently open | P0-INF-4, P0-ROLE-1 | M | Security + QA |
| P1-COM-2 | **Lifetime-spend discount tiers** ($1k/2%, $5k/7%, $20k/10%, $100k/20%) — reuse customer_group→price_list as the *mechanism*; build the missing *driver* (spend accumulator + tier job). `src/jobs/` is empty | P0-DATA-1 | M | Product + Data + QA |
| P1-COM-3 | **Company credit limit** — extend the existing server-side hook rather than adding a second gate; semantics differ from `spending_limit` (revolving balance vs. periodic cap) | P0-SEC-5, P0-DATA-1 | H | Security + QA + **owner gate: credit policy** |
| P1-COM-4 | **Payment provider** — no backend provider is registered; checkout cannot charge a card | — | H | **Owner gate** + Security |
| P1-COM-5 | **US/CA regions** — seed is EU-only (`gb,de,dk,se,fr,es,it`); also make the seed **idempotent** (it currently has no existence checks and will collide on SKUs) | — | L | Data + QA |
| P1-COM-6 | Saved designs + reorder — upgrade `previously-purchased` from variant-level to design-level | P0-DATA-2 | M | Product + QA |

---

# WAVE 3 — Operating leverage

| ID | Task | Dependencies | Risk |
|---|---|---|---|
| P1-OPS-1 | Admin sales pipeline dashboard with search + drill-down (scaffold exists: `routes/companies/page.tsx` + filters pattern) | P0-DATA-4 | M |
| P1-OPS-2 | Designer↔customer collaboration UI — extend `QuoteMessages` with attachments and version history | P0-DATA-2 | M |
| P1-OPS-3 | Customer-visible order pipeline stepper — `order-details` currently shows only number/date/email | P0-DATA-4 | M |
| P1-OPS-4 | Notifications + overdue-action reminders | P0-INF-4 | M |
| P1-OPS-5 | Audit history / activity timeline | P0-DATA-4 | M |
| P1-OPS-6 | Lead capture and routing | P0-ROLE-1 | M |

---

# WAVE 4 — Quality and launch readiness

| ID | Task | Dependencies | Risk |
|---|---|---|---|
| P1-QA-1 | **Negative permission test suite** covering every TEST_PLAN required negative test — cross-tenant access, role escalation, price/discount tampering, credit bypass, wrong-version approval, unsafe upload, unauthorized status mutation | Wave 0 | H |
| P1-QA-2 | **Accessibility remediation** — fix the systemic `Input` `htmlFor`/`id` mismatch affecting ~14 forms; label icon-only buttons; raise `text-neutral-400` label contrast above 4.5:1; add semantic landmarks | — | M |
| P1-QA-3 | Mobile/desktop workflow evidence for every beta path step (MASTER_SPEC acceptance requirement) | Waves 1–3 | M |
| P1-QA-4 | Rebrand — remove hardcoded Medusa branding **and the Medusa Cloud promo banner rendered on every page** (`(main)/layout.tsx`) | — | L |
| P1-REL-1 | Staging deployment to DreamHost — **nothing exists today** (no Dockerfile/Procfile/nginx/PM2); note the storefront build needs a live backend | P0-INF-1 | H (owner gate) |
| P1-REL-2 | Backups, monitoring, rollback runbook — all three are currently aspirational text only | P1-REL-1 | H |
| P1-REL-3 | Harden `update.yaml` — pin actions to SHAs (currently mutable `@v1`/`@v3` tags with `contents:write` and an `ANTHROPIC_API_KEY`) | — | M |
| P2-DATA-1 | Add missing indexes (`quote.customer_id`, `quote.cart_id`, `approval.cart_id`, `approval_status.cart_id`); unique constraint on `company.email`; clean up stale MikroORM snapshots | P0-DATA-1 | L |

---

## P2 — Expansion (unchanged from BETA_BACKLOG)

Automated outreach in Review mode · further integrations · SMS after email is
reliable · broader soft-goods categories.

---

## Critical path to beta

```
P0-INF-2 ─┬─ P0-2 ──┐
          └─ P0-INF-1 ──┐
P0-SEC-1 ──┬── P0-SEC-2 ─┼─→ P0-DATA-1 ─┬─ P0-INF-3 ─→ P0-DATA-2 ─→ P1-OPS-2
           ├── P0-SEC-3  │              ├─ P0-INF-4 ─→ P1-COM-1
           ├── P0-SEC-4  │              ├─ P0-DATA-3
           └── P0-SEC-5  │              └─ P0-DATA-4 ─→ P1-OPS-1/3/5
                         └─→ P0-ROLE-1
                                        → P1-QA-1 → P1-REL-1 → P1-REL-2
```

**The longest chain is:**
`P0-SEC-1 → P0-DATA-1 → P0-INF-3 → P0-DATA-2 → P1-OPS-2 → P1-QA-1 → P1-REL-1 → P1-REL-2`

Artwork/proof is the critical path, because it is both the largest net-new domain
area and a hard dependency of the collaboration and reorder features.

---

## First task to start

**P0-SEC-1 — company-scoped authorization.** It is the single highest-severity
finding (every registrant is currently a global admin over every team), it is the
shared root cause of nine findings, and every Wave 1 hockey model hangs off the
`Company` boundary it establishes. Implemented by Application Engineering, reviewed
independently by Security and QA.
