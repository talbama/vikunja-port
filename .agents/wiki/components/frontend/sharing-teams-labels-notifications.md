# Sharing, teams, labels, notifications

The collaboration surface of the Vue app: project sharing (users, teams, link shares), team management, labels (the reference TanStack Query implementation), the notification bell, plus the smaller cross-cutting widgets that live next to them: subscriptions, reactions, keyboard shortcuts and the quick-actions palette. Context: [Frontend architecture](../../04-frontend-architecture.md), backend [models-sharing-teams-labels](../backend/models-sharing-teams-labels.md).

## Responsibility

- Owns: the UI and client calls for shares, link-share authentication and layout, teams and members, labels (list/create/edit and the task label picker), the notifications dropdown, subscribe/unsubscribe buttons, emoji reactions, shortcut registration and the help overlay, quick actions.
- Does not own: permission evaluation (backend `Can*` methods), the WebSocket client ([realtime-and-pwa](./realtime-and-pwa.md)), auth token handling for link shares ([auth-and-session](./auth-and-session.md)), the task detail view that hosts labels/reactions/subscriptions ([task-detail](./task-detail.md)).

## Sharing

| Piece | File | Notes |
|---|---|---|
| Share settings modal | `frontend/src/views/project/settings/ProjectSettingsShare.vue` | Loads the project with legacy `ProjectService`, `userIsAdmin = maxPermission === PERMISSIONS.ADMIN`, renders `LinkSharing` (if `configStore.linkSharingEnabled`) and `UserTeam` twice (`shareType="user"` / `"team"`) |
| `LinkSharing.vue` (322 lines) | `frontend/src/components/sharing/LinkSharing.vue` | `LinkShareService` → `/projects/{projectId}/shares` (`getAll`/`create`/`delete`); create sends `permission`, `name`, `password`; per-share view selector; `getShareLink(hash, viewId)` = `configStore.frontendUrl + 'share/' + hash + '/auth' + ('?view=' + viewId)` |
| `UserTeam.vue` (386 lines) | `frontend/src/components/sharing/UserTeam.vue` | Props `type: 'project'`, `shareType: 'user' \| 'team'`, `id`, `userIsAdmin`. Picks `UserService`+`UserProjectService` (`/projects/{projectId}/users[/{username}]`) or `TeamService`+`TeamProjectService` (`/projects/{projectId}/teams[/{teamId}]`); `load`, `add(admin)`, `toggleType` (permission select), `deleteSharable`, `find(query)` |
| Hash constants | `frontend/src/constants/linkShareHash.ts` → `LINK_SHARE_HASH_PREFIX = '#share-auth-token='`; `constants/redirectHash.ts` must stay distinct | `router/index.ts:630` copies a link-share hash from `from` to `to` on every navigation; `:634` redirects any `#share-auth-token=` to `link-share.auth` when `authStore.authLinkShare` is false |
| `LinkSharingAuth.vue` (184 lines) | `frontend/src/views/sharing/LinkSharingAuth.vue` | Route `link-share.auth`; `authStore.linkShareAuth({hash, password})` → `POST /shares/{hash}/auth`; error code `13002` switches to the password form; `redirectToProject` prefers the last visited route, then `?view=`, then `project.index`, always re-attaching the hash |
| `ContentLinkShare.vue` (212 lines) | `frontend/src/components/home/ContentLinkShare.vue` | Layout chosen by `App.vue` for link-share identities: logo, project title, `projectStore.loadProject` with a retry button, full width for kanban/gantt, `PoweredByLink` |

Link-share auth details (token type 2, the `authLinkShare` computed) live in [auth-and-session](./auth-and-session.md); the backend side in [auth-and-sessions](../backend/auth-and-sessions.md).

## Teams

| Piece | File | Notes |
|---|---|---|
| `ListTeams.vue` | `frontend/src/views/teams/ListTeams.vue` | `TeamService.getAll()` |
| `NewTeam.vue` | `frontend/src/views/teams/NewTeam.vue` | `TeamService.create`, `isPublic` checkbox only if `configStore.publicTeamsEnabled` |
| `EditTeam.vue` (406 lines) | `frontend/src/views/teams/EditTeam.vue` | `userIsAdmin = team.maxPermission > PERMISSIONS.READ`; `save`, `deleteTeam`, `deleteMember`, `addUser` (`UserService` search), `toggleUserType` (`/teams/{teamId}/members/{username}/admin`), `leave`; description via `AsyncEditor` ([editor](./editor.md)); members sorted by display name |
| Services | `frontend/src/services/team.ts` (`/teams`, `/teams/{id}`), `teamMember.ts` (`/teams/{teamId}/members`, `.../{username}`, `.../{username}/admin`; `beforeCreate` copies `id` into `userId`) | legacy layer |
| Model | `frontend/src/models/team.ts`: `externalId` (OIDC-synced teams), `isPublic` | mirrors `pkg/models/teams.go` |

