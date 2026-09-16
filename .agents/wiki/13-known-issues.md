# Known issues, fragile areas, and tech debt

What to be careful with, why, and what to check before touching it. Sources: git history (15,607 commits, analyzed 2026-09-16), TODO/FIXME comments, test coverage gaps, and code reading during the wiki build. Items marked "Unverified:" are inferences.

## Hotspots by fix-commit density

Files most often touched by `fix` commits (last 3000 matching commits, generated files and lockfiles excluded). Size and bug density coincide.

| Touches | File | Why it is fragile | Check before touching |
|---|---|---|---|
| 77 | `pkg/models/tasks.go` (2,369 lines) | `Update` decides which columns to write, handles project moves, done/repeat date shifting, bucket routing, and mergo zero-value resets in one function | `tasks_test.go` (1,676 lines); run `mage test:filter TestTask`; read [models-tasks](components/backend/models-tasks.md) |
| 58 | `pkg/models/project.go` (1,600) | Parent/child normalization, archiving, favorites pseudo project, views created on create | `mage test:filter TestProject`; ancestor rows |
| 51 | `frontend/src/components/project/views/ProjectKanban.vue` (1,141) | Drag and drop, two sequential writes (position then bucket), done-bucket coupling, per-bucket pagination | e2e `frontend/tests/e2e/project/*kanban*`; `stores/kanban.test.ts` |
| 48 | `pkg/models/listeners.go` (1,801) | 24 listeners with side effects across mail, DB, webhooks, audit | Listener tests; `events.Fake()` |
| 45 | `frontend/src/views/tasks/TaskDetailView.vue` (1,534) | Every task attribute's save path in one component | e2e `frontend/tests/e2e/task/*.spec.ts` (18 files) |
| 44 | `frontend/src/components/input/editor/TipTap.vue` (1,140) | Content lifecycle, paste handling, drafts, image uploads | 12 editor unit tests, e2e `editor/*.spec.ts` |
| 40 | `pkg/models/task_search.go` | Filter → SQL translation, sub-table filters, ParadeDB branch | `task_collection_test.go` (2,561 lines) |
| 29 | `pkg/models/task_position.go` (1,049) | Float positions, lock ordering, conflict repair, three repair paths and two CLI commands | Position tests; `vikunja repair task-positions` |
| 29 + 27 | `pkg/models/task_collection.go`, `task_collection_filter.go` | Textual filter preprocessing before parsing; complexity cap for GHSA-xxc3-xpmc-vmvr | Same tests; both sides of the DSL |
| 28 | `pkg/models/project_view.go` | Enum marshalling, bucket configuration modes, default views | `project_view_test.go` |
| 27 | `pkg/modules/migration/create_from_structure.go` | Shared write path for every importer | Importer tests with fixture files |
| 27 | `pkg/models/saved_filters.go` | Pseudo project arithmetic, three sync mechanisms (on-read, listener, cron) | `mage test:filter TestSavedFilter` |
| 27 | `frontend/src/stores/auth.ts` | Debounced `checkAuth`, id+type identity comparison, refresh coordination | `stores/auth.*.test.ts` |
| 26 | `frontend/src/components/input/filter/FilterInput.vue` (historically under `project/partials/`) | Autocomplete over the DSL | `helpers/filters.test.ts` |
| 23 | `pkg/routes/caldav/listStorageProvider.go` (1,204) | Over-fetching, client quirks; two FIXMEs | `mage test:caldav` |
| 21 | `pkg/modules/dump/restore.go`, `pkg/modules/auth/openid/openid.go` | Restore ordering; provider edge cases | |

## TODO, FIXME, HACK comments

Backend: 12 real markers in `pkg/` (a naive grep shows hundreds because of the CalDAV `VTODO` vocabulary).

| Location | Note |
|---|---|
| `pkg/routes/caldav/listStorageProvider.go:537` | FIXME: should get the project with no tasks |
| `pkg/routes/caldav/listStorageProvider.go:932` | FIXME: fetch only required attributes |
| `pkg/modules/background/handler/background.go:427` | FIXME: "should use an event once we have events" (stale; events exist) |
| `pkg/modules/migration/todoist/todoist.go:496` | FIXME: should be comments |
| `pkg/cmd/migrate.go:33` | TODO: args to run migrations up or down |
| `pkg/models/subscription_test.go:194, :317`, `pkg/models/task_collection_test.go:1660` | TODOs in tests (parent project filter) |

