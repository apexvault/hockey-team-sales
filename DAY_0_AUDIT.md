# Day 0 Audit Report — Evidence Record

Date: 2026-09-23
Branch: `chore/day-0-baseline-audit` (from `main` @ `7f36e09`)
Method: read-only inspection + executed baseline commands. Every claim below is
backed by a command result or a file path.

---

## 1. Repository and branch selection

| Fact | Value |
|---|---|
| Selected repository | `C:\code\Claude\hockey-team-sales-app` |
| `origin` | `https://github.com/apexvault/hockey-team-sales.git` |
| `upstream` (configured Day 0) | `https://github.com/medusajs/b2b-starter.git` |
| Selected baseline branch | `main` @ `7f36e09` ("fix: remove status filter") |
| Day 0 working branch | `chore/day-0-baseline-audit` |

**Rationale.** `main` is the only branch on `origin` and is the tip of all work.
There was no more-advanced branch to choose between.

### Fork divergence: ZERO

```
git rev-list --left-right --count upstream/main...origin/main
0       0
git diff upstream/main HEAD          -> (empty)
```

**This fork is byte-identical to `medusajs/b2b-starter` at `7f36e09`.** No
hockey-specific code, schema, or configuration exists. All 49 commits are
upstream commits. `README.md` still instructs cloning the Medusa repo.

Consequence: hockey-specific completeness is **0%**. What exists is a generic
B2B commerce starter that happens to be a good foundation.

### Worktree safety

| Check | Result |
|---|---|
| Worktrees | 1 (`C:/Code/Claude/hockey-team-sales-app`, main) |
| Stashes | none |
| Uncommitted tracked changes | none |
| Untracked files | the 9 supplied Day 0 documents only |

No user work was at risk and none was discarded or overwritten.

---

## 2. Actual stack (authoritative — supersedes assumptions in ARCHITECTURE.md)

| Layer | Actual | Note |
|---|---|---|
| Backend framework | **Medusa 2.21.1** | `apps/backend/package.json` |
| Storefront | **Next.js 15.5.21**, App Router, React 19.0.5 | `apps/storefront/package.json` |
| Language | TypeScript ^5.5.3 | backend `strictNullChecks` only; storefront full `strict` |
| **ORM** | **MikroORM** (via Medusa framework) | **NOT Prisma** — ARCHITECTURE.md's "Prisma where already used" does not apply |
| Database | PostgreSQL | 162 tables after migration |
| Package manager | **pnpm 9.15.0**, pinned via `packageManager` | not on PATH; reachable only via `corepack` |
| Monorepo | Turborepo ^2.3.3, workspaces `apps/*` | |
| Node | engines `^20.19.0 \|\| >=22.12.0`; local v24.18.0 | satisfied |
| Search | Medusa **native Postgres search** + `@medusajs/instantsearch-adapter` | not Algolia/Meilisearch |
| Containerization | **none in repo** | no Dockerfile, no docker-compose |

### Configured vs. merely present

`apps/backend/medusa-config.ts` registers **only** the three custom modules and
DB/CORS/secrets. Nothing else is wired:

| Integration | Reality |
|---|---|
| Stripe / PayPal | storefront UI + deps only; **no backend payment provider registered** — checkout cannot charge a card |
| Redis | `REDIS_URL` in template but **never read**; in-memory event bus/cache (single-instance only) |
| File storage | **no File Module registered** → local-disk default. Blocks artwork/proofs |
| Email / notifications | **no notification provider** → MASTER_SPEC's *mandatory* email is impossible today |
| Subscribers / jobs | `src/subscribers/` and `src/jobs/` contain only `README.md` — zero of each |

---

## 3. Baseline command results

Commands were run from the repo root unless noted. `pnpm` invoked via a corepack
shim because it is not on PATH.