## Labels

The pattern every new feature should copy ([Conventions](../../08-conventions.md#data-layer)):

| Layer | File | What |
|---|---|---|
| Query module | `frontend/src/client/queries/labels.ts` (197 lines) | `labelKeys.all`, `labelsQuery()` (generated `labelsList`), `ensureLabels()`/`refreshLabels()` for non-component code, pure helpers `getLabelById`, `getLabelsByIds`, `getLabelByExactTitle`, `getLabelsByExactTitles`, `filterLabelsByQuery(labels, hidden, query)` (substring on title or description, `[]` for an empty query), `sortLabelsAlphabetically`; `create/update/deleteLabelMutationOptions()` with optimistic `onMutate`/`onError`/`onSettled` on the list key and `use*LabelMutation()` hooks; `labelBody` strips `#` via `colorFromHex` |
| Read composable | `frontend/src/composables/useLabels.ts` | `useQuery(labelsQuery())`, `labels = data ?? []`, `isPending`, bound lookup helpers |
| Styling | `frontend/src/composables/useLabelStyles.ts` | `getLabelColor` accepts `''`, `#hex`, `var(--x)` or bare hex; `getLabelStyles` → `{background, color: getTextColor(bg)}` |
| Colour helpers | `frontend/src/helpers/color/` | `colorFromHex` (strip `#`), `colorIsDark` (WCAG relative luminance, threshold `0.1791` so black/white always reach 4.5:1), `getTextColor` → `#000`/`#fff`, `randomColor.ts` → `getRandomColorHex()` from a 13-colour palette |
| Views | `frontend/src/views/labels/ListLabels.vue` (inline edit with `ColorPicker` + `AsyncEditor`, `useUpdateLabelMutation`/`useDeleteLabelMutation`), `NewLabel.vue` (`createLabelDraft({hex_color: getRandomColorHex()})`, `useCreateLabelMutation`, navigates to `labels.index`) | route family `labels.*` |
| Partials | `components/tasks/partials/Label.vue` (chip), `Labels.vue` (dedupes by id), `EditLabels.vue` (`modelValue`, `taskId`, `disabled`, `creatable`, `creationDisabledMessage`; with `taskId` calls `taskStore.addLabel`/`removeLabel`, otherwise only emits; `createAndAddLabel` through the create mutation) | used by task detail, quick add, link-share label picker |

Types come from `@/client/generated` (`Label`, `LabelWritable`); there is no legacy label service any more.

## Notifications

`frontend/src/components/notifications/Notifications.vue` (411 lines):

- Initial `GET /notifications` via legacy `NotificationService` (`services/notification.ts`; `update` = `POST /notifications/{id}`, `markAllRead` = `POST /notifications`, `delete` = `DELETE /notifications`).
- Realtime: `useWebSocket().subscribe('notification.created', ...)` prepends a `NotificationModel` unless the id is already present. On WS disconnect it reloads; a `setInterval` of `POLL_INTERVAL = 10000` ms polls **only while `wsConnected` is false and the tab is visible**.
- Click → `getNotificationRoute(n)`: `task.*` names → `task.detail`, `project.created` → `task.index`, `team.member.added` → `teams.edit`; marks the notification read and re-renders with the server response; a duplicated navigation triggers `router.go(0)`.
- Rendering: `NOTIFICATION_NAMES` in `modelTypes/INotification.ts` (`task.comment`, `task.assigned`, `task.deleted`, `task.created`, `task.reminder`, `project.created`, `team.member.added`, `task.mentioned`); `models/notification.ts` → `toText(user)` builds the sentence (English, **not translated**) and hydrates `doer`, `task`, `project`, `team`. Rows with an unknown `name` are hidden (`n.name !== ''`).

Backend types and channels: [notifications-and-mail](../backend/notifications-and-mail.md); the `notification.created` bridge: [websocket](../backend/websocket.md).

## Subscriptions, reactions

- `components/misc/Subscription.vue`: props `modelValue: ISubscription | null`, `entity` (`project` | `task`), `entityId`, `type` (`button` | `dropdown`). `isInherited` when the subscription's entity/id differ from the props (subscribed via the project); `SubscriptionService` → `PUT`/`DELETE /subscriptions/{entity}/{entityId}`. Used by `views/tasks/TaskDetailView.vue` and `components/project/ProjectSettingsDropdown.vue`.
- `components/input/Reactions.vue` (207 lines): props `entityKind: ReactionKind`, `entityId`, `disabled`; `defineModel<IReactionPerEntity>()` (emoji → users). Picker is `VuemojiPicker` from `vuemoji-picker`, themed through `useColorScheme`. `ReactionService` (`services/reactions.ts`) uses `{kind}/{id}/reactions` (`GET`, `PUT`) and **`POST .../reactions/delete`** for removal (`pkg/routes/routes.go:949-951`); the model is updated locally with `authStore.info`.

## Keyboard shortcuts

| Piece | File | Notes |
|---|---|---|
| Bindings | `frontend/src/constants/shortcuts.ts` → `SHORTCUTS` | `toggleMenu: 'Mod+KeyE'`, `quickSearch: 'Mod+KeyK'`, `showKeyboardShortcuts: 'Shift+Slash'`, navigation sequences `KeyG KeyO/U/P/A/M`, task-detail single keys; `reminder` is `Shift+KeyR` on Apple and `Alt+KeyR` elsewhere, `delete` is `Backspace` vs `Delete`. `PRIMARY_MODIFIER_KEY` is `⌘` or `ctrl` for display |
| Engine | `frontend/src/helpers/shortcut.ts` (308 lines) | Replacement for `@github/hotkey`: `parseKey` (`Mod` flag), `matchesKey` (`Mod` → `metaKey` when `isAppleDevice()`, else `ctrlKey`), `eventToShortcutString` (used by the editor's `editShortcut`), `shortcutBindingToDisplay`, `isFormField`, `install(el, binding)`/`uninstall(el)`: one document `keydown` listener, sequences with a 1500 ms timeout, a match calls `el.click()` |
| `isAppleDevice` | `frontend/src/helpers/isAppleDevice.ts` | `navigator.userAgent.includes('Mac')` or an iOS `navigator.platform` |
| Directive | `frontend/src/directives/shortcut.ts` → `v-shortcut="SHORTCUTS.navigation.overview"` | registered in `main.ts`; used in `components/home/Navigation.vue`, `ContentAuth.vue` |
| Overlay | `components/misc/keyboard-shortcuts/index.vue` (toggled by `baseStore.setKeyboardShortcutsActive`), `shortcuts.ts` → `KEYBOARD_SHORTCUTS: ShortcutGroup[]` with `available(route)` filters, `components/misc/Shortcut.vue` renders keys with `+` or `then` | help data derives from `SHORTCUTS` via `shortcutBindingToDisplay`, verified by `keyboard-shortcuts/shortcuts.test.ts` |

macOS e2e caveat: because `Mod` resolves from the browser user agent, Playwright on a Mac host must send Meta. `tests/e2e/misc/menu.spec.ts` presses `ControlOrMeta+e`; `tests/support/commands.ts:59` picks `Meta+V` when `process.platform === 'darwin'`. Use the same pattern for any new shortcut test.

## Quick actions

`frontend/src/components/quick-actions/QuickActions.vue` (870 lines), opened by `Mod+K` through `baseStore.quickActionsActive`:

- Enums `ACTION_TYPE` (`cmd`, `task`, `project`, `team`, `labels`), `COMMAND_TYPE` (`newTask`, `newProject`, `newTeam`), `SEARCH_MODE` (`all`, `tasks`, `projects`, `teams`).
- Sources: tasks via legacy `TaskService` with `TaskFilterParams`, projects from `projectStore` plus `modules/projectHistory`, labels via `useLabels().filterLabelsByQuery`, teams via `TeamService`, commands filtered by substring (`FIXME: use fuzzysearch`, line 281).
- `parsedQuery = parseTaskText(query, quickAddMagicMode)` powers the new-task command and the inline `QuickAddMagic` hints; `newTask` → `taskStore.createNewTask` ([filters-and-quick-add](./filters-and-quick-add.md#quick-add-magic-modulesquickaddmagic)).
- Keyboard navigation over grouped `results` (`select`, `setResultRefs`, `resultCount` announced for a11y).
- `QuickAddOverlay.vue`: the Electron quick-entry window (`useQuickAddMode`), preloads projects and `ensureLabels()`, closes through `window.quickEntry.close()` ([desktop](../desktop.md)).

## Dependencies

- **Uses:** legacy services `project`, `linkShare`, `userProject`, `teamProject`, `user`, `projectUsers`, `team`, `teamMember`, `notification`, `subscription`, `reactions`, `task`; generated client for labels; stores `auth`, `base`, `config`, `projects`, `tasks`; `composables/useWebSocket.ts`, `useColorScheme.ts`, `useCopyToClipboard.ts`; `vuemoji-picker`, `@vueuse/core`.
- **Used by:** `App.vue` (`ContentLinkShare`, `QuickActions` in `ContentAuth.vue`), `AppHeader.vue` (notifications bell), task detail and project views (labels, subscription, reactions), the router (link-share hash handling).

## Invariants and assumptions

- `LINK_SHARE_HASH_PREFIX` is the only way a link-share identity survives navigation; every `router.push` inside link-share views re-attaches `route.hash` (`ContentLinkShare.vue` → `getProjectRoute`, `LinkSharingAuth.vue` → `redirectToProject`). `REDIRECT_HASH_PREFIX` must never collide with it.
- `LinkSharingAuth.vue` logs only status and error code, never the error object (`AxiosError.config.data` holds the plaintext share password).
- Labels are the single source of truth in the TanStack cache: components never call `queryClient`; cache writes happen only in `client/queries/labels.ts` mutation callbacks. `stores/tasks.ts` uses `createLabelMutationOptions()` with the shared `queryClient` for the same reason.
- `matchesKey` compares `event.code`, not `event.key`; bindings are written as `KeyX`/`Slash`, not characters.
- `Notifications.vue` assumes the WebSocket event name `notification.created` is in the backend `validEvents` list ([Conventions](../../08-conventions.md#if-you-change-x-you-must-also-change-y)).
- Permission constants `PERMISSIONS.READ/WRITE/ADMIN` mirror `pkg/models/permissions.go` ([Data model](../../06-data-model.md#enums-duplicated-across-sides)).

## Error handling

Legacy service errors surface as toasts via `@/message` (`error(e)` in `Notifications.vue` initial load is downgraded to `console.warn` so the bell still mounts). `ContentLinkShare.vue` shows an inline retry on project load failure. Link-share auth maps `13002` (wrong password) to the password form and otherwise shows `sharing.error` or the server message (`TODO` at `LinkSharingAuth.vue:151` asks for a global handler).

## Tests

Unit: `frontend/src/client/queries/labels.test.ts` (mutation lifecycle through `getMutationCache().build(...).execute`), `helpers/color/{colorFromHex,colorIsDark,getTextColor}.test.ts`, `helpers/shortcut.test.ts` (`parseKey`, `matchesKey`, sequences), `components/misc/Shortcut.test.ts`, `components/misc/keyboard-shortcuts/shortcuts.test.ts` (help data derives from `SHORTCUTS`), `components/quick-actions/QuickActions.test.ts` (opens with/without a current project). No unit tests for the sharing, team, notification, subscription or reaction components.

E2E (`run-e2e-tests` skill): `tests/e2e/sharing/linkShare.spec.ts` (view a share, direct project/task URL with hash, colliding user id, label picker cannot create labels, password-protected shares), `tests/e2e/sharing/team.spec.ts` (create/list/edit/permissions, add member, READ vs READ_WRITE on shared projects, revoke), `tests/e2e/misc/menu.spec.ts` (`Mod+E` toggle), `tests/e2e/misc/notifications.spec.ts` (despite the name, this covers **toast** merging via `$notify` and the `×2` counter from `@kyvg/vue3-notification`, not the bell; the bell has no e2e coverage), `tests/e2e/misc/sidebar-resize.spec.ts`.

## Gotchas and tech debt

- `frontend/src/components/sharing/UserTeam.vue:194` — `FIXME: I think this whole thing can now only manage user/team sharing for projects? Maybe remove a little generalization?` (the `type` prop only accepts `'project'`).
- `frontend/src/components/sharing/LinkSharing.vue:318` — `FIXME: I think this is not needed` (scoped style rule).
- `frontend/src/views/sharing/LinkSharingAuth.vue:109` (`FIXME: push to 'project.list' since authenticated?`), `:113` (`TODO: no password`), `:151` (`TODO: Put this logic in a global errorMessage handler`).
- `frontend/src/views/teams/EditTeam.vue:357` — `FIXME: direct manipulation` (`toggleUserType` mutates the member before the request).
- `frontend/src/components/quick-actions/QuickActions.vue:281` — `FIXME: use fuzzysearch`.
- `NotificationModel.toText` produces untranslated English; notification rows bypass i18n.
- Reactions delete through `POST .../reactions/delete` (v1 quirk); a v2 port should use `DELETE`.
- Everything except labels is on the legacy service layer ([api-client-legacy](./api-client-legacy.md)); teams, shares and notifications are candidates for the labels pattern.

## Related pages

[auth-and-session](./auth-and-session.md), [task-detail](./task-detail.md), [project-views](./project-views.md), [realtime-and-pwa](./realtime-and-pwa.md), [api-client-generated-and-queries](./api-client-generated-and-queries.md), [api-client-legacy](./api-client-legacy.md), [stores](./stores.md), [bootstrap-and-routing](./bootstrap-and-routing.md), backend [models-sharing-teams-labels](../backend/models-sharing-teams-labels.md), [notifications-and-mail](../backend/notifications-and-mail.md), [websocket](../backend/websocket.md), [auth-and-sessions](../backend/auth-and-sessions.md), [Data flows](../../10-data-flows.md#label-mutation-on-the-new-stack), [playbooks/build-vue-feature](../../playbooks/build-vue-feature.md).
