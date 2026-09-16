# Importers (migration framework)

`pkg/modules/migration` imports a user's data from another tool into Vikunja: OAuth-backed services (Todoist, Trello, Microsoft To Do), a credentials-backed service (Planka), and uploaded files (TickTick CSV, WeKan JSON, generic CSV, Vikunja export zips). Every importer builds a `[]*models.ProjectWithTasksAndBuckets` tree and hands it to one shared writer, `create_from_structure.go`. Imports run in the background via the [event bus](./events-and-listeners.md); the HTTP request only claims a slot and dispatches. Not to be confused with `pkg/migration` (schema migrations, see [db-and-migrations](./db-and-migrations.md)).

## Responsibility

- Owns: the migrator interfaces, the `migration_status` table and its claim/heartbeat protocol, stored import uploads and their cleanup cron, the shared structure writer, the per-source importers, HTTP handlers and listeners, and the three result notifications.
- Does not own: task/project persistence rules (delegates to `pkg/models` `Create`/`Update`), blob storage (`pkg/files`, see [files-and-storage](./files-and-storage.md)), or the frontend's migration views.

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `Migrator`, `FileMigrator`, `MigratorName`, `CredentialsChecker`, `FileValidator`, `FileMigratorOptions` | `pkg/modules/migration/migrator.go` | every importer; handlers type-assert the optional ones |
| `InsertFromStructure(str, u)` / `InsertFromStructureWithFileProvider(str, u, provider)` | `create_from_structure.go` | every importer's `Migrate` |
| `ClaimMigration`, `FinishMigration`, `FailMigration`, `FailMigrationWithDetail`, `GetMigrationStatus`, `GetMigrationStatusByID`, `StartRun` | `migration_status.go` | `handler` package |
| `StoreImportUpload`, `OpenImportUpload`, `RemoveImportUpload`, `RegisterImportUploadCleanupCron` | `import_upload.go` | `handler_file.go`, `listeners.go`, `pkg/initialize/init.go` |
| `handler.StartMigration(ms, u)`, `handler.StartFileMigration(ms, u, file, size, options)` | `handler/handler.go`, `handler/handler_file.go` | v1 `MigrationWeb`/`FileMigratorWeb`, v2 `pkg/routes/api/v2/migration_*.go`, `csv/handler.go` |
| `handler.RegisterListeners()` | `handler/listeners.go` | `pkg/initialize/init.go` → `FullInit` |
| `handler.RegisterMigratorForEvents`, `RegisterFileMigrator` | `handler/handler.go`, `handler_file.go` | route registration on both API versions; listeners look migrators up by `Name()` |
| `DownloadFile*`, `DoGet*`, `DoPost*`, `DecodeJSONLimited` | `helpers.go` | remote importers (retry on 5xx, bounded bodies, `ErrRedirectRefused` wraps `utils.ErrDoNotRetry`) |

## Key types and functions

