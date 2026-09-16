# Debugging and troubleshooting

Error messages you will meet, what causes them, and the tools for looking inside a running system. Where a message is quoted it was either observed on 2026-09-16 or copied from the source line cited.

## Error messages and their causes

### Backend startup

| Message | Cause | Fix |
|---|---|---|
| `service.publicurl is required when cors.enable is true` (observed) | No config file found and no `VIKUNJA_SERVICE_PUBLICURL` | Create `config.yml` or pass `--config`; see [Development workflow](07-development-workflow.md#configuration-for-local-runs) |
| `No config file found, using default or config from environment variables.` | Informational; Viper searched rootpath, `/etc/vikunja/`, `~/.config/vikunja/`, `.` | Only a problem if you expected a file |
| `Could not read config file <path>: ...` (`pkg/config/config.go:739`) | `--config` points at an unreadable file; deliberately fatal | Fix the path |
| `Could not determine root path. Set service.rootpath in your config.` (`config.go:354`) | Rootpath unresolved | Set `service.rootpath` |
| `Unknown database type <x>` (`pkg/db/db.go:118`) | `database.type` not `sqlite`, `mysql`, `postgres` | |
| `No redis host provided.` (`pkg/red/redis.go:40`) | `redis.enabled=true` without `redis.host` | |
| `OpenID Connect configuration error: ...` (`pkg/initialize/init.go:120`) | Two providers share an issuer | |
| `Error getting migration table: no such table: migration` (observed on `migrate list`) | Fresh DB; the migration table is created by the first `web` or `migrate` run | Start `web` once or run `migrate` |
| `panic: rate limited path <p> is not in unauthenticatedAPIPaths` (`pkg/routes/routes.go:422`) | A credential path was added to a rate-limited set but not to the unauthenticated map | Add it to both |
| `pattern all:dist: no matching files found` from `go build`/`go test` | `frontend/dist/` missing; `frontend/embed.go` embeds it | `mage build` creates a placeholder, or `mkdir -p frontend/dist && touch frontend/dist/index.html` |
| `No license key configured. Pro features have been disabled.` (observed, WARN) | Expected without a license | Nothing |

### HTTP responses

| Response | Cause | Where |
|---|---|---|
| `401 {"code":11,"message":"missing, malformed, expired or otherwise invalid token provided"}` | No or expired JWT/API token; also returned for a token signed with another `service.secret` (the secret is regenerated at start if empty, invalidating everything) | `pkg/routes/api_tokens.go` → `SetupTokenMiddleware` |
| `403 {"code":0,"message":"You don't have the permission to see this"}` (v1) or problem+json `title: Forbidden` (v2) on a GET | The id does not exist **or** you cannot see it; both are 403 by design | `pkg/web/handler/error.go` → `ErrReadForbidden` |
| `404` on `/api/v1/admin/*`, `/api/v2/time-entries`, invite links | Feature gate or admin gate; deliberately indistinguishable from unregistered routes | `pkg/routes/feature_gate.go`, `admin_gate.go`; check `/api/v1/info` → `enabled_pro_features` and the user's `is_admin` |
| `412 {"code":2002,"message":...,"invalid_fields":[...]}` (v1) | govalidator failure on the bound struct | `pkg/models/error.go` → `ValidationHTTPError` |
| `422 problem+json errors[].location: body.<field>` (v2) | Huma schema validation (`minLength`, `enum`, ...) or govalidator mapped to 422 | `pkg/routes/api/v2/errors.go`, `validation.go` |
| `429` with `X-RateLimit-*` headers | Per-IP limits on credential endpoints (always on) or global user/IP limits | `pkg/routes/rate_limit.go`; e2e sets `VIKUNJA_RATELIMIT_NOAUTHLIMIT=1000` |
| `413` → `{"code":...,"message":"The file is too large"}` | Body over `files.maxsize` (default 20MB, +2 MB overhead) | `pkg/routes/error_handler.go` special-cases it |
| `500` with generic text on v2 | Internal error; details are logged, not returned | API log, Sentry |
| `304` on v2 reads | `If-None-Match` matched the ETag (which folds in the permission) | `pkg/routes/api/v2/types.go` → `conditionalReadResponse` |
| Empty `[]` where items were expected (v2) | Handler cast `DoReadAll`'s `any` result to the wrong slice type | See the `api-v2-routes` skill's "silent empty" trap |

### Frontend

| Symptom | Cause | Where |
|---|---|---|
| Login page shows `Request failed with status code 404` | The SPA posted to a relative `/api/v1` on a host that does not proxy it and the port-3456 fallback found nothing | `frontend/src/helpers/checkAndSetApiUrl.ts`; set `DEV_PROXY` or the API URL in the UI |
| "Using Vikunja installation at ..." with a "change" button and errors | API URL discovery failed → `NoApiUrlProvidedError` / `InvalidApiUrlProvidedError` | `Ready.vue`, `ApiConfig.vue` |
| Endless redirect between `/share/:hash/auth` and a project | Link-share and user tokens share an id space; fixed by comparing `type` too in `checkAuth` | `frontend/src/stores/auth.ts` |
| Toast shows a raw English server message | No `error.<code>` key in `en.json` for that code | Add the key; see [Known issues](13-known-issues.md#error-codes) |
| `VIKUNJA_OPENAPI_INPUT must point to the generated temporary spec` | `pnpm generate:api-client` run directly | Use `mage generate:frontend-client` |
| `mage check:frontend-client` fails | Generated client out of date or generation not idempotent | Regenerate and commit |
| Stale JS after deploy, chunk load errors | Old service worker or split chunks | `handleChunkLoadErrors.ts` reloads once; `UpdateNotification.vue` prompts |
| Keyboard shortcut e2e fails on macOS | Meta vs Ctrl mismatch | CI only |

## Logs and flags

| Need | Setting |
|---|---|
| Everything | `log.level: DEBUG` (`VIKUNJA_LOG_LEVEL=DEBUG`) |
| SQL statements | `log.database: stdout`, `log.databaselevel: DEBUG` |
| HTTP access lines | `log.http: stdout` (default on); each line has `remote_ip`, `method`, `uri`, `status`, `latency` |
| Event router | `log.events: stdout`, `log.eventslevel: DEBUG` |
| Mail | `log.mail: stdout` |
| JSON logs | `log.format: structured` |
| Tests | `TESTS_VERBOSE=1` for SQL in Go tests; `pnpm vitest run --reporter verbose` |
| Frontend dev | `import.meta.env.DEV` enables the rethrowing `warnHandler`/`onerror` in `main.ts`; Vue DevTools at `/__devtools__/` |

Request ids: every response carries `X-Request-Id` (set by the first middleware); audit entries and log lines include it when auditing is on.

## Inspecting the database

- SQLite: `sqlite3 <rootpath>/vikunja.db` (path is logged at start: `Using SQLite database at: ...`). Tables are named as in [Data model](06-data-model.md). In tests the DB is in memory; use `db.AssertExists` or `TESTS_VERBOSE=1`.
- PostgreSQL/MySQL: connection settings are `database.*`; the migration table is `migration` (xormigrate).
- `./vikunja doctor` reports connection, server version, ParadeDB availability, file storage, and disk space.
- `./vikunja dump` produces a zip with the DB and files for offline inspection; `restore` loads one.
- Repairs for drifted data: `./vikunja repair task-positions`, `repair orphan-positions`, `repair projects` (ancestors), `repair file-mime-types`.

## Inspecting queues and background work

- There is no queue to inspect. Events live in memory; failed handlers log `ERROR` lines with the handler name and, after five retries, land on the `poison` topic whose consumer logs and reports to Sentry (`pkg/events/events.go`). Grep the API log for the listener name (`SendTaskCommentNotification`, `WebhookDeliveryListener`, ...).
- Prometheus: enable `metrics.enabled` and read `/api/v1/metrics` (optionally behind `metrics.username`/`metrics.password`); includes Watermill router metrics and DB pool stats.
- Cron: nothing is recorded. Add a log line inside the job or call the function from a test.
- Imports: `migration_status` rows and the user-facing status endpoint show progress.

## Inspecting network traffic

- Browser devtools Network tab; the frontend attaches `Authorization: Bearer` on both layers.
- `rest/` Bruno collection for login and a couple of requests.
- curl recipes in [API contract](05-api-contract.md#sample-calls-captured); use `-D -` to see `ETag`, `x-pagination-*`, `x-max-permission`, `X-RateLimit-*`.
- WebSocket: connect to `ws://host/api/v1/ws`, send `{"action":"auth","token":"<jwt>"}`, expect `{"action":"auth.success","success":true}`, then `{"action":"subscribe","event":"notification.created"}`.

## Delve and pprof

- Headless delve on the binary (verified): `dlv exec ./vikunja --headless --listen=127.0.0.1:2345 --api-version=2 -- --config config.yml web`, then `dlv connect 127.0.0.1:2345`. Breakpoints by symbol, for example `break pkg/models.(*Task).Update`. Build without `-s -w` for full symbols (`go build -o vikunja-debug .`).
- pprof: `metrics.enabled: true` and `metrics.pprof: true` mount `/debug/pprof` (`pkg/routes/metrics.go` → `setupPprof`).

## Known failure modes

- **Secret rotation logs everyone out**: an empty `service.secret` is regenerated on each start (`config.go` → `generateServiceSecretIfEmpty`). Set it explicitly.
- **Events lost on restart**: in-flight or retrying events vanish; webhooks and notifications are not retried across restarts.
- **Position drift**: task ordering can hit precision limits or conflicts; the code recalculates (`ErrCodeNeedsFullRecalculation 4028`) and two repair commands exist.
- **Migration on SQLite is limited**: `modifyColumn` is a no-op on SQLite (`pkg/migration/migration.go`); schema divergence between DBs is possible.
- **Index loss on plain `Sync`**: `tx.Sync` in a migration drops indexes the struct does not declare (v2.4.0 regression, #3244); `partialSync` is mandatory and linted.
- **Swagger drift on PRs**: `pkg/swagger` is only regenerated after merge; v1 docs can be stale on a branch.
- **Frontend port 3456 fallback**: an unrelated local Vikunja on 3456 can receive requests from an e2e run whose API is elsewhere. Pin `VIKUNJA_E2E_API_PORT=3456` or stop the other instance.
- **Typecheck is red on `main`**: do not treat its exit code as a signal; compare error counts per file.
