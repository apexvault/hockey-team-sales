# Project Status

## Executive status

- Phase: Wave 0 — Make the baseline trustworthy
- State: **ACTIVE** — Day 0 COMPLETE and accepted; P0-SEC-1 implemented, in independent review
- Overall beta completion: **~12–18%** of the hockey beta path (method and
  confidence in `DAY_0_AUDIT.md` §10). Hockey-specific code: **0%**.
- Current owner blocker: 7 owner gates open (see below) — none block the first P0 task
- Production status: No deployment authorized; **no deployment mechanism exists**
- Next milestone: Wave 0 complete — remaining: **P0-INF-1 (CI)**, P0-INF-2 (toolchain), P0-2 (residual fixture debt), P0-SEC-6 (secrets), **P0-SEC-7 (new — cart-transfer ownership, before beta)**

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
| **P0-SEC-1 company-scoped authorization** | **COMPLETE — APPROVED WITH CONDITIONS** | Security rejected twice, then approved on the third round; QA passed with corrections. Both rejections found real defects. **22 Day 0 findings closed + 10 new found and fixed, 1 verified by test**; conditions tracked in P0-SEC-7. See `SECURITY_FINDINGS.md` |
| Launch forecast | **DONE** | See below |

## Baseline command results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` | PASS (0 errors, 14 warnings) |
| `medusa db:migrate` | PASS (162 tables from empty) |
| `pnpm build` | **PASS** — only after P0-1 fix; requires a live backend |
| `pnpm test` | **NO-OP** — no app defines a `test` script |
| `test:unit` | **PASS 28/28** (first unit tests in the repo; were 0) |
| `test:integration:http` | **PASS 61/61** (were 0/48) |
| typecheck | **Does not exist** |

## Top risks

1. **No CI exists** — now the single largest risk. It is why a broken build and a
   fully broken test suite both shipped undetected, and nothing yet protects the
   89 tests now guarding the authorization boundary. **P0-INF-1.**
2. **No deployment, backup, monitoring, or rollback mechanism exists anywhere.**
3. Artwork/proof/roster/production are ~0% built and sit on the critical path.
4. **`POST /store/carts/:id/customer` has no ownership check** (F-41) — any
   authenticated customer with a cart id can transfer that cart to themselves and
   read its contents, which now also moves the cart's company link. Gated only by
   ULID entropy. **P0-SEC-7, before beta.**
5. Admin surface still has no role granularity — any staff login sees every
   team's data (F-18, **P0-ROLE-1**).
5. `JWT_SECRET` may be empty, in which case Medusa silently falls back to the
   literal `"supersecret"` outside production (F-20, **P0-SEC-6**).
6. No invitation or consent step exists for roster attachment, so an admin can
   attach any unaffiliated customer to their team (F-35, **P1-COM-1**).
7. Employee↔customer duplication is still possible under a race; it needs a DB
   unique constraint (F-34, **P2-DATA-1**). A duplicate would let membership
   resolve to an arbitrary company.
8. A one-person team currently has no self-service offboarding path: the
   `LAST_EMPLOYEE` guard blocks removing the only member, and a customer already
   affiliated cannot found another company. Deliberate, but an **owner policy
   decision** to confirm.

Closed since the last report: soft-delete revocation (F-39) is no longer an open
question — an integration test now proves a removed employee's still-valid token
is refused.

**Retired by P0-SEC-1** (were risks 1-3 and 7): global `company_admin` on signup
(F-01), React-only approval enforcement (F-06), unauthorized DELETE routes
(F-02/F-03), and compensation-path privilege escalation (F-22).

## Owner gates open

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
