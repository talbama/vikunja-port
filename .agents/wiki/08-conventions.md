# Conventions and patterns

Coding style on each side, patterns to copy and to avoid (each with a real example), and the cross-cutting "if you change X, also change Y" table. The rule docs in `.agents/docs/` remain the short form; this page explains and points at examples.

## Go

### Style

- Multi-field struct literals and multi-entry slice/map literals go one item per line with trailing commas, including nested literals and tests. Example: every `huma.Operation{...}` in `pkg/routes/api/v2/labels.go`.
- Wrap errors: `fmt.Errorf("loading project: %w", err)`. HTTP mapping uses `errors.As`, so wrapping is safe; the `IsErr*` helpers are not, they type-assert directly.
- Comments explain *why*, not *what*. Default to none. The codebase does this consistently; `pkg/routes/routes.go` and `pkg/routes/api/v2/errors.go` are good models of comment density.
- Every `.go` file starts with the AGPL header from `code-header-template.txt` (the `goheader` linter fails otherwise). `veans/` has its own copy.
- `gofmt` + `goimports` formatting; `mage fmt` or your editor.
- Before adding a helper, `rg` for an existing one. `pkg/utils/` and `pkg/db/helpers.go` already cover random tokens, SHA-256, multi-field search, unique-constraint detection, retries, zip writing.

### Data access

- **No raw SQL**, including migrations and tests. Use the XORM session and `xorm.io/builder`: `s.Where(builder.In("id", ids))`, `s.Cols("done").Update(t)`. Never `s.Exec`, `s.Query`, or `builder.Expr` with hand-built strings. A handful of grandfathered exceptions exist (`pkg/models/project_access.go` permission CTE, `subscription.go` recursive CTE, `project_repair.go`, `task_position.go`, `task_search.go`, `teams.go`); do not add to them without a reason a reviewer will accept.
- **`builder.In("col")` with no arguments is dropped by `Where` and matches every row.** Pass an empty typed slice (`[]int64{}`) to get `0=1`. Example of the safe form: `pkg/models/project.go` around line 592 (`builder.In("id", ids)` where `ids` is always a slice).
- Models receive `s *xorm.Session` and never commit. Reads inside a request reuse the session's memo (`db.Remember`); do not replace the session context yourself (`db.SetSessionContext`).
- Migrations: `partialSync` for existing tables, plain `tx.Sync` only for brand-new tables, every DDL error returned, cross-DB checked. Details in [db-and-migrations](components/backend/db-and-migrations.md) and the `migration` skill.

### Permissions

Pattern to copy: `pkg/models/label_permissions.go`. `CanUpdate` and `CanDelete` share `isLabelOwner`; `CanRead` returns `(bool, maxPermission, error)`; `CanCreate` denies link shares by type-asserting `a.(*LinkSharing)`. The `Can*` method loads the entity it needs and the CRUD method trusts that load.

Anti-patterns that get flagged in review: permission checks inside `pkg/routes/`; shipping `Create` without `CanUpdate`/`CanDelete`; copy-pasting the same check into two `Can*` methods; re-querying the entity in the handler.

### Events

Dispatch from model methods with `events.DispatchOnCommit(s, &TaskUpdatedEvent{Task: t, Doer: doerFromAuth(s, a)})` (`pkg/models/tasks.go`); the `Do*` pipeline publishes after commit. Use `events.Dispatch` only outside a transaction. New listeners go in `pkg/models/listeners.go` and must be registered in `RegisterListeners()`; a listener that is not registered never fires.

### Secrets and tokens

- High-entropy random tokens are stored as plain SHA-256 via `utils.Sha256Hex` (`pkg/models/sessions.go` → `HashSessionToken`, API tokens). Passwords stay bcrypt (`pkg/user/`).
- Never log tokens, passwords, or full event payloads; the poison-queue logger deliberately drops payloads.

### Errors

