# Decision Log

## Confirmed

| ID | Decision | Status |
|---|---|---|
| D-001 | Use an orchestrator/PM coordinating specialist agents and independent QA. | Approved |
| D-002 | Continue work automatically; ask the owner only for genuine owner decisions or blockers. | Approved |
| D-003 | GitHub and CI are the controlled bridge between development and deployment. | Approved |
| D-004 | Local development precedes DreamHost staging/current live target; AWS remains the final intended architecture. | Approved |
| D-005 | No autonomous production deployment, production-data change, spending, or critical-infrastructure change. | Approved |
| D-006 | Use daily concise reports and weekly deep reports. | Approved |
| D-007 | Simulate the complete lead-to-order-to-delivery-to-reorder path early. | Approved |

## Resolved by Day 0 audit (evidence in `DAY_0_AUDIT.md`)

- **Which repository and branch are the correct baseline?** `apexvault/hockey-team-sales`
  `main` @ `7f36e09`. It is the only branch and has **zero divergence** from
  `medusajs/b2b-starter`, now configured as `upstream`.
- **Which systems are retained, repaired, replaced, or deferred?** See D-012.
  Nothing warrants replacement.
- **Beta launch date?** 16–24 weeks, MEDIUM confidence — see `PROJECT_STATUS.md`.

## Proposed — awaiting owner authorization

| ID | Decision | Options | Recommendation | Impact | Evidence |
|---|---|---|---|---|---|
| D-008 | Order status representation | (a) extend Medusa core `OrderStatus`; (b) separate `OrderPipeline` + append-only history | **(b)** | Core `OrderStatus` drives fulfillment/payment logic; extending it risks commerce correctness | Only ~3 of 10 spec statuses representable; 2 carry the wrong meaning — `DAY_0_AUDIT.md` §10 |
| D-009 | File/object storage for artwork | S3 / other | **Owner gate** — blocks all artwork work | Critical path | No File Module registered; no upload capability exists (F-19) |
| D-010 | Email/notification provider | SendGrid / SES / Resend / other | **Owner gate** | MASTER_SPEC makes email **mandatory**; impossible today | No notification provider; `src/subscribers/` empty |
| D-011 | Payment provider | Stripe / other | **Owner gate** | Nothing can be charged today | Storefront UI exists but **no backend provider registered** |
| D-012 | Reuse strategy | extend vs. rebuild | **EXTEND `Company`/`Employee`/`Quote`; ADD roster, artwork, pipeline; REPLACE nothing** | The module-link graph and server-side enforcement hooks are the starter's real value | `DAY_0_AUDIT.md` §11 |
| D-013 | Authorization rework | point fixes vs. structural | **Structural** — one `ensureCompanyAccess` middleware; forbid reading tenant ids from `req.params`/`req.body` in `/store/**` | Nine findings share one root cause; point fixes leave the next route exposed | `DAY_0_AUDIT.md` §7 |
| D-014 | Seed regions | keep EU / migrate to US-CA | **Migrate to US/CA** and make the seed idempotent | MASTER_SPEC targets US and Canada | Seed creates `gb,de,dk,se,fr,es,it` only |

## Approved — owner decisions (2026-09-23, post P0-SEC-1)

| ID | Decision | Status | Implementation |
|---|---|---|---|
| D-015 | A customer may belong to and manage **multiple** companies, organizations or teams. | **Approved** | **NOT YET IMPLEMENTED** — see the design gate below |
| D-016 | Replace the broad `LAST_EMPLOYEE` policy with a `LAST_ADMINISTRATOR` policy. | **Approved** | **DONE** — removing the final *member* is permitted; only removing or demoting the last *administrator* is refused |
| D-017 | An organization cannot be left active without an administrator. | **Approved** | **DONE** — enforced on both the delete and demote paths |
| D-018 | The final administrator must appoint a replacement, or use a future controlled archive/closure workflow. | **Approved** | **PARTIAL** — succession works and is tested; the archive/closure workflow does not exist, so there is currently no self-service way to wind an organization down |
| D-019 | Do not hard-code a one-customer/one-company assumption. | **Approved** | **NOT YET IMPLEMENTED** — current code violates this; see below |
| D-020 | No real roster data for minors may be loaded until verified invitation/consent is implemented **and reviewed**. | **Approved** | Gate recorded; F-35 / P1-COM-1 is the implementing task |

### D-015 / D-019 — not implemented, and why

P0-SEC-1 shipped a deliberate single-company model. Three places enforce it:
`POST /store/companies` returns 409 when the caller already belongs to a company;
employee creation refuses an already-affiliated customer; and
`resolveCompanyMembership` resolves `customer.employee` to **one** employee and
therefore one company. The employee↔customer module link is also declared
non-list.

Lifting this is a model change, not a flag. Every guard that currently compares
"the caller's company" to a path parameter must instead test membership of a
**set**, and the link cardinality and its DB constraint change with it.

**It also opens a design question that is an owner decision, not an engineering
one:** if a customer belongs to three teams, which team's approval settings and
spending limit govern a given cart, and which team is the resulting order
attributed to? Cart→company attribution is currently derived server-side from
the customer's single employee record precisely because deriving it from
client-supplied input was the F-27/F-28 vulnerability. With multiple
memberships, the customer must *choose* a team per cart — and that choice must
be validated against their memberships rather than trusted.

Recommended options, for the owner to pick before implementation:
1. **Explicit per-cart organization selection**, validated against the caller's
   memberships (recommended — keeps derivation server-side and auditable).
2. A per-customer "active organization" on the session, switched deliberately.
3. Attribute to the organization that owns the sales channel or price list in
   play (least explicit; not recommended).

Tracked as **P0-SEC-8 — multi-organization membership**, sequenced after
P0-SEC-7 and gated on that choice. Until then the single-company assumption
remains in force and is *documented* rather than silently assumed.

## Conflicts recorded

- **ARCHITECTURE.md says "Prisma where already used".** The actual ORM is
  **MikroORM** (via Medusa). No Prisma anywhere. ARCHITECTURE.md is retained as a
  statement of *preference*; the repository audit is authoritative per its own
  "Change rule".
- **ARCHITECTURE.md says "Docker and NGINX where already used".** Neither is
  present in the repository.
- **CLAUDE_START_DAY_0.md** instructs reading `DAY_0/…`; no `DAY_0/` directory
  exists — the documents are at the repository root. Read from the root.

Claude must add proposed decisions with options, recommendation, impact, and evidence. Do not mark them approved without owner authorization.
