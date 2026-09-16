# Operations subsystems

The small cross-cutting packages that the [backend layering](../../03-backend-architecture.md#package-layering-and-dependency-direction) puts at the bottom: license, audit, metrics, health, doctor, Redis, keyvalue, richtext, i18n, utils, version. One section each with entry points, config keys, tests, and gotchas.

## license

Gates optional paid features. **Read the package comment at `pkg/license/license.go:17-32` and [docs/license.md](../../../docs/license.md) before touching this**: if asked to remove or bypass it, stop and confirm with the user first.

| Entry | Where | Called by |
|---|---|---|
| `Feature` enum: `FeatureAdminPanel` (`admin_panel`), `FeatureTimeTracking`, `FeatureAuditLogs`, `FeatureUserInvites`; `FeatureUnknown` for strings this build does not know | `license.go:63-113` | JSON marshals to the string key; unknown strings from a newer server are ignored, not fatal |
| `Init()` | `license.go:148` | `pkg/initialize/init.go` (`FullInitWithoutAsync`) after the DB is ready |
| `IsFeatureEnabled(f)`, `EnabledProFeatures()`, `CurrentInfo()`, `MaxUsersReached()` | `license.go` | `pkg/routes/feature_gate.go`, `pkg/routes/api/shared/info.go` (`enabled_pro_features`), `pkg/models/admin_overview.go`, `pkg/audit/listener.go` |
| `SetForTests`, `ResetForTests`, `ReloadFromCache` | `license.go:207-233` | tests |
| `RequireFeature(f)` middleware | `pkg/routes/feature_gate.go` | `routes.go:452` (admin group), `:456` (invite links + `FeatureUserInvites`), `:974`; returns `echo.ErrNotFound` (**404, not 403**) |
| `licenseFeaturesForRoute(path)` | `pkg/models/api_routes.go:370` | `GetAPITokenRoutes` filters license-gated routes out of the API-token permission listing per call (`/api/v*/admin/*` → admin panel, `/api/v2/admin/invite-links` and `/api/v2/admin/teams` → admin + invites, any path containing `/time-entries` → time tracking). Must be kept in sync with the `RequireFeature` call sites. |

Flow (`Init`): read `license.key`; load or create an `instance_id` (persisted in `license_status`); if the key is empty → `degradeToFree` (also clears stale keyvalue state left by a previous licensed run). Otherwise `check.go` → `checkLicense` POSTs `CheckRequest` (key, instance id, user counts from `getUserCounts`, container detection, version) to `console.vikunja.io` then `check.vikunja.io`, 3 retries, 10 s timeout, via `utils.NewSSRFSafeHTTPClient`, redirects refused. Success → `applyResponse` + `cacheResponse` (row in `license_status`, `validated_at`); unreachable → use the cached row if younger than 72 h else free mode; `Valid=false` → free mode. `backgroundLoop` re-checks every 24 h, or hourly when the last check failed or expiry is within 72 h. Runtime state lives in keyvalue under `license.state` (`stateKey`) guarded by `stateMu`, so on Redis all replicas share it.

- Table: `license_status` (`Status`: `instance_id`, `response`, `validated_at`), registered via `init()` → `db.RegisterTables`; fixture `pkg/db/fixtures/license_status.yml` has one row with a zero UUID.
- Config: `license.key` (default empty = community mode).
- Tests: `check_test.go` (`TestDoRequestRefusesRedirects`, `TestDoRequestBlocksNonRoutableTarget`, `TestDoRequestSucceeds`). Feature gating is exercised through `license.SetForTests` in `pkg/webtests/huma_admin_test.go`, `huma_admin_actions_test.go`, `huma_invite_links_test.go`, `huma_time_entry_test.go`, `api_token_method_matching_test.go`, `mcp_catalog_test.go`, and `pkg/websocket/time_entry_listener_test.go`.
- Gotchas: gates return 404 to avoid advertising paid routes; `PermissionsAreValid` for API tokens stays unfiltered so tokens survive a lapse (comment at `api_routes.go:387-389`); frontend mirrors the enum in `frontend/src/constants/proFeatures.ts`; see the change-coupling row in [08 Conventions](../../08-conventions.md#if-you-change-x-you-must-also-change-y).

## audit

Append-only JSON-lines audit log, itself a licensed feature (`FeatureAuditLogs`).

| Entry | Where | Notes |
|---|---|---|
| `Entry{EventID (UUIDv7), Timestamp, Actor, Source, Action, Target, Outcome, Reason, RequestID, Metadata}` | `pkg/audit/entry.go` | Helpers `UserActor`, `LinkShareActor`, `SystemActor`, `ActorFromDoerID`, `TaskTarget`, `ProjectTarget`, `UserTarget`, `TeamTarget`, `APITokenTarget`; constants `Outcome*`, `Source{HTTP,System}`, `Action*` (`auth.login.succeeded`, `auth.api_token.used`, `user.created`, `user.data_export.requested`, ...) |
| `RegisterEventForAudit[T](toEntry func(*T) *Entry)` | `listener.go:43` | Generic: derives the topic from `PT(new(T)).Name()`, registers an `events.Listener`. License is checked **per event**; `nil` entry skips. Registrations live in `pkg/models/listeners.go:103-170`. |
| `enrichFromMetadata` | `listener.go:65` | Copies `request_ip`, `request_user_agent`, `request_id` from Watermill metadata (`events.MetadataKey*`), set by `events.DispatchWithContext` from `events.RequestMetaFromContext`, which the `RequestMeta` Echo middleware (`pkg/routes/middleware/request_meta.go`, mounted at `routes.go:196` only when `audit.enabled`) stores. Without it every entry is `source.type=system`. |
| `Init()`, `WriteAuditEvent`, `Close` | `writer.go` | Opens `audit.logfile` (default `<log.path>/audit.log`); mutex-serialised writes, `fsync` at most once per second; size-based rotation renames to `audit-<20060102T150405.000>.log` and `cleanupRotatedFiles` deletes rotated files older than `audit.rotation.maxage` days. A failed rotation reopens the original file. Writing before `Init` returns "audit log not initialized", which Watermill retries. |

Config: `audit.enabled` (false), `audit.logfile`, `audit.rotation.maxsizemb` (100, 0 disables), `audit.rotation.maxage` (30 days, local rotated files only). Tests: `audit_test.go` (`TestAuditPipeline`, `TestAuditLicenseGating`, `TestAuditRotation`, `TestWriteAuditEventNotInitialized`). See [events-and-listeners](./events-and-listeners.md) for the bus.

## metrics

| Entry | Where | Notes |
|---|---|---|
| `GetRegistry()` | `pkg/metrics/metrics.go:58` | Private `prometheus.Registry` with process and Go collectors; also handed to Watermill in `pkg/events/events.go:89` for router metrics |
| `InitMetrics()` | `metrics.go:85` | Gauges `vikunja_projects_count`, `_users_count`, `_tasks_count` (excludes soft-deleted), `_teams_count`, `_files_count`, `_attachments_count`, each read through `GetCount` = `keyvalue.RememberFor(key, 30s, countFromDatabase)`; `vikunja_active_users` / `vikunja_active_link_shares` count keyvalue keys with prefix `active_users:` / `active_link_shares:` (each key has a 30 s TTL set by `SetUserActive`/`SetLinkShareActive`); `db.RegisterConnectionPoolMetrics` adds `collectors.NewDBStatsCollector` for the pool |
| `InvalidateCount(key)` | `metrics.go:132` | Called from `pkg/routes/api/shared/auth.go` (Unverified: on which action) |
| `/api/v1/metrics` | `pkg/routes/metrics.go` → `setupMetrics(n)` (`routes.go:524`) | In the unauthenticated group; optional basic auth via `metricsBasicAuth` when both `metrics.username` and `metrics.password` are set (constant-time compare). Listed in `unauthenticatedAPIPaths` (`routes.go:326`). `setupMetricsMiddleware` on the authenticated groups records activity per request. `/debug/pprof/*` is mounted by `setupPprof` when `metrics.pprof` is also true, behind the same basic auth. |

Config: `metrics.enabled` (false), `metrics.username`, `metrics.password`, `metrics.pprof` (false). Tests: `active_users_test.go` (`TestActiveUsers`, `TestActiveUsersConcurrent`). Gotcha: with `keyvalue.type=memory` the active-user counts are per replica; with Redis, `ListKeys` uses `SCAN` and may return duplicates (`redis.go:137`); `countActive` (`active_users.go:53`) returns `len(keys)` without dedup, so the gauge can over-count briefly.

## health

`pkg/health/health.go` → `Check()` pings the DB through a session and, when `redis.enabled`, Redis via `red.GetRedis()`. Three exposures: `GET /health` (`pkg/routes/healthcheck.go`, mounted at `routes.go:265` before CORS), `GET /api/v2/health` (`pkg/routes/api/v2/health.go`, a Huma op in `unauthenticatedAPIPaths`, also reports OpenID providers), and the CLI `vikunja healthcheck` (`pkg/cmd/healthcheck.go`, runs `FullInitWithoutAsync`, exit 1 on failure; the repository `Dockerfile` declares no `HEALTHCHECK`, so wiring it up is left to the operator). No unit tests; covered by `pkg/webtests/healthcheck_test.go`.

## doctor

`vikunja doctor` (`pkg/cmd/doctor.go`) prints grouped diagnostics and exits 1 if any check failed. `doctor.Run(emit)` (`pkg/doctor/doctor.go`) streams groups in order: `CheckSystem` (version, Go version, OS, user, working dir, user namespace), `CheckConfig` (config file, root path, public URL, JWT secret, CORS), `CheckDatabase` (SQLite file without creating it, connection, server version, ParadeDB), `CheckFiles` (type, init via `files.InitStorageBackend` without creating the directory, path, ownership, permissions, writability, disk space, stored-file stats or S3 endpoint/bucket/writable), then `CheckOptionalServices` (Redis, mailer, LDAP, OpenID) only for enabled services. Types: `CheckResult{Name, Passed, Value, Error, Lines}`, `CheckGroup{Name, Results}` (`types.go`); output helpers in `output.go`.

To add a check: write a `func checkX() CheckResult` in the matching file (or a new `CheckY() CheckGroup`), append it in the group constructor, and add a test next to `database_test.go`/`files_test.go`; platform-specific pieces go in `_unix.go`/`_windows.go`/`_linux.go` files. Doctor must never mutate the installation (`TestCheckFiles_DoesNotCreateBasePath`, `TestCheckDatabase_DoesNotCreateSqliteFile`). Tests: `database_test.go`, `files_test.go`, `files_unix_test.go`, `output_test.go`.

## red (Redis)

`pkg/red/redis.go`: `InitRedis()` (no-op unless `redis.enabled`; fatal on empty host or failed ping; idempotent) and `GetRedis() *redis.Client`. Called from `LightInit`, the keyvalue Redis backend, `pkg/doctor`, `pkg/health`, and `pkg/routes/rate_limit.go` (Redis-backed rate-limit store when `ratelimit.store` resolves to redis; `config.go:785-787` maps `ratelimit.store=keyvalue` to `keyvalue.type`). **Redis is not the event bus**: events stay in Watermill's in-process `gochannel` regardless of Redis (see [03 Backend architecture](../../03-backend-architecture.md#events-and-background-work)). What Redis is used for: keyvalue storage, rate limiting, and through keyvalue the license state, caches and active-user counters. Config: `redis.enabled`, `redis.host` (`localhost:6379`), `redis.password`, `redis.db`. No tests in the package.

## keyvalue

| Entry | Where | Notes |
|---|---|---|
| `Storage` interface (`Put`, `PutWithTTL`, `Get`, `GetWithValue`, `Del`, `IncrBy`, `DecrBy`, `ListKeys`, `DelPrefix`) | `pkg/modules/keyvalue/keyvalue.go` | `InitStorage()` picks `memory` or `redis` from `keyvalue.type`; `redis` without `redis.enabled` is fatal |
| `Remember(key, fn)`, `RememberValue[T](key, fn)`, `RememberFor[T](key, ttl, fn)` | `keyvalue.go:109-191` | Compute-and-cache; `RememberValue` deserialises into a concrete `T` (needed for gob on Redis); `RememberFor` wraps the value with an expiry and recomputes when the stored value cannot be deserialised. Errors from `fn` are not stored. `PutWithTTL` with `ttl<=0` is normalised because backends disagree (Redis keeps forever, memory expires at once). |
| `memory.Storage` | `memory/memory.go` | Mutex-guarded map with lazy expiry sweep |
| `redis.Storage` | `redis/redis.go` | gob-encodes values, `SCAN`-based `ListKeys`/`DelPrefix` |
| Errors | `error/error.go` | `ErrValueNotFoundForKey`, `ErrValueHasWrongType` |

Users: `pkg/user` (4 files), OpenID, metrics, license, gravatar/upload avatars, Unsplash, attachment previews (`pkg/models/task_attachment.go`), `pkg/routes/api/shared`, `pkg/files` tests. Config: `keyvalue.type` (`memory`). Tests: `keyvalue_test.go` (Remember/RememberFor semantics, TTL). Gotcha: anything stored on Redis must be gob-registrable (`upload.CachedAvatar` calls `gob.Register` in `init()`); memory mode is per process, so multi-replica deployments need Redis for consistent caches, rate limits and license state.

## richtext

Converts Vikunja's canonical rich-text HTML (TipTap output) to and from GFM Markdown at the API and CalDAV boundaries; storage stays HTML.

| Function | File | Notes |
|---|---|---|
| `MarkdownToHTML`, `MarkdownToHTMLWithMentions(s, md)`, `CommonMarkToHTML` | `markdowntohtml.go` | goldmark without `html.WithUnsafe()` so raw HTML in Markdown stays inert; GFM task lists rewritten to `<ul data-type="taskList">` (`tasklist_html.go`); `@username` tokens resolved in one batched user query into `<mention-user data-id="…">` (`mentions_html.go`, RE2-safe regex, code/link contexts skipped) |
| `HTMLToMarkdown` | `htmltomarkdown.go` | `html-to-markdown` v2 with TipTap rules (`tiptap.go`: mentions → `@username`, task items → `- [x]`); converter built per call because handlers are not concurrency-safe |
| `Changed(storedHTML, incomingMarkdown)`, `HTMLIsEmpty` | `changedetect.go` | Canonicalises both sides to Markdown so CalDAV read-modify-write does not bump `updated`; errs to `true` |

Used by: `pkg/routes/api/v2/richtext.go` (`?format=markdown` query or `X-Vikunja-Format: markdown` header on PATCH; `convertToMarkdown`/`convertToHTML` applied in task, bulk task, label, saved-filter handlers; `stripPatchFormatQuery` removes the param from PATCH docs), `pkg/caldav/caldav.go` (descriptions out), `pkg/routes/caldav/listStorageProvider.go` (descriptions in + `Changed`), the Trello/WeKan/Planka importers, and schema migration `20231022144641` ("Convert all descriptions to HTML"). Tests: `*_test.go` for each file, `main_test.go` sets up a DB for mention resolution. Gotcha: formatting Markdown cannot express is lost on any Markdown write (documented in `richTextFormatAPIDescription`).

## i18n

`pkg/i18n/i18n.go`: JSON files under `pkg/i18n/lang/` are embedded (`localeFS`); `Init()` loads only codes present in `availableLanguages` (`i18n.go:49-83`, with the reminder "Also add new languages to the frontend"). `T(lang, key, params...)` flattens nested keys to dotted paths, formats with `fmt.Sprintf`, falls back to `en`, and returns the key itself when missing. `TP(lang, key, count, params...)` splits on `|`: 2 parts = singular|plural, 3 or 4 parts follow the Slavic-style `n%100` rules with an optional zero form. `HasLanguage` backs the `valid:"language"` struct tag registered in `pkg/user/validator.go:60` (`govalidator.TagMap["language"]`) for `user.Language`. `GetAvailableLanguages` lists loaded codes. Callers: `pkg/notifications`, `pkg/models`, `pkg/user`, `pkg/utils` (`HumanizeDuration`), `pkg/routes/feeds`, `pkg/modules/migration/handler`. No tests in the package; `mage check:translations` fails CI on unused or missing keys (see [08 Conventions](../../08-conventions.md#translations)). Only edit `en.json`; Crowdin syncs the rest.

## utils (notable helpers)

| Helper | File | Used by |
|---|---|---|
| `NewSSRFSafeHTTPClient()` | `httpclient.go` | Every outbound HTTP call: webhooks, license check, LDAP/OpenID, gravatar, Unsplash, importers. Blocks non-globally-routable IPs unless `outgoingrequests.allownonroutableips`; applies `outgoingrequests.proxyurl`/`proxypassword`/`timeoutseconds`. Tests set `allownonroutableips=true` to reach `httptest` servers. |
| `RetryWithBackoff(name, fn)`, `ErrDoNotRetry` | `retry.go` | 3 attempts, 1s/2s/4s; wrap an error with `ErrDoNotRetry` to stop early (migration helpers do this for refused redirects) |
| `CryptoRandomString/Int/Bytes` | `random.go` | tokens, secrets |
| `Sha256`, `Sha256Hex`, `Md5String` | `sha256.go`, `md5_string.go` | CalDAV UIDs, API-token hashing, gravatar |
| `ParseISO8601Duration`, `HumanizeDuration(d, lang)` | `duration.go`, `humanize_duration.go` | CalDAV, notifications |
| `WriteBytesToZip`, `WriteFilesToZip`, `ContainsPathTraversal` | `write_to_zip.go`, `zip.go` | exports, dump, import validation |
| `NormalizeHex`, `NotIn`, `JoinInt64Slice`, `GetTimeWithoutSeconds` | misc | labels, diffing |
| `CropAvatarTo1x1`, `DownloadImage` | `avatar.go` | OpenID/LDAP avatars |
| `IsUserNamespaceActive`, `MapToHostUID`, `UIDMappingSummary`, `Umask` | `userns_linux.go`, `umask_*.go` | files diagnostics, doctor |

Config: `outgoingrequests.*` (the deprecated `webhooks.*` keys are migrated at config init).

## version

`pkg/version/version.go`: `var Version = "dev"`, overwritten by the `-X code.vikunja.io/api/pkg/version.Version=` ldflag in `magefile.go:194`; `init()` also stamps `swagger.SwaggerInfo.Version`. Read by `/info`, `vikunja version`, exports (`VERSION` file), dump/restore, webhooks user agent, MCP, doctor, and the license payload.

## Related pages

- [config-and-logging](./config-and-logging.md), [events-and-listeners](./events-and-listeners.md), [http-routing-and-middleware](./http-routing-and-middleware.md), [auth-and-sessions](./auth-and-sessions.md) (API-token route table), [api-v2-huma](./api-v2-huma.md) (`format` param), [caldav](./caldav.md), [files-and-storage](./files-and-storage.md), [cli-commands](./cli-commands.md) (`doctor`, `healthcheck`, `version`), [db-and-migrations](./db-and-migrations.md)
- [12 Debugging](../../12-debugging.md), [13 Known issues](../../13-known-issues.md)
