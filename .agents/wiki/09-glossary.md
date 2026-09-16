# Core concepts and glossary

Terms that mean something specific in this codebase, plus the naming conventions you will meet in file and symbol names.

## Domain terms

| Term | Meaning here | Defined in |
|---|---|---|
| **Project** | Container for tasks; can nest via `parent_project_id`; owns views, shares, webhooks, background. Older code and the `/lists` redirect still say "list" | `pkg/models/project.go` |
| **Namespace** | Removed concept (projects used to live in namespaces). Survives as `SubscriptionEntityType` value 1 and old fixture names | `pkg/models/subscription.go` |
| **Pseudo project** | A negative project id: `-1` is Favorites, `-(n+1)` is saved filter `n`. Never a row in `projects` | `pkg/models/project.go` → `IsPseudoProjectID`, `saved_filters.go` |
| **Project view** | A way of looking at a project's tasks: `list`, `gantt`, `table`, `kanban`; each has its own filter, position ordering, and (for kanban) buckets | `pkg/models/project_view.go` |
| **Bucket** | Kanban column belonging to one view; has an optional WIP `limit`; a view may mark one bucket as `done_bucket_id` and one as `default_bucket_id` | `pkg/models/kanban.go` |
| **Bucket configuration mode** | How a kanban view assigns tasks to buckets: `none`, `manual` (drag and drop, `task_buckets` rows), `filter` (each bucket is a filter) | `pkg/models/project_view.go` |
| **Position** | Float ordering value per `(task, view)` in `task_positions`; recalculated when precision runs out | `pkg/models/task_position.go` |
| **Index / identifier** | `Task.index` is the per-project counter; `Project.identifier` is the prefix; together `PROJ-12`. Empty identifier renders `#12` | `pkg/models/task_index.go` |
| **Saved filter** | A stored `TaskCollection` query that behaves like a read-only project (pseudo id) | `pkg/models/saved_filters.go` |
| **Filter (query)** | The text DSL `done = false && due_date < now+7d`, parsed by fexpr after textual preprocessing; supports datemath | `pkg/models/task_collection_filter.go`, `frontend/src/helpers/filters.ts` |
| **Datemath** | Relative date expressions like `now/d`, `now+1w`, from `go-datemath`; used in filters and reminders UI | `pkg/models/task_collection_filter.go` → `safeDatemathParse`, `frontend/src/helpers/time/dateMath.ts` |
| **Task collection** | The request DTO for listing tasks: `filter`, `sort_by`, `order_by`, `expand`, `filter_timezone`, `s`/`q` search | `pkg/models/task_collection.go` |
| **Expand** | Query parameter asking for extra relations on tasks (`buckets`, `comments`, `reactions`, `is_unread`, `subscription`) | `pkg/models/task_collection.go` → `TaskCollectionExpandable` |
| **Quick add magic** | Prefix syntax in the task title input: `*label`, `+project`, `!priority`, dates in words; Vikunja and Todoist prefix modes | `frontend/src/modules/quickAddMagic/` |
| **Reminder** | Absolute time or relative (`relative_period` seconds from `due_date`/`start_date`/`end_date`); fired by a per-minute cron | `pkg/models/task_reminder.go` |
| **Repeat mode** | `default` (shift by `repeat_after` seconds), `month`, `from_current_date`; applied when a repeating task is marked done | `pkg/models/tasks.go` |
| **Relation** | Directed link between two tasks (`subtask`, `blocking`, `precedes`, ...); creating one inserts the inverse | `pkg/models/task_relation.go` |
| **Link share** | Public access to one project via a hash URL, optionally password protected; authenticates as a JWT of type 2 | `pkg/models/link_sharing.go` |
| **Team** | Group of users with admins; can be synced from OIDC groups or LDAP | `pkg/models/teams.go`, `team_sync.go` |
| **Permission** | `read` 0, `write` 1, `admin` 2 (`-1` unknown). Max permission for the caller is returned by `CanRead` and exposed to the UI | `pkg/models/permissions.go` |
| **Subscription** | Opt-in to notifications for a project or task; inherited down the tree; `muted` opts out | `pkg/models/subscription.go` |
| **Favorite** | Per-user star on a task or project; feeds the Favorites pseudo project | `pkg/models/favorites.go` |
| **Notification** | Two channels: database rows shown in the bell menu and mails; each type implements `ToMail`/`ToDB` | `pkg/notifications/`, `pkg/models/notifications.go` |
| **Webhook** | Per-project outbound HTTP POST on selected events, with optional HMAC secret | `pkg/models/webhooks.go` |
| **API token** | `tk_...` bearer token with `(group, permission)` scopes derived from route paths; may belong to a bot | `pkg/models/api_tokens.go`, `api_routes.go` |
| **Bot user** | A user with `bot_owner_id`, username starting `bot-`, no password; the owner mints its tokens. Used by veans | `pkg/models/bot_users.go`, `pkg/user/` |
| **Session** | Refresh-token record behind a JWT (`sid` claim); listed and revocable in settings | `pkg/models/sessions.go` |
| **Testing token** | `service.testingtoken`; enables `PATCH /api/v1/test/:table` and `DELETE /api/v2/test/all` for seeding in e2e and veans tests | `pkg/routes/api/v1/testing.go` |
| **Pro feature** | License-gated capability: `admin_panel`, `time_tracking`, `audit_logs`, `user_invites`; gated routes return 404 | `pkg/license/`, `pkg/routes/feature_gate.go` |
| **Invite link** | Admin-created, hashed token for self-registration into teams (pro) | `pkg/models/user_invite_link.go` |
| **Migration (two meanings)** | (1) DB schema migration in `pkg/migration/`; (2) data import from another tool in `pkg/modules/migration/` ("migrator", "importer"). Frontend routes call the second `migrate.*` | |
| **Importer / migrator** | A `Migrator` (OAuth-style) or `FileMigrator` (upload) implementation per source | `pkg/modules/migration/migrator.go` |
| **Background (project)** | Project cover image from upload or Unsplash, with a blurhash placeholder | `pkg/modules/background/` |
| **Avatar provider** | `initials`, `gravatar`, `upload`, `marble`, `ldap`, `openid`, `empty` | `pkg/modules/avatar/` |
| **Rich text** | Task descriptions and comments are stored as TipTap HTML; v2 can convert to and from Markdown | `pkg/richtext/`, `frontend/src/components/input/editor/` |
| **Mention** | `@username` in rich text, resolved to a mention node and a notification | `pkg/models/mentions.go`, `pkg/richtext/mentions_html.go` |
| **Reaction** | Emoji on a task or comment | `pkg/models/reaction.go` |
| **Time entry** | Start/end record on a task (pro); running timers are pushed over websocket | `pkg/models/time_tracking.go` |
| **Doer** | The user who caused an event; carried on every event struct | `pkg/models/events.go` |
| **Poison queue** | Watermill topic receiving messages that failed all retries; only logged and reported to Sentry | `pkg/events/events.go` |
| **Webtest** | HTTP-level integration test in `pkg/webtests` using a real Echo instance and fixtures | `pkg/webtests/integrations.go` |
| **Fixture** | YAML rows in `pkg/db/fixtures/` loaded by go-testfixtures; e2e tests seed through the testing endpoint instead | `pkg/db/test_fixtures.go` |
| **Factory (e2e)** | `Factory.create(n, override)` in `frontend/tests/factories/` seeding rows through the API | `frontend/tests/support/factory.ts` |
| **AutoPatch** | Huma feature that synthesizes `PATCH` (JSON merge patch) for every GET+PUT pair on v2 | `pkg/routes/api/v2/registry.go` |
| **MCP** | Model Context Protocol server exposing allow-listed v2 operations as tools for AI clients | `pkg/modules/mcp/` |
| **veans** | The agent-facing CLI; "beans" for Vikunja | `veans/` |
| **Plugin** | Native `.so` or yaegi-interpreted Go code loaded at startup; can add migrations and routes | `pkg/plugins/` |
| **ParadeDB** | PostgreSQL extension (`pg_search`) used for BM25 task search when present | `pkg/db/db.go` |

