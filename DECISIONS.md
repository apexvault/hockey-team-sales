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
