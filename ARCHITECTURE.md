# Architecture Baseline

## Known preferred stack

- Next.js
- Node.js
- PostgreSQL
- Prisma where already used
- Role-based authorization
- Docker and NGINX where already used

The repository audit is authoritative. Claude must record the actual stack, versions, services, package manager, database strategy, test frameworks, CI, hosting configuration, storage, email, authentication, and deployment scripts.

## Environment progression

1. Local development
2. GitHub and CI as the controlled bridge
3. DreamHost VPS staging/current live target at `crm.beclutch.me`
4. AWS as the intended final production architecture

No direct production development and no automatic production deployment on push.

## Architecture audit questions

- What repository and branch contain the most advanced safe implementation?
- Which documents are currently authoritative?
- Do schema and migrations reproduce a clean database?
- Are tenant boundaries enforced server-side?
- Are permissions centralized and negatively tested?
- Are uploads restricted by type, size, authorization, and storage policy?
- Are secrets excluded from code, logs, fixtures, and commits?
- Can CI reproduce install, lint, typecheck, test, and build?
- Can staging be deployed deliberately from an approved commit?
- Are monitoring, backups, and rollback defined?

## Change rule

Day 0 may add documentation, safe test scaffolding, and non-destructive configuration improvements. It must not perform production migrations, deploy to production, rotate credentials, or redesign architecture without an explicit decision record and owner approval.
