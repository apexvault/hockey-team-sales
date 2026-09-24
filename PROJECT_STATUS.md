# Project Status

# ⛔ PAUSED — REFERENCE ONLY

**Owner decision, 2026-09-23.** Work on this application is **paused**.
`rbk-team-sales` is now the primary Apex Apparel platform. This repository is
retained as a **reference implementation and audit record only**.

No further feature or security work is authorised. P0-INF-2, P0-2, F-42, F-43,
F-37 and F-38 are all **deferred** — see "Deferred work" below.

---

## 🚫 PROHIBITED USES

This application **must not** receive any of the following, in any environment,
until the open critical findings below are closed and re-reviewed:

| Prohibited | |
|---|---|
| **Real users** | No production or invited user accounts |
| **Guest traffic** | F-42 is an open, accepted residual — guest carts carrying PII can be copied out permanently |
| **Payments** | No payment provider is registered, and F-43 permits unauthenticated payment-session creation |
| **Rosters** | No invitation or consent flow exists (F-35) |
| **Minors' data** | Follows directly from the two above; this is the binding constraint |
| **Production deployment** | No deployment mechanism exists, and `main` has no branch protection |

This is not a precaution about hypothetical risk. Each row maps to a specific
open finding with a working proof of concept, recorded in `SECURITY_FINDINGS.md`.

---

## Executive status

- Phase: Wave 0 — **halted** partway
- State: **PAUSED — REFERENCE ONLY**
- Overall beta completion: **~12–18%** of the hockey beta path (method and
  confidence in `DAY_0_AUDIT.md` §10). Hockey-specific code: **0%**.
- Production status: **No deployment authorized; no deployment mechanism exists;
  prohibited per the table above**
- Work completed and independently reviewed before the pause: Day 0, P0-SEC-1,
  P0-INF-1, P0-SEC-7

## ⚠️ OPEN CRITICAL FINDINGS AT PAUSE

Four findings are **open** and were deliberately deferred with the security
reviewer's explicit agreement. None is theoretical — each was demonstrated
against a running server. Full detail in `SECURITY_FINDINGS.md`.

| ID | Severity | What it is | Why it matters on resume |
|---|---|---|---|
| **F-42** | **MEDIUM — gating** | **Guest carts carrying PII can be read, claimed, and COPIED OUT PERMANENTLY by anyone holding the cart id.** A stranger can `POST /store/quotes` with a guest cart id and receive a durable attacker-owned draft order containing the basket — and the real customer later registering and claiming the cart **does not revoke it**. | This is the binding constraint on guest traffic and minors' data. "Close before real traffic" must account for **copy-out**, not merely read. Fix needs a server-set cart nonce, or requiring a claimant's authenticated email to match `cart.email`. |
| **F-43** | **MEDIUM** | **`POST /store/payment-collections/:id/payment-sessions` is unguarded and WRITES.** With a collection id, an unauthenticated caller reads the victim's basket `amount` and creates payment sessions on their collection, each carrying `context.customer` = the attacker. | Independent of the leak, this is a cost and abuse vector against a real PSP, plus a payment-confusion risk. Deferrable **only** because every acquisition path for an owned cart's collection id is closed and `pay_col_<ULID>` is not guessable — the remaining route to one is a guest cart, i.e. F-42. Fix is one `cart_payment_collection` link hop. |
| **F-37** | LOW | `StoreUpdateApproval.status` is a bare `z.string()`, not a native enum, and `ensureApprovalAccess` ignores `approval.status` — so an already-decided approval can be re-decided. | Fails closed against the completion rule today, but the column is modelled as an enum. Not cart-id-as-authority; swept into P0-SEC-7 by proximity, not by class. |
| **F-38** | LOW | `set-admin-role` still writes a non-company-scoped `role` marker into `user_metadata`. | Nothing reads it for authorization any more, but any future consumer re-opens F-01/F-22 — the two most severe findings of the whole audit. |

Also still open, from earlier waves: **F-18** (no admin role granularity),
**F-19** (no upload capability), **F-20** (empty `JWT_SECRET` falls back to the
literal `"supersecret"` outside production), **F-34** (employee↔customer
duplication race needs a DB unique constraint), **F-35** (no invitation/consent
for roster attachment).

---

## Deferred work

Explicitly **not started**, by owner decision:

| Item | What it was | Why it matters later |
|---|---|---|
| **P0-INF-2** | Reproducible toolchain: add `.nvmrc` (the Node version currently lives in the CI workflow, not the repo), add a `typecheck` script and CI job, add `cross-env` so backend test scripts run on Windows, add `docker-compose.yml` for Postgres | Two pre-existing `tsc` errors currently block adding the typecheck job — it would make CI red on arrival. Those must be fixed first. |
| **P0-2** | Residual test-fixture debt: decouple `integration-tests/utils/admin.ts` from the hardcoded `JWT_SECRET="supersecret"`; remove the three committed `console.log("vic logs …")` statements in `companies.spec.ts` | The JWT coupling is the single most confusing failure mode for a newcomer — a mismatch 401s every admin request and looks nothing like its cause. |
| **Fail-closed cart-route test** | A test that enumerates every store route accepting a `cart_id` and asserts each one is guarded | **The highest-value deferred item.** The cart-id-as-authority rule is currently enforced by *remembering* to register the guard on each new route. Nothing fails closed for a route nobody thought about — which is exactly how `/store/shipping-options` was missed after three other routes had been fixed. Same shape as the route-verb coverage check already in CI. |

---

## Day 0 tracker

| Workstream | Status | Evidence |
|---|---|---|
| Repository/branch selection | **DONE** | `main` @ `7f36e09`; branch `chore/day-0-baseline-audit`; upstream configured; **zero divergence from `medusajs/b2b-starter`** |
| Technology and dependency audit | **DONE** | Medusa 2.21.1 + Next 15.5.21 + MikroORM (**not Prisma**); `DAY_0_AUDIT.md` §2 |
| Product/spec reconciliation | **DONE** | Beta path: 0 DONE / 6 PARTIAL / 4 MISSING; `DAY_0_AUDIT.md` §10 |
| Agent structure and guardrails | **DONE** | 8 specialist roles; independent QA enforced; no self-approval |
| Backlog reconciliation | **DONE** | `DAY_0_BACKLOG.md` — 4 waves, dependency-aware, critical path identified |
| Baseline tests/build | **DONE (with failures recorded)** | install PASS · lint PASS · migrate PASS · build PASS *after P0-1 fix* · **tests 15/15 FAIL** · typecheck **does not exist** |
| Security/permission baseline | **DONE** | **26 findings, 8 CRITICAL** (5 added by independent QA); `DAY_0_AUDIT.md` §7 |
| **P0-SEC-7 cart-ID-as-authority** | **COMPLETE — SECURITY APPROVED** | Branch `feat/p0-sec-7-cart-ownership` @ `9f49cdd`; PR [#2](https://github.com/apexvault/hockey-team-sales/pull/2). Security rejected twice with executed exploits, then approved; QA passed with corrections. 5 routes guarded, 20 tests. F-37/F-38/F-42/F-43 explicitly deferred **on the reviewer's word**, not mine |
| **P0-INF-1 mandatory CI** | **COMPLETE — CI GREEN** | Run [35940269550](https://github.com/apexvault/hockey-team-sales/actions/runs/35940269550), all 6 jobs success. Draft PR [#1](https://github.com/apexvault/hockey-team-sales/pull/1) — review only, **not merged**. Independent review found 2 false-green holes that survived a green run; both fixed and the fix proven by simulation |
| **P0-SEC-1 company-scoped authorization** | **COMPLETE — APPROVED WITH CONDITIONS** | Security rejected twice, then approved on the third round; QA passed with corrections. Both rejections found real defects. **22 Day 0 findings closed + 10 new found and fixed, 1 verified by test**; conditions tracked in P0-SEC-7. See `SECURITY_FINDINGS.md` |
| Launch forecast | **DONE** | See below |

## Baseline command results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` | PASS (0 errors, 12 warnings) |
| `medusa db:migrate` | PASS (162 tables from empty) |
| `pnpm build` | **PASS** — only after P0-1 fix; requires a live backend |
| `pnpm test` | **NO-OP** — no app defines a `test` script |
| `test:unit` | **PASS 28/28** (first unit tests in the repo; were 0) |
| `test:integration:http` | **PASS 86/86** (were 0/48) |
| typecheck | **Still does not exist** — two pre-existing `tsc` errors block adding it; P0-INF-2 |

## Top risks

1. **CI exists and is green, but it is not yet MANDATORY.** `main` has no branch
   protection and no rulesets, so a red `CI passed` check blocks nothing today.
   **This is an owner action** — changing repository access policy is outside
   what I may do autonomously. See "Owner gates open" below for the exact steps.
   Until it is done, every guarantee below is advisory.
2. **No deployment, backup, monitoring, or rollback mechanism exists anywhere.**
3. Artwork/proof/roster/production are ~0% built and sit on the critical path.
4. Admin surface still has no role granularity — any staff login sees every
   team's data (F-18, **P0-ROLE-1**).
5. `JWT_SECRET` may be empty, in which case Medusa silently falls back to the
   literal `"supersecret"` outside production (F-20, **P0-SEC-6**).
6. No invitation or consent step exists for roster attachment, so an admin can
   attach any unaffiliated customer to their team (F-35, **P1-COM-1**).
7. **Guest carts carrying PII can be copied out permanently** by anyone holding
   the cart id (F-42) — a stranger can turn a guest cart into an attacker-owned
   draft order that survives the parent reclaiming the cart. Accepted residual;
   **must close before any real guest traffic carrying minors' data**, and
   "before" has to account for copy-out, not merely read.
8. Employee↔customer duplication is still possible under a race; it needs a DB
   unique constraint (F-34, **P2-DATA-1**). A duplicate would let membership
   resolve to an arbitrary company.
9. **A one-person organization still has no self-service offboarding path.** The
   `LAST_ADMINISTRATOR` guard refuses removing or demoting the last administrator,
   and because the last remaining member is necessarily an administrator, no
   other state is reachable. Succession works and is tested; winding down does
   not, pending the archive/closure workflow (D-018). This is the intended
   policy per owner decision 4, not a defect — recorded so it is not mistaken
   for solved.

Closed since the last report: F-41 (cart-ID-as-authority) is fixed by P0-SEC-7
and mutation-verified. Soft-delete revocation (F-39) was closed the round before
by an integration test proving a removed employee's still-valid token is refused.

**Retired by P0-SEC-1** (were risks 1-3 and 7): global `company_admin` on signup
(F-01), React-only approval enforcement (F-06), unauthorized DELETE routes
(F-02/F-03), and compensation-path privilege escalation (F-22).

## 🔄 HOW TO RESUME SAFELY

Read this section first. The order matters and is not arbitrary.

### Step 0 — verify nothing drifted
```bash
git fetch origin
git log --oneline origin/main -1          # expect 7f36e09, unchanged
git status --short                        # expect empty
```
`main` must still be `7f36e09a8aacd5083481f2c75d40c9a4305fc99c`. Four branches
and two draft PRs carry all the work; **nothing was merged**.

### Step 1 — restore the local environment
```bash
corepack enable                           # pnpm is NOT on PATH without this
docker start hockey-day0-postgres         # stopped at pause, NOT deleted; data intact
pnpm install --frozen-lockfile
```
Then follow `CONTRIBUTING.md` exactly — it documents the two things that are not
discoverable (pnpm via corepack, and `JWT_SECRET` must be exactly `supersecret`
or every integration test 401s).

Expected once running: **86/86 integration, 28/28 unit, lint 0 errors, build 2/2.**

### Step 2 — required branch order and dependency chain

Each branch is cut from the previous one, so they must be reviewed and merged
**in this order**. Merging out of order will produce conflicts and, worse, could
land a security fix without the boundary it depends on.

```
main (7f36e09)
  └─ chore/day-0-baseline-audit          audit + broken-build fix + .gitignore
       └─ feat/p0-sec-1-company-scoped-authorization    the tenant boundary
            └─ feat/p0-inf-1-mandatory-ci               CI + LAST_ADMINISTRATOR
                 └─ feat/p0-sec-7-cart-ownership        cart-ID-as-authority
```

**PR #2 targets `main`, not PR #1.** Its diff against `main` therefore contains
every commit above it — merging #2 merges the whole chain. Decide that
deliberately; do not discover it at merge time.

Dependency reasoning, so the order is not treated as cosmetic:
1. **Day 0 first** — it contains the fix without which `pnpm build` fails at all.
2. **P0-SEC-1 before anything else** — every later guard derives the caller's
   company from `resolveCompanyMembership`. Without it the other branches import
   a boundary that does not exist.
3. **P0-INF-1 before further feature work** — it is what stops a broken build or
   a disabled test suite reaching `main` again, which is how both shipped
   unnoticed originally.
4. **P0-SEC-7 last** — it extends P0-SEC-1's rule to cart-id-keyed routes and
   raises the CI test floor set by P0-INF-1.

### Step 3 — owner actions still outstanding
- **Enable branch protection on `main`** (gate 0 below). Until then CI is green
  but blocks nothing. Protect the check named **`CI passed`**, not the
  individual jobs.
- **Answer the multi-organization design question** (D-015/D-019 in
  `DECISIONS.md`) before any further authorization work.

### Step 4 — before any real traffic
Close **F-42** and **F-43**, and have both re-reviewed independently. The
prohibition table at the top of this file is the acceptance gate, not advice.

---

## Recommended next P0 (when resumed)

**P0-INF-2 — reproducible toolchain**, then **P0-2 — residual fixture debt**.
Rationale: CI is now the thing protecting 114 tests, and its two known soft spots
are both in P0-INF-2 — there is no `.nvmrc`, so the Node version lives in the
workflow rather than the repo, and there is still no `typecheck` job because two
pre-existing `tsc` errors would make CI red on arrival. Both are cheap and both
make CI stronger rather than adding surface to defend.

A follow-up worth scheduling, suggested by the security reviewer: the
cart-id-as-authority rule is currently enforced by *remembering* to register the
guard on each new route that accepts a `cart_id`. Nothing fails closed for a
route nobody thought about. A test that enumerates store routes accepting
`cart_id` and asserts each one is guarded would make the next omission
impossible — the same shape as the route-verb coverage check in CI.

## Owner gates open

0. **Enable branch protection on `main`** (new, blocking the value of P0-INF-1).
   Settings → Branches → Add rule for `main`:
   - Require status checks to pass before merging
   - Select the check named **`CI passed`** — *not* the individual jobs. A rule
     naming the individual jobs goes green when those jobs are skipped or
     cancelled, because GitHub reports neither failure nor success for them.
   - Require a pull request before merging
   - Consider a `CODEOWNERS` entry for `.github/` — under `pull_request`, a fork
     PR runs the workflow file *from the fork*, so a fork could replace `ci.yml`
     with a no-op that still declares a job named `CI passed`. This is inherent
     to required status checks; review of `.github/` is the only mitigation.
1. Order-status migration strategy
2. Payment provider selection (nothing can be charged today)
3. File/object storage selection (blocks all artwork work)
4. Email provider selection (blocks the *mandatory* email requirement)
5. Hosting confirmation (DreamHost staging has zero implementation)
6. Credit policy (commercial/legal)
7. US/CA region migration (seed data is EU-only)

## Beta forecast

Stated in **engineer-weeks** first, because a calendar figure is meaningless
without headcount. Revised after independent QA challenged the original estimate
as optimistic.

| Wave | Scope | Engineer-weeks |
|---|---|---|
| 0 | Trustworthy baseline: CI, authorization rework across ~20 routes, repair 15 tests, negative permission tests | 10–16 |
| 1 | Team model, file storage, notifications, artwork/proof, roster, order pipeline, staff roles | 24–36 |
| 2 | Commercial rules, payment provider, credit, discount tiers, US/CA regions | 14–20 |
| 3–4 | Operating leverage, QA, a11y, staging, backups/rollback | 14–20 |
| | **Subtotal** | **62–92** |
| | **Contingency (25%)** — MEDIUM confidence, 7 unanswered owner gates | +16–23 |
| | **Total** | **78–115 engineer-weeks** |

### Calendar translation (assumption must be chosen by the owner)

| Team | Calendar estimate |
|---|---|
| **1–2 engineers** | **30–40 weeks** |
| **3–4 engineers + dedicated security and QA reviewers** | **24–32 weeks** |

**Recommended planning figure: 24 weeks is the credible floor**, and only with a
team of 3–4 plus independent reviewers. The earlier "16 weeks" figure was a
straight sum of best cases with no contingency, while the waves are explicitly
serialised — it is withdrawn.

**Confidence: MEDIUM.** Drivers of the spread:
- **Owner-gate latency is unmodelled.** Three of the seven gates block entire
  waves and none are answered. Historically the largest source of slip.
- Wave 0 is the most aggressive line item: a structural authorization rework with
  independent review is 2–3 engineer-weeks on its own, before the 15 broken tests,
  CI with a Postgres service *and* a booted backend, and the negative-test suite
  that five Wave 0 tasks name as acceptance.
- Artwork/proof/roster are net-new domain modelling with no structural ancestor.

This forecast assumes no production deployment occurs without explicit approval.

## Required daily report format

- Overall beta completion:
- Current phase:
- Completed since last report:
- Active work:
- Blockers / owner gates:
- Latest approved commit and CI:
- Staging/production status:
- Risks:
- Next milestone:
