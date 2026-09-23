# Security Findings Register

Live status of every security finding. The Day 0 evidence record in
`DAY_0_AUDIT.md` §7 is immutable and describes each finding as originally
discovered; this file tracks remediation.

- **Discovered:** Day 0 audit (2026-09-23), branch `chore/day-0-baseline-audit`
- **Last updated:** P0-SEC-1 after independent Security + QA review

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
| F-06 | CRITICAL | Purchase approval enforced only in React | **FIXED** | `assertCartApprovalSatisfied` — fails closed when the company requires approval; 18 unit tests plus an end-to-end test that reaches the hook |
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
| F-29 | **HIGH** | **The first F-27 fix was incomplete.** `cartCreated` fires only at creation and only when the cart already has a customer. A shopper who browses logged out and then signs in has their customer attached by `transferCartCustomer`, which exposes no post-transfer hook — so that cart reaches checkout with no company link and no settings to enforce. The original bypass survived through a completely ordinary flow. Found independently by both reviewers. | **FIXED at the root cause** — a subscriber on `cart.customer_transferred` repairs the link, and the completion guard keeps an independent customer-derived fallback. Both proven by mutation test (disabling either fails the guest-cart tests) |
| F-40 | **HIGH** | **The second F-29 fix was also incomplete, in the other direction.** Routing around the link in the completion guard alone fixed the security hole but left the three *other* readers of that link broken: `createApprovalStep` returned "No enabled approval types found", the team admin's approval queue (which enumerates `company.carts`) could never show the cart, and the storefront's payment button read `cart.company` to decide whether to offer "Request Approval". The guest cart became neither completable nor approvable — fail-closed, but a dead end for an ordinary purchase. Found by the security reviewer on re-review. | **FIXED** — repairing the link fixes all four readers at once |
| F-28 | MEDIUM | Same defect on the order→company link (`order.metadata.company_id`), corrupting per-team order history and spend attribution. | **FIXED** — `order-created.ts` derives from the order's customer |

---

## Found by independent review of P0-SEC-1

The security reviewer **rejected** the first implementation; the QA reviewer
passed it with corrections. Both are addressed below.

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-30 | **MEDIUM** | **Regression introduced by the first implementation.** The unconditional self-approval ban deadlocked single-admin teams: only admins can decide approvals, the requester is the cart owner, there is no route to withdraw a PENDING approval, and a PENDING record blocks completion even after the requirement is switched off. A founding coach could permanently brick their own cart. | **FIXED** — separation of duties now applies only when the company actually has another admin who could decide it |
| F-31 | MEDIUM | Employee creation returned three distinguishable outcomes (403 absent / 409 affiliated / 200 free), letting any team admin probe an arbitrary customer id for existence and affiliation. | **FIXED** — one uniform 409 for both refusal cases |
| F-32 | MEDIUM | **Regression introduced by the first implementation.** `GET /store/quotes/:id` re-filtered on the caller's own `customer_id` with `throwIfKeyNotFound`, so the company-admin read the middleware authorises silently returned `404 "Quote id not found: <id>"` — restoring the id-echoing oracle this change set out to remove, and disagreeing with its sibling `/preview`. | **FIXED** — authorization lives in the middleware; the handler returns the uniform 403 |
| F-33 | MEDIUM | An admin could delete or demote the last member/admin, leaving a team unadministrable or wholly unreachable while its roster, carts and orders — minors' data — remain with nobody able to view or erase them. | **FIXED** — `LAST_EMPLOYEE` / `LAST_ADMIN` guards on both delete and demote |
| F-34 | MEDIUM | Duplicate employee links were possible via `POST /admin/companies/:id/employees`, which had no affiliation guard. The employee↔customer link is non-list, so a duplicate makes `resolveCompanyMembership` derive an **arbitrary** company — the one way the boundary could yield the wrong tenant. | **PARTIAL** — admin-side guard added; a DB unique constraint is still needed to close the TOCTOU race (**P2-DATA-1**) |

---

## Still open

| ID | Severity | Finding | Owner / task |
|---|---|---|---|
| F-18 | LOW | Admin surface has no role granularity; any staff login sees every team's data. Some `/admin` routes lack body validation. | **P0-ROLE-1** |
| F-19 | LOW | No file-upload capability exists (artwork has no foundation). Controls specified in advance. | **P0-INF-3** |
| F-20 | LOW | `medusa-config.ts` passes an empty `JWT_SECRET` through; Medusa then silently falls back to the literal `"supersecret"` outside production. | **P0-SEC-6** |
| F-21 | INFO | Storefront `is_admin` gating is UI-only — acceptable now that the server enforces the same rule. | N/A |
| F-35 | MEDIUM | No invitation/consent step for roster attachment (above). Until it exists, "verified membership" is not achievable and a team admin can unilaterally place a child's account on their roster. **The security reviewer's position: deferrable from P0-SEC-1, but it must ship before any real roster.** | **P1-COM-1** |
| F-36 | LOW | `GET /store/free-shipping/prices?cart_id=…` has no authentication and no cart-ownership check, giving anyone with the public publishable key a cart-existence and basket-total oracle. Pre-existing; outside P0-SEC-1's scope. | **P0-SEC-7** (new) |
| F-37 | LOW | `StoreUpdateApproval.status` is a bare `z.string()`, not a native enum, and `ensureApprovalAccess` ignores `approval.status` — so an already-decided approval can be re-decided. Fails closed against the completion rule, but the column is modelled as an enum. | **P0-SEC-7** (new) |
| F-38 | LOW | `set-admin-role` still writes a non-company-scoped `role` marker into `user_metadata`. Nothing reads it today, but any future consumer re-opens F-01/F-22. Provider identities are keyed on email, which is not unique across guest/account customers. | **P0-SEC-7** (new) |
| ~~F-39~~ | — | Soft-delete revocation: does removing an employee actually revoke access? **CLOSED — verified empirically, not deferred.** An integration test now adds an admin employee, confirms they can read the team, deletes them, and asserts their still-valid token gets 403 on both the company and the roster. | **VERIFIED** |

---

## Non-security defects found while testing P0-SEC-1

Recorded here so they are not lost; neither is in P0-SEC-1's scope.

| ID | Finding | Evidence |
|---|---|---|
| D-01 | **Test fixtures were the real cause of the "all 15 tests fail" Day 0 finding.** The Day 0 audit attributed it to the region lacking `countries`; that was a genuine defect but **not** the blocker. The actual error was `Variants ... do not exist or belong to a product that is not published` — `productSeeder` created the product without `status: "published"`, so its variants were not purchasable. Both are now fixed. | `integration-tests/utils/seeder.ts` |
| D-02 | **Corrected by the QA reviewer — my original diagnosis was wrong.** The failing assertion was **not** a `unit_price` defect: `unit_price` is `100` and matches. The `null` I saw was on the nested `items[0].detail` sub-object, where it is normal. The single real mismatch was `summary.difference_sum`, a field **removed from the core order summary in the Medusa 2.19→2.21 upgrades** — `grep -rl difference_sum node_modules/.pnpm/` returns nothing, so no application code could ever produce it. It was a stale test assertion, not a product defect, and there is **no pricing-correctness risk**. Fixed; the suite is now green. | `integration-tests/http/quotes/quotes.spec.ts:94` |
| D-03 | Remaining P0-2 fixture debt: `integration-tests/utils/admin.ts:46` depends on the ambient `JWT_SECRET` matching the hardcoded `"supersecret"`, and `companies.spec.ts:35,37,234` contain committed `console.log("vic logs …")` debug output. | **P0-2** |

---

## Intentional behaviour changes introduced by P0-SEC-1

Recorded because they alter existing API responses.

| Change | Rationale |
|---|---|
| `409 LAST_EMPLOYEE` / `409 LAST_ADMIN` on employee delete and demote (previously succeeded) | Prevents orphaning a team and its roster data. **Note for the owner:** a one-person team therefore has no self-service offboarding path, and `POST /store/companies` already returns 409 for anyone already affiliated — so a founding coach is currently bound to their company through the store API. That is a deliberate trade for youth-roster data retention, and it is a product policy call, not purely a security one. |
| Store employee-create refusal changed `403` → `409 EMPLOYEE_NOT_ADDABLE` | Removes the three-way existence oracle. The admin route uses `409 EMPLOYEE_ALREADY_EXISTS` for the same refusal — the two surfaces deliberately differ because only the store surface needed the oracle closed. |
| The storefront does not yet handle any of these codes | `LAST_ADMIN`, `LAST_EMPLOYEE`, `EMPLOYEE_NOT_ADDABLE` and `COMPANY_ALREADY_EXISTS` currently surface as a generic failure with no explanation. Tracked as a UI follow-up. |
| Cross-tenant and unknown-id requests now return a uniform **403** instead of **404** | A 404 for absent and 403 for someone-else's turns the endpoint into an existence oracle, letting a caller enumerate which teams and quotes exist. Existence is itself protected data. |
| `DELETE /store/companies/<unknown>` returns **403** instead of **204** | It previously reported success for deleting a company that does not exist. |
| `POST /store/companies` returns **409** if the caller already belongs to a company | Prevents a member holding two memberships, which would undermine the single-company boundary the guards rely on. |
| Storefront signup no longer calls `createEmployee` | The founding employee is created server-side in the same workflow as the company, removing the zero-employee window. |