| # | Command | Result | Duration |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | **PASS** (exit 0, 1911 packages) | ~120s |
| 2 | `pnpm lint` | **PASS** (exit 0) — 0 errors, 14 warnings | 5s |
| 3 | `medusa db:migrate` (fresh DB) | **PASS** (exit 0) — 162 tables, seed script ran | 21s |
| 4 | `pnpm build` (as-found) | **FAIL** — storefront module-not-found | 27s |
| 4b | `pnpm build` (after P0-1 fix, backend running) | **PASS** (exit 0, 2/2 tasks) | 28s |
| 5 | `pnpm test` | **NO-OP** — neither app defines a `test` script | — |
| 6 | `pnpm test:unit` | **0 tests found** — no `*.unit.spec.ts` exists anywhere | 5s |
| 7 | `test:integration:http` | **FAIL — 15/15 tests, 3/3 suites** | 45s |
| 8 | typecheck | **DOES NOT EXIST** — no script in any package or turbo task | — |

### Lint warnings (0 errors, non-blocking)
12 backend (`prices-in-major-units` ×4, `use-medusa-error-not-generic-error` ×7,
`no-wildcard-with-specific-fields` ×1) + 2 storefront (`react-hooks/exhaustive-deps`).

### Windows portability defect
Backend test scripts use POSIX inline env syntax
(`TEST_TYPE=integration:http NODE_OPTIONS=... jest`). On Windows/PowerShell this
fails immediately with `'TEST_TYPE' is not recognized`. Tests are **unrunnable on
Windows** via the documented scripts; the baseline above was obtained by running
them through bash. Fix: `cross-env`.

---

## 4. P0-1 — Broken production build (FIXED this branch)

**The chosen baseline could not produce a production build.**

```
./src/lib/search-client.ts
Module not found: Can't resolve '@medusajs/instantsearch-adapter'
```

`apps/storefront/src/lib/search-client.ts:4` imports
`@medusajs/instantsearch-adapter`, which was **absent from
`apps/storefront/package.json` and absent from `pnpm-lock.yaml` entirely**.
Introduced by `74230a8 feat: search (#34)`. Because the fork is identical to
upstream, **upstream `main` is also broken**, and because there is no CI
(§6) nothing detected it.

**Fix applied:** added `@medusajs/instantsearch-adapter@2.21.1` (version matched
to the other pinned `@medusajs/*` packages). Build then passes: `Tasks: 2
successful, 2 total`, exit 0.

**Second constraint discovered while verifying the fix:** the storefront build
performs build-time data collection against the backend and fails with
`ECONNREFUSED` if it is not running. A full `pnpm build` therefore requires a
**live backend + database + a valid publishable key**. This materially constrains
CI and staging design and is captured in P0-INF-1.

This is the minimum change required to satisfy the Day 0 requirement of a
reproducible production build. It is additive and reversible.

---

## 5. P0-2 — Entire test suite fails on a clean checkout (NOT fixed; deliberate)

All 15 tests in all 3 suites fail. Root cause traced through the fixtures:

- `integration-tests/utils/seeder.ts:1-9` — `regionSeeder` creates a region with
  **no `countries`** (the string `countries` appears nowhere in `integration-tests/`).
- `integration-tests/utils/seeder.ts:55-70` — `cartSeeder` then posts a shipping
  address with `country_code: "us"`.
- `POST /store/carts` rejects with **400**.

Secondary defects found in the same files:
- `integration-tests/utils/admin.ts:45` signs tokens with `process.env.JWT_SECRET`
  while the specs inject `JWT_SECRET: "supersecret"` — the suite only works if the
  ambient env happens to match that hardcoded value.
- `companies.spec.ts:35,37` contain committed debug logging (`console.log("vic logs …")`).

**Not fixed in Day 0, by design.** AGENT_RULES forbids weakening tests to force a
pass, and repairing fixtures is implementation work requiring independent review.
Raised as backlog item **P0-2**.