One struct per error in `pkg/models/error.go` (or the package's `error.go`), with `Error()`, `IsErrX()`, `ErrCodeX`, and `HTTPError()`. Pick the next free code in the right block and grep `origin/main` first; `pkg/web/error_codes_test.go` fails on duplicates. Add the English string under `error` in `frontend/src/i18n/lang/en.json`.

## Frontend

### Style (enforced by `frontend/eslint.config.js` and `.stylelintrc.json`)

- `<script setup lang="ts">` only; tabs; single quotes; no semicolons; trailing commas; PascalCase components in templates.
- New components need multi-word names (`TaskDetailHeading`, not `Heading`). About 50 legacy single-word names are grandfathered in the ESLint allowlist.
- Icon-only buttons need an accessible name (local rule `vikunja/icon-button-accessible-name`).
- No `for...in`. No `.test.ts` linting (ESLint ignores tests) and no linting of `src/client/generated`.
- Logical CSS properties only (`margin-inline-start`), enforced by `stylelint-use-logical`. Tailwind is wired with a `tw-` prefix but no component uses it yet; prefer scoped SCSS with the design tokens, and Bulma helpers for spacing (`theme/logical-spacing.scss`).
- Strings: `const {t} = useI18n({useScope: 'global'})` then `t('key')` (`frontend/src/views/labels/ListLabels.vue`). Reuse an existing key with the same English value before adding one.
- Test ids: `v-cy="name"` renders `data-cy` in dev or when `window.TESTING` is true (`src/directives/testid.ts`); Playwright's `testIdAttribute` is `data-cy`.

### Data layer

Pattern to copy for anything new: `frontend/src/client/queries/labels.ts` + `frontend/src/composables/useLabels.ts` + `frontend/src/views/labels/ListLabels.vue`. Key factory, `queryOptions()`, `mutationOptions()` with optimistic `onMutate` / `onError` / `onSettled`, thin `use*Mutation` hooks, `ensure*`/`refresh*` for non-component code.

Anti-patterns:

| Don't | Because | Instead |
|---|---|---|
| Add a `FooService extends AbstractService` or `IFoo` interface for a new route | Legacy layer is being removed | Generated `fooList()` and `Foo` type from `@/client/generated` |
| Call `queryClient.setQueryData` from a component, store action, or socket handler | Cache writes must be traceable to mutations | Put them in the mutation option callbacks, using the `client` from the callback context |
| Add a `detail(id)` key with no detail query | Orphan cache entries | Write into the list key with the id in the updater |
| `cancelQueries` as a guard around a request | Only meaningful in a full optimistic flow | `onMutate` cancel + snapshot, `onError` restore, `onSettled` invalidate |
| Put mutations into a `use*` read composable | A create-only view would subscribe to the list | Separate `useCreateFooMutation()` |
| Keep server lists in a Pinia store | Duplicates the query cache | TanStack Query module; stores hold UI state and orchestration |

Stores stay setup-style with the `acceptHMRUpdate` block (`frontend/src/stores/*.ts`).

### Testing

Vitest files sit next to the code. Mock the generated client with `vi.mock('@/client/generated', () => sdk)` and `@/message` when code toasts; mock legacy services with `vi.mock('@/services/bucket')` as in `src/stores/kanban.test.ts`. Test mutation options through the real lifecycle: `queryClient.getMutationCache().build(queryClient, options).execute(vars)` (`src/client/queries/labels.test.ts`). Prefer extending an e2e spec over adding a component test for UI behavior.

## Commits and reviews

- Conventional Commits; `fix(deps):` is reserved for Renovate. Scope by area: `feat(api-v2): ...`, `fix(caldav): ...`, `docs(wiki): ...`.
- Lint before committing: `mage lint:fix`, `pnpm lint:fix`, `pnpm lint:styles:fix`.
- Never commit `pkg/swagger/` edits, `config.yml.sample`, `plans/`.
- Contributions made with AI assistance must say so (`CONTRIBUTING.md`).

## Translations

- Edit only `frontend/src/i18n/lang/en.json` and `pkg/i18n/lang/en.json`. Never add other languages; Crowdin syncs them nightly.
- `mage check:translations` fails CI on keys used but missing and keys present but unused. Dynamic keys under `error.` are whitelisted, which is why error-code drift is not caught.
- Backend strings: `i18n.T(lang, "key", params...)` in notifications and mails.
- New locales must be added in both `frontend/src/i18n/index.ts` and `pkg/i18n/i18n.go`.

## If you change X, you must also change Y

| Change | Also change | Or else |
|---|---|---|
| Add or rename a DB column | `pkg/migration/<ts>.go` (`partialSync`), the model's `xorm` tag, `pkg/db/fixtures/<table>.yml`, `doc:`/`readOnly:` tags, `mage generate:frontend-client`, legacy `frontend/src/modelTypes/I*.ts` + model class if legacy code reads it | Tests fail on fixtures, v2 spec undocumented, CI client check fails, legacy UI drops the field |
| Add a table | `GetTables()` in `pkg/models/models.go`, fixture file, migration, `TableName()` | `db.RegisterTables` misses it; `WipeEverything`/`TruncateAllTables` skip it; tests start with no rows |
| Add a model | `Can*` methods, `CRUDable` methods, v2 routes, webtests (positive + negative), error codes, `en.json` | Missing permission path; undocumented API |
| Add a v2 route | webtest in `pkg/webtests/huma_*`, regenerate client, `exposedOperations` in `pkg/modules/mcp/exposure.go` if agents need it, `unauthenticatedAPIPaths` if public | Untested route; agents cannot see it; public route rejected with 401 |
| Add a v1 route | Don't. If fixing one, keep swaggo comments; do not run swagger generation | Docs drift silently until CI regenerates |
| Add an `ErrCode*` | `frontend/src/i18n/lang/en.json` → `error.<code>`; unique number | Users see raw server messages; duplicate code test fails |
| Add an event | listener registration in `RegisterListeners()`, `RegisterEventForWebhook` if webhook-worthy, `RegisterEventForAudit` if auditable, `pkg/websocket/connection.go` `validEvents` if pushed to clients | Nothing happens, silently |
| Add a config key | `config.go` constant + default, `config-raw.json`, regenerate sample; `pkg/doctor` check if it matters operationally | Undocumented key; defaults missing |
| Add an enum value | Both the Go constant and the TypeScript mirror in `frontend/src/types` or `constants` (see [Data model](06-data-model.md#enums-duplicated-across-sides)); `MarshalJSON` for string enums | UI cannot render or select it |
| Add a filter field or operator | `pkg/models/task_collection_filter.go` and `frontend/src/helpers/filters.ts` (+ `FilterAutocomplete.ts`) | Frontend rejects or mistransforms the query |
| Add a websocket event | `validEvents`, a `pkg/websocket/listener.go` bridge, frontend subscriber | Subscribe returns `invalid_event` |
| Add a cron job | `Register*Cron()` and the call in `pkg/initialize/init.go` → `FullInit` | Never scheduled |
| Add an importer | `pkg/modules/migration/<name>/`, v2 wiring in `pkg/routes/api/v2/migration_{oauth,credentials,file,csv}.go` (v1 `registerMigrations` only for existing importers), `/info` advertising, `frontend/src/views/migrate/migrators.ts`, i18n keys | UI does not offer it |
| Change the OpenAPI shape of an exported package | `pkg/yaegi_symbols` regeneration (CI does it), veans `internal/client/types.go` | Plugins or the CLI break |
| Add a pro feature | `pkg/license` `Feature*`, `RequireFeature` on routes, `enabled_pro_features` in `/info`, `frontend/src/constants/proFeatures.ts`, router `meta` guard | Feature visible without license or hidden with one |
| Add a locale | `frontend/src/i18n/index.ts`, `useDayjsLanguageSync.ts`, `pkg/i18n/i18n.go`, Crowdin | Language not selectable or rejected by validation |
| Add a keyboard shortcut | `frontend/src/constants/shortcuts.ts` and the help overlay list | Undocumented shortcut |
| Change `frontend/index.html`'s inline `window.*` script | `desktop/build.js` `API_URL_SCRIPT_RE`, the template in `pkg/routes/static.go` → `serveIndexFile` (injects `SENTRY_*` and `CUSTOM_LOGO_URL*`) | Desktop build or served index breaks |