## Naming conventions

| Pattern | Meaning | Example |
|---|---|---|
| `CanRead/CanCreate/CanUpdate/CanDelete` | Permission methods on a model; `CanRead` also returns max permission | `pkg/models/label_permissions.go` |
| `Create/ReadOne/ReadAll/Update/Delete(s, auth)` | `web.CRUDable` methods; never commit | `pkg/models/label.go` |
| `DoCreate/DoReadOne/...` | Framework-agnostic pipeline wrapping the two above | `pkg/web/handler/core.go` |
| `*Web` (`CreateWeb`) | Echo handler methods on `WebHandler` (v1) | `pkg/web/handler/create.go` |
| `Register<Resource>Routes` + `init()` | v2 resource registration | `pkg/routes/api/v2/labels.go` |
| `<resource>-<verb>` operation id | v2 operation ids; become `resourceVerb()` functions in the generated client and `resource_verb` MCP tools | `labels-list` |
| `Err<Name>`, `IsErr<Name>`, `ErrCode<Name>` | Domain error triple | `pkg/models/error.go` |
| `<Entity><Action>Event` | Watermill event structs with `Name()` topic | `TaskCreatedEvent` |
| `<Purpose>Listener` / `Send<X>Notification` | Event listener types | `pkg/models/listeners.go` |
| `Register<Job>Cron` | Cron registration functions called from `FullInit` | `pkg/models/task_reminder.go` |
| `<Name>Notification` | Notification type with `ToMail`/`ToDB` | `pkg/models/notifications.go` |
| `<timestamp>.go` and `<name><timestamp>` structs | Migrations and their local table structs | `pkg/migration/20260914185746.go` |
| `*_permissions.go`, `*_test.go`, `huma_*_test.go` | Permission methods, model tests, v2 webtests | |
| `use<Thing>` | Vue composables | `frontend/src/composables/` |
| `<thing>Keys`, `<things>Query()`, `create<Thing>MutationOptions()`, `useCreate<Thing>Mutation()` | TanStack Query module members | `frontend/src/client/queries/labels.ts` |
| `<Thing>Service`, `<Thing>Model`, `I<Thing>` | Legacy service, model class, interface | `frontend/src/services/`, `models/`, `modelTypes/` |
| `<Thing>Factory` | Playwright seed factories | `frontend/tests/factories/` |
| `*.spec.ts` under `tests/e2e`, `*.test.ts` under `src` | Playwright vs Vitest | |
| `VIKUNJA_<SECTION>_<KEY>` | Env override of config key `section.key` | `VIKUNJA_SERVICE_PUBLICURL` |
| `tk_` prefix | API tokens | `pkg/models/api_tokens.go` |
| `data-cy` | Test id attribute (from the former Cypress suite) | `frontend/src/directives/testid.ts` |
| `Frederick [Bot]` | CI's committer for generated swagger, yaegi symbols, and translations | `.github/workflows/release.yml`, `crowdin.yml` |
