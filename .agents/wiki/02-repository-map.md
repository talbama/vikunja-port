# Repository map

Directory-by-directory guide. For each area: what lives there, what must not go there, and the page that explains it. Paths are relative to the repo root.

## Root

| Path | What it is | Notes |
|---|---|---|
| `main.go` | Entry point, calls `cmd.Execute()` | Nothing else belongs here |
| `magefile.go` | All backend build/test/lint/generate/dev tasks (`mage -l`) | Targets documented in [Build and release](components/build-and-release.md) |
| `go.mod`, `go.sum` | Module `code.vikunja.io/api`, Go 1.27 | Dependency updates come from Renovate; a `tool` block pins `mage`, `swag`, and `xgo` |
| `config-raw.json` | **Source of truth for configuration docs and defaults** | Edit this, then `mage generate:config-yaml false` |
| `config.yml.sample` | Generated from `config-raw.json`; **gitignored** | A fresh clone has none until you generate it |
| `config.yml` | Your local config; gitignored | Viper also searches `/etc/vikunja/`, `~/.config/vikunja/`, and `service.rootpath` |
| `pkg/` | The Go API | See below |
| `frontend/` | Vue SPA | See below |
| `desktop/` | Electron wrapper, own `package.json` and lockfile | [desktop](components/desktop.md) |
| `veans/` | Separate Go module, agent CLI, own `AGENTS.md`, magefile, linter config | [veans](components/veans.md) |
| `build/` | Separate Go module with the `release:*` mage targets and packaging scripts | [Build and release](components/build-and-release.md) |
| `.agents/` | Agent guidance: `docs/` (rules), `skills/` (checklists), `wiki/` (this) | |
| `.github/workflows/`, `.github/actions/` | CI (`ci.yml` → `test.yml`, `release.yml`), Crowdin sync, previews, labeling | [Development workflow](07-development-workflow.md#what-ci-runs) |
| `Dockerfile`, `nfpm.yaml`, `vikunja.service`, `vikunja.initd` | Container image, deb/rpm/apk packaging, service units | |
| `devenv.nix`, `devenv.yaml`, `mise.toml` | Reproducible dev shells; `mise.toml` pins Node 24.21, pnpm 11.26, Go 1.27.1 | |
| `cliff.toml`, `CHANGELOG.md` | git-cliff changelog config and generated changelog | Changelog is prepended by `mage dev:tag-release` |
| `rest/` | Bruno HTTP collection (`login`, `user info`, `mark all notifications as read`) | Handy for manual API poking |
| `examples/plugins/example/` | The one example plugin | [plugins](components/backend/plugins.md) |
| `conductor.json`, `paseo.json`, `.devcontainer/` | Worktree/agent orchestration hooks and devcontainer | |
| `renovate.json`, `crowdin.yml`, `publiccode.yml` | Dependency bot, translation sync, public-code metadata | |
| `code-header-template.txt` | AGPL header enforced on every Go file by the `goheader` linter | Copy it into new `.go` files |

Untracked artifacts you may see locally: `vikunja` (built binary), `cover.out`, `frontend/dist*`, `plans/`. All gitignored.

## Backend: `pkg/`

Dependency direction is bottom-up: nothing in a lower row imports a higher row.

| Layer | Packages | Responsibility | Page |
|---|---|---|---|
| Leaf utilities | `utils/`, `log/`, `version/`, `i18n/`, `red/`, `metrics/`, `health/` | Helpers, slog logging, embedded translations, Redis client, Prometheus | [operations-subsystems](components/backend/operations-subsystems.md) |
| Config | `config/` | Viper keys (`type Key string` constants), env mapping, defaults | [config-and-logging](components/backend/config-and-logging.md) |
| Persistence | `db/` (engine, sessions, fixtures, dump/restore), `migration/` (one file per migration) | All DB access goes through XORM sessions handed in by callers | [db-and-migrations](components/backend/db-and-migrations.md) |
| Cross-cutting infra | `events/`, `cron/`, `mail/`, `notifications/`, `files/`, `websocket/`, `audit/`, `license/`, `errorreport/`, `richtext/` | Event bus, scheduler, mail queue, notification channels, file storage, realtime, audit log, feature gating, Sentry fingerprints, HTML/Markdown | component pages under `components/backend/` |
| Identity | `user/` | `User` model, tokens, TOTP, CalDAV tokens, bots, deletion. Separate from `models` to avoid an import cycle (`models` imports `user`) | [user-package](components/backend/user-package.md) |
| Domain | `models/` (172 files) | Every entity with its `Can*` permission methods, CRUD methods, events, listeners, cron jobs, filters and search | `models-*` pages |
| Feature modules | `modules/auth/` (jwt, `openid/`, `ldap/`, `oauth2server/`), `modules/avatar/*`, `modules/background/*`, `modules/migration/*` (importers), `modules/mcp/`, `modules/keyvalue/`, `modules/dump/`, `modules/humabridge/`, `modules/imageutils/` | Optional or pluggable subsystems built on models | see index in [README](README.md) |
| Generic HTTP pipeline | `web/` (`web.go` interfaces, `handler/core.go` `Do*` functions, `handler/*.go` Echo wrappers) | The one place that opens/commits sessions, runs `Can*`, and flushes events | [crud-framework](components/backend/crud-framework.md) |
| Transport | `routes/` (`routes.go`, middleware, rate limiting, error handler, static files), `routes/api/v1/`, `routes/api/v2/`, `routes/api/shared/`, `routes/caldav/`, `routes/feeds/` | Echo setup, route registration, v1/v2 handlers | [http-routing-and-middleware](components/backend/http-routing-and-middleware.md), [api-v1](components/backend/api-v1.md), [api-v2-huma](components/backend/api-v2-huma.md), [caldav](components/backend/caldav.md) |
| Composition | `initialize/` (startup order), `cmd/` (cobra commands), `plugins/` + `yaegi_symbols/` | Wiring and CLI | [cli-commands](components/backend/cli-commands.md), [plugins](components/backend/plugins.md) |
| Generated | `swagger/` (v1 OpenAPI from swaggo), `yaegi_symbols/` (from `yaegi extract`) | **Never hand-edit** | below |
| Tests only | `webtests/` (HTTP integration, v1 and v2), `e2etests/` (webhooks with the real event bus), `caldavtests/` (protocol compliance), `db/fixtures/` (38 YAML files, one per table) | | [Testing guide](11-testing-guide.md) |

### What does NOT go where (backend)

- No new routes in `pkg/routes/api/v1/`. v1 is frozen; bug fixes and ports only. New routes go in `pkg/routes/api/v2/<resource>.go` and self-register via `init()` → `AddRouteRegistrar`.
- No permission checks in `pkg/routes/`. They belong on the model as `Can*` methods. The single exception is a non-CRUD v2 action, which has no `Do*` wrapper and must call `Can*` itself.
- No raw SQL strings anywhere, including migrations and tests. Use the XORM builder (`.agents/docs/code-style.md`; not lint-enforced). `.golangci.yml` `forbidigo` rules ban plain `tx.Sync` (drops indexes) in `pkg/migration/` in favor of `partialSync`, and `s.Context(...)` outside `pkg/db` in favor of `db.SetSessionContext`.
- No models in `pkg/user/` that import `pkg/models`. Put cross-package user logic in `pkg/models` (for example `pkg/models/user_delete.go`) or `pkg/routes/api/shared/`.
- No edits to `pkg/swagger/` or `pkg/yaegi_symbols/` (except `symbols.go`); CI regenerates them after merge to `main`.

## Frontend: `frontend/`

| Path | What it is | Page |
|---|---|---|
| `index.html` | Shell with `window.API_URL = '/api/v1'` at the end; production deployments rewrite this | [bootstrap-and-routing](components/frontend/bootstrap-and-routing.md) |
| `vite.config.ts` | Build, dev server (`127.0.0.1:4173`, `DEV_PROXY`), PWA, Tailwind, Sass `additionalData`, **and the Vitest config** | [Frontend architecture](04-frontend-architecture.md#build-and-dev-server) |
| `openapi-ts.config.ts` | `@hey-api/openapi-ts` config; needs `VIKUNJA_OPENAPI_INPUT`, so run it through `mage generate:frontend-client` | [api-client-generated-and-queries](components/frontend/api-client-generated-and-queries.md) |
| `embed.go` | `//go:embed all:dist` so the Go binary serves the SPA. If `dist/` is missing, **every** `go build`/`go test` in the repo fails to compile; mage creates a placeholder | |
| `eslint.config.js`, `eslint-rules/`, `.stylelintrc.json` | Lint rules incl. the local `icon-button-accessible-name` rule and logical-property enforcement | [Conventions](08-conventions.md) |
| `tsconfig.json` + `tsconfig.app.json` / `.config.json` / `.vitest.json` | Project references; `pnpm typecheck` builds all three | |
| `src/main.ts`, `src/App.vue`, `src/pinia.ts` | Bootstrap and layout switch | [bootstrap-and-routing](components/frontend/bootstrap-and-routing.md) |
| `src/router/index.ts` | All routes and the `beforeEach` guard | same |
| `src/stores/` | 10 setup-style Pinia stores (`auth`, `base`, `config`, `projects`, `tasks`, `kanban`, `timeTracking`, `migration`, `viewFilters`, `helper.ts`) | [stores](components/frontend/stores.md) |
| `src/client/` | **New API layer**: `http.ts` (fetch client + token refresh), `queryClient.ts`, `generated/` (do not edit), `queries/` (TanStack Query option factories), `inviteLink.ts` | [api-client-generated-and-queries](components/frontend/api-client-generated-and-queries.md) |
| `src/services/`, `src/models/`, `src/modelTypes/` | **Legacy API layer** (axios, camelCase models, `I*` interfaces). Keep working, do not extend for new routes | [api-client-legacy](components/frontend/api-client-legacy.md) |
| `src/components/` | `base/`, `date/`, `gantt/`, `home/` (app shell), `input/` (form primitives, `editor/` TipTap, `filter/`, `datepicker/`), `misc/` (Modal, Card, Dropdown, keyboard shortcuts...), `notifications/`, `project/` (`views/` list/gantt/table/kanban, `partials/`), `quick-actions/`, `sharing/`, `tasks/` (`partials/` used by task detail), `time-tracking/`, `token/` | feature pages under `components/frontend/` |
| `src/views/` | Route components by area: `Home.vue`, `About.vue`, `404.vue`, `project/`, `tasks/`, `user/` (+ `settings/`), `admin/`, `filters/`, `labels/`, `teams/`, `migrate/`, `sharing/`, `time-tracking/` | same |
| `src/composables/` | 29 `use*` composables (`useTaskList`, `useWebSocket`, `useLabels`, `useRouteFilters`, ...) | |
| `src/helpers/` | ~80 pure helpers; `time/` has the date math, `filters.ts` the filter DSL transform, `auth.ts` token storage | |
| `src/modules/quickAddMagic/` | Parser for `*label +project !priority` task syntax | [filters-and-quick-add](components/frontend/filters-and-quick-add.md) |
| `src/i18n/lang/en.json` | Only translation file you edit; Crowdin fills the other 37 | [Conventions](08-conventions.md#translations) |
| `src/styles/` | Bulma variables, custom properties, dark mode, `tailwind.css`; read `src/styles/README.md` | [styling-and-theming](components/frontend/styling-and-theming.md) |
| `src/constants/`, `src/types/` | Enums mirrored by hand from Go (priorities, permissions, repeat modes, view kinds, pro features) | [Data model](06-data-model.md#enums-duplicated-across-sides) |
| `src/modelSchema/` | One orphaned zod file; nothing imports it | dead code |
| `tests/e2e/` | Playwright specs by area (`task/`, `project/`, `user/`, `editor/`, `admin/`, `filters/`, `sharing/`, `websocket/`, `misc/`, `time-tracking/`) | [testing-infrastructure](components/frontend/testing-infrastructure.md) |
| `tests/support/`, `tests/factories/`, `tests/fixtures/` | Playwright fixtures (`fixtures.ts`), DB seeding via the testing token (`factory.ts`), 25 row factories, binary fixtures | same |
| `docs/models-services.md` | Describes the **legacy** service layer | historical |
| `dist/`, `dist-dev/`, `playwright-report/`, `test-results/`, `stats.html` | Build and test output; gitignored | |

### What does NOT go where (frontend)

- No new files in `src/services/`, `src/models/`, `src/modelTypes/` for new routes. Use `src/client/generated` types and functions plus a `src/client/queries/<feature>.ts` module.
- No `queryClient` access from components; cache writes live in mutation option callbacks (`.agents/docs/api.md` query-cache rules).
- No Options API components; ESLint enforces `<script setup lang="ts">`. New components need multi-word names.
- No unprefixed Tailwind classes; every utility is `tw-*`. No physical CSS properties (`margin-left`); stylelint enforces logical ones.
- No new strings without an `en.json` key; `mage check:translations` fails CI on missing or dead keys.

## Generated code

| Artifact | Source of truth | Regenerate with | Committed | Checked on PRs |
|---|---|---|---|---|
| `pkg/swagger/{docs.go,swagger.json,swagger.yaml}` | swaggo comments on v1 handlers | `mage generate:swagger-docs` (don't run unless asked) | yes | **No.** `release.yml` regenerates and commits `[skip ci] Updated swagger docs` after merge to `main` |
| `frontend/src/client/generated/` | v2 Huma OpenAPI built in-process by `apiv2.NewCanonicalAPI()` | `mage generate:frontend-client` | yes | **Yes**, `mage check:frontend-client` (generates twice, compares hashes, requires a clean tree) |
| `pkg/yaegi_symbols/*.go` (except `symbols.go`) | 12 Go packages listed in `magefile.go` (`yaegiSymbolPackages`) | `mage generate:yaegi-symbols` | yes | No; regenerated by `release.yml` after merge |
| `config.yml.sample` | `config-raw.json` | `mage generate:config-yaml false` (`true` fully comments it out) | **no** (gitignored) | n/a |
| `pkg/i18n/lang/*.json`, `frontend/src/i18n/lang/*.json` except `en.json` | Crowdin | `crowdin.yml` workflow commits nightly | yes | `mage check:translations` checks `en.json` vs code usage |
| `pkg/routes/api/v2/scalar/scalar.standalone.js` | unpkg, pinned version in `magefile.go` | `mage generate:scalarBundle` | yes | No |
| `frontend/src/version.json` | git describe | CI writes it; checked in as `{"VERSION": "dev"}` | yes | No |

All of the above were run on 2026-09-16 except `generate:swagger-docs`, `generate:yaegi-symbols`, and `generate:scalarBundle`.

## When adding a new X, put it in Y

| Adding | Put it in | Then also | Playbook |
|---|---|---|---|
| A domain entity | `pkg/models/<entity>.go` (+ `<entity>_permissions.go` for `Can*`), register in `pkg/models/models.go` → `GetTables()` | migration in `pkg/migration/`, fixture `pkg/db/fixtures/<table>.yml`, error codes in `pkg/models/error.go`, tests in `pkg/models/<entity>_test.go` | [add-api-endpoint](playbooks/add-api-endpoint.md) |
| An API route | `pkg/routes/api/v2/<resource>.go` with `init() { AddRouteRegistrar(...) }` | webtest in `pkg/webtests/huma_<resource>_test.go`, `mage generate:frontend-client`, MCP allow-list in `pkg/modules/mcp/exposure.go` if agents should see it | [add-api-endpoint](playbooks/add-api-endpoint.md) |
| A schema change | `pkg/migration/<timestamp>.go` via `mage dev:make-migration Name` | model struct tags, fixtures, `doc:` tags for v2, regenerate frontend client | [add-migration](playbooks/add-migration.md) |
| A domain event | `pkg/models/events.go` (or `mage dev:make-event Name models`) | listener in `pkg/models/listeners.go` + `RegisterListeners()`; webhook/audit opt-in there too | [background-job](playbooks/background-job.md) |
| A scheduled job | `Register<Name>Cron()` next to the model, called from `pkg/initialize/init.go` → `FullInit` | | [background-job](playbooks/background-job.md) |
| A notification type | `pkg/models/notifications.go` (or `mage dev:make-notification`), strings in `pkg/i18n/lang/en.json` | register it so DB rows can be rehydrated | [notifications-and-mail](components/backend/notifications-and-mail.md) |
| A config key | `pkg/config/config.go` constant + default in `initDefaultConfig()`, and `config-raw.json` | `mage generate:config-yaml false` | [config-and-logging](components/backend/config-and-logging.md) |
| A CLI command | `pkg/cmd/<name>.go` with `rootCmd.AddCommand` in `init()` | choose `initialize.LightInit` vs `FullInitWithoutAsync` | [cli-commands](components/backend/cli-commands.md) |
| An importer | `pkg/modules/migration/<source>/` implementing `Migrator` or `FileMigrator` | v2 registration in `pkg/routes/api/v2/migration_{oauth,credentials,file,csv}.go` (v1 `registerMigrations` in `pkg/routes/routes.go` only for existing importers), frontend entry in `frontend/src/views/migrate/migrators.ts`, `/info` advertises it | [importers](components/backend/importers.md) |
| A frontend page | `frontend/src/views/<area>/<Name>.vue` + route in `src/router/index.ts` | i18n keys, `src/client/queries/<feature>.ts` if it needs data, e2e spec in `frontend/tests/e2e/<area>/` | [build-vue-feature](playbooks/build-vue-feature.md) |
| A reusable component | `frontend/src/components/<area>/` (multi-word name) | story in `*.story.vue` if it is a primitive | |
| A Pinia store | `frontend/src/stores/<name>.ts`, setup style, with the HMR block | prefer a TanStack Query module for server state | [stores](components/frontend/stores.md) |
| A keyboard shortcut | `frontend/src/constants/shortcuts.ts` + `components/misc/keyboard-shortcuts/shortcuts.ts` (help overlay) | | |
| A translation string | `frontend/src/i18n/lang/en.json` or `pkg/i18n/lang/en.json` only | reuse an existing key with the same value if one exists | [Conventions](08-conventions.md#translations) |
| An e2e test | `frontend/tests/e2e/<area>/<name>.spec.ts` using `test` from `tests/support/fixtures.ts` and factories | | [Testing guide](11-testing-guide.md) |
| A Go integration test over HTTP | `pkg/webtests/<resource>_test.go` (v1) and `huma_<resource>_test.go` (v2) | | [Testing guide](11-testing-guide.md) |