Frontend: about 50 markers in `frontend/src`. Highest signal:

| Location | Note |
|---|---|
| `frontend/src/stores/projects.ts:137` | FIXME: should be a watcher, but watchers "sometimes crash browser processes" |
| `frontend/src/stores/tasks.ts:147` | TODO: task map shape unsettled |
| `frontend/src/components/home/ContentAuth.vue:118, :141` | FIXME: title handling "really error prone" |
| `frontend/src/components/sharing/UserTeam.vue:194` | FIXME: over-generalized share manager |
| `frontend/src/views/tasks/ShowTasks.vue:250, :295` | FIXME HACK; store mutation in a view |
| `frontend/src/views/project/helpers/useGanttTaskList.ts:24`, `useGanttFilters.ts:43, :58` | FIXME: unify with `useTaskList`; use zod |
| `frontend/src/components/project/views/ProjectKanban.vue:778, :1125` | TODO fix type; FIXME "does not seem to work" |
| `frontend/src/router/index.ts:90, :214` | FIXME: eager imports of `Register.vue`, `LinkSharingAuth.vue` |
| `frontend/src/views/Home.vue:99` | FIXME: should use pinia |
| `frontend/src/components/tasks/partials/SingleTaskInProject.vue:303`, `ProjectTable.vue:477` | TODO: re-enable opening task detail in a modal (same regression, two places) |
| `frontend/src/views/sharing/LinkSharingAuth.vue:151` | TODO: global auth error handler |
| `frontend/src/modelTypes/{IProject,ILinkShare,ISubscription,IAbstract,ISavedFilter}.ts` | FIXME: weak types |
| `frontend/src/services/attachment.ts:70` | TODO: file size validation |
| `frontend/src/components/quick-actions/QuickActions.vue:281` | FIXME: use fuzzy search |

## Untested or thinly tested

| Area | State |
|---|---|
| `pkg/routes/api/v1` (24 files), `pkg/web/handler` (8), `pkg/routes/api/shared` (5) | No unit tests; only indirect coverage through `pkg/webtests` |
| `pkg/cmd` (15 files), `pkg/cron`, `pkg/initialize`, `pkg/plugins`, `pkg/health`, `pkg/red`, `pkg/i18n`, `pkg/version` | No tests |
| `pkg/modules/background/{handler,unsplash,upload}`, `pkg/modules/avatar/{marble,botmarble,empty,ldap,openid}`, `pkg/modules/keyvalue/*` | No tests |
| `pkg/models/team_sync.go` | No dedicated test file |
| `frontend/src/modelTypes` (42 files), `views/{admin,migrate,filters,teams,labels,sharing}`, `components/base`, `components/sharing`, `components/time-tracking`, `directives`, `constants`, `types` | No unit tests; e2e covers some flows (11 view test files exist elsewhere under `views/`) |
| `pnpm typecheck` | 1,535 errors on `main`; `continue-on-error` in CI |
| Swagger v1 drift, yaegi symbols | Not checked on PRs; regenerated after merge |

## Knowledge duplicated by hand across sides

| Concept | Go | TypeScript | Drift found |
|---|---|---|---|
| Error codes | 162 `ErrCode*` constants | 107 numeric keys under `error` in `en.json` | **56 codes have no frontend string** (e.g. 11 invalid token, 1026, 1030, 1031, 2004, 3010, 3014, 4024, plus `ErrorCodeGenericForbidden`, whose Go literal `0001` is the number 1 while the JSON key is the string `"0001"`, so it never matches). The `handler.ErrReadForbidden` 403 carries no code at all (`code: 0`). `mage check:translations` whitelists the dynamic `error.` prefix, so CI cannot see this |
| Relation kinds | 12 values incl. `duplicateof` | 10 values, `PROCEDES` typo | `duplicateof` unreachable from the UI |
| Priorities | none (bare `int64`; CalDAV maps 0–9 in `pkg/caldav/priority.go`) | `PRIORITIES` 0–5 | Ladder exists only in TS |
| Repeat modes, view kinds, bucket modes, permissions, auth types, pro features, reminder anchors | `iota` enums | hand-written objects | In sync today; no generator |
| Filter DSL | `task_collection_filter.go` | `helpers/filters.ts`, `FilterAutocomplete.ts` | `subTableFilters` lists `label_id`, `parent_project`, `parent_project_id` that `validateTaskField` never accepts (dead) |
| Locales | `pkg/i18n/i18n.go` `availableLanguages` | `SUPPORTED_LOCALES`, `useDayjsLanguageSync.ts` | `fa-IR` is selectable in the frontend but missing from the Go allowlist; six frontend JSON files (`ca-ES`, `eo-UY`, `ro-RO`, `sk-SK`, `sr-CS`, `th-TH`) exist but are not selectable |
| Migrator ids | importer `Name()` | `views/migrate/migrators.ts` | |
| WebSocket events | `validEvents` | string literals | |
| Token refresh logic | | `helpers/fetcher.ts` and `client/http.ts` | Two implementations of the same 401/code-11 retry |
| Wire types for veans | `pkg/models` | `veans/internal/client/types.go` | Manual mirror |

