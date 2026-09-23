# Security Findings Register

Live status of every security finding. The Day 0 evidence record in
`DAY_0_AUDIT.md` §7 is immutable and describes each finding as originally
discovered; this file tracks remediation.

- **Discovered:** Day 0 audit (2026-09-23), branch `chore/day-0-baseline-audit`
- **Last updated:** P0-SEC-1, commit `c3d0d9f`

| Status | Meaning |
|---|---|
| FIXED | Remediated and covered by an automated test |
| OPEN | Not yet remediated |
| N/A | Not applicable / superseded |

---

## Closed by P0-SEC-1 — company-scoped authorization boundary

The root cause of nine of these was a single pattern: **the tenant identifier
was read from the URL, body or cart metadata and never cross-checked against the
caller.** It is fixed structurally, not per-route, by
`apps/backend/src/api/middlewares/ensure-company-access.ts`, which derives the
company from `auth_context → customer → employee → company` and treats any
client-supplied company id as a claim that must match.

| ID | Severity | Finding | Status | Fix |
|---|---|---|---|---|
| F-01 | CRITICAL | Every registrant became a global `company_admin` (zero-employee bootstrap bypass + non-company-scoped role) | **FIXED** | Founder created server-side in `createCompanyWithFounderWorkflow`; bootstrap branch deleted; `user_metadata.role` removed as an authorization input in favour of `employee.is_admin` |
| F-02 | CRITICAL | `DELETE /store/companies/:id` had no authorization entry | **FIXED** | Explicit `DELETE` entry, `ensureCompanyAccess({ admin: true })` |
| F-03 | CRITICAL | `DELETE .../employees/:employeeId` had no authorization entry and ignored the company segment | **FIXED** | Explicit entry + `ensureEmployeeInCompany` + handler filters on `company_id` |
| F-04 | CRITICAL | Company update had no role check and spread raw `req.body` | **FIXED** | Admin-scoped; `StoreUpdateCompany` validator wired in (it existed but was unused) |
| F-05 | CRITICAL | Quote acceptance never verified ownership | **FIXED** | `ensureQuoteAccess({ ownerOnly: true })` + `validateQuoteOwnershipStep` inside the workflow |
| F-06 | CRITICAL | Purchase approval enforced only in React | **FIXED** | `assertCartApprovalSatisfied` — fails closed when the company requires approval; 14 unit tests |
| F-07 | CRITICAL | Any "admin" could decide any team's approval; no self-approval guard | **FIXED** | `ensureApprovalAccess` — company-scoped, ADMIN-type only, rejects self-approval |
| F-08 | HIGH | `GET /store/companies/:id` tenant IDOR | **FIXED** | `ensureCompanyAccess`; handler reads `req.company_id` |
| F-09 | HIGH | Employee routes ignored the company segment | **FIXED** | `ensureEmployeeInCompany` + defence-in-depth `company_id` filters |
| F-10 | HIGH | `company_id` taken from the URL allowed employee reassignment; `is_admin` mirror asymmetry | **FIXED** | `company_id` derived from membership; `setAdminRoleStep` now also runs on promotion |
| F-11 | HIGH | Another team's approval settings could be disabled | **FIXED** | Admin-scoped, company derived |
| F-12 | HIGH | Quote preview leaked another team's negotiated pricing | **FIXED** | `ensureQuoteAccess()` |
| F-13 | HIGH | Anyone could freeze any cart with an approval request | **FIXED** | `ensureCartAccess` on `/store/carts/:id/approvals` |
| F-14 | MEDIUM | Spending limit never fetched prior orders, so a cap never accumulated | **FIXED** | Hook now requests `orders.total`, `orders.created_at`, and the company's reset frequency |
| F-15 | MEDIUM | Quote reject/messages unscoped | **FIXED** | Owner-only guard + workflow-level ownership assertion |
| F-16 | MEDIUM | `POST /store/carts/:id/line-items/bulk` had no `authenticate` at all | **FIXED** | Authentication + `ensureCartAccess` |
| F-17 | MEDIUM | `ensureRole` on a matcher with no `:id`; unguarded `providerIdentity` → 500 not 403 | **FIXED** | `ensureRole` deleted; guards never read a param the matcher lacks; all paths fail closed |
| F-22 | CRITICAL | Compensation handler set `role: "company_admin"` unconditionally — a failed demotion **promoted** the user | **FIXED** | Both handlers capture and restore the exact prior metadata; authorization no longer reads it |
| F-23 | MEDIUM | `filters: { id: undefined }` did not filter, binding to an arbitrary company | **FIXED** | No guard reads an absent param; membership never comes from a path lookup |
| F-24 | LOW | `remove-admin-role.ts` null dereference → 500 | **FIXED** | Null-guarded |
| F-25 | LOW | `validate-cart-completion` unguarded `queryCart` → raw `TypeError` | **FIXED** | Explicit `MedusaError` |
| F-26 | LOW | `:employee_id` matcher vs `[employeeId]` directory mismatch | **FIXED** | Guards use the route's actual param name |

