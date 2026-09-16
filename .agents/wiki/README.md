# Vikunja engineering wiki

Internal documentation for people and AI agents changing this repository. It answers three questions: **where do I look**, **what must I not break**, and **how do I do X here**. Every claim points at a file, type, or function; anything inferred rather than read is marked "Unverified:". Commands were run on 2026-09-16 on macOS unless a page says otherwise.

Rules of the road live in `AGENTS.md` and `.agents/docs/`; skills in `.agents/skills/` are step checklists. This wiki is the map underneath them.

## Start here

| I want to... | Read |
|---|---|
| Understand the system in ten minutes | [Overview](01-overview.md), then [Repository map](02-repository-map.md) |
| Add an API endpoint end to end | [playbooks/add-api-endpoint](playbooks/add-api-endpoint.md) |
| Add or change a database migration | [playbooks/add-migration](playbooks/add-migration.md) |
| Build a new page or feature in the Vue app | [playbooks/build-vue-feature](playbooks/build-vue-feature.md) |
| Add or fix a background job, listener, or cron | [playbooks/background-job](playbooks/background-job.md) |
| Fix a bug (reproduce, locate by symptom, test first) | [playbooks/fix-a-bug](playbooks/fix-a-bug.md) |
| Set up, build, test, lint | [Development workflow](07-development-workflow.md) |
| Know what to change together (schema, model, client, i18n...) | [Conventions](08-conventions.md#if-you-change-x-you-must-also-change-y) |
| Decode an error or a weird failure | [Debugging](12-debugging.md) |
| Know where the bodies are buried | [Known issues](13-known-issues.md) |

## Foundation

| Page | Summary |
|---|---|
| [01 Overview](01-overview.md) | What Vikunja is, who consumes it, design constraints, tech stack for both halves, architecture diagram |
| [02 Repository map](02-repository-map.md) | Directory-by-directory guide, generated vs hand-written code, "when adding X put it in Y" |
| [03 Backend architecture](03-backend-architecture.md) | Package layering, startup, request pipeline, sessions, events, errors, config, logging, concurrency |
| [04 Frontend architecture](04-frontend-architecture.md) | Bootstrap, routing, stores, the two API layers, auth refresh, errors to toasts, styling, build |
| [05 API contract](05-api-contract.md) | v1 vs v2 wire formats, auth flow, error shapes, realtime channels, the sync checklist |
| [06 Data model](06-data-model.md) | ER diagram, entity reference with Go/table/frontend locations, enums duplicated across sides, lifecycles, invariants |
| [07 Development workflow](07-development-workflow.md) | Setup, config, build, run, every test and lint command with verified results, codegen, debugging, CI, releases |
| [08 Conventions](08-conventions.md) | Go and frontend style, patterns to copy and avoid, translations, the change-coupling table |
| [09 Glossary](09-glossary.md) | Domain terms and naming conventions |

## Cross-cutting

| Page | Summary |
|---|---|
| [10 Data flows](10-data-flows.md) | End-to-end traces with sequence diagrams: login, task creation, label mutation on the new stack, comment to notification, kanban move |
| [11 Testing guide](11-testing-guide.md) | Test organization on both sides, fixtures and factories, how to write each kind of test, coverage gaps, slow and flaky tests |
| [12 Debugging](12-debugging.md) | Error messages and causes, logs and flags, inspecting the DB and network, known failure modes |
| [13 Known issues](13-known-issues.md) | Git hotspots, TODOs, untested areas, duplicated knowledge, complex functions, stale docs, undetermined questions |

## Playbooks

| Page | Summary |
|---|---|
| [Add an API endpoint](playbooks/add-api-endpoint.md) | Model → `Can*` → v2 handler → webtests → regenerate client → query module → component → e2e |
| [Add or change a migration](playbooks/add-migration.md) | Scaffold, `partialSync`, model tags, fixtures, migration test, cross-DB checks, rollback reality |
| [Build a Vue feature](playbooks/build-vue-feature.md) | Route → view → components → query module or store → i18n → tests → lint |
| [Background job](playbooks/background-job.md) | Event listener vs cron, dispatch on commit, retries and the poison queue, idempotency, testing, observability |
| [Fix a bug](playbooks/fix-a-bug.md) | Reproduce locally, symptom → where-to-look tables, failing test first, verify the other side |

## Backend components

| Page | Scope |
|---|---|
| [http-routing-and-middleware](components/backend/http-routing-and-middleware.md) | `pkg/routes/routes.go`, middleware, rate limits, CORS, static files, error handler |
| [auth-and-sessions](components/backend/auth-and-sessions.md) | JWT, refresh sessions, API tokens, link shares, OIDC, LDAP, TOTP, OAuth2 server |
| [crud-framework](components/backend/crud-framework.md) | `pkg/web` interfaces and the `Do*` pipeline |
| [api-v1](components/backend/api-v1.md) | Frozen Echo routes and swaggo docs |
| [api-v2-huma](components/backend/api-v2-huma.md) | Huma setup, registry, AutoPatch, envelopes, error bridge, validation |
| [models-projects-and-permissions](components/backend/models-projects-and-permissions.md) | Projects, ancestors, shares, permission inheritance, duplication |
| [models-tasks](components/backend/models-tasks.md) | Tasks, done/repeat, reminders, assignees, relations, comments, attachments, positions, bulk ops |
| [models-filtering-and-search](components/backend/models-filtering-and-search.md) | Task collections, filter DSL, search, saved filters |
| [models-views-and-kanban](components/backend/models-views-and-kanban.md) | Project views, buckets, task-bucket membership |
| [models-sharing-teams-labels](components/backend/models-sharing-teams-labels.md) | Teams, link shares, labels, subscriptions, favorites, reactions, webhooks, invite links |
| [events-and-listeners](components/backend/events-and-listeners.md) | Event bus, event catalog, listeners, webhooks and audit registration |
| [notifications-and-mail](components/backend/notifications-and-mail.md) | Notification types, DB and mail channels, mail daemon |
| [cron-and-background-jobs](components/backend/cron-and-background-jobs.md) | Scheduler, the job list, background imports, retry and observability limits |
| [db-and-migrations](components/backend/db-and-migrations.md) | Engines, sessions, session cache, fixtures, dump/restore, migration mechanics |
| [config-and-logging](components/backend/config-and-logging.md) | Config keys and env mapping, loggers, Sentry fingerprints |
| [files-and-storage](components/backend/files-and-storage.md) | File storage backends, attachments, backgrounds, avatars, exports |
| [caldav](components/backend/caldav.md) | CalDAV format and HTTP layers, tokens, protocol tests |
| [importers](components/backend/importers.md) | Import framework and the per-source importers |
| [websocket](components/backend/websocket.md) | Hub, protocol, event bridges |
| [mcp](components/backend/mcp.md) | MCP server, exposure allow-list, catalog tools |
| [plugins](components/backend/plugins.md) | Native and yaegi plugins, symbol tables |
| [user-package](components/backend/user-package.md) | `pkg/user`: users, tokens, TOTP, bots, deletion |
| [operations-subsystems](components/backend/operations-subsystems.md) | License, audit, metrics, health, doctor, Redis, keyvalue, richtext, i18n |
| [cli-commands](components/backend/cli-commands.md) | Cobra commands, startup levels, dump/restore, repair |

## Frontend components

| Page | Scope |
|---|---|
| [bootstrap-and-routing](components/frontend/bootstrap-and-routing.md) | `main.ts`, `App.vue`, router and guards, readiness |
| [auth-and-session](components/frontend/auth-and-session.md) | Auth store, token storage and refresh, API URL discovery, link-share and OIDC flows |
| [api-client-legacy](components/frontend/api-client-legacy.md) | `AbstractService`/`AbstractModel`, case conversion, verb mapping |
| [api-client-generated-and-queries](components/frontend/api-client-generated-and-queries.md) | Generated client, fetch config, TanStack Query modules |
| [stores](components/frontend/stores.md) | Every Pinia store and its responsibilities |
| [project-views](components/frontend/project-views.md) | Project shell and the list, table, gantt, kanban views |
| [task-detail](components/frontend/task-detail.md) | Task detail view and its partials |
| [editor](components/frontend/editor.md) | TipTap editor, extensions, paste handling, mentions |
| [filters-and-quick-add](components/frontend/filters-and-quick-add.md) | Filter input and DSL transform, quick add magic |
| [user-settings-and-admin](components/frontend/user-settings-and-admin.md) | Settings views, API tokens, MCP, bots, admin panel |
| [sharing-teams-labels-notifications](components/frontend/sharing-teams-labels-notifications.md) | Sharing UI, teams, labels, notifications bell |
| [realtime-and-pwa](components/frontend/realtime-and-pwa.md) | WebSocket client, service worker, update banner, Sentry |
| [styling-and-theming](components/frontend/styling-and-theming.md) | Bulma variables, tokens, dark mode, Tailwind prefix, stylelint |
| [i18n-and-formatting](components/frontend/i18n-and-formatting.md) | vue-i18n setup, dayjs locales, date and time helpers |
| [testing-infrastructure](components/frontend/testing-infrastructure.md) | Vitest config, Playwright fixtures, factories, seeding |

## Other modules

| Page | Scope |
|---|---|
| [veans](components/veans.md) | The agent CLI module |
| [desktop](components/desktop.md) | Electron wrapper and its build |
| [build-and-release](components/build-and-release.md) | `magefile.go` targets, the `build/` module, CI workflows, release flow |

## Keeping this wiki current

- Before changing a component, read its page. After changing it, update the page in the same commit.
- Add a row to the relevant tables here when you add a page.
- Prefer pointing at code over pasting it. If you paste, keep it under ten lines.
- Mark anything you did not verify as "Unverified:" rather than leaving it out or guessing.