## Unusually complex or risky functions

- `pkg/models/tasks.go` → `Update`: column whitelist, project move with index aliasing, repeat handling, bucket routing, `mergo` resets. Every hop has bitten before.
- `pkg/models/task_position.go` → `RecalculateTaskPositions`, `RepairTaskPositions`, `DeleteOrphanedTaskPositions`, deterministic lock ordering (`viewLockOrder`) to avoid deadlocks.
- `pkg/models/task_collection_filter.go` → `preprocessFilterString`, `replaceFilterOperators`, `quotedRunEnd` re-implement fexpr quoting; `validateFilterComplexity` is the guard for GHSA-xxc3-xpmc-vmvr. The most security-sensitive string handling in the repo.
- `pkg/routes/rate_limit.go` → `basicAuthRateLimitWithClock`: reserve-then-refund with window-stamped keys (GHSA-m469-88xx-8rx2).
- `pkg/routes/api/v2/errors.go` → `init()` monkey-patches `huma.NewError` globally; removing it leaks driver errors on 5xx.
- `pkg/routes/api/v2/huma.go`: `Servers[0]` must stay relative or `$schema` links double-prefix.
- `pkg/models/api_routes.go` → `shouldSkipRouteCheck`: lets AutoPatch's internal GET inherit PATCH authorization; security-adjacent.
- `frontend/src/stores/auth.ts` → `checkAuth`: once-a-minute debounce and the id+type comparison that fixed a redirect loop.
- `frontend/src/helpers/auth.ts` → `refreshToken`: Web Locks, coalescing, `authEpoch`.
- `frontend/src/components/project/views/ProjectKanban.vue` → `updateTaskPosition`: two non-atomic writes.

## Architectural debt

- **In-process, non-durable event bus** (`pkg/events`): restarts lose in-flight webhooks, notifications, imports; no cross-instance delivery; poison queue is log-only. `BootedEvent` is dispatched after the blocking router start and has no listener.
- **Two frontend API layers**: 120 files on legacy services vs 23 on the generated client; only labels are on TanStack Query.
- **Two API versions** with different validation status codes (412 vs 422) and different verb semantics.
- **`pkg/cron`** has no error plumbing, naming, overlap protection, or metrics; `log.Errorf` in a cron job never reaches Sentry.
- **Migrations**: `modifyColumn` is a no-op on SQLite; `IsUniqueConstraintError`'s SQLite branch matches any message containing `task_buckets`. (`renameTable`'s backtick quoting is safe: xorm rewrites quotes per dialect on raw `Exec`, and migration `20221113170740` exercises it on all three databases.)
- **`pkg/models/error.go`** is a 2,886-line flat list; codes are chosen by hand.
- **Refresh cookies per API version** and JWT invalidation on secret regeneration are easy to trip over in deployments.

## Smaller defects and oddities found while reading