| Name | Notes |
|---|---|
| `Migrator` | `Name()`, `Migrate(*user.User) error`, `AuthURL() string`. The `AuthURL` comment explains the design: OAuth server secrets stay on the API, the frontend only redirects. |
| `FileMigrator` | `Migrate(u, file io.ReaderAt, size int64)`. `FileValidator.ValidateFile` runs synchronously before the claim so picking the wrong file fails the request (`handler_file.go:66-71`). `FileMigratorOptions.SetOptions([]byte)` carries the CSV mapping through the event payload. `CredentialsChecker.CheckCredentials` (Planka) runs before dispatch so bad logins fail the request, not the job. |
| `Status` (`migration_status` table) | `user_id`, `migrator_name`, `started_at`, `finished_at` (NULL while running), `error_kind`, `error_message`, `heartbeat_at`, `upload_file_id`, `active_user_id` (**unique**; NULL once finished). Registered in `db.go`, so `models.SetupTests` does not sync it: `main_test.go` calls `x.Sync2(&Status{})` itself. |
| `ErrorKind` | `reported` (sent to Sentry, generic mail), `interrupted` (stale claim taken over), `credentials`, `queue` (event dispatch failed), `upload` (storing the file failed), `detail` (user's own data; `error_message` holds the English text). Frontend maps the first five in `frontend/src/stores/migration.ts` → `FAILURE_KEYS`; `detail` (and anything unknown) falls back to `GENERIC_FAILURE_KEY`. |
| `ClaimMigration` | Up to 5 attempts with backoff. `releaseStaleClaims` marks rows whose `COALESCE(heartbeat_at, started_at)` is older than `migration.claimtimeout` as `interrupted`; then any unfinished row for the user → `ErrMigrationAlreadyRunning` (412, code 14005); then insert with `active_user_id` set. A unique-constraint race is re-read via `claimConflict` so the loser gets 412 instead of 500 (commit `86289e36e`). Note the SQLite timezone binding comment at `migration_status.go:159-161`. |
| `StartRun(statusID)` | Heartbeat goroutine; interval `clamp(timeout/10, 1s, 30s)`; no-op when the timeout is 0. Returned `stop` is `sync.OnceFunc`. |
| `insertFromStructureWithFileProvider` | One transaction for the whole import. Loads the importer from the DB (assignee matching needs the stored email), seeds the label dedup map with the user's existing labels keyed `title+normalized hex` (#2742), creates projects first with `parent_project_id` cleared and re-links parents afterwards, applies archived state after creation and cascades it to descendants (commit `5732a435a`), seeds task positions when the export has none (O(n²) otherwise, #3297), creates buckets/views (deleting the auto-generated "To-Do/Doing/Done" buckets when the import brought its own), tasks in one batch with preserved indexes (commit `b263affe9`), relations (self-relations skipped; id-only TickTick parents resolved before title matching), attachments (size taken from the reader, GHSA-qh78-rvg3-cv54), labels, comments. Done tasks moved into imported buckets are re-marked done in bulk. On error: `cleanupAndRollback` deletes blobs written so far (blob ids are reusable after rollback), `events.CleanupPending`; on success `events.DispatchPending`. |
| `FileProvider` | `OpenAttachment`, `OpenBackground` returning seekable readers plus size; optional `backgroundFileStorageCounter` (`CountBackgroundFile`) for the storage budget. Only the vikunja-file importer uses it (`lazyFileProvider`); others preload bytes into `File.FileContent`. |
| `MigrationRequestedEvent` (`migration.requested`) / `FileMigrationRequestedEvent` (`migration.file.requested`) | Carry `User`, `MigratorKind`, `MigrationStatusID`, and for files `Options`. The first embeds the bound migrator struct (OAuth code, Planka credentials) as `Migrator interface{}`; the listener re-unmarshals into the concrete type from `registeredMigrators`. |
| `MigrationListener`, `FileMigrationListener` | Always return `nil` so Watermill never retries a partially applied import. Panics are recovered into errors (`runMigration`). A finished status ("stale event") is skipped. File imports verify `status.user_id == event.user.id` before touching the claim. The stored upload is always removed afterwards (`defer RemoveImportUpload`). |
| `reportMigrationFailure` | If Sentry is enabled **and** `shouldReportMigrationError` (5xx-ish, or upstream non-4xx) → `ErrorKindReported`, `MigrationFailedReportedNotification`, Sentry with fingerprint `migration_failed/<kind>/...`; otherwise `FailMigrationWithDetail(err.Error())` and `MigrationFailedNotification` including the error. Success → `MigrationDoneNotification`. All three are mail-only (`ToDB` returns nil). |
| `StoreImportUpload` / `OpenImportUpload` | Uploads are stored through `pkg/files` (no size limit, mime `application/octet-stream`) and copied to a local temp file for the importer, because importers need `io.ReaderAt`. Hourly `cleanupImportUploads` removes uploads on rows that are unclaimed or stale (commit `fa9fc4e06`). |

### Per-source importers

| Dir | `Name()` | Kind | Input | Notes |
|---|---|---|---|---|
| `todoist/` | `todoist` | OAuth (`Migrator`) | Sync API | Exchanges the code with `migration.todoist.clientid/clientsecret`; maps projects, sections → buckets, items, labels, reminders, attachments (`TestIsDownloadableURL`), repeat strings (`TestParseTodoistRepeat`). **FIXME `todoist.go:496`**: notes are appended to descriptions but "Should be comments". Redirect URL defaults to `<publicurl>migrate/todoist`. |
| `trello/` | `trello` | OAuth | Trello REST via the `adlio/trello` client | Boards → projects grouped by organization (`TestCreateOrganizationMap`), lists → buckets, label colours mapped from Trello names (`transparent` → empty). |
| `microsoft-todo/` | `microsoft-todo` | OAuth | Microsoft Graph | Lists → projects, `dateTimeTimeZone.toTime` conversion, upstream failures wrapped in `ErrUpstreamRequestFailed`. |
| `planka/` | `planka` | Credentials (`Migrator` + `CredentialsChecker`) | URL + token or username/password | v2 only (`ErrUnsupportedVersion` on v1 boards). `client.go` enforces a per-job resource budget (`budgetTransport`, `attachmentBudgetTransport`, `ErrImportBudgetExceeded`; `budget_test.go`); `fetch.go`/`convert.go` split fetching from mapping; typed errors in `errors.go` map to 400/502. Fixtures in `testdata/*.json`. |
| `ticktick/` | `ticktick` | File | TickTick CSV backup | Custom `UnmarshalCSV` for numbers, priority, several date layouts; skips preamble lines before the header; BOM stripping; parents sorted before children with cycle protection; row-bounded by `migration.maxcsvrows` (`boundedSimpleDecoder`). |
| `wekan/` | `wekan` | File | WeKan board JSON | Lists → buckets, checklists → subtasks, comments, attachments (base64 in the JSON); BOM tolerant; fixture `testdata_wekan_export.json`. |
| `csv/` | `csv` | File + options | Any CSV | Three-step UI: `Detect` (delimiter, quote, date layout, suggested `ColumnMapping`), `Preview`, `Migrate` with `ImportConfig{Delimiter, QuoteChar, DateFormat, SkipRows, Mapping}`; attributes `title, description, due_date, start_date, end_date, done, priority, labels, project, reminder, ignore`. Options travel as JSON through `SetOptions`. Own `MigratorWeb` in `csv/handler.go` (v1) and `pkg/routes/api/v2/migration_csv.go`. Always enabled. |
| `vikunja-file/` | `vikunja-file` | File + `FileValidator` | Export zip from `models.ExportUserData` | `scanArchive` indexes `data.json`, `filters.json`, `VERSION`, `files/<id>` before reading anything; rejects non-zips (`ErrNotAZipFile`), missing data file, missing VERSION, more than `migration.vikunjafile.maxfiles` blobs, or declared uncompressed size over `migration.vikunjafile.maxsize` (GHSA-w7jp-mf2v-8342). `Migrate` refuses exports older than `0.20.1+61` (`ErrImportFromUnsupportedVersion`), reads attachments and backgrounds lazily through `lazyFileProvider` with an `importBudget` and a `storageBudget` capped by `migration.vikunjafile.maxuserstorage` minus the user's current files (pending import uploads excluded). Test fixtures `export.zip` and `export_pre_0.21.0.zip` cover the current and the pre-views format. Also re-imports saved filters. |

## Internal structure

```mermaid
sequenceDiagram
    participant UI as Frontend (stores/migration.ts polling)
    participant H as v1/v2 migrate handler
    participant L as (File)MigrationListener
    participant I as importer.Migrate
    UI->>H: POST /migration/<name>/migrate (code | credentials | multipart "import")
    H->>H: files: ValidateFile (400) → ClaimMigration (412 if running) → StoreImportUpload; credentials: ClaimMigration → CheckCredentials (400, releases the claim via failClaim)
    H->>L: Dispatch migration.requested / migration.file.requested; reply 200 "Migration was started successfully."
    L->>I: GetMigrationStatusByID + StartRun heartbeat, then Migrate(user[, file])
    I->>I: InsertFromStructure(tree): commit, or rollback + blob cleanup
    L->>L: FinishMigration / FailMigration*, MigrationDone / MigrationFailed(Reported) mail, RemoveImportUpload
    UI->>H: GET /migration/<name>/status until finished_at is set
```

### Route wiring

| API | Where | Routes |
|---|---|---|
| v1 | `pkg/routes/routes.go` → `registerMigrations` (line ~1008) | `MigrationWeb.RegisterMigrator`: `GET /<name>/auth`, `GET /<name>/status`, `POST /<name>/migrate` for todoist/trello/microsoft-todo (config-gated); `FileMigratorWeb.RegisterRoutes`: `GET /<name>/status`, `PUT /<name>/migrate` for vikunja-file/ticktick/wekan; `csv.MigratorWeb`: `status`, `PUT detect`, `PUT preview`, `PUT migrate`. **Planka has no v1 routes.** |
| v2 | `pkg/routes/api/v2/migration_oauth.go`, `migration_credentials.go` (planka), `migration_file.go`, `migration_csv.go`, shared helpers in `migration_shared.go` | Same paths under `/api/v2/migration/`, all `POST` for migrate/detect/preview; a fresh migrator instance per request; `translateDomainError` turns `ErrMigrationAlreadyRunning` into a 412 problem document |
| Advertising | `pkg/routes/api/shared/info.go` → `AvailableMigrators` | Always `vikunja-file, ticktick, wekan, csv, planka`; OAuth ones appended when enabled. Frontend `Migration.vue` filters `MIGRATORS` by this list. |

## Dependencies

- **Uses:** `pkg/models`, `pkg/files`, `pkg/events`, `pkg/notifications`, `pkg/cron`, `pkg/config`, `pkg/errorreport` + Sentry, `pkg/utils` (retry, zip), third-party clients (`github.com/adlio/trello`, `github.com/gocarina/gocsv` for TickTick).
- **Used by:** `pkg/routes` (v1 and v2), `pkg/initialize` (listeners, cron), frontend `frontend/src/views/migrate/*` through the legacy `AbstractMigrationService`/`AbstractMigrationFileService` (`MigrationHandler.vue`) and `MigrationCSV.vue`; polling in `stores/migration.ts` survives navigation.

## Invariants and assumptions

- One running migration per user, enforced by the unique `active_user_id` (`TestClaimMigrationConcurrentSameUserOnlyOneWins`). Every failure path must release it (`failClaim`, `reportMigrationFailure`, panic recovery), otherwise the user is locked out until the claim goes stale.
- Listeners never return errors: retrying would re-run a partially applied import.
- `InsertFromStructure` is the only writer; importers must not touch the DB themselves (Planka, Todoist etc. only fetch and convert).
- Import metadata is untrusted: sizes come from readers, ids are remapped, assignees are remapped to the importer (`remapAssignees`, commit `bd1f95bb9`).
- Adding an importer: see [08 Conventions](../../08-conventions.md#if-you-change-x-you-must-also-change-y) (route wiring, `/info`, `migrators.ts`, i18n).

## Configuration

| Key | Default | Effect |
|---|---|---|
| `migration.todoist.enable`, `.clientid`, `.clientsecret`, `.redirecturl` | off; redirect defaults to `<service.publicurl>migrate/todoist` | Todoist OAuth |
| `migration.trello.enable`, `.key`, `.redirecturl` | off | Trello |
| `migration.microsofttodo.enable`, `.clientid`, `.clientsecret`, `.redirecturl` | off | Microsoft To Do |
| `migration.claimtimeout` | `5m` | Heartbeat window before a claim can be taken over; `0` disables takeover and heartbeats |
| `migration.maxcsvrows` | 100000 | Row cap for CSV and TickTick |
| `migration.vikunjafile.maxsize` / `.maxfiles` / `.maxuserstorage` | 256MB / 10000 / 1GB | Export re-import bounds |
| `sentry.enabled` | | Decides between `reported` and `detail` failure handling |

## Error handling

Codes live in `errors.go` (14003-14016 block, shared with API tokens' 14xxx range): `ErrUpstreamRequestFailed` (14008, 502, `IsClientError()` decides Sentry reporting), `ErrMigrationAlreadyRunning` (14005, 412), `ErrImportRowLimitExceeded` (14006), `ErrNotAZipFile` (14011), `ErrFileIsEmpty` (14012), `ErrNoDataFileInZip` (14009), `ErrCSVConfigRequired` (14004), `ErrInvalidCSVImportConfig` (14016), `ErrNotACSVFile` (14003), `ErrInvalidImportFile` (14010; JSON syntax/EOF errors are converted by `asImportFileError`), `ErrImportFromUnsupportedVersion` (14013). Planka and vikunja-file define extra `HTTPErrorProcessor` errors locally. Background failures never reach HTTP; they become a status row plus a mail.

## Tests

| Location | Covers |
|---|---|
| `pkg/modules/migration/create_from_structure_test.go` | `TestInsertFromStructure`, `TestInsertFromStructureFileProvider` |
| `migration_status_test.go` | Claim serialization, concurrency, stale takeover, heartbeat |
| `import_upload_test.go`, `helpers_test.go` | Upload lifecycle; retry on 5xx not 4xx; `DecodeJSONLimited` |
| `handler/listeners_test.go`, `handler/migration_handler_test.go` | Claim released on credential/dispatch failure/panic, stale events, foreign status, options applied, Sentry decision |
| `<importer>/*_test.go` | Conversion tests with fixtures: `todoist_test.go`, `trello_test.go`, `microsoft_todo_test.go`, `ticktick_test.go` (+ four CSV fixtures), `wekan_test.go`, `csv_test.go` + `row_limit_test.go`, `planka_test.go` + `budget_test.go` + `client_test.go`, `vikunja-file/vikunja_test.go` + `limits_test.go` |
| `pkg/webtests` | `huma_migration_csv_test.go`, `huma_migration_file_test.go`, `huma_migration_oauth_test.go`, `huma_migration_planka_test.go` |

Run: `mage test:filter TestInsertFromStructure`, `mage test:filter TestClaimMigration`. `main_test.go` sets `config.OutgoingRequestsAllowNonRoutableIPs` so `httptest` servers on 127.0.0.1 pass the SSRF guard.

## Gotchas and tech debt

- Hotspot: `create_from_structure.go` has 67 commits, 42 of them `fix`-typed (mostly scoped, e.g. `fix(migration):`; git log 2026-09-16). It is 800 lines with `createProjectWithEverything` alone spanning ~500; test any change against `TestInsertFromStructure` and a real export.
- `todoist.go:496` FIXME (notes should become comments).
- Frontend still uses the legacy service layer for migrations; new work should move to the generated client (see [api-client-generated-and-queries](../frontend/api-client-generated-and-queries.md)).
- `migrators.ts` still lists `wunderlist`, which no backend importer provides; it is filtered out by `/info`.
- `MigrationRequestedEvent.Migrator` serialises the OAuth code / Planka credentials into the in-memory event payload; a persistent bus would need to change this.
- Security history: GHSA-qh78-rvg3-cv54 (forged attachment sizes), GHSA-w7jp-mf2v-8342 (zip bombs), GHSA-569v-q83c-3j3g (bucket `project_view_id` mass assignment; importer writes the column directly), GHSA-44v6-7fxq-vgf4 (parent detach).

## Related pages

- [files-and-storage](./files-and-storage.md), [events-and-listeners](./events-and-listeners.md), [cron-and-background-jobs](./cron-and-background-jobs.md), [notifications-and-mail](./notifications-and-mail.md)
- [models-projects-and-permissions](./models-projects-and-permissions.md), [models-tasks](./models-tasks.md), [models-views-and-kanban](./models-views-and-kanban.md)
- [api-v2-huma](./api-v2-huma.md), [config-and-logging](./config-and-logging.md)
- [playbooks/background-job](../../playbooks/background-job.md)