Net testing position: **0 unit tests, 0 module tests, 0 storefront tests, 0
passing integration tests, 0 negative permission tests.** Under MASTER_SPEC's
acceptance principle, **no feature can currently be marked DONE.**

---

## 6. CI, deployment, backups, monitoring, rollback

| Area | Finding |
|---|---|
| **CI** | **None.** The only workflow, `.github/workflows/update.yaml`, is `workflow_dispatch`-only and runs an AI dependency-updater. **Nothing runs install/lint/test/build on push or PR.** This is why P0-1 and P0-2 went unnoticed. |
| CI supply chain | That workflow grants `contents: write` + `pull-requests: write`, holds `ANTHROPIC_API_KEY`, and pins `medusajs/medusa-update-action@v1` and `actions/checkout@v3` to **mutable tags, not SHAs**. Mitigated only by being manual-trigger. |
| **Deployment** | **Nothing exists.** No Dockerfile, Procfile, nginx, PM2, Vercel, AWS, or DreamHost config. No reference to `crm.beclutch.me` anywhere. The DreamHost→AWS progression in ARCHITECTURE.md has **no implementation whatsoever**. |
| **Backups** | **None.** The word appears only in the planning documents. |
| **Monitoring** | **Effectively none.** No error tracking, no APM, no metrics. A health endpoint **does** exist — `GET /health` returned **HTTP 200** against the running backend (Medusa framework built-in), so liveness probing is possible today. |
| **Rollback** | **None.** Aspirational text only; no scripts, tags, or runbook. |
| Local dev | Requires a manually provisioned Postgres; no compose file. Day 0 used a dedicated container on port **5442** to avoid unrelated databases already running on 5432/5433. |

### Environment configuration defects
- `NEXT_PUBLIC_STRIPE_KEY` and `NEXT_PUBLIC_PAYPAL_CLIENT_ID` are **read by
  `payment-wrapper/index.tsx` but absent from `.env.template`**.
- `REVALIDATE_SECRET=supersecret` is a committed, guessable default.
- `check-env-variables.js` validates only 1 of the `NEXT_PUBLIC_*` vars used.
- **`.gitignore` covers `**/.env` and `**/.env.local` but NOT `.env.test`,
  `.env.production`, `.env.staging`** — Medusa's jest setup loads `.env.test`, so a
  developer creating one would commit it silently. Fixed on this branch.

---

## 7. Security and tenant isolation — 21 findings

Audited independently of the implementation pass. In this product a "company" is a
**hockey team**, so cross-company leakage means cross-team leakage, and rosters
contain minors' data.

### Critical

| ID | Finding | Evidence |
|---|---|---|
| **F-01** | **Every user who signs up becomes a global `company_admin`.** `ensure-role.ts:25` waives the role check when a company has 0 employees; the storefront signup flow (`lib/data/customer.ts:95-113`) creates a company then adds the user as `is_admin`, which writes `user_metadata.role = "company_admin"`. That role is **never company-scoped** (`ensure-role.ts:37`), so it grants admin over **every** team. | `api/middlewares/ensure-role.ts:17-41` |
| **F-02** | `DELETE /store/companies/:id` has **no authorization middleware at all** — the verb is exported and therefore routed, but `middlewares.ts` defines only GET/POST. Any authenticated user can delete any team. | `store/companies/[id]/route.ts:60-70` |
| **F-03** | `DELETE /store/companies/:id/employees/:employeeId` — same class; handler ignores the company segment and deletes by employee id alone. | `.../[employeeId]/route.ts:73-86` |
| **F-04** | `POST /store/companies/:id` has neither `ensureRole` **nor body validation** — the handler spreads raw `req.body` into the update workflow. Any user can rewrite any team's billing email, address, or currency. | `store/companies/[id]/route.ts:31-58` |
| **F-05** | `POST /store/quotes/:id/accept` never verifies quote ownership — anyone with a quote ID can commit another team to a live order. (Contrast: `GET /store/quotes/:id` *is* correctly scoped.) | `customer-accept-quote.ts:17-48` |
| **F-06** | **Purchase approval is enforced only in the React UI.** The server checks "is there a pending approval record?", never "does this company require approval?". Skipping the client call to `/store/carts/:id/approvals` and going straight to `/complete` bypasses approval entirely. | `workflows/hooks/validate-cart-completion.ts:20-25` |
| **F-07** | `POST /store/approvals/:id` — any `company_admin` (per F-01, anyone) can approve or reject **any** team's cart. No self-approval prevention. | `store/approvals/[id]/route.ts:8-36` |