| Where | What |
|---|---|
| `pkg/routes/api/v1/avatar.go:43` | Swagger `@Router /{username}/avatar [get]` but the route is `GET /avatar/:username` |
| `pkg/models/label.go:99` | `Label.Update` annotated `@Router /labels/{id} [put]` but v1 registers `POST /labels/:label` |
| `pkg/models/task_relation.go:213` | `ErrRelationAlreadyExists` check ORs two identical conditions; only the forward direction is checked (Unverified whether a constraint catches the inverse) |
| `pkg/models/error.go` | `ErrOnlyOneDoneBucketPerProject` (10005) and `ErrTaskAlreadyExistsInBucket` (10006) are defined but never constructed |
| `pkg/models/task_overdue_reminder.go` | Doc comment says "once a day"; schedule is `* * * * *` (daily behavior comes from the per-user window) |
| `pkg/models/events.go` → `TaskPositionsRecalculatedEvent` | Dispatched, no listener |
| `pkg/cmd/dump.go` | Filename layout `2006-01-02_15-03-05` uses `03` (12-hour) where minutes were intended; `log.Critical` does not exit, so failures exit 0 |
| `pkg/cmd/user.go` → `getPasswordFromFlagOrInput` | "Passwords don't match!" is logged and the first entry is used anyway |
| `pkg/cmd/web.go` | Catches only `os.Interrupt`; `Dockerfile` has no `STOPSIGNAL` (Unverified: SIGTERM handling) |
| `pkg/migration/migration.go` → `initMigration` | Builds its xorm logger from `log.events*`, not `log.database*` |
| `pkg/websocket/messages.go` | `forbidden` error and `ActionUnsubscribed` constants are never emitted |
| `pkg/modules/auth/auth.go` → `ValidateAPITokenString` | Comment says it is shared with WebSocket auth; `pkg/websocket/connection.go` → `handleAuth` only accepts JWTs, so API tokens cannot open a socket |
| `pkg/routes/routes.go` → `setupSentry` | `sentry.Flush` is deferred inside the setup function, so nothing flushes Sentry at shutdown |
| `pkg/web/handler/read_all.go` | `service.maxitemsperpage` clamp applies to v1 only; v2 caps `per_page` at 1000 in `ListParams` |
| `frontend/src/stores/viewFilters.ts` | The only store without the `acceptHMRUpdate` block |
| `frontend/src/stores/tasks.ts` → `addTaskAttachment` | No callers outside the store |
| `pkg/config/config.go` → `files.s3.tempdir` | Declared with a default, absent from `config-raw.json`, never read by any code |
| `frontend/src/views/migrate/migrators.ts` | Still lists `wunderlist`; no backend importer provides it (filtered out by `/info`) |
| `pkg/plugins/registry.go` | `Registry`/`NewRegistry` have no callers; `Manager` keeps its own slices |
| `pkg/files/files.go` → `File.Delete`, `Dump` | Delete swallows `*os.PathError` from blob removal; Dump skips rows without blobs, both can hide orphaned files |
| `Dockerfile` | No `HEALTHCHECK` even though `vikunja healthcheck` exists |
| `SavedFilter.Delete`, `ProjectView.Delete` | Do not remove dependent `buckets` (views) or the saved filter's views/positions (Unverified: whether anything else cleans them) |
| `Project.Update` | Cannot clear `description` (only written when non-empty) |
| `TeamMember.Update` | Toggles `admin` instead of setting it |
| `Webhook.Update` | Only writes `events` |
| `LinkSharing.ReadAll` | Counts on `hash LIKE` while searching `name` |
| `pkg/db/fixtures/team_projects.yml` | Comment says read-only for team 8 on project 19, row has `permission: 2` |
| `frontend/src/components/input/editor/suggestion.ts` | The "Heading 3" slash command calls `setNode('heading', {level: 2})` |
| `frontend/src/helpers/filters.ts` → `transformFilterStringFromApi` | Whole-string `replaceAll` of snake_case field names can rewrite text inside quoted values |
| `frontend/src/views/user/settings/General.vue` | Two `authStore.settings` watchers that can never re-run |
| `frontend/src/modules/quickAddMagic/dateParser.ts` | Ignores the `now` argument for `next month` / `end of month` |
| `frontend/src/modelSchema/common/repeats.ts` | Dead: imports `zod` (not a dependency), unused constants, nothing imports it |
| `frontend/vite.config.ts` | PWA `shortcuts` point at `/namespaces`, `/tasks/by/week`, `/tasks/by/month` (no such routes); top-level `output.manualChunks` is outside `build.rollupOptions` (Unverified: inert) |
| `frontend/src/sw.ts` | NetworkOnly rule matches `/api/v1/` only; v2 requests fall through |
| `frontend/src/styles/tailwind.css` | Tailwind v4 is wired (with a `tw-` prefix) but no component uses a `tw-` class; `tsconfig.app.json` lists a nonexistent `tailwind.config.js` |
| `frontend/src/styles/custom-properties/shadows.scss` | Dark-mode block lacks the `@media screen` guard that `colors.scss` uses, so dark shadows may print (Unverified) |
| `frontend/src/styles/README.md` | Presents `tw-` utilities as in use |
| `frontend/src/histoire.setup.ts:13` | Imports `@/components/input/button.vue` (lowercase) while the file is `Button.vue`; breaks on case-sensitive filesystems |
| `frontend/src/router/index.ts` | `filter.settings.edit`/`.delete` reuse the paths of `project.settings.edit`/`.delete`; `scrollBehavior` returns `inset-inline-start`/`inset-block-start` keys (Unverified: honored by vue-router) |
| `frontend/src/helpers/checkAndSetApiUrl.ts` | Two consecutive `+ /api/v1` probe steps whose comments claim http vs https but neither changes the scheme |
| `frontend/tests/support/seed.ts` vs `factory.ts` | Two seeding helpers reading different env var names (`TEST_SECRET` vs `VIKUNJA_SERVICE_TESTINGTOKEN`) |
| `frontend/docs/models-services.md` | Describes `defaults()` and `/namespaces` paths that no longer exist |
| `desktop/package.json` | `version: v0.1.0`; overwritten at build time, never bumped by `dev:tag-release`; `unzipper` devDependency unused (Unverified) |
| `desktop/README.md` | Manual steps diverge from `build.js` |
| `desktop/oauth.js` | Custom-scheme redirect only; token exchange at `/api/v1/oauth/token` while veans uses v2 |
| `veans/README.md` | Says credentials honor `XDG_CONFIG_HOME` (code deliberately does not), tokens minted with `PUT /tokens` (code uses `POST`), references a nonexistent `veans-e2e.yml` workflow and unused `VEANS_E2E_ADMIN_USER/PASS` vars |
| `.github/workflows/release.yml` | `publish-repos` lists `release:repo-apk`, which does not exist in `build/magefile.go` (apk uses a shell step); comment says `build-mage` lives in `test.yml` |
| `Dockerfile` | Installs `mage@latest` while everything else pins 1.17.2; `swag` unpinned in the swagger job |
| Packaging | CI generates the sample with `generate:config-yaml 1` (fully commented), so `build/after-install.sh`'s placeholder seds hit commented lines (Unverified: whether that is intended) |
| `.gitignore` | Stale `docs/` entries for a directory that no longer exists |
| `.claude/settings.json` | Allowlists `go test`, `pnpm test:e2e`, and `mage test` (no such root alias), contradicting the docs |

