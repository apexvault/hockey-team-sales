# Contributing — local / CI parity

The exact commands CI runs, and how to run the identical thing locally. If these
two lists ever diverge, CI is lying to you.

CI is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Toolchain

| | Value | Source of truth | How CI gets it |
|---|---|---|---|
| Node | **22.12.0** | `engines.node` is a **range** (`^20.19.0 \|\| >=22.12.0`), not a pin | CI hard-codes 22.12.0 and fails if the range ever changes, since a range cannot select a version |
| pnpm | **9.15.0** | `packageManager` field | read from `package.json` at run time |
| PostgreSQL | **16** | none — chosen by CI | `postgres:16-alpine` |

pnpm genuinely cannot drift. **Node can**: there is no `.nvmrc`, so the concrete
version lives in the workflow. The guard there compares `engines.node` against
the exact expected range and fails the run if it changes, which forces a
deliberate re-pin rather than silent drift. Adding an `.nvmrc` would make this
a real single source of truth (P0-INF-2).

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

`next lint` runs `apps/storefront/check-env-variables.js` **before** eslint, and
that script exits 1 on a missing publishable key. Lint makes no network call, so
a placeholder is enough — but without it, lint fails for a reason that has
nothing to do with lint:

```bash
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_local_lint_placeholder pnpm lint
```

(If you have already created `apps/storefront/.env.local` for step 5, plain
`pnpm lint` works and picks the key up from there — which is exactly why this
requirement went unnoticed until CI ran on a clean checkout.)

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

Create **both** `apps/backend/.env` and `apps/backend/.env.test` with the same
values (both git-ignored). Two files are needed because they are loaded by
different things: `jest.config.js` calls `loadEnv("test", …)` so the test run
reads `.env.test`, while `medusa-config.ts` calls
`loadEnv(process.env.NODE_ENV || "development", …)` — so a bare
`npx medusa db:migrate` reads `.env` and would otherwise find no `DATABASE_URL`:

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
npx medusa db:migrate          # also runs the seed script, which creates the publishable key
pnpm build
npx medusa develop &           # wait for "Server is ready on port: 9000"
```

Use `medusa develop`, not `medusa start`. `medusa build` emits a standalone
deployable at `.medusa/server`, and `medusa start` expects to run **from that
directory** — from the project root it fails with *"Could not find index.html in
the admin build directory"*. CI uses `develop` for the same reason.

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

- Any required job that fails, is **skipped**, or is **cancelled**. The gate job
  requires an explicit `success` from every job in its `needs` list, derived from
  that list rather than restated.

  **Protect the status check named `CI passed`** — that is the job's display
  name and the string GitHub offers in the branch-protection UI. Protecting the
  individual jobs instead is unsafe: a rule naming them goes green when those
  jobs are skipped or cancelled, because GitHub reports neither failure nor
  success for them.
- A test run that finds **no tests**. `--passWithNoTests` is deliberately unset.
- A test run that is **padded with skipped tests**. Both suites enforce a floor
  on *passed* tests and reject any `numPendingTests`/`numTodoTests` above zero.
  Gating on the total would let a `describe.skip` disable a whole suite while the
  count still looked satisfied.
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