### Found during P0-SEC-1 implementation (new)

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-27 | **HIGH** | The cart→company link was built from **client-supplied `cart.metadata.company_id`**. Omitting it detached the cart from its company, so approval and spending-limit checks found no settings to enforce — a one-field bypass of a team's purchase controls. Setting it to another id attributed the cart to a team the buyer does not belong to. | **FIXED** — `cart-created.ts` derives the company from the cart's customer |
| F-28 | MEDIUM | Same defect on the order→company link (`order.metadata.company_id`), corrupting per-team order history and spend attribution. | **FIXED** — `order-created.ts` derives from the order's customer |

---

## Still open

| ID | Severity | Finding | Owner / task |
|---|---|---|---|
| F-18 | LOW | Admin surface has no role granularity; any staff login sees every team's data. Some `/admin` routes lack body validation. | **P0-ROLE-1** |
| F-19 | LOW | No file-upload capability exists (artwork has no foundation). Controls specified in advance. | **P0-INF-3** |
| F-20 | LOW | `medusa-config.ts` passes an empty `JWT_SECRET` through; Medusa then silently falls back to the literal `"supersecret"` outside production. | **P0-SEC-6** |
| F-21 | INFO | Storefront `is_admin` gating is UI-only — acceptable now that the server enforces the same rule. | N/A |

---

## Non-security defects found while testing P0-SEC-1

Recorded here so they are not lost; neither is in P0-SEC-1's scope.

| ID | Finding | Evidence |
|---|---|---|
| D-01 | **Test fixtures were the real cause of the "all 15 tests fail" Day 0 finding.** The Day 0 audit attributed it to the region lacking `countries`; that was a genuine defect but **not** the blocker. The actual error was `Variants ... do not exist or belong to a product that is not published` — `productSeeder` created the product without `status: "published"`, so its variants were not purchasable. Both are now fixed. | `integration-tests/utils/seeder.ts` |
| D-02 | `POST /store/quotes` produces a draft-order line item with `unit_price: null` where the source cart item has `unit_price: 100`, failing an existing assertion. **Proven pre-existing**: re-running the suite against unmodified source with only the fixture repair applied reproduces exactly this one failure (14/15 pass). Quote pricing may be losing the unit price. | `integration-tests/http/quotes/quotes.spec.ts` — tracked under **P0-2** |
| D-03 | Remaining P0-2 fixture debt: `integration-tests/utils/admin.ts:46` depends on the ambient `JWT_SECRET` matching the hardcoded `"supersecret"`, and `companies.spec.ts:35,37,234` contain committed `console.log("vic logs …")` debug output. | **P0-2** |

---

## Intentional behaviour changes introduced by P0-SEC-1

Recorded because they alter existing API responses.

| Change | Rationale |
|---|---|
| Cross-tenant and unknown-id requests now return a uniform **403** instead of **404** | A 404 for absent and 403 for someone-else's turns the endpoint into an existence oracle, letting a caller enumerate which teams and quotes exist. Existence is itself protected data. |
| `DELETE /store/companies/<unknown>` returns **403** instead of **204** | It previously reported success for deleting a company that does not exist. |
| `POST /store/companies` returns **409** if the caller already belongs to a company | Prevents a member holding two memberships, which would undermine the single-company boundary the guards rely on. |
| Storefront signup no longer calls `createEmployee` | The founding employee is created server-side in the same workflow as the company, removing the zero-employee window. |
