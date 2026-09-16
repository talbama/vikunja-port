# CLI commands and startup

`pkg/cmd` is the cobra tree behind the `vikunja` binary; `pkg/initialize` provides the wiring levels each command picks; `pkg/modules/dump` implements the backup format. Context: [Backend architecture: Startup](../../03-backend-architecture.md#startup).

## Responsibility

- **Owns:** the command and flag definitions, which init level runs before each command, the HTTP server lifecycle and graceful shutdown (`web.go`), the dump zip format and restore procedure, version printing.
- **Does not own:** what the commands call: migrations ([db-and-migrations](./db-and-migrations.md)), diagnostics (`pkg/doctor`, [operations-subsystems](./operations-subsystems.md)), repair logic (`models.RepairTaskPositions`, `models.RepairOrphanedProjects`, `models.DeleteOrphanedTaskPositions`, `files.RepairFileMimeTypes`), routes ([http-routing-and-middleware](./http-routing-and-middleware.md)), user logic ([user-package](./user-package.md)).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `cmd.Execute()` | `pkg/cmd/cmd.go` | `main.go` |
| `initialize.LightInit/InitEngines/FullInitWithoutAsync/FullInit` | `pkg/initialize/init.go` | command `PreRun`s; `dump.Restore` calls `LightInit` + `InitEngines` again after swapping the config |
| `dump.Dump(path)`, `dump.Restore(path, overrideConfig)` | `pkg/modules/dump/{dump,restore}.go` | `dumpCmd`, `restoreCmd` |
| `doctor.Run(emit)`, `PrintHeader`, `PrintGroup`, `CountFailed` | `pkg/doctor/` | `doctorCmd` |
| `health.Check()` | `pkg/health/health.go` | `healthcheckCmd`, `/health` route |
| `version.Version` | `pkg/version/version.go` | `versionCmd`, `webCmd`, Sentry release, dump `VERSION` file |

## Command reference

All commands accept the persistent `--config <file>` flag (`cmd.go`), applied in `cobra.OnInitialize` via `config.SetConfigFile` before any `PreRun`. Running the bare binary is `web` (`rootCmd.PreRun/Run` alias `webCmd`'s).

| Command | Flags / args | PreRun level | Does |
|---|---|---|---|
| `web` | none | `FullInit` | `routes.NewEcho` + `RegisterRoutes`, serves on `service.interface`, a unix socket, or autotls; blocks until SIGINT |
| `migrate` | none | `LightInit` (as `PersistentPreRun`, inherited by subcommands) | `migration.Migrate(nil)`; the engine is created inside `initMigration` |
| `migrate list` | none | inherited `LightInit` | prints ID/Description from the `migration` table; on a never-migrated DB fails with `no such table: migration` because nothing has created the table yet ([verified](../../07-development-workflow.md#build-and-run-the-backend)) |
| `migrate rollback` | `-n/--name <id>` (required) | inherited `LightInit` | `migration.Rollback(id)` → xormigrate `RollbackTo`; most rollbacks are no-ops |
| `user list` | `-e/--email` (exact match) | `FullInit` | table of ID, Username, Email, Status, Issuer, Subject, Created, Updated |
| `user create` | `-u/--username` (req), `-e/--email` (req), `-p/--password` (prompted if absent), `-a/--avatar-provider` | `FullInit` | `user.CreateUser` + default project |
| `user update <id>` | `-u`, `-e`, `-a` | `FullInit` | updates the given fields |
| `user reset-password <id>` | `-d/--direct`, `-p/--password` | `FullInit` | direct password set, or sends the reset mail |
| `user change-status <id>` | `-d/--disable`, `-e/--enable` (neither = toggle) | `FullInit` | flips `status` |
| `user delete <id>` | `-n/--now`, `-c/--confirm` | `FullInit` | without `--now` sends the deletion-request mail (`user.RequestDeletion`); with `--now` prompts for `YES, I CONFIRM` unless `--confirm`, then `models.DeleteUser`; `user.GuardLastAdmin` protects the last admin |
| `user set-admin <username-or-id>` | `--admin`, `--no-admin` | `FullInit` | refuses unless `license.IsFeatureEnabled(FeatureAdminPanel)`; `GuardLastAdmin` on demotion |
| `dump` | `-p/--path` (default rootpath), `-f/--filename` (default `vikunja-dump_<date>.zip`) | `FullInitWithoutAsync` | `dump.Dump` |
| `restore <file>` | `--preserve-config` | `FullInitWithoutAsync` | `dump.Restore(file, !preserveConfig)` |
| `testmail <email>` | positional | `LightInit` + `mail.StartMailDaemon()` | renders a notification mail and `mail.SendTestMail` (synchronous) |
| `version` | none | none | prints `version.Version` and `runtime.Version()` |
| `doctor` | none | `log.InitLogger()` + `config.InitConfig()` only; each check opens what it needs | `doctor.Run` groups System, Configuration, Database, Files, optional Redis/Mailer/LDAP/OpenID |
| `healthcheck` | none | `FullInitWithoutAsync` | `health.Check()`: DB `Ping` and Redis ping if enabled; not an HTTP probe |
| `repair projects` | `--dry-run` | `FullInitWithoutAsync` | re-parents projects whose parent is gone, rebuilds `project_ancestors` |
| `repair task-positions` | `--dry-run` | `FullInitWithoutAsync` | fixes duplicate positions per view, falls back to full recalculation |
| `repair orphan-positions` | `--dry-run` | `FullInitWithoutAsync` | deletes `task_positions` rows for missing tasks/views |
| `repair file-mime-types` | `--dry-run` | `FullInitWithoutAsync` | detects MIME for files with empty `mime` |

`user` has a `PersistentPostRun` that calls `mail.StopMailDaemon()` to drain queued mails before the process exits (comment in `user.go`). The `user *` commands use `FullInit` (cron, websocket hub, and the event router start) although they only need mail and the DB. Unverified: whether anything in those commands needs the router; `RequestDeletion` and `DeleteUser` may dispatch events that would otherwise be dropped.

## Init levels (`pkg/initialize/init.go`)

| Level | Exact order | Why commands pick it |
|---|---|---|
| `LightInit()` | `log.InitLogger()` → `config.InitConfig()` → `time.LoadLocation(service.timezone)` (Critical, not fatal) → `red.InitRedis()` → `keyvalue.InitStorage()` | config and cache only; no DB. `migrate` and `testmail` |
| `InitEngines()` | `models.SetEngine()` → `files.SetEngine()` → `db.CreateParadeDBIndexes()` (each fatal) | used inside `FullInitWithoutAsync` and again by `dump.Restore` after the config is replaced |
| `FullInitWithoutAsync()` | `LightInit()` → `files.InitFileHandler` → **`migration.Migrate(nil)`** → `InitEngines()` → `license.Init()` → `audit.Init()` if enabled → `mail.StartMailDaemon()` → `ldap.InitializeLDAPConnection()` → `openid.GetAllProviders()` (fatal only on duplicate issuer) → `i18n.Init()` → `plugins.Initialize()` | everything that needs data but no scheduled work: `dump`, `restore`, `healthcheck`, `repair *` |
| `FullInit()` | `FullInitWithoutAsync()` → `cron.Init()` + 14 `Register*Cron()` → `ws.InitHub()` → goroutine: `models.RegisterListeners()`, `migrationHandler.RegisterListeners()`, `ws.RegisterListeners()`, `events.InitEvents()`, then `events.Dispatch(&BootedEvent{})` | `web`, `user *` |

Migrations therefore run on every `web`, `user`, `dump`, `restore`, `healthcheck`, and `repair` invocation, not only on `migrate`. `healthcheck` against a DB that is down fails inside `Migrate` with a fatal before reaching `health.Check` (Unverified at runtime; follows from the order).

**`BootedEvent` caveat:** `events.InitEvents()` blocks in Watermill's `router.Run`, so the `Dispatch(&BootedEvent{})` written after it only executes when the router stops. `grep` finds no listener for `BootedEvent` outside `pkg/initialize/events.go`, so nothing currently depends on it.

```mermaid
sequenceDiagram
    participant M as main.go
    participant C as cobra
    participant I as initialize
    participant W as webCmd.Run
    M->>C: cmd.Execute()
    C->>C: OnInitialize: config.SetConfigFile(--config)
    C->>I: PreRun → FullInit()
    I->>I: LightInit, migrations, engines, mail, ldap, oidc, i18n, plugins, cron, ws
    I-->>I: go { register listeners; events.InitEvents() (blocks) }
    C->>W: Run
    W->>W: routes.NewEcho + RegisterRoutes; go server.ListenAndServe
    W->>W: <-SIGINT; server.Shutdown(10s); cron.Stop; license.Shutdown; plugins.Shutdown
```

## Web server details (`pkg/cmd/web.go`)

- `http.Server{Addr: service.interface, Handler: echo, ReadHeaderTimeout: 10s}`.
- **Unix socket:** when `service.unixsocket` is set, `setupUnixSocket` removes a stale socket file, applies `service.unixsocketmode` through `utils.Umask` (race-free vs `Chmod`; no-op on Windows), and `server.Serve(listener)`; `service.interface` is ignored.
- **AutoTLS:** `autotls.enabled` requires `service.publicurl` with a dotted hostname and `autotls.email`; certificates are cached in `<files.basepath>/.certs`; an extra `:http` server answers ACME challenges; `RenewBefore` from `autotls.renewbefore` (`720h`); warns when `service.interface` is not `:443`; unix socket is ignored with a warning.
- **Graceful shutdown:** `signal.Notify(quit, os.Interrupt)` only, then `server.Shutdown` with a 10 s context (fatal on failure), `cron.Stop()`, `license.Shutdown()`, `plugins.Shutdown()`. The mail daemon, event router, and websocket hub are not stopped explicitly. The `Dockerfile` sets no `STOPSIGNAL`, so `docker stop` sends SIGTERM, which this handler does not catch; Unverified: observed behaviour under Docker.

## Dump and restore (`pkg/modules/dump`)

Zip layout written by `Dump(filename)`:

| Entry | Content |
|---|---|
| `<config basename>` | the file `viper.ConfigFileUsed()` points at, if any (warning otherwise) |
| `.env` | every environment variable containing `VIKUNJA_`, one per line (only when non-empty) |
| `VERSION` | `version.Version` |
| `database/<table>.json` | `db.Dump()` output per registered table, including `migration` |
| `files/<id>` | every stored file from `files.Dump()` |

`Restore(filename, overrideConfig)` in order: open zip → interactive confirmation `Yes, I understand` → reject any entry with `utils.ContainsPathTraversal` (`pkg/utils/zip.go`) → classify entries → `checkVikunjaVersion` (dump and binary versions must be equal; `dev` vs `dev` allowed) → `restoreConfig` when `overrideConfig` (writes the config to the **current working directory** by basename, or prints the `.env` contents, and waits for Enter) → `initialize.LightInit()` + `InitEngines()` + `files.InitFileHandler` on the restored config → read `database/migration.json`, require at least two entries, pick the second-to-last id → `preValidateTableData` → `db.WipeEverything()` → `migration.MigrateTo(thatID)` → insert every table → `migration.Migrate(nil)` → `models.RebuildProjectAncestors` (the closure table is never backfilled by `initSchema`) → write files by id. `--preserve-config` skips the config step and warns that the current config must match the data. Size limits `maxConfigSize` and `maxDumpEntrySize` guard decompression bombs.

## Version stamping

`pkg/version/version.go` declares `var Version = "dev"` and copies it into `swagger.SwaggerInfo.Version`. `magefile.go` → `initVars` sets `Ldflags = -X "code.vikunja.io/api/pkg/version.Version=<VersionNumber>" -X "main.Tags=..."` where `setVersion` → `getRawVersionNumber` takes `RELEASE_VERSION`, else `DRONE_TAG`, else `DRONE_BRANCH` with `release/v` stripped, else `git describe --tags --always --abbrev=10` (with `-g` replaced by `-`). `mage build` always adds the `osusergo` tag to avoid glibc `getpwuid_r` crashes under systemd (#2170). A plain `go build` yields `dev`, which `restore` accepts only against a `dev` dump.

## Exit codes

| Path | Code |
|---|---|
| cobra returns an error (unknown command, missing required flag, bad arg count) | prints the error, `1` (`cmd.Execute`) |
| any `log.Fatal[f]` during init or a command (`Migrate` failure, missing config file, DB unreachable, user lookups) | `1` |
| `doctor` with failed checks | `1` (`0` when all pass) |
| `healthcheck` | `1` on error, explicit `0` on success |
| `dump`, `restore` failure | **`0`**: both call `log.Critical(err)`, which logs at Error and returns (`pkg/log/logging.go`) |
| `user create/reset-password` password mismatch at the prompt | `log.Critical("Passwords don't match!")` then continues with the first entry (`getPasswordFromFlagOrInput`) |
| `repair *` failure | `0`: errors are `log.Errorf` and `return` |
| `web` normal shutdown | `0`; `1` if `server.Shutdown` fails |

## Dependencies

- **Uses:** `spf13/cobra`, `golang.org/x/crypto/acme/autocert`, `golang.org/x/term` (password prompt), `olekukonko/tablewriter`, `hashicorp/go-version` (dump version compare), `pkg/initialize`, `pkg/routes`, `pkg/migration`, `pkg/models`, `pkg/user`, `pkg/files`, `pkg/mail`, `pkg/notifications`, `pkg/doctor`, `pkg/health`, `pkg/license`, `pkg/plugins`, `pkg/cron`.
- **Used by:** `main.go`; Docker `ENTRYPOINT ["/app/vikunja/vikunja"]`; CI `test-migration-smoke` (`vikunja migrate` on an upgraded DB); `mage test:e2e` and veans e2e start `web`.

## Invariants and assumptions

- `--config` is honoured only because it is applied in `cobra.OnInitialize`; a `PersistentPreRun` on root would be shadowed by subcommand `PreRun`s (`cmd.go` comment). Any new command must define `PreRun` with an init level and must not add a root `PersistentPreRun`.
- `initialize.FullInit` must be called at most once per process; `x` in `pkg/db` is a singleton and `events.InitEvents` starts a blocking router.
- `restore` runs `LightInit` a second time after replacing the config; `viper` state is re-read, but the logger and Redis are re-initialised too. Do not add one-shot side effects to `LightInit`.
- `migrate` deliberately skips `InitEngines` and `Migrate` in `PreRun`; `initMigration(nil)` creates its own engine. Changing it to `FullInitWithoutAsync` would run migrations twice.
- `dump` must include `database/migration.json`, otherwise `restore` refuses ("does not contain database migration information").

## Configuration

Keys read directly by commands: `service.interface`, `service.unixsocket[mode]`, `service.publicurl`, `service.rootpath` (dump default path), `autotls.enabled/email/renewbefore`, `files.basepath` (cert cache), `mailer.fromemail` (testmail), `redis.enabled` (healthcheck). Everything else flows through the init levels ([config-and-logging](./config-and-logging.md)).

## Error handling

Init failures are fatal (`log.Fatalf` → exit 1) with the message naming the subsystem (`Could not init file handler`, `Migration failed`, `OpenID Connect configuration error`). Server listen errors are logged (`Server error`) but the process stays alive waiting for SIGINT (Unverified: intended). `doctor` never fatals; it reports per check. `restore` validates the archive before wiping so a malformed dump leaves the DB intact.

## Tests

- `pkg/modules/dump/restore_test.go` (158 lines) covers restore helpers (`parseDbFileName`, value conversion); `pkg/db/dump_test.go` covers `Restore` conversions. Run `mage test:filter TestRestore`.
- `pkg/doctor/*_test.go` for database, files, output formatting.
- No tests for `pkg/cmd` itself or `pkg/initialize`; command behaviour is exercised indirectly by CI (`test-migration-smoke` runs `migrate`; `test-frontend-e2e-playwright` and `test-veans-e2e` run `web`).

## Gotchas and tech debt

- `pkg/cmd/migrate.go:33` `// TODO: add args to run migrations up or down, until a certain point etc` (a `MigrateTo` already exists in `pkg/migration` but is unexposed).
- The `03-backend-architecture` page lists `migrate` and `user` under `FullInitWithoutAsync`; the code uses `LightInit` for `migrate` and `FullInit` for every `user` subcommand.
- `dump`'s filename uses `time.Now().Format("2006-01-02_15-03-05")`: `03` is the 12-hour clock in Go layouts, so the "minutes" field is actually the hour again; the help text promises `HH-II-SS`.
- `restore` writes the restored config into the process cwd, not next to the pinned `--config` file, and then re-runs `LightInit`, which searches the cwd last; with `--config` pointing elsewhere the restored file may be ignored. Unverified at runtime.
- `healthcheck` needs a full DB init including migrations, so it is heavier than the HTTP `/health` route and can mutate the schema.
- `user set-admin` is gated by the admin-panel license feature; see [License system](../../../docs/license.md) before changing.
- `repair` subcommands open a single `db.NewSession()` for the whole run; a large instance holds one transaction for the duration.

## Related pages

- [db-and-migrations](./db-and-migrations.md), [config-and-logging](./config-and-logging.md), [operations-subsystems](./operations-subsystems.md) (doctor, health, license), [cron-and-background-jobs](./cron-and-background-jobs.md) (what `FullInit` schedules), [events-and-listeners](./events-and-listeners.md) (router start), [files-and-storage](./files-and-storage.md) (`files.Dump`, MIME repair), [user-package](./user-package.md), [plugins](./plugins.md)
- [03 Backend architecture](../../03-backend-architecture.md#startup), [07 Development workflow](../../07-development-workflow.md#build-and-run-the-backend), [build-and-release](../build-and-release.md) (ldflags, Docker), [12 Debugging](../../12-debugging.md)
