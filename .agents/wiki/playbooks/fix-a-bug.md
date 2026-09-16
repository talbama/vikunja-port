# Playbook: fix a bug

Reproduce, locate by symptom, write the failing test, fix, verify both sides. Use a worktree for anything non-trivial: `mage dev:prepare-worktree fix-<slug> ""` creates `../fix-<slug>` with a copied `config.yml` and installed frontend deps.

## 1. Reproduce locally

| Kind of report | How to reproduce |
|---|---|
| API misbehaves | Run `./vikunja --config config.yml web`, register a user, `curl` the endpoint (recipes in [API contract](../05-api-contract.md#sample-calls-captured)). Seed data through the UI or, with `service.testingtoken` set, through `PATCH /api/v1/test/<table>` like the e2e factories do |
| UI misbehaves | `cd frontend && pnpm dev` against the API; or reproduce headless with a Playwright spec: `VIKUNJA_E2E_API_PORT=3456 mage test:e2e "--headed tests/e2e/<area>/<spec>.spec.ts"` |
| Only on MySQL/Postgres | `VIKUNJA_TESTS_USE_CONFIG=1` with `VIKUNJA_DATABASE_*` pointing at a local DB, or rely on CI's matrix and say so |
| Sentry issue | The frontend filters in `frontend/src/helpers/sentryFilters.ts` and API fingerprints in `pkg/errorreport` tell you what was already classified as noise; the `sentry-triage` skill has the procedure |
| Import/CalDAV/webhook | Fixture files under `pkg/modules/migration/<source>/`, `pkg/caldavtests/`, and `pkg/e2etests/` show the input formats |

Turn on `VIKUNJA_LOG_LEVEL=DEBUG` and `VIKUNJA_LOG_DATABASE=stdout VIKUNJA_LOG_DATABASELEVEL=DEBUG` when the SQL matters.

## 2. Locate by symptom: backend

| Symptom | Look at |
|---|---|
| Wrong status code or error body | `pkg/routes/error_handler.go` (v1), `pkg/routes/api/v2/errors.go` (v2), then the `HTTPError()` of the error in `pkg/models/error.go` / `pkg/user/error.go` |
| 403 where 404 or 200 expected | The model's `Can*` in `pkg/models/<entity>_permissions.go`; project inheritance in `project_permissions.go` + `project_ancestors` rows |
| 401 with code 11 | `pkg/routes/api_tokens.go` → `SetupTokenMiddleware`, `unauthenticatedAPIPaths` in `routes.go`, token expiry, `service.secret` changes |
| API token allowed/denied wrongly | `pkg/models/api_routes.go` (`getRouteGroupName`, `CanDoAPIRoute`, `shouldSkipRouteCheck`) |
| Task list shows wrong tasks or order | `pkg/models/task_collection.go`, `task_search.go`, `task_collection_sort.go`; filter parse in `task_collection_filter.go` |
| Filter string rejected or misparsed | `task_collection_filter.go` (`preprocessFilterString`, `getValueForField`, datemath) and the frontend transform in `frontend/src/helpers/filters.ts` |
| Task done/repeat/dates wrong | `pkg/models/tasks.go` → `Update` and the `*Repeat*` helpers; reminders in `task_reminder.go` |
| Kanban ordering or bucket membership wrong | `pkg/models/task_position.go`, `kanban_task_bucket.go` (done bucket rules), `kanban.go` (limits) |
| Saved filter view missing tasks | `saved_filters.go` listeners and `RegisterAddTaskToFilterViewCron` |
| Notification or mail not sent | `pkg/models/listeners.go` registration, `pkg/notifications/notification.go` (`Notify`), user settings (`EmailRemindersEnabled`), `pkg/mail` daemon, `mailer.enabled` |
| Webhook not delivered | `RegisterEventForWebhook` list in `listeners.go`, `WebhookDeliveryListener`, `pkg/models/webhooks.go`, poison log |
| Websocket push missing | `pkg/websocket/listener.go` bridges and `validEvents` |
| Import fails or imports wrong data | `pkg/modules/migration/<source>/`, `create_from_structure.go`, status rows |
| CalDAV client shows wrong data | `pkg/caldav/parsing.go`, `pkg/routes/caldav/listStorageProvider.go` |
| Attachment/background/avatar broken | `pkg/files/`, `pkg/modules/background/`, `pkg/modules/avatar/`, storage config |
| Startup or config problem | `pkg/config/config.go`, `pkg/initialize/init.go`, `./vikunja doctor` |
| Migration error on upgrade | `pkg/migration/<ts>.go`, helpers in `migration.go`, DB-specific branches |
| Rate limited unexpectedly | `pkg/routes/rate_limit.go` (basic-auth reserve/refund, per-minute floors) |
| Slow endpoint | `pkg/db/session_cache.go` misses, N+1 in `ReadAll` (check with SQL logging), missing index (`pkg/models` xorm tags), pprof |

## 3. Locate by symptom: frontend

| Symptom | Look at |
|---|---|
| Blank app or "Using Vikunja installation at..." prompt | `frontend/src/helpers/checkAndSetApiUrl.ts`, `stores/base.ts` → `hydrateConfig`, `components/misc/Ready.vue` |
| Redirect loop or wrong page after login | `router/index.ts` → `getAuthForRoute`, `beforeEach`; `stores/auth.ts` → `checkAuth`; `helpers/saveLastVisited.ts` |
| Logged out unexpectedly | `helpers/auth.ts` (refresh, `authEpoch`), `helpers/fetcher.ts` / `client/http.ts` retry rules, `stores/auth.ts` → `refreshUserInfo` 4xx handling |
| Stale data after an action | Legacy: the store action that should update state (`stores/tasks.ts`, `projects.ts`, `kanban.ts`); new stack: mutation `onSettled` invalidation in `client/queries/<feature>.ts` |
| Wrong field values (camel/snake) | `helpers/case.ts`, `services/abstractService.ts` interceptors; generated client uses snake_case as-is |
| Toast shows raw text or wrong message | `message/index.ts` → `getErrorText`, `en.json` `error.<code>` |
| Task detail field not saving | `views/tasks/TaskDetailView.vue` save path and the partial in `components/tasks/partials/` |
| Kanban drag glitch | `components/project/views/ProjectKanban.vue` → `updateTaskPosition`, `stores/kanban.ts`, `helpers/calculateItemPosition.ts` |
| List view filter or sort wrong | `composables/useTaskList.ts`, `useRouteFilters.ts`, `helpers/filters.ts`, `components/input/filter/` |
| Quick add parsed wrong | `modules/quickAddMagic/*` and its 1050-line test |
| Editor content mangled | `components/input/editor/TipTap.vue`, `editorExtensions.ts`, paste handlers, `contentRepair.ts`; backend `pkg/richtext` |
| Dates off by hours or a day | `helpers/time/*`, `useDateDisplay`, user timezone setting, `filter_timezone` |
| Style broken in dark mode or RTL | `styles/custom-properties/colors.scss`, logical properties, `useColorScheme.ts` |
| Notifications bell stale | `components/notifications/Notifications.vue`, `composables/useWebSocket.ts` |
| Works in dev, broken in build | `vite.config.ts` (chunking, PWA), `sw.ts` caching, `registerServiceWorker.ts` |
| Desktop only | `desktop/main.js`, `preload*.js`, `helpers/desktopAuth.ts`, `stores/base.ts` desktop branch |

## 4. Write the failing test first

| Layer | Test |
|---|---|
| Model or permission | `pkg/models/<entity>_test.go` with fixtures; `mage test:filter TestX` |
| HTTP behavior | `pkg/webtests/<resource>_test.go` (v1) or `huma_<resource>_test.go` (v2) |
| Event side effect | listener test or `pkg/e2etests/` |
| Migration | `pkg/migration/<ts>_test.go` |
| Frontend logic | co-located `*.test.ts`; `pnpm vitest run <file>` |
| User flow | Playwright spec; run just that file |

Confirm the test fails without the fix; say which tests fail in the PR.

## 5. Fix at the source

- Make the bad state unrepresentable (parse at the boundary, correct the lifecycle) rather than adding `?.` guards in consumers.
- Reuse existing helpers; grep before adding one.
- New error code? Grep `origin/main` for the highest code in the block first; add the `en.json` string; `pkg/web/error_codes_test.go` catches duplicates only after rebase.
- Do not touch permissions in handlers; fix the `Can*`.

## 6. Verify the other side did not break

- Backend change to a wire shape: `mage generate:frontend-client` + `mage check:frontend-client`; grep the frontend for the field (`rg field_name frontend/src`) including legacy `modelTypes`.
- Frontend change to a request: confirm the v1/v2 verb and path against `pkg/routes/routes.go` or the v2 resource file; run the relevant webtest.
- Shared enums or filter syntax: update both sides ([Conventions](../08-conventions.md#if-you-change-x-you-must-also-change-y)).
- Run: `mage test:filter <names>`, `mage test:web` once if a route changed, `pnpm vitest run <touched>`, one Playwright spec if the UI changed, `mage lint:fix`, `pnpm lint:fix`.
- Do not run the full suites repeatedly; save logs and read them.

## 7. Commit

`fix(<area>): <what>` with the issue or Sentry id in the body; lint first; never include `pkg/swagger/` changes. If the fix touched a wiki-documented component, update the page in the same commit.
