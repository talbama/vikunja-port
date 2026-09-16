# Development workflow

Setup, build, run, test, lint, generate, debug, and what CI gates. Every command below was run on macOS on 2026-09-16 unless marked otherwise; failures are noted.

## Setup from a clean machine

| Need | Version | How this machine got it |
|---|---|---|
| Go | 1.27.x (`go.mod` says 1.27.0; `mise.toml` pins 1.27.1) | Official tarball into `~/.local/go` (Homebrew was not writable) |
| mage | 1.17.2 | `go install github.com/magefile/mage@latest` → `~/go/bin/mage` |
| Node | 24.x (`frontend/.nvmrc` 24.21.0) | Already present |
| pnpm | 11.26.0 (`frontend/package.json` → `packageManager`) | `corepack enable --install-directory ~/.local/node/bin pnpm`; set `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` |
| golangci-lint | 2.13.0 (pinned in `magefile.go`, `.github/actions/golangci-lint`, `devenv.nix`) | `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.13.0` |
| Playwright browsers | 1.63 | `cd frontend && pnpm exec playwright install chromium` |
| Optional | `devenv shell` (Nix) provides all of the above plus mailpit; `mise install` provides only Node, pnpm, and Go (`mise.toml`) | not used here |

`mage` needs `pnpm`, `go`, and `golangci-lint` on `PATH`. On this machine that means `export PATH=$HOME/.local/go/bin:$HOME/go/bin:$HOME/.local/node/bin:$PATH` in each shell.

```bash
cd frontend && pnpm install --frozen-lockfile   # ~30 s
```

## Configuration for local runs

