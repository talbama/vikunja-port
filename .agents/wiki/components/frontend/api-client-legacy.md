# Legacy API client (services, models, modelTypes)

The v1-era data layer: `AbstractService` subclasses talk to `/api/v1` over axios, `AbstractModel` subclasses hold camelCase data, `modelTypes/I*.ts` type them. It is frozen for new work and being replaced by the generated client plus TanStack Query ([api-client-generated-and-queries](./api-client-generated-and-queries.md)). Overview in [Frontend architecture](../../04-frontend-architecture.md#two-api-layers); policy in [API design](../../../docs/api.md#frontend-clients). Verified 2026-09-16.

## Responsibility

- Owns: URL templates and verb mapping for v1 resources, snake_case ↔ camelCase conversion, model construction with defaults, pagination headers, `x-max-permission`, file uploads, per-service `loading` flags.
- Does not own: the axios instance and the 401 refresh (`helpers/fetcher.ts`, see [auth-and-session](./auth-and-session.md)), caching (stores or TanStack Query), anything on `/api/v2` (generated client; the few `apiV2Url(...)` calls inside services are transitional).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `AbstractService<Model>` | `frontend/src/services/abstractService.ts` | 46 service classes (40 top-level + `admin/` 3 + `migrator/` 3; `timeEntry.ts` is plain functions) |
| `AbstractModel<Model>` → `assignData`, `maxPermission` | `frontend/src/models/abstractModel.ts` | 35 model classes directly; `adminUser`, `teamMember`, `teamProject`, `userProject` extend another model |
| `objectToCamelCase`, `objectToSnakeCase` | `frontend/src/helpers/case.ts` | `AbstractModel`, `AbstractService`, `stores/auth.ts`, `services/timeEntry.ts`, `models/task.ts` |
| `IAbstract` (`maxPermission`) | `frontend/src/modelTypes/IAbstract.ts` | every `I*` interface |
| `frontend/docs/models-services.md` | historical | describes `defaults()` and namespace paths that no longer exist; do not follow it |

Consumers: 83 non-test files import from `@/services/`; 136 import from `@/services/`, `@/models/`, or `@/modelTypes/` (counted with `grep -rl` on 2026-09-16). Stores that hold service instances: `auth`, `base`, `kanban`, `migration`, `projects`, `tasks`, `timeTracking`.

## Key types and functions (`services/abstractService.ts`)

| Piece | Behaviour |
|---|---|
| `Paths` | `{create, get, getAll, update, delete, reset?}`; constructor `Object.assign`s the subclass's partial |
| Placeholders | `{name}` segments replaced from the model via `getRouteReplacements` / `getReplacedRoute` (pattern `/{([^}]+)}/`, overridable via `getRouteParameterPattern`) |
| Verbs | `get` → GET `paths.get`; `getAll` → GET `paths.getAll` with `params.page`; `create` → **PUT** `paths.create`; `update` → **POST** `paths.update` (through `post(url, model)`); `delete` → DELETE with the model as body |
| Request interceptor | per instance; guarded by `config.payloadTransformed` so a 401-retried request is not re-transformed; `post` → `beforeUpdate` + `objectToSnakeCase`; `put` → `beforeCreate` + snake; `delete` → `beforeDelete` + snake; each step switchable via `use{Create,Update,Delete}Interceptor()` and `autoTransformBefore{Send,Post,Put,Delete}()` |
| `prepareParams` | query params: `Date` → ISO string (also inside arrays), then snake_case |
| Model factories | `modelFactory` (default identity) and per-verb `modelGetFactory`, `modelGetAllFactory`, `modelCreateFactory`, `modelUpdateFactory`; subclasses return `new XModel(data)` |
| `beforeGet/Create/Update/Delete` | hooks that receive the model before the request |
| `setLoading()` | sets `loading = true` after 100 ms; returns a cancel function that clears the timer and resets to false |
| `getM(url, model, params)` | raw GET; sets `result.maxPermission` from the `x-max-permission` header |
| `getAll` | reads `x-pagination-result-count` → `resultCount` and `x-pagination-total-pages` → `totalPages`; returns `[]` when the body is not an array |
| `create` / `post` | copy `model.maxPermission` onto the result if the caller had one (v1 create responses do not send the header) |
| `getBlobUrl(url, method, data)` | blob GET/POST; SVG → data URL via `FileReader` when available; otherwise `URL.createObjectURL` |
| `uploadFile` / `uploadBlob` / `uploadFormData` | PUT multipart with `transformRequest` identity and `uploadProgress` (0–100) |

`helpers/fetcher.ts` → `AuthenticatedHTTPFactory()` is created per service instance, so each service has its own axios instance and interceptor chain but shares the module-level `refreshPromise`.

## Models (`models/abstractModel.ts` and subclasses)

`AbstractModel` is tiny: `maxPermission: Permission | null = null` and `assignData(data)` = `objectToCamelCase(data)` then `Object.assign(this, omitBy(data, isNil))`, so `null`/`undefined` from the API never overwrite a class-field default. Subclasses declare defaults as class fields, call `this.assignData(data)` in the constructor, then post-process: wrap nested objects in models, `new Date(...)` for timestamps, prefix `#` on `hexColor` (`models/project.ts` is a representative example). `models/task.ts` line 104 keeps `labels` as generated snake_case `Label[]` by re-snake-casing after the camelCase pass, because task label UI already moved to the new client.

`helpers/case.ts`: recursive key conversion via `change-case`; skips `null` and `Date` values (a `Date` has no own enumerable keys and would become `{}`); arrays are mapped element-wise. Tests: `helpers/case.test.ts`.

## modelTypes (`frontend/src/modelTypes/`, 42 interfaces)

| Group | Interfaces |
|---|---|
| Base | `IAbstract` (FIXME `:4` "should this be readonly?"), `IFile` |
| Users and auth | `IUser` (also exports `AUTH_TYPES`), `IUserSettings`, `IAvatar`, `IApiToken`, `IApiTokenSettings` (imports generated `RouteDetail`), `ICaldavToken`, `IEmailUpdate`, `IPasswordReset`, `IPasswordUpdate`, `ISession`, `ITotp` |
| Projects and views | `IProject` (FIXME `:17` `backgroundInformation: unknown`), `IProjectView`, `IProjectDuplicate`, `IBackgroundImage`, `ISavedFilter` (FIXME `:4` vs `TaskFilterParams`), `ISubscription` (FIXMEs `:6-7` entity types), `IBucket` |
| Tasks | `ITask` (imports generated `Label`), `ITaskAssignee`, `ITaskBucket`, `ITaskComment`, `ITaskDuplicate`, `ITaskPosition`, `ITaskRelation`, `ITaskReminder`, `IAttachment`, `IReaction`, `ITimeEntry` |
| Sharing and teams | `ILinkShare` (FIXME `:10` sharing type numbers; mirrored in `models/linkShare.ts:13`), `ITeam`, `ITeamMember`, `ITeamProject`, `ITeamShareBase`, `IUserProject`, `IUserShareBase` |
| Misc | `INotification`, `IWebhook`, `IAdminOverview`, `IAdminUser` |

There is no `ILabel` or `LabelModel` any more; labels were migrated (see below).

## Services → endpoints (`frontend/src/services/`)

Paths are relative to `window.API_URL` (`/api/v1`). "extra" lists non-CRUD methods that call `this.http` directly.

| Service | Paths | Extra |
|---|---|---|
| `project.ts` `ProjectService` | CRUD `/projects`, `/projects/{id}` | `background()` blob, `DELETE /projects/{id}/background` |
| `projectViews.ts` | CRUD `/projects/{projectId}/views[/{id}]` | |
| `projectUsers.ts` | getAll `/projects/{projectId}/projectusers` | |
| `projectDuplicateService.ts` | create `/projects/{projectId}/duplicate` | |
| `userProject.ts`, `teamProject.ts` | CRUD `/projects/{projectId}/users[/{username}]`, `/projects/{projectId}/teams[/{teamId}]` | |
| `linkShare.ts` | `/projects/{projectId}/shares[/{id}]` | |
| `webhook.ts` `WebhookService` / `UserWebhookService` | `/projects/{projectId}/webhooks[/{id}]`, `/user/settings/webhooks[/{id}]` | `GET /webhooks/events`, `GET /user/settings/webhooks/events` |
| `backgroundUnsplash.ts`, `backgroundUpload.ts` | getAll `/backgrounds/unsplash/search`, update `/projects/{projectId}/backgrounds/unsplash`; upload `/projects/{projectId}/backgrounds/upload` | `thumb()` blob `GET /backgrounds/unsplash/images/{id}/thumb`; `modelUpdateFactory` returns a `ProjectModel` |
| `task.ts` `TaskService` | create `/projects/{projectId}/tasks`, `/tasks`, `/tasks/{id}` | `bulkCreate` → `apiV2Url('projects/{id}/tasks/bulk')`; heavy `processModel` (dates, repeat, reminders; `services/task.test.ts`) |
| `taskCollection.ts` | getAll `/projects/{projectId}/views/{viewId}/tasks`, or `/projects/{projectId}/tasks` when `viewId` is falsy (overrides `getReplacedRoute`) | `modelFactory` returns a `BucketModel` when `project_view_id` is present, else `TaskModel` (FIXME `:48`) |
| `taskAssignee.ts`, `taskRelation.ts`, `taskComment.ts`, `taskPosition.ts`, `taskDuplicateService.ts`, `attachment.ts` | `/tasks/{taskId}/assignees[/{userId}]`, `/tasks/{taskId}/relations[/{relationKind}/{otherTaskId}]`, `/tasks/{taskId}/comments[/{id}]`, update `/tasks/{taskId}/position`, create `/tasks/{taskId}/duplicate`, `/tasks/{taskId}/attachments[/{id}]` | attachments: preview blobs, TODO `:70` size validation |
| `bucket.ts`, `taskBucket.ts` | `/projects/{projectId}/views/{projectViewId}/buckets[/{id}]`, update `.../buckets/{bucketId}/tasks` | |
| `savedFilter.ts` | `/filters[/{id}]` | `useSavedFilter` composable in the same file |
| `reactions.ts` | `{kind}/{id}/reactions`, delete `.../reactions/delete` | |
| `subscription.ts` | create/delete `/subscriptions/{entity}/{entityId}` | |
| `notification.ts` | `/notifications[/{id}]`, delete `/notifications` | |
| `team.ts`, `teamMember.ts` | `/teams[/{id}]`, `/teams/{teamId}/members[/{username}[/admin]]` | |
| `user.ts` `UserService` | getAll `/users` | |
| `userSettings.ts`, `avatar.ts`, `passwordUpdateService.ts`, `passwordReset.ts`, `emailUpdate.ts` | update `/user/settings/general`; `/user/settings/avatar[/upload]`; update `/user/password`; `/user/password/reset`, `/user/password/token`; email: `apiV2Url('user/settings/email')` PUT/DELETE, `.../resend` POST | |
| `apiToken.ts`, `caldavToken.ts`, `session.ts`, `botUser.ts`, `dataExport.ts` | `/tokens[/{id}]` + `GET /routes`; `/user/settings/token/caldav[/{id}]`; `/user/sessions[/{id}]`; `/user/bots[/{id}]`; `GET /user/export`, blob `POST /user/export/download` | |
| `totp.ts`, `accountDelete.ts` | get `/user/settings/totp`, posts `.../enroll`, `.../enable`, `.../disable`, blob `GET .../qrcode`; posts `/user/deletion/{request,confirm,cancel}` | |
| `admin/overviewService.ts`, `admin/projectService.ts`, `admin/userService.ts` | `GET /admin/overview`; getAll `/admin/projects`; getAll `/admin/users`, `POST /admin/users`, `DELETE /admin/users/{id}` | `PATCH apiV2Url('admin/users/{id}/password')`, `POST apiV2Url('admin/users/{id}/password-reset-email')` |
| `migrator/abstractMigration.ts`, `migrator/abstractMigrationFile.ts`, `migrator/csvMigration.ts` | update/auth/status at `apiV2Url('migration/<key>/{migrate,auth,status}')`; file upload `/migration/<key>/migrate`; CSV detect/preview uploads | |
| `timeEntry.ts` | plain functions on `apiV2Url('time-entries...')` with manual case conversion (`parseTimeEntry`) | not an `AbstractService` |

## How stores consume services

Stores instantiate services inside actions (`new ProjectService()`, `new TaskService()`) or hold one for `loading` state, wrap calls with `setModuleLoading` (`stores/helper.ts`), and copy results into reactive maps (`projectStore.projects[id]`, `taskStore.tasks`, `kanbanStore.buckets`). `stores/base.ts` uses `ProjectService.background()` for the project background blob. Tests mock the service module: `vi.mock('@/services/bucket', ...)` in `stores/kanban.test.ts`.

## Migration direction

Done on the new client: labels (`client/queries/labels.ts`, `composables/useLabels.ts`; `stores/tasks.ts` uses generated `taskLabelsCreate`/`taskLabelsDelete` and `createLabelMutationOptions`), invite links (`client/inviteLink.ts`, `views/admin/InviteLinksView.vue`), MCP info (`views/user/settings/Mcp.vue`), registration via invite (`authRegister`). Half-way: services calling `apiV2Url` (time entries, email update, admin user password, migrations, bulk task create) still go through axios and hand-convert case. Everything else is v1.

Rules (from `AGENTS.md` and `.agents/docs/api.md`):

- Do **not** add a service, model, or `modelTypes` interface for a new route. New routes are v2 and use `client/generated` + a query module.
- Existing services keep working; fix bugs in place, keep v1 swaggo docs accurate on the Go side.
- When a v1 model gains a field that legacy views read, update the `I*` interface and the model class (camelCase) as well as regenerating the client ([API contract](../../05-api-contract.md#keeping-both-sides-in-sync) step 6).

### Migrating a feature off the legacy layer

1. Confirm the v2 operations exist (`pkg/routes/api/v2/<resource>.go`); add them via the `api-v2-routes` skill if not, then `mage generate:frontend-client`.
2. Create `client/queries/<feature>.ts` following `labels.ts` (keys, `queryOptions`, `mutationOptions`, hooks, `ensure*`/`refresh*`, pure helpers) and `composables/use<Feature>s.ts` for reads.
3. Switch components to the composable and mutation hooks; replace `I<Feature>` imports with the generated type and rename fields to snake_case at the boundary (as `models/task.ts` does for labels).
4. Move store logic: reads via `ensure*`/`refresh*`, writes via `useMutation(options, queryClient)` in the store setup (`stores/tasks.ts` line 144).
5. Delete the service, model, interface, and their tests; run `pnpm lint:fix`, `pnpm vitest run`, and the relevant e2e specs; grep for remaining importers.
6. Update this page's tables and [stores](./stores.md).

## Dependencies

- **Uses:** axios (`helpers/fetcher.ts`), `change-case`, `helpers/utils.ts` (`omitBy`, `isNil`), `constants/permissions.ts`.
- **Used by:** stores, views and components listed above, `stores/auth.ts` (`UserModel`, `UserSettingsModel`, `AvatarService`, `UserSettingsService`).

## Invariants and assumptions

- v1 verb semantics: PUT creates, POST updates (`create()` / `update()`); do not "fix" this in a subclass.
- Request bodies are snake_cased exactly once (`payloadTransformed`); a subclass that pre-converts must disable `autoTransformBefore*`.
- `assignData` ignores `null`/`undefined`, so a field that the API legitimately nulls keeps its class default; models needing `null` must handle it in the constructor.
- `maxPermission` is only populated by `getM` (header) or copied from the input model; list results from `getAll` do not carry it.
- Services are stateful (`loading`, `totalPages`, `resultCount`, `uploadProgress`); share an instance only when you want shared state.

## Configuration

None beyond `window.API_URL` ([auth-and-session](./auth-and-session.md#api-url-discovery)).

## Error handling

Errors are axios errors; views call `getErrorText(e)` or `error(e)` from `message/index.ts`, which reads `e.response.data.code` for the i18n key. Services throw `Error('This model is not able to ...')` when a path is empty. v1 validation failures arrive as `412` with `invalid_fields`, parsed by `helpers/parseValidationErrors.ts`.

## Tests

- `services/abstractService.test.ts` (`getBlobUrl`, payload transforms on a retried request), `services/task.test.ts` (`bulkCreate`, `processModel`), `services/emailUpdate.test.ts`, `services/timeEntry.test.ts` (`parseTimeEntry`).
- `models/task.test.ts` (labels), `models/user.test.ts` (`getDisplayName`, avatar cache), `models/userSettings.test.ts`, `models/attachment.test.ts` (preview kinds).
- `helpers/case.test.ts`.
- Run: `cd frontend && pnpm vitest run src/services src/models src/helpers/case`.
- Not covered: most individual service path tables, `uploadFormData`, `getAll` header parsing, `prepareParams`.

## Gotchas and tech debt

- FIXMEs: `modelTypes/IAbstract.ts:4`, `IProject.ts:17`, `ILinkShare.ts:10`, `ISubscription.ts:6-7`, `ISavedFilter.ts:4`, `models/linkShare.ts:13`, `services/taskCollection.ts:48`; TODO `services/attachment.ts:70`.
- `frontend/docs/models-services.md` still documents `defaults()` and `/namespaces/...` paths; no model defines `defaults()` today.
- `models/task.ts` mixes camelCase fields with snake_case generated `Label` objects; any code touching `task.labels` must use `hex_color`, not `hexColor`.
- `apiV2Url` inside services bypasses the generated client's typing and interceptors' identity checks; it is a stop-gap.
- Per-instance axios interceptors mean a component that creates a service per call re-registers interceptors each time (cheap, but surprising in tests).

## Related pages

[api-client-generated-and-queries](./api-client-generated-and-queries.md), [auth-and-session](./auth-and-session.md), [stores](./stores.md), [task-detail](./task-detail.md), [project-views](./project-views.md), [Frontend architecture](../../04-frontend-architecture.md), [API contract](../../05-api-contract.md), [API design](../../../docs/api.md), backend [api-v1](../backend/api-v1.md), [Build a Vue feature](../../playbooks/build-vue-feature.md).
