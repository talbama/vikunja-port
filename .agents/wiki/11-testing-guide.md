# Testing guide

How tests are organized on each side, what infrastructure they rely on, how to write each kind, and what is not covered. Commands are the ones verified in [Development workflow](07-development-workflow.md#tests).

## Backend

### Layers

| Layer | Where | Runs with | Uses |
|---|---|---|---|
| Unit and model ("feature") tests | `*_test.go` next to the code, mostly `pkg/models/*_test.go`, `pkg/user`, `pkg/caldav`, `pkg/modules/**` | `mage test:feature` (`go test -short ./...`) | in-memory SQLite, embedded fixtures, `events.Fake()` |
| HTTP integration ("webtests") | `pkg/webtests/*_test.go` (v1) and `pkg/webtests/huma_*_test.go` (v2) | `mage test:web`; a single one with `mage test:filter TestName` (webtests are rerun without `-short`) | real Echo instance, real JWTs, fixtures |
| Event end-to-end | `pkg/e2etests/` | `mage test:e2EApi` | `events.InitEventsForTesting` (real Watermill router), webhook targets |
| CalDAV protocol | `pkg/caldavtests/` | `mage test:caldav` | real router, XML bodies |
| Migration tests | `pkg/migration/<ts>_test.go` | `mage test:filter Test...` | `db.CreateTestEngine()` with a fresh schema |
| S3 storage | `pkg/files` → `TestFileStorageIntegration` | CI only (minio service); locally with `VIKUNJA_FILES_TYPE=s3` and credentials | |

`pkg/webtests`, `pkg/e2etests`, and `pkg/caldavtests` each have a `main_test.go` whose `TestMain` returns early under `-short`; that is the whole gating mechanism.

### Fixtures and the test DB

- `pkg/db/test.go` → `CreateTestEngine()`: in-memory SQLite (`file::memory:?cache=shared`) unless `VIKUNJA_TESTS_USE_CONFIG=1`, in which case it builds an engine from config so the suite can run on MySQL or PostgreSQL. `TESTS_VERBOSE=1` logs SQL.
- `pkg/db/test_fixtures.go` → `InitFixtures` / `LoadFixtures`: embedded YAML under `pkg/db/fixtures/` (38 files, one per table). Rows have stable ids that tests reference directly; **add rows, never renumber**. `users.yml` defines the well-known test users (`user1` is id 1 and owns most fixture projects).
- `db.LoadFixtures()` reloads everything and invalidates session caches; call it at the start of a test that mutates data (model tests do this in each test or subtest).
- Assertions: `db.AssertExists(t, "tasks", map[string]interface{}{"id": 1, "done": true}, false)` and `db.AssertMissing(...)`. `nil` values become `IS NULL`; identifiers are quoted so `limit` works as a column name.
- Package setup: `pkg/models/main_test.go` → `TestMain` runs `setupTime()` (fixed `testCreatedTime`/`testUpdatedTime`), `log.InitLogger()`, `config.InitDefaultConfig()`, `i18n.Init()`, `files.InitTests()`, `user.InitTests()`, `SetupTests()`, `events.Fake()`, then `m.Run()`. Copy this shape for a new package with DB tests.
- `events.Fake()` swaps dispatch for capture; assert with the helpers in `pkg/events/testing.go` instead of running a router.

### Writing a model test

1. Put it in `pkg/models/<entity>_test.go`. Start each case with `db.LoadFixtures()`, open `s := db.NewSession(); defer s.Close()`.
2. Call the model method with a fixture user (`&user.User{ID: 1}`) and `require.NoError`.
3. `require.NoError(t, s.Commit())` before `db.AssertExists` (assertions open their own session).
4. Every `Can*` path needs a positive and a negative case: the allowed user succeeds, an unrelated user (`ID: 13` is the conventional "no access" user in many tests) gets `false` or the expected `ErrCode*`. Check inherited access (team, parent project) and link shares if the model supports them.
5. Run `mage test:filter TestEntity 2>&1 | tee /tmp/entity.log`.

### Writing a webtest (handler test)

- v1: declare `testHandler := webHandlerTest{user: &testuser1, strFunc: func() handler.CObject { return &models.LabelTask{} }, t: t}` (see `pkg/webtests/label_task_test.go`; labels themselves are tested on v2 in `huma_label_test.go`) and call `testHandler.testCreateWithUser(nil, nil, `{"title":"x"}`)`, `testReadAllWithUser`, `testUpdateWithUser`, `testDeleteWithUser`, plus the `...WithLinkShare` variants. Assert status on `rec.Code` and body substrings; for errors use `assertHandlerErrorCode(t, err, models.ErrCodeLabelDoesNotExist)`.
- v2: `webHandlerTestV2` in `pkg/webtests/integrations.go` takes the same `urlParams` map and serves real HTTP through Huma; errors come back as `*v2HTTPError` so the same `assertHandlerErrorCode` works. For ETag, PATCH, and other v2-only behavior use `humaRequest(t, e, method, path, body, humaTokenFor(t, user), contentType)` from `pkg/webtests/huma_helpers_test.go`. The RFC 9457 body shape is asserted once in `TestHuma_ErrorShapeIsRFC9457`; per-resource tests only check status codes.
- Template: `pkg/webtests/_test.go.tpl`.
- Keep v1 and v2 tests in sibling files (`label_test.go`, `huma_label_test.go`) so parity is reviewable.

### Writing an event or job test

- Listener logic: call the listener's `Handle` with a hand-built `*message.Message` (JSON of the event) after `db.LoadFixtures()`, or call the underlying function directly. `events.Fake()` captures anything the listener dispatches in turn.
- End to end through the router: add to `pkg/e2etests/`, use `setupE2ETestEnv(ctx)` (starts `InitEventsForTesting` and drains with `WaitForPendingHandlers`), perform the HTTP call with `testUpdateWithUser`, then assert side effects in the DB or on an `httptest.Server` acting as a webhook target (`webhook_test.go`).
- Cron functions are plain functions; call them in a test with fixtures loaded and assert DB state. There is no scheduler to mock.

### Writing a migration test

Copy `pkg/migration/20260830162731_test.go`: create an engine with `db.CreateTestEngine()`, run the migration's `Migrate(tx)`, then assert columns and indexes exist (that test pins that no index was dropped, the v2.4.0 regression). Declare a full-row struct inside the test if you need to read rows back.

## Frontend

### Unit (Vitest)

- Config: the `test` block in `frontend/vite.config.ts` (happy-dom, excludes `e2e/**`). Run all with `pnpm test:unit`, one file with `pnpm vitest run <path>`.
- 123 co-located test files under `src/`, mostly `*.test.ts` (two gantt helpers use `*.spec.ts`).
- Patterns, each with a real example:
  - **Store**: `src/stores/kanban.test.ts`: `vi.hoisted` spies, `vi.mock('@/services/bucket', ...)` returning a class, `vi.mock` for `vue-router`, `vue-i18n`, other stores; `setActivePinia(createPinia())` in `beforeEach`; import the store after the mocks.
  - **Composable**: `src/composables/useTaskList.test.ts`: mount a `defineComponent` host inside a `createRouter({history: createMemoryHistory()})`, `flushPromises()`, `enableAutoUnmount(afterEach)`; test pure helpers (`buildStoredQuery`) directly.
  - **Component**: `src/components/input/Button.test.ts`: `mount(Button, {props, slots})` and assert classes; heavier ones (`src/views/user/settings/TOTP.test.ts`) install a real `createI18n({legacy: false, messages: {en}})` with the actual `en.json`.
  - **Query module**: `src/client/queries/labels.test.ts`: mock `@/client/generated` with `vi.mock('@/client/generated', () => sdk)`, build the mutation through `queryClient.getMutationCache().build(queryClient, options).execute(vars)`, assert cache writes; to observe an optimistic write, assert inside the mocked request before throwing.
  - **Helpers**: `src/helpers/filters.test.ts`, `src/modules/quickAddMagic/quickAddMagic.test.ts` (1050 lines) are table-driven examples.
- Mock `@/message` when code toasts. ESLint does not lint `*.test.ts`.

### End to end (Playwright)

- Runner: `mage test:e2e "<args>"` only (see [Development workflow](07-development-workflow.md#end-to-end-playwright)); pin `VIKUNJA_E2E_API_PORT=3456`.
- Config `frontend/playwright.config.ts`: `testDir tests/e2e`, one worker, chromium only, `testIdAttribute: 'data-cy'`, service workers blocked, no `webServer` block.
- Fixtures `frontend/tests/support/fixtures.ts`: `apiContext` (auto; `Factory.truncateAll()` before every test), `currentUser`, `userToken`, `authenticatedPage` (logs in through the API, injects `API_URL` and the token into `localStorage` via `addInitScript`, navigates to `about:blank` on teardown so polling does not starve the next seed).
- Seeding `frontend/tests/support/factory.ts`: `Factory.create(count, override)` → `PATCH /api/v1/test/<table>?truncate=…` with `Authorization: <testing token>`; `'{increment}'` placeholders; 24 factories in `frontend/tests/factories/` (`TaskFactory` copies `id` into `index` to satisfy the `(project_id, index)` unique constraint).
- Write a spec: `import {test, expect} from '../../support/fixtures'`, seed with factories in `beforeEach`, use `authenticatedPage` for signed-in flows, select with `page.getByTestId('...')` (renders from `v-cy`) or roles, assert with `expect(page).toHaveURL` / `toContainText`. Put it in `frontend/tests/e2e/<area>/`.
- Before writing a component test, check whether an e2e spec already covers the scenario; extend it if so.

## What is and isn't covered

| Area | Coverage |
|---|---|
| `pkg/models` | Heavy: `task_collection_test.go` 2561 lines, `tasks_test.go` 1676, `project_test.go` 1115, `label_test.go` 1048 |
| `pkg/routes/api/v1`, `pkg/web/handler`, `pkg/routes/api/shared` | No unit tests; covered indirectly by `pkg/webtests` |
| `pkg/cmd`, `pkg/cron`, `pkg/initialize`, `pkg/plugins`, `pkg/health`, `pkg/red` | No tests |
| `pkg/modules/background/*`, `pkg/modules/avatar/{marble,botmarble,empty,ldap,openid}`, `pkg/modules/keyvalue/*` | No tests |
| Frontend `helpers/`, `quickAddMagic/`, stores | Good unit coverage |
| Frontend `views/**` | 11 unit test files (user settings, password reset, `ShowTasks`, two project settings, gantt helpers); `views/admin`, `views/migrate`, `views/filters`, `views/teams`, `views/labels`, `views/sharing` have none |
| Frontend `modelTypes/` (42 files), `components/base`, `components/sharing`, `components/time-tracking`, `directives`, `constants`, `types` | No unit tests; e2e only where a spec exists |
| E2E | 65 specs: task 18, project 13, user 10 (+6 settings), editor 5, misc 3, websocket 3, admin 2, filters 2, sharing 2, time-tracking 1 |

## Slow, flaky, or environment-bound

- `pnpm typecheck`: 1535 errors, minutes to run, never green; not a test.
- E2E on macOS: `misc/menu.spec.ts` keyboard shortcut fails (Meta vs Ctrl under the emulated Windows UA); OpenID (`user/openid-login.spec.ts`) needs Dex; email confirmation and the registration notice need a second API with Mailpit. All three are provided as Docker services only in CI.
- E2E with a random API port: UI-login specs 404 because the frontend falls back to port 3456. Always pin.
- Backend suites run with `-p 1`; expect minutes for `mage test:feature`. Save output to a file rather than rerunning.
- `mage test:filter` runs webtests in a second pass; a filter matching nothing still reports `ok`.
- Tests against PostgreSQL in CI disable `fsync`; a locally configured Postgres will be slower.