The binary refuses to start without `service.publicurl` when CORS is on (default). Minimal `config.yml` (gitignored; the working directory is on Viper's search path):

```yaml
service:
  interface: ":3456"
  publicurl: "http://localhost:3456/"
  rootpath: "/absolute/path/for/data"
  secret: "change-me"
  testingtoken: "some-token"      # enables /api/v1/test/* seeding for e2e and veans
database:
  type: sqlite
  path: "/absolute/path/for/data/vikunja.db"
files:
  basepath: "/absolute/path/for/data/files"
```

Or pass `--config /path/config.yml`. Every key can be an env var: `VIKUNJA_SERVICE_PUBLICURL`, `VIKUNJA_DATABASE_TYPE`, `VIKUNJA_LOG_DATABASE=stdout VIKUNJA_LOG_DATABASELEVEL=DEBUG` for SQL logging. Generate the documented sample with `mage generate:config-yaml false` (writes the gitignored `config.yml.sample`).

## Build and run the backend

| Command | What happens | Verified |
|---|---|---|
| `mage build` | `go build -tags osusergo -ldflags "-s -w -X ...version.Version=<git describe>" -o vikunja`; creates a placeholder `frontend/dist/index.html` if missing | yes, ~78 MB binary |
| `./vikunja version` | prints version and Go version | yes |
| `./vikunja --config config.yml web` | runs migrations, then serves on `service.interface` | yes; `/api/v1/info`, `/health`, `/api/v2/health`, `/api/v2/docs` answered |
| `./vikunja --config config.yml migrate list` | lists applied migrations | yes; **fails with `no such table: migration` on a never-started DB**, run `web` or `migrate` once first |
| `./vikunja --config config.yml migrate` | applies pending migrations | not run separately (`web` runs them) |
| `./vikunja --config config.yml doctor` | system/config/DB/files/services checks | yes |
| `./vikunja --config config.yml healthcheck` | DB (and Redis) ping using the config, not HTTP | yes |
| `./vikunja user create|list|...` | user administration | not run |
| `./vikunja dump` / `restore <file>` | zip of config + files + DB | not run |
| `./vikunja repair projects|task-positions|orphan-positions|file-mime-types` | data repair | not run |

Without a config file: `service.publicurl is required when cors.enable is true`, then exit.

## Frontend dev server

```bash
cd frontend
pnpm dev                     # 127.0.0.1:4173 (VIKUNJA_FRONTEND_PORT or --port override)
pnpm build                   # dist/ + Workbox copy
pnpm preview                 # serve dist/ on 4173
pnpm preview:vikunja         # run ../vikunja, which serves the embedded dist/
```

Verified: `pnpm dev --port 4199` was ready in ~4 s and served `window.API_URL = '/api/v1'`; `pnpm build` succeeded. To reach a backend on another origin either set `DEV_PROXY=http://localhost:3456` in `frontend/.env.local` (proxies `/api/*`; not exercised in this session) or let the app discover the API URL at first load (`src/helpers/checkAndSetApiUrl.ts` probes port 3456 on the page's host).

## Tests

### Backend (always through mage; plain `go test` needs `frontend/dist/index.html` to exist because `frontend/embed.go` embeds it)

| Command | Runs | Verified | Duration here |
|---|---|---|---|
| `mage test:feature` | `go test -p 1 -short -coverprofile cover.out ./...` — unit and model tests; `pkg/webtests`, `pkg/e2etests`, `pkg/caldavtests` skip themselves under `-short` | 54 packages ok | a few minutes |
| `mage test:web` | `go test -p 1 ./pkg/webtests` (HTTP integration, v1 and v2) | ok | ~90 s |
| `mage test:e2EApi` (alias `test:e2e-api`) | `pkg/e2etests` with the real event router | ok | ~15 s |
| `mage test:caldav` | `pkg/caldavtests` | ok | ~11 s |
| `mage test:filter <regex>` | `-run <regex> -short` on every package except webtests, then webtests **without** `-short`, so a matching webtest really runs | `mage test:filter TestLabel` ok | |
| `mage test:all` | feature + web + caldav + e2e-api | not run as one target | |
| `mage test:coverage` | feature + `cover.html` | not run | |

Save output to a file and read it: `mage test:filter Foo 2>&1 | tee /tmp/foo.log`. Do not rerun to grep differently.

Run against MySQL or PostgreSQL by exporting `VIKUNJA_TESTS_USE_CONFIG=1` and `VIKUNJA_DATABASE_*` (that is how CI's `test-api` matrix works); the default is in-memory SQLite (`pkg/db/test.go` → `CreateTestEngine`). `TESTS_VERBOSE=1` shows SQL.

### Frontend unit

```bash
cd frontend
pnpm test:unit                          # vitest --dir ./src, all 123 files (1634 tests passed)
pnpm vitest run src/stores/kanban.test.ts   # one file (8 tests passed)
```

Tests are co-located `*.test.ts` files; config is the `test` block in `vite.config.ts` (happy-dom).

### End to end (Playwright)

```bash
VIKUNJA_E2E_API_PORT=3456 mage test:e2e ""                              # all 65 specs
VIKUNJA_E2E_API_PORT=3456 mage test:e2e "tests/e2e/user/login.spec.ts"   # one file
mage test:e2e "--grep menu"                                              # by name
mage test:e2e "--headed tests/e2e/misc/menu.spec.ts"                     # headed
```

`mage test:e2e` builds the API (skip with `VIKUNJA_E2E_SKIP_BUILD=true`), starts it on a temp rootpath with in-memory SQLite and a random testing token, runs `pnpm build:dev` and `pnpm preview:dev`, exports `API_URL`, `BASE_URL`, `VIKUNJA_SERVICE_TESTINGTOKEN`/`TEST_SECRET` to Playwright, then tears down. Pin the API port to **3456**: specs that log in through the UI post to a relative `/api/v1`, and the frontend then falls back to port 3456 on the same host; with mage's default random port those specs fail with 404.

Verified: full run 333 passed / 15 failed with a random port; with the port pinned the login and password-reset specs pass. Expected local failures on macOS: `misc/menu.spec.ts` keyboard shortcut (Playwright sends Meta, the emulated Windows UA expects Ctrl), and the specs needing Dex (OpenID) or Mailpit (email confirmation, registration notice), which CI provides as Docker services.

## Lint and format

| Command | Verified result |
|---|---|
| `mage lint` (alias of `check:golangci`) | 0 issues |
| `mage lint:fix` | not run |
| `mage fmt` | not run (gofmt over tracked Go files) |
| `cd frontend && pnpm lint` | 0 errors, 18 warnings (all `depend/ban-dependencies` about axios) |
| `pnpm lint:fix`, `pnpm lint:styles:fix` | not run |
| `pnpm lint:styles` | clean |
| `pnpm typecheck` | exit 2 with **1535 `error TS` lines**; informational in CI (`continue-on-error`). Compare the count for files you touch before and after |

Lint before every commit: `mage lint:fix` for Go, `pnpm lint:fix` (+ `pnpm lint:styles:fix` for styles) for the frontend.

## Code generation

| Command | Verified |
|---|---|
| `mage generate:frontend-client` | yes via `mage check:frontend-client` (generates twice, compares hashes, tree stayed clean) |
| `mage check:translations` | yes: 146 API keys and 1725 frontend key references in sync |
| `mage generate:config-yaml false` | yes |
| `mage dev:make-migration <Name>` | yes; writes `pkg/migration/<timestamp>.go` with a `partialSync` skeleton |
| `mage dev:make-event`, `dev:make-listener`, `dev:make-notification` | not run |
| `mage generate:swagger-docs` | not run; CI regenerates after merge, do not run unless asked |
| `mage generate:yaegi-symbols`, `check:yaegi-symbols`, `generate:scalarBundle` | not run |

## Debugging

- **Logs**: `log.level` (`DEBUG` for everything), `log.database` + `log.databaselevel=DEBUG` for SQL, `log.http` for request lines, `log.events` for Watermill, `log.format=structured` for JSON. Env form: `VIKUNJA_LOG_LEVEL=DEBUG`.
- **Delve**: installed with `go install github.com/go-delve/delve/cmd/dlv@latest`. Verified headless flow:
  ```bash
  dlv exec ./vikunja --headless --listen=127.0.0.1:2345 --api-version=2 -- --config config.yml web
  dlv connect 127.0.0.1:2345      # then break pkg/models.(*Task).Update, continue
  ```
  (Run with `-- version` in this session; `dlv exec` without a terminal needs the headless form.) For tests: `dlv test ./pkg/models -- -test.run TestTask` (not run).
- **pprof**: `setupPprof(e)` in `pkg/routes/metrics.go` mounts `/debug/pprof` when both `metrics.enabled` and `metrics.pprof` are true, behind the metrics Basic auth if configured.
- **HTTP clients**: the Bruno collection in `rest/`; the curl samples in [API contract](05-api-contract.md#sample-calls-captured).
- **Browser**: Vue DevTools at `http://127.0.0.1:4173/__devtools__/` while `pnpm dev` runs; `data-cy` attributes exist in dev builds and when `window.TESTING` is set.
- **Sentry**: `sentry.enabled` + `sentry.dsn`; fingerprints from `pkg/errorreport`; frontend filters in `frontend/src/helpers/sentryFilters.ts`.
- More in [Debugging](12-debugging.md).

## Migrations locally

Migrations run automatically on `web` start (`pkg/initialize/init.go` → `FullInitWithoutAsync` → `migration.Migrate(nil)`). `./vikunja migrate list` shows applied ids; `./vikunja migrate rollback` exists but most migrations have empty rollbacks. Scaffold with `mage dev:make-migration Name`, then follow [add-migration](playbooks/add-migration.md). CI's `test-migration-smoke` job upgrades a database created by the last published binary against each of sqlite, postgres, mariadb, mysql.

## What CI runs

`.github/workflows/ci.yml` calls `test.yml` on PRs and pushes, then `release.yml` on `main` and tags.

| `test.yml` job | Gate |
|---|---|
| `mage` | compiles `mage-static`, cached for the other jobs |
| `api-build` | `mage build` |
| `api-lint`, `veans-lint` | golangci-lint 2.13.0 |
| `veans-test`, `test-veans-e2e` | veans unit tests; veans against the built API |
| `check-translations` | `mage check:translations` |
| `check-frontend-client` | `mage check:frontend-client` |
| `test-migration-smoke` | upgrade path from the last unstable release, 4 DBs |
| `test-api` | `feature` and `web` × sqlite-in-memory, sqlite, postgres, mariadb, mysql, paradedb, with an LDAP service |
| `test-caldav`, `test-e2e-api`, `test-s3-integration` | protocol tests, event tests, minio-backed file storage |
| `frontend-lint`, `frontend-stylelint`, `test-frontend-unit`, `frontend-build` | must pass |
| `frontend-typecheck` | runs, does not block |
| `test-frontend-e2e-playwright` | 6 shards, Dex and Mailpit services, two API instances (mailer on/off) |

Not gated on PRs: swagger drift (`mage check:got-swag` exists but no workflow runs it) and yaegi symbols; both are regenerated and committed by `release.yml` → `generate-swagger-and-yaegi` as "Frederick [Bot]" after merge.

## Git, commits, worktrees

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`...); git-cliff builds the changelog from them.
- Never commit `pkg/swagger/` changes; never commit `config.yml.sample`.
- Plans go in `plans/` (gitignored). `mage dev:prepare-worktree <name> <plan-path>` creates `../<name>` on a branch of the same name, **moves** the plan file into it, copies `config.yml` with a rewritten rootpath, and installs frontend deps.
- Releases: `mage dev:tag-release vX.Y.Z` regenerates swagger and yaegi symbols, updates the changelog, README badge, `frontend/package.json`, `publiccode.yml`, commits, and tags. `release.yml` then builds Docker images, binaries, OS packages, desktop apps, and a draft GitHub release. Current tag: `v2.6.0`.