## Documentation drift corrected or flagged during the wiki build

Fixed in this branch (see git log for `.agents/docs` and `.agents/skills`): the "plain `go test` does not work" wording, the `api-v2-routes` skill's stale `mage test:filter` caveat, the `migration` skill telling you to extend `modelTypes`, the `run-e2e-tests` skill missing `VIKUNJA_E2E_API_PORT`, `dev-commands.md` missing the generation targets and the gitignored sample, `git-workflow.md` not saying `prepare-worktree` moves the plan, and `sentry-triage` depending on tooling outside the repo.

Still to decide by a maintainer: `pkg/web/readme.md` reads as a standalone library README with an LGPL badge; `frontend/docs/models-services.md` has no legacy warning; `.claude/settings.json` allowlist. `CLAUDE.md` was a git symlink to `AGENTS.md` and is now a one-line `@AGENTS.md` include, so the two cannot drift.

## Could not determine

- Whether any production deployment runs more than one API instance (which would make the in-process event bus a correctness problem rather than a durability one).
- Whether vue-router honors the logical-property keys returned by `scrollBehavior`.
- Whether the top-level `output.manualChunks` in `vite.config.ts` has any effect.
- Whether `ErrRelationAlreadyExists`'s one-directional check is covered by a DB constraint.
- Which of the 56 untranslated error codes users actually see (depends on which endpoints raise them through the UI).
- How CI's fully commented `config.yml.sample` interacts with `build/after-install.sh`.
