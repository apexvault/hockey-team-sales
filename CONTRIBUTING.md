# Contributing — local / CI parity

The exact commands CI runs, and how to run the identical thing locally. If these
two lists ever diverge, CI is lying to you.

CI is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Toolchain

Both are pinned by the repository; CI reads them from `package.json` rather than
restating them, so they cannot drift apart.

| | Value | Source of truth |
|---|---|---|
| Node | **22.12.0** | must satisfy `engines.node` (`^20.19.0 \|\| >=22.12.0`) |
| pnpm | **9.15.0** | `packageManager` field |
| PostgreSQL | **16** | `postgres:16-alpine` |

### `pnpm` is not on PATH by default

`pnpm` is pinned via `packageManager` and is only reachable through **corepack**.
This is the single most common local setup failure and it is not documented
anywhere upstream:

```bash
corepack enable                 # once per machine
pnpm --version                  # -> 9.15.0
```

If `corepack enable` is not permitted on your machine, install shims into a
directory you control and put it on PATH:

```bash
corepack enable --install-directory ~/.local/bin pnpm
```

CI uses `pnpm/action-setup`, which achieves the same thing on the runner.

---

## The commands

Run in this order. Each maps 1:1 to a CI job.

### 1. Install — CI job `lint` / `unit` / `integration` / `build`

```bash
pnpm install --frozen-lockfile
```

`--frozen-lockfile` is mandatory. A plain `pnpm install` may silently update the
lockfile and make your local run pass against a dependency graph CI will not
have.

### 2. Lint — CI job `lint`

```bash
pnpm lint
```

Expected: exit 0. Warnings are allowed (currently 10 backend + 2 storefront, all
pre-existing); **errors are not**.

### 3. Unit tests — CI job `unit`

```bash
cd apps/backend
TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --ci --runInBand --forceExit
```

Expected: **28 passed**. No database required.

### 4. Database + integration tests — CI job `integration`

Start an isolated PostgreSQL. Use a dedicated container and a port that does not
collide with anything else you run:

```bash
docker run -d --name hockey-dev-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hockey_medusa \
  -p 5442:5432 postgres:16-alpine
```

Create `apps/backend/.env.test` (git-ignored — see the note below):

```
DATABASE_URL=postgres://postgres:postgres@localhost:5442/hockey_medusa
DB_HOST=localhost
DB_PORT=5442
DB_USERNAME=postgres
DB_PASSWORD=postgres
JWT_SECRET=supersecret
COOKIE_SECRET=supersecret
STORE_CORS=http://localhost:8000
ADMIN_CORS=http://localhost:5173,http://localhost:9000
AUTH_CORS=http://localhost:5173,http://localhost:9000
```

`JWT_SECRET` **must** be exactly `supersecret`: the integration specs inject that
value into the app under test, while `integration-tests/utils/admin.ts` signs its
admin token with `process.env.JWT_SECRET`. If the two differ, every admin request
401s and the whole suite fails for a reason that looks nothing like the cause.
(Decoupling that is tracked as P0-2.)

Migrate from an empty database, then run the suite:

```bash
cd apps/backend
npx medusa db:migrate
TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules npx jest --ci --runInBand --forceExit
```

Expected: **63 passed**, ~110s.

### 5. Production builds — CI job `build`

**The storefront build requires a running backend.** Next.js performs build-time
data collection against it and fails with `ECONNREFUSED` otherwise. This is not
optional and it is why the broken build went unnoticed for so long.

```bash
cd apps/backend
npx medusa db:migrate          # seeds the publishable key
pnpm build
npx medusa develop &           # wait for "Server is ready on port: 9000"
```

Fetch the seeded publishable key and put it in `apps/storefront/.env.local`:

```bash
docker exec hockey-dev-postgres psql -U postgres -d hockey_medusa -t -A \
  -c "select token from api_key where type='publishable' limit 1;"
```

```
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=<the key above>
NEXT_PUBLIC_BASE_URL=http://localhost:8000
NEXT_PUBLIC_DEFAULT_REGION=us
```

Then:

```bash
pnpm build                     # from the repo root; expects 2/2 successful
```

---

## Windows

The backend test scripts in `apps/backend/package.json` use POSIX inline
environment variables (`TEST_TYPE=unit ... jest`). On PowerShell and cmd these
fail immediately with `'TEST_TYPE' is not recognized`. Run them through **Git
Bash**, or use the explicit `npx jest` invocations above, until `cross-env` is
added (P0-INF-2).

---

## What CI will not let through

- Any required job that fails, is **skipped**, or is **cancelled**. The `verify`
  job requires an explicit `success` from each of `toolchain`, `lint`, `unit`,
  `integration`, `build`. **Protect the `verify` job, not the individual jobs** —
  a branch rule naming the individual jobs goes green when they never run.
- A test run that finds **no tests**. `--passWithNoTests` is deliberately unset.
- A migration that exits 0 without creating a schema. CI asserts the database is
  empty beforehand, then asserts ≥100 tables and all seven custom module tables
  afterwards.
- A build that reports success from cache without producing artefacts. CI asserts
  `apps/backend/.medusa/server` and `apps/storefront/.next/BUILD_ID` exist.

## Secrets

Never commit a `.env*` file. `.gitignore` covers `**/.env*` and re-allows only
`.env.template` / `.env.example`. The values used in CI (`supersecret`) are
throwaway credentials for an ephemeral database created and destroyed inside the
run; they grant nothing. The publishable key CI reads from its own seeded
database is masked with `::add-mask::` before use so it cannot surface in logs.