### High
- **F-08/F-09** — `GET /store/companies/:id`, `/employees`, `/employees/:employeeId`
  are tenant IDORs returning full customer records (name, email, phone) for any
  team. Youth rosters make this COPPA-adjacent.
- **F-10** — `POST .../employees/:employeeId` takes `company_id` from the **URL**,
  allowing a player to be reassigned to another team, or their `spending_limit`
  and `is_admin` rewritten. Also: `is_admin: true` updates the DB flag but never
  calls `setAdminRoleStep`, so `employee.is_admin` and `user_metadata.role` drift —
  **two divergent sources of truth for the same authorization decision.**
- **F-11** — approval settings for any team can be disabled remotely.
- **F-12** — `GET /store/quotes/:id/preview` leaks another team's negotiated pricing.
- **F-13** — anyone can create a PENDING approval on any cart, **permanently
  freezing that team's checkout** (all three cart hooks then throw).

### Medium / Low
- **F-14** — the spending limit check never fetches `customer.orders`, so prior
  spend is always `0`: a $500 monthly cap permits unlimited $499 orders.
- **F-15** — quote reject/messages unscoped.
- **F-16** — `POST /store/carts/:id/line-items/bulk` has **no `authenticate`** at all.
- **F-17** — `ensureRole` runs on `/store/approvals*` where `req.params.id` is
  undefined; also dereferences `providerIdentity` with no null guard → **500 instead
  of 403** (fail-open decided by an unhandled exception).
- **F-18** — all admin users are equal; no scoping, and `GET /admin/approvals`
  returns every company's data to any staff login.
- **F-19** — no upload capability exists at all (only a `TODO` comment).
- **F-20** — **no committed secrets found.** Residual: `medusa-config.ts` passes
  empty `JWT_SECRET` through, and Medusa **silently falls back to the literal
  `"supersecret"` outside production**.

### Root cause
Nine findings share one cause: **the tenant identifier is read from the URL path
and never cross-checked against the caller.** Point fixes will leave the next route
with the same hole. Recommended structural fix: a single
`ensureCompanyAccess({ admin? })` middleware that derives
`actor_id → customer → employee → company_id`, compares it to the path, and writes a
trusted `req.company_id`; then enforce the rule that **no `/store/**` handler may
read a tenant id from `req.params` or `req.body`**.

---

## 8. Data and schema

- Migrations **do** reproduce a clean database deterministically (verified: 162
  tables from empty, exit 0).
- **Snapshot sprawl.** Each module carries `.snapshot-b2b-debug.json` and
  (two modules) `.snapshot-medusa-backend.json`. MikroORM names snapshots after
  the *database* name, so neither matches the documented DB name. `db:migrate` is
  unaffected, but `db:generate` will silently fall back to diffing the live schema
  and write a third stale snapshot.
- **Seed is EU-only** — regions `gb, de, dk, se, fr, es, it`, EUR default.
  MASTER_SPEC targets **US and Canada**. Seed is also **non-idempotent** (no
  existence checks; re-running will collide on SKUs) and **unreferenced anywhere**
  except as a migration script.
- **Missing indexes** on `quote.customer_id`, `quote.cart_id`, `approval.cart_id`,
  `approval_status.cart_id` — only `deleted_at` is indexed on those tables, while
  `employee.company_id` and `message.quote_id` *are* indexed. Inconsistent.
