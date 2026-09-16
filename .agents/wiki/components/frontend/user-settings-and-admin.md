# User settings and admin

Everything under `/user/settings/*` (the settings shell and its fourteen child views plus the nested import wizard), the pro-gated `/admin/*` panel, and the About page. Context: [Frontend architecture](../../04-frontend-architecture.md#routing), [Data model](../../06-data-model.md#entity-reference) (User row), backend [user-package](../backend/user-package.md), [auth-and-sessions](../backend/auth-and-sessions.md).

## Responsibility

- Owns: the settings navigation and each settings form, the API-token scope picker (also reused for bots and MCP), the MCP connection guide, data export/deletion flows, session and webhook management UIs, bot users, the import wizard views, the admin overview/users/projects/invite-links views and their services, pro-feature gating in the UI, version display.
- Does not own: the auth store that holds `settings`/`info` ([auth-and-session](./auth-and-session.md), [stores](./stores.md)), the `/info` config store, license enforcement (backend `pkg/license`, [operations-subsystems](../backend/operations-subsystems.md)), import execution ([importers](../backend/importers.md)), the MCP server ([mcp](../backend/mcp.md)).

## Entry points and public API

| Route name | Path / parent | View |
|---|---|---|
| `user.settings` (redirects to `user.settings.general`) | `/user/settings` | `frontend/src/views/user/Settings.vue` → `SideNavShell.vue` |
| `user.settings.{general,avatar,caldav,mcp,data-export,feeds,deletion,email-update,password-update,totp,apiTokens,sessions,webhooks,bots}` | children | `frontend/src/views/user/settings/*.vue` |
| `migrate.start`, `migrate.csv`, `migrate.service` (`:service`) | children of `user.settings` | `frontend/src/views/migrate/{Migration,MigrationCSV,MigrationHandler}.vue` |
| `user.export.download` | `/user/export/download` (top level, from the export mail) | `frontend/src/views/user/DataExportDownload.vue` |
| `admin.{overview,users,projects,inviteLinks}` | `/admin`, `meta.requiresAdminPanel` (+ `requiresUserInvites` on invite links) | `frontend/src/views/admin/{AdminShell,OverviewView,UsersView,ProjectsView,InviteLinksView}.vue` |
| `about` | `/about` | `frontend/src/views/About.vue` |

Shell navigation (`Settings.vue` → `navigationItems`) hides entries by config: password and email only for `authStore.info.isLocalUser`; TOTP needs `configStore.totpEnabled` **and** a local user; import needs `migratorsEnabled`; CalDAV `caldavEnabled`; webhooks `webhooksEnabled`; deletion `userDeletionEnabled`. `authStore.settings.extraSettingsLinks` (server-configured, `UserGeneralSettings.ExtraSettingsLinks`) are appended as external links. The MCP label is the hard-coded string `'MCP'`.

## Setting → UI file → API endpoint → backend field

All settings views except `Mcp.vue` and `InviteLinksView.vue` use the legacy service layer ([api-client-legacy](./api-client-legacy.md); create = `PUT`, update = `POST`, snake_case conversion automatic).

| Setting | UI | Endpoint (v1 unless noted) | Backend |
|---|---|---|---|
| Name, default project, email reminders, overdue reminders + time, language, timezone, week start, discoverable by name/email | `views/user/settings/General.vue` (630 lines) → `authStore.saveUserSettings` → `UserSettingsService.update` | `POST /user/settings/general` (also on v2, `pkg/routes/api/v2/user_settings.go:117`) | `models.UserGeneralSettings` (`pkg/models/user_settings.go`): `Name`, `EmailRemindersEnabled`, `OverdueTasksRemindersEnabled`, `OverdueTasksRemindersTime`, `DefaultProjectID`, `WeekStart`, `Language`, `Timezone`, `DiscoverableByName`, `DiscoverableByEmail` → `users` columns |
| `frontendSettings.*`: `defaultView`, `minimumPriority`, `defaultDueTime`, `filterIdUsedOnOverview`, `showLastViewed`, `dateDisplay`, `timeFormat`, `timeTrackingDefaultStart` (pro), `colorSchema`, `quickAddMagicMode`, `quickAddDefaultReminders`, `defaultTaskRelationType`, `playSoundWhenDone`, `allowIconChanges`, `alwaysShowBucketTaskCount`, `backgroundBrightness` (clamped 0–100), `desktopQuickEntryShortcut` (desktop only, `ShortcutRecorder.vue`) | same form; shape in `frontend/src/modelTypes/IUserSettings.ts` → `IFrontendSettings` (`sidebarWidth`, `commentSortOrder` are written elsewhere) | same request, `frontend_settings` object | `UserGeneralSettings.FrontendSettings` → `users.frontend_settings` JSON (`pkg/user/user.go:127`, `premarshalFrontendSettings`); the server never interprets it |
| Timezone list | `General.vue` → `useAvailableTimezones` (raw `AuthenticatedHTTPFactory`) | `GET /user/timezones` | `pkg/routes` timezone list |
| Avatar provider / upload / crop | `Avatar.vue` (`vue-advanced-cropper`), `AvatarService` | `GET`/`POST /user/settings/avatar`, `PUT /user/settings/avatar/upload` | `avatar_provider`: `gravatar`, `upload`, `initials`, `marble`, `ldap`, `openid`, `default` (`userAvatarProviderBody` doc in v2); `authStore.invalidateAvatar()` afterwards |
| CalDAV tokens | `Caldav.vue`, `CaldavTokenService` | `GET`/`PUT /user/settings/token/caldav`, `DELETE .../{id}`; URL shown: `${configStore.apiBase}/dav/principals/${username}/` | caldav tokens ([caldav](../backend/caldav.md)) |
| TOTP | `TOTP.vue`, `TotpService` | `GET /user/settings/totp`, `POST .../enroll`, `.../enable` `{passcode}`, `.../disable` `{password}`, `.../qrcode` (blob); enabling calls `authStore.logout()` | `pkg/user` TOTP |
| API tokens | `ApiTokens.vue` + `components/token/ApiTokenForm.vue` (437 lines) | `GET`/`PUT /tokens`, `DELETE /tokens/{id}`; scopes from `GET /routes` (`ApiTokenService.getAvailableRoutes`) | `pkg/models/api_tokens.go`; route groups from `collectRoutesForAPITokens` |
| MCP tokens and client guide | `Mcp.vue` (generated `mcpInfo()`), `McpClientGuide.vue` | `GET /api/v2/mcp/info` → `ConnectionSettings {endpoint, presets.read_only/typed/full}`; tokens are API tokens whose `permissions.mcp` includes `access` | [mcp](../backend/mcp.md) |
| Data export | `DataExport.vue`, `DataExportDownload.vue`, `DataExportService` | `POST /user/export/request` `{password}`, `GET /user/export` (status), `POST /user/export/download` (blob) | [files-and-storage](../backend/files-and-storage.md) |
| Account deletion | `Deletion.vue`, `AccountDeleteService` | `POST /user/deletion/request`, `/cancel` `{password}` (`/confirm` `{token}` from the mail link); `authStore.info.deletionScheduledAt` | `deletion_scheduled_at`, [Data model lifecycle](../../06-data-model.md#user-deletion) |
| Email change | `EmailUpdate.vue`, `EmailUpdateService` | **v2** `PUT /api/v2/user/settings/email`, `DELETE`, `POST .../resend` (`apiV2Url`); `authStore.info.pendingEmail` | `pending_email` |
| Password change | `PasswordUpdate.vue`, `PasswordUpdateService`, `helpers/validatePasswort.ts` | `POST /user/password` | `pkg/user` |
| Sessions | `Sessions.vue`, `SessionService` | `GET /user/sessions`, `DELETE /user/sessions/{id}`; the row equal to `authStore.currentSessionId` (JWT `sid`) is marked current and cannot be deleted | `sessions` table |
| User webhooks | `Webhooks.vue` (`UserWebhookService`) + shared `components/misc/WebhookManager.vue` | `/user/settings/webhooks[/{id}]`, events from `GET /user/settings/webhooks/events` | user-scoped webhooks |
| Project webhooks (same component) | `views/project/settings/ProjectSettingsWebhooks.vue` (`WebhookService`) | `/projects/{projectId}/webhooks[/{id}]`, `GET /webhooks/events` | `pkg/models/webhooks.go` |
| Bot users | `BotUsers.vue`, `BotUserService`, per-bot `ApiTokenForm` | `/user/bots[/{id}]`; tokens `GET /tokens?owner_id=<bot>`; username forced to the `bot-` prefix | `bot_owner_id` ([user-package](../backend/user-package.md)) |
| Notification feed | `AtomFeed.vue` | displays `${configStore.apiBase}/feeds/notifications.atom` (Unverified: how the feed authenticates; the view only shows the URL) | Atom feed route |

`ApiTokenForm.vue`: props `routes?`, `presets?`, `initialTitle`, `initialScopes` (`group:permission,...`); default expiry `DEFAULT_EXPIRY_DAYS = 30` with a custom `Datepicker`; `other` route group sorted last; preset buttons (`fullAccess` default, MCP passes `readOnly`/`typed`/`fullAccess` from `/mcp/info`); locked scopes survive group toggles. `ApiTokens.vue` prefills from `route.query.title` / `route.query.scopes` and auto-opens the form (used by external "create a token for X" links; `tests/e2e/user/api-tokens.spec.ts`).

`McpClientGuide.vue`: props `endpoint`, `token`; remembers the chosen client in `localStorage['mcp-client']`; emits ready-to-paste commands for Claude Code (`claude mcp add --transport http ...`), Codex (`codex mcp add ... --bearer-token-env-var`), Claude Desktop, Mistral Vibe and a generic entry linking `MCP_HELP`; the token is shown only once after creation (`Mcp.test.ts`).

## Internal structure

```mermaid
sequenceDiagram
    participant G as General.vue
    participant A as authStore
    participant S as UserSettingsService (legacy)
    participant API as POST /user/settings/general
    G->>G: settings ref copied from authStore.settings with fallbacks; isDirty via fast-deep-equal
    G->>A: saveUserSettings({settings})
    A->>S: update(settings) (language nulled in demo mode)
    A->>A: setUserSettings(); setLanguage(settings.language)
    S->>API: snake_case body incl. frontend_settings JSON
    A->>A: if name changed and avatar provider is initials → invalidateAvatar()
    A-->>G: success toast; initialSettings reset
```

Import wizard: `Migration.vue` lists `MIGRATORS` (`views/migrate/migrators.ts`: `wunderlist`, `todoist`, `trello`, `microsoft-todo`, `vikunja-file`, `ticktick`, `wekan`, `csv`, `planka`) filtered by what `/info` advertises; `MigrationHandler.vue` drives OAuth-style migrators through `AbstractMigrationService` (**v2** `migration/{id}/auth`, `/migrate`, `/status`) or file uploads through `AbstractMigrationFileService` (v1 `/migration/{id}/migrate`), with `MigrationCredentialsForm.vue` for URL/username/password sources; `MigrationCSV.vue` uses `CSVMigrationService` `detect` → `preview` → import. `stores/migration.ts` polls the status source (`POLL_INTERVAL`, generation counter so a stale poll cannot apply). Adding an importer: [Conventions](../../08-conventions.md#if-you-change-x-you-must-also-change-y).

Admin panel:

| View | Service / client | Endpoints |
|---|---|---|
| `AdminShell.vue` | `SideNavShell`; invite-links tab only if `isProFeatureEnabled(PRO_FEATURE.USER_INVITES)` | — |
| `OverviewView.vue` | `services/admin/overviewService.ts` → `AdminOverviewModel` (`users`, `projects`, `tasks`, `teams`, `shares.{linkShares,teamShares,userShares}`, `license.{licensed,instanceId,features,maxUsers,expiresAt,validatedAt,lastCheckFailed}`) | `GET /admin/overview` |
| `UsersView.vue` (591 lines) | `services/admin/userService.ts` + `models/adminUser.ts` (`UserModel` + `status`, `isAdmin`, `issuer`, `subject`, `authProvider`) | `GET /admin/users?s=&page=`, `POST /admin/users` (`CreateAdminUserBody`), `PATCH /admin/users/{id}/admin`, `PATCH .../status`, **v2** `PATCH admin/users/{id}/password` and `POST .../password-reset-email`, `DELETE /admin/users/{id}?mode=now\|scheduled` |
| `ProjectsView.vue` | `services/admin/projectService.ts` | `GET /admin/projects`, `PATCH /admin/projects/{id}/owner` `{owner_id}` (owner picked via `AdminUserService.getAll({s})`) |
| `InviteLinksView.vue` | generated `adminInviteLinksList/Create/Delete`, `adminTeamsList` | v2 admin invite-link routes; fields name, max uses, expiry, skip email confirm, teams; consumed on the register side by `client/inviteLink.ts` + `views/user/Register.vue` |

## Dependencies

- **Uses:** stores `auth`, `config`, `base`, `projects`, `migration`; legacy services listed above; generated `mcpInfo`, `adminInviteLinks*`, `adminTeamsList`; `vue-advanced-cropper`, `@vueuse/core` (`useNow`, `useLocalStorage`, `useClipboard`, `useDebounceFn`), `fast-deep-equal`; `components/misc/SideNavShell.vue`, `Modal.vue`, `PaginationEmit.vue`, `TimeDisplay.vue`, `components/input/Form*.vue`, `components/tasks/partials/Reminders.vue`, `ProjectSearch.vue`; `constants/{proFeatures,priorities,dateDisplay,timeFormat}.ts`, `i18n` `SUPPORTED_LOCALES`.
- **Used by:** the router only; `WebhookManager.vue` and `ApiTokenForm.vue` are shared with project settings and bots.

## Invariants and assumptions

- Pro gating happens in three places that must agree: `frontend/src/constants/proFeatures.ts` (`admin_panel`, `time_tracking`, `user_invites`, mirroring `pkg/license` `Feature*`), `configStore.isProFeatureEnabled(name)` (reads `enabled_pro_features` from `/info`), and router `meta` (`requiresAdminPanel` also requires `authStore.info.isAdmin` and force-refreshes `/user` when `isAdmin` is still undefined; all three redirect to `not-found`, mirroring the backend's 404 from `RequireFeature`/`RequireInstanceAdmin`). `General.vue` and `AdminShell.vue` additionally hide UI by the same check.
- `frontendSettings` is opaque to the server; every key needs a fallback in `General.vue`'s initialiser because old accounts lack it, and `IFrontendSettings` in `IUserSettings.ts` is the only schema.
- Settings write through `authStore.saveUserSettings`, never through the service directly, so language, avatar and the store stay consistent.
- `ApiTokenForm` trusts `GET /routes` for the scope catalogue; a new route group appears automatically, the `other` group is always last.
- The current session id comes from the JWT `sid` claim (`authStore.currentSessionId`); `Sessions.vue` relies on it to prevent self-revocation.

## Error handling

Toasts via `@/message` (`error(e)`, `success(...)`); `Mcp.vue` sets `loadFailed` and shows a retry; `UsersView`/`ProjectsView`/`InviteLinksView` wrap each call in try/catch → `error(e)`; v2 validation problems (invite link expiry in the past) are checked client-side first (`admin.inviteLinks.futureExpiry`). Router guards fail closed to `not-found`, never 403.

## Tests

| Test | Covers |
|---|---|
| `views/user/settings/General.test.ts` | renders without a user; external (non-local) user flag |
| `views/user/settings/ApiTokens.test.ts` | delete during modal close animation, delete text cleared, double-click deletes once |
| `views/user/settings/Mcp.test.ts` | guide only after creation, secret forgotten on Done |
| `views/user/settings/TOTP.test.ts` | enroll / QR / disable states |
| `components/token/ApiTokenForm.test.ts` | title focus on submit, supplied routes and presets, locked scopes through group toggles |
| `components/token/McpClientGuide.test.ts` | instructions hidden until a client is chosen; ChatGPT explanation |
| e2e `tests/e2e/user/settings/{caldav,data-export,deletion,mcp,sessions,totp}.spec.ts` | token round-trips against the CalDAV endpoint, export password checks, schedule/cancel deletion, scoped MCP token shown once, session revocation breaks refresh, TOTP enroll forces re-login |
| e2e `tests/e2e/user/api-tokens.spec.ts` | query-parameter prefill of title and scopes |
| e2e `tests/e2e/admin/admin-panel.spec.ts`, `invite-links.spec.ts` | licensed vs unlicensed access, non-admin → not-found, tab navigation; invite create/copy/register/join, anonymous unknown invite, fragment revalidation, hidden without `user_invites` |

Run unit tests with `pnpm vitest run src/views/user/settings src/components/token`. Not covered: `General.vue` save path, `Avatar.vue`, `EmailUpdate.vue`, `PasswordUpdate.vue`, `Webhooks.vue`/`WebhookManager.vue` (project webhooks have `tests/e2e/project/webhooks.spec.ts`), `BotUsers.vue`, `AtomFeed.vue`, the migrate views, `ProjectsView.vue`, `About.vue`.

## Gotchas and tech debt

- `General.vue` has two `watch(() => authStore.settings, ...)` handlers that both return early when `settings.value` has keys; since `settings` is initialised from the store, they never re-run, so server-side changes are not reflected while the page is open.
- `useAvailableTimezones` and `ApiTokens.vue` (`apiDocsUrl = window.API_URL + '/docs'`) touch `AuthenticatedHTTPFactory`/`window.API_URL` directly instead of a service or the config store.
- `services/admin/userService.ts` mixes v1 URLs with `apiV2Url(...)` for password operations (comment in file) — a symptom of the partial v2 port; new admin endpoints should use the generated client like `InviteLinksView.vue`.
- `AdminOverviewModel` re-parses `expiresAt`/`validatedAt` into `Date` by hand.
- `models/userSettings.ts` still exists for the legacy `UserSettingsService`; `IUserSettings` is the effective schema and must be edited together with `General.vue` fallbacks.
- Only `FIXME` nearby: `frontend/src/views/user/Register.vue:182` (`use the beforeEnter hook of vue-router`), which affects invite-link registration. None inside `views/user/settings`, `views/admin`, `views/migrate` or `components/token`.

## Related pages

[auth-and-session](./auth-and-session.md), [stores](./stores.md), [bootstrap-and-routing](./bootstrap-and-routing.md) (guards), [api-client-legacy](./api-client-legacy.md), [api-client-generated-and-queries](./api-client-generated-and-queries.md), [i18n-and-formatting](./i18n-and-formatting.md) (language, date display, time format), [filters-and-quick-add](./filters-and-quick-add.md) (quick add mode and default reminders), [sharing-teams-labels-notifications](./sharing-teams-labels-notifications.md) (webhook manager sibling), backend [user-package](../backend/user-package.md), [auth-and-sessions](../backend/auth-and-sessions.md), [mcp](../backend/mcp.md), [importers](../backend/importers.md), [operations-subsystems](../backend/operations-subsystems.md) (license), [playbooks/build-vue-feature](../../playbooks/build-vue-feature.md).
