# Project Status

## Executive status

- Phase: Day 0 — Foundation and Audit
- State: **COMPLETE** (2026-09-23)
- Overall beta completion: **~12–18%** of the hockey beta path (method and
  confidence in `DAY_0_AUDIT.md` §10). Hockey-specific code: **0%**.
- Current owner blocker: 7 owner gates open (see below) — none block the first P0 task
- Production status: No deployment authorized; **no deployment mechanism exists**
- Next milestone: Wave 0 complete — trustworthy baseline (CI + authorization + tests)

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
| Launch forecast | **DONE** | See below |

## Baseline command results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` | PASS (0 errors, 14 warnings) |
| `medusa db:migrate` | PASS (162 tables from empty) |
| `pnpm build` | **PASS** — only after P0-1 fix; requires a live backend |
| `pnpm test` | **NO-OP** — no app defines a `test` script |
| `test:unit` | 0 tests exist |
| `test:integration:http` | **FAIL 15/15** |
| typecheck | **Does not exist** |

## Top risks

1. **Every user who registers becomes a global `company_admin` over every team**
   (F-01). Highest-severity finding; rosters contain minors' data.
2. **Purchase approval is enforced only in the React UI** (F-06) — trivially bypassed.
3. **Two `DELETE` routes have no authorization at all** (F-02, F-03) — any user can
   delete any team or any player.
4. **No CI exists** — which is why a broken build and a fully broken test suite
   both shipped undetected.
5. **No deployment, backup, monitoring, or rollback mechanism exists anywhere.**
6. Artwork/proof/roster/production are ~0% built and sit on the critical path.
7. **Workflow compensation handlers grant global `company_admin` on rollback**
   (F-22) — privilege escalation triggered by an error path.

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