- No unique constraint on `company.email`.
- Cross-module references (`quote.cart_id`, `approval.cart_id`, …) are plain text
  with **no DB-level referential integrity** — by design in Medusa (module links),
  but orphan rows are possible.
- Money uses `bigNumber()` correctly (numeric + raw jsonb).

---

## 9. UI/UX

- Storefront App Router with working B2B journeys: quote request, quote
  negotiation, company/employee management, approvals, bulk add-to-cart, checkout.
- **`QuoteMessages`** (`quotes/components/quote-messages.tsx`) is a real,
  item-scoped, attributed two-sided message thread — the single best foundation for
  designer↔customer collaboration. Text-only today.
- **Order status UI is near-empty**: `order-details/index.tsx` shows only order
  number, date, and email. No pipeline stepper exists.
- Responsive coverage is uneven: `account` 31 breakpoint usages, `cart` 17,
  `layout` 16 — but **`modules/quotes` and `modules/common` have 0**.
- **Accessibility defect (systemic):** the shared `Input`
  (`modules/common/components/input/index.tsx:56-75`) has
  `<label htmlFor={name}>` but the input sets only `name`, never `id` — labels are
  **not programmatically associated** in ~14 forms. A JS focus handler masks it
  visually. Also: only 4 `aria-label`s repo-wide, icon-only close buttons unlabeled,
  5 semantic landmarks total, and `text-neutral-400` labels on white ≈ 2.8:1 (below
  the 4.5:1 AA minimum).
- **Medusa branding is hardcoded in components**, not just config — including a
  promo banner on every page (`(main)/layout.tsx`) advertising Medusa Cloud.

---

## 10. Beta completeness

Method: equal 10% weight per MASTER_SPEC beta path step, scored on the fraction of
the **hockey** requirement met. Medusa generics earn partial credit only.

| Step | Score |
|---|---|
| 1 Lead / account creation | 50 |
| 2 Product & pricing selection | 55 |
| 3 Quote creation & acceptance | 75 |
| 4 Artwork upload & designer collaboration | 10 |
| 5 Proof review & approval | 5 |
| 6 Roster & personalization | 0 |
| 7 Payment / approved credit | 35 |
| 8 Production handoff & status tracking | 10 |
| 9 Shipment / delivery confirmation | 40 |
| 10 Reorder from saved designs | 15 |
| **Raw weighted total** | **29.5%** |

**Reported figure: ~15–20%. Confidence: MEDIUM-HIGH.**

Three adjustments pull the raw number down:
1. **The remaining 70% is the harder 70%.** Steps 4, 5, 6, 8 are net-new domain
   modelling with no structural ancestor. Effort-weighted ≈ **20%**.
2. **The acceptance principle is met nowhere** — 0 passing tests, 0 negative
   permission tests, and 7 critical authorization defects. Under a strict gate ≈ **15%**.
3. **Infrastructure blockers sit under multiple steps**: no file storage (blocks 4,
   5, 10), no notifications (blocks the *mandatory* email requirement), no payment
   provider (blocks 7), EU-only seed data (spec requires US/CA).

### Status tallies

Beta path (10 steps): **0 DONE · 6 PARTIAL · 4 MISSING · 0 BLOCKED · 0 N/A**
P0 core commercial workflow (11 items): **0 DONE · 7 PARTIAL · 4 MISSING**

### Roles: spec vs. implemented
Only three identities exist — Medusa admin `user`, a customer with
`user_metadata.role === "company_admin"`, and a plain customer.

| Spec role | Status |
|---|---|
| Admin | PARTIAL — all admins equal, no sub-roles |
| Salesperson | **MISSING** — `SALES_MANAGER` enum exists but **no actor consumes it** |
| Designer | **MISSING** |
| Customer / team rep | PARTIAL — role lives in auth metadata, not the domain model |
| Invited team member | PARTIAL — the record exists; **the invite is a stub** (`toast.info("Not implemented")`) |
| Wholesale / store account | PARTIAL — no invite-only gate, no application state |
| Production / operations | **MISSING** |

### Order statuses
Only ~3 of the 10 MASTER_SPEC statuses have any representation, and 2 of those
carry the wrong meaning (`AWAITING_APPROVAL` currently means *price* approval, not
*proof* approval). `NEEDS_ARTWORK`, `IN_DESIGN`, `IN_PRODUCTION`, `QUALITY_CHECK`,
`READY_TO_SHIP` have **no representation at all**.

Recommendation (owner gate): do **not** extend Medusa's core `OrderStatus`. Add a
separate `OrderPipeline` model plus an append-only `OrderStatusHistory`, linked to
core Order following the `links/order-company.ts` pattern.

---

## 11. Reusable B2B functionality → hockey

The starter's real value is **not its features** — it is the module-link graph and
the server-side enforcement pattern (`workflows/hooks/*` → throw). Nothing warrants
a REPLACE.

| Hockey concept | Starter primitive | Verdict |
|---|---|---|
| Team / club / store account | `Company` | **EXTEND** — add account_type, sport, colors, salesperson, lifetime_spend, credit fields. The 8 existing links are the prize. |
| Purchasing team member | `Employee` | **EXTEND** |
| Roster participant | — | **ADD NEW** — a roster player usually has no login; do **not** overload `Employee` |
| Quote + designer chat | `Quote` + `Message` | **REUSE Quote / EXTEND Message** — add attachments, designer author type, broader thread scope |
| Proof approval | `Approval` module | **EXTEND THE PATTERN, NOT THE TABLE** — it is hard-keyed to `cart_id`; proofs must key on an artwork **version** |
| Credit limit | `spending_limit` + `check-spending-limit.ts` | **EXTEND** — mechanism is right and correctly server-side; semantics differ (per-employee periodic cap vs. company revolving balance) |
| Discount tiers | `customer_group` link + price lists | **REUSE the mechanism / ADD the driver** — the $1k/2% … $100k/20% ladder needs a lifetime-spend accumulator, and `src/jobs/` is empty |
| Saved designs, production pipeline, notifications, file storage | — | **ADD** |

---

## 12. Documents reconciled

| Document | Action |
|---|---|
| `ARCHITECTURE.md` | **Conflict: Prisma.** Actual ORM is MikroORM. Also "Docker and NGINX where already used" — neither is present. Corrected in this report; ARCHITECTURE.md left intact as the stated *preference*, with the conflict recorded here and in DECISIONS.md. |
| `PROJECT_STATUS.md` | Updated — all trackers moved off NOT STARTED with evidence. |
| `DECISIONS.md` | Added D-008..D-013 as **Proposed** (not approved). |
| `BETA_BACKLOG.md` | Superseded in detail by `DAY_0_BACKLOG.md`; left as the strategic view. |
| `CLAUDE_START_DAY_0.md` | Instructed reading `DAY_0/…`; the documents are actually at the repo root. No `DAY_0/` directory exists. Noted, not "fixed". |
| `TEST_PLAN.md` | Baseline commands now filled in by §3. |

---

## 13. Owner gates (no autonomous action taken)

1. **Order-status migration strategy** — adding the 10 hockey statuses.
2. **Payment provider selection** — nothing can be charged today.
3. **File/object storage selection** (S3 vs. other) — blocks all artwork work.
4. **Email provider selection** — blocks the *mandatory* email requirement.
5. **Hosting decision** — DreamHost staging has zero implementation; confirm
   target before DevOps work is sequenced.
6. **Credit policy** — commercial/legal rules for credit limits and AR.
7. **US/CA region migration** — seed data is EU-only.

No production deployment, production data change, credential rotation, purchase,
or destructive deletion was performed.
