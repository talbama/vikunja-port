# Data flow walkthroughs

Five end-to-end traces naming the exact functions and files at each hop. Read them to learn the shape of a request before adding one of your own. The four layers are always the same: Vue component → store or query module → HTTP client → Echo/Huma handler → `Do*` pipeline → model → DB → response → state update → render. The last trace is a background flow.

## 1. Login

```mermaid
sequenceDiagram
    participant V as views/user/Login.vue
    participant S as stores/auth.ts
    participant H as helpers/fetcher.ts (axios)
    participant R as pkg/routes/api/v1/login.go
    participant SH as pkg/routes/api/shared/auth.go
    participant AU as pkg/modules/auth/auth.go
    participant M as pkg/models/sessions.go
    participant RT as router/index.ts

    V->>S: authStore.login({username, password, totpPasscode?})
    S->>H: HTTP.post('login', snake_case body)
    H->>R: POST /api/v1/login
    R->>SH: AuthenticateUserCredentials(ctx, &user.Login)
    SH->>SH: user.CheckUserCredentials or ldap.AuthenticateUserInLDAP; enforceLoginTOTP
    SH-->>R: *user.User (or ErrWrongUsernameOrPassword 1011 / TOTP errors)
    R->>AU: NewUserAuthTokenResponse(user, c, long, nil)
    AU->>M: CreateSession(s, userID, deviceInfo, ip, long, oidc)
    AU->>AU: NewUserJWTAuthtoken(u, session.ID); SetRefreshTokenCookie (one per refresh path)
    AU-->>H: 200 {"token": "<jwt>"} + Set-Cookie
    H-->>S: response.data.token
    S->>S: saveToken(token, true); checkAuth() → decode JWT, refreshUserInfo() GET /user
    S-->>V: authenticated = true
    V->>RT: router.push({name: 'home'}) or redirectIfSaved()
```

Files and symbols:

| Hop | Where |
|---|---|
| Form and TOTP prompt | `frontend/src/views/user/Login.vue` (`needsTotpPasscode` computed from the store) |
| Store action | `frontend/src/stores/auth.ts` → `login()`; on error code 1017 it sets `needsTotpPasscode` |
| Transport | `frontend/src/helpers/fetcher.ts` → `HTTPFactory()`; body snake-cased by `objectToSnakeCase` |
| Route | `pkg/routes/routes.go` registers `/login` in the credential group with `noAuthRateLimit`; path listed in `unauthenticatedAPIPaths` |
| Handler | `pkg/routes/api/v1/login.go` → `Login` |
| Credential check | `pkg/routes/api/shared/auth.go` → `AuthenticateUserCredentials`, `enforceLoginTOTP`. `user.LoginFailedEvent` is dispatched from `pkg/user/user.go` → `CheckUserCredentials`; `LoginSucceededEvent` from `pkg/modules/auth/auth.go` → `IssueUserToken` |
| Token issue | `pkg/modules/auth/auth.go` → `NewUserAuthTokenResponse` → `IssueUserToken` → `models.CreateSession`, `NewUserJWTAuthtoken`, `SetRefreshTokenCookie` |
| Post-login | `authStore.checkAuth()` decodes the JWT and calls `refreshUserInfo()` (`GET /user`), then `App.vue` switches to the authenticated layout and `ContentAuth.vue` connects the websocket |

The v2 path (`POST /api/v2/login`) shares `AuthenticateUserCredentials` and `IssueUserToken`; only the handler file differs (`pkg/routes/api/v2/auth_login.go`). Expired JWTs later trigger the refresh flow in [API contract](05-api-contract.md#auth-and-session-flow).

## 2. Create a task from the list view (legacy stack)

```mermaid
sequenceDiagram
    participant C as components/tasks/AddTask.vue
    participant T as stores/tasks.ts
    participant SV as services/task.ts (AbstractService)
    participant E as pkg/routes/routes.go
    participant W as pkg/web/handler/create.go
    participant D as pkg/web/handler/core.go
    participant TK as pkg/models/tasks.go
    participant EV as pkg/events
    participant L as pkg/models/listeners.go

    C->>C: parseSubtasksViaIndention(title, quickAddMagicMode)
    C->>T: ensureLabelsExist(labels); findProjectId(...)
    C->>T: createNewTasksBulk(entries) or createNewTask({title, projectId, ...})
    T->>T: buildTaskFromQuickAddTitle() → parseTaskText (modules/quickAddMagic)
    T->>SV: new TaskService().create(task)
    SV->>E: PUT /api/v1/projects/:project/tasks (snake_case)
    E->>W: taskHandler.CreateWeb
    W->>W: ctx.Bind(&Task{}); validate
    W->>D: DoCreate(ctx, task, auth)
    D->>TK: task.CanCreate(s, a) → project write permission
    D->>TK: task.Create(s, a) → createTask(s, t, a, updateAssignees, setBucket)
    TK->>TK: index from project_task_counters, insert, position rows, default bucket, reminders, labels, assignees
    TK->>EV: DispatchOnCommit(s, &TaskCreatedEvent{Task, Doer})
    D->>D: s.Commit(); DispatchPending(ctx, s)
    EV-->>L: task.created → SendTaskCreatedNotification, HandleTaskCreateMentions, webhooks
    W-->>SV: 201 task JSON
    SV-->>T: TaskModel (camelCase)
    T->>T: addLabelsToTask(); kanbanStore.addTaskToBucket() if a kanban view is open
    T-->>C: created task; emits to the list which re-renders
```

Files and symbols:

| Hop | Where |
|---|---|
| Input parsing | `frontend/src/components/tasks/AddTask.vue`; `frontend/src/helpers/parseSubtasksViaIndention.ts`; `frontend/src/modules/quickAddMagic/quickAddMagic.ts` → `parseTaskText` |
| Store | `frontend/src/stores/tasks.ts` → `createNewTask`, `createNewTasksBulk`, `buildTaskFromQuickAddTitle`, `addLabelsToTask` (labels via the generated `taskLabelsCreate`) |
| Service | `frontend/src/services/task.ts` (`create: '/projects/{projectId}/tasks'`); `AbstractService.create` sends **PUT** |
| Route | `pkg/routes/routes.go` line ~708: `a.PUT("/projects/:project/tasks", taskHandler.CreateWeb)` |
| Pipeline | `pkg/web/handler/create.go` → `CreateWeb`; `pkg/web/handler/core.go` → `DoCreate` |
| Model | `pkg/models/tasks_permissions.go` → `CanCreate`; `pkg/models/tasks.go` → `Create` → `createTask` → `createTasks` (index assignment, `getDefaultBucketID`, positions, reminders) |
| Events | `pkg/models/events.go` → `TaskCreatedEvent` (`task.created`); listeners registered in `pkg/models/listeners.go` lines 41 and 47 |
| Response | `x-max-permission` not set on create; body is the task with server-filled `id`, `index`, `created_by` |

On the new stack the same operation is `POST /api/v2/projects/{project}/tasks`, operation id `tasks-create` in `pkg/routes/api/v2/tasks.go`, generated as `tasksCreate()`; it calls the same `DoCreate` → `Task.Create`.

## 3. Create a label (new stack: generated client + TanStack Query + Huma)

```mermaid
sequenceDiagram
    participant V as views/labels/NewLabel.vue
    participant Q as client/queries/labels.ts
    participant G as client/generated/sdk.gen.ts
    participant HT as client/http.ts
    participant HU as pkg/routes/api/v2/labels.go
    participant D as pkg/web/handler/core.go
    participant LB as pkg/models/label.go
    participant QC as TanStack QueryClient

    V->>Q: useCreateLabelMutation().mutateAsync(draft)
    Q->>QC: onMutate: cancelQueries(labelKeys.all), snapshot, optimistic setQueryData
    Q->>G: labelsCreate({body: {title, description, hex_color}})
    G->>HT: fetch POST /api/v2/labels (request interceptor adds Bearer)
    HT->>HU: labelsCreate(ctx, in)
    HU->>HU: authFromCtx(ctx)
    HU->>D: DoCreate(ctx, &in.Body, a)
    D->>LB: CanCreate (denies link shares) → Create (sets CreatedByID)
    D-->>HU: nil
    HU-->>HT: 201 {id, title, ..., created_by}
    HT-->>G: Response (throwOnError: errors throw)
    G-->>Q: Label
    Q->>QC: onSuccess: setQueryData(labelKeys.all, append); onSettled: invalidateQueries(labelKeys.all)
    Q-->>V: newLabel
    V->>V: router.push({name: 'labels.index'})
    QC-->>V: useLabels() consumers re-render from the cache
```

Files and symbols:

| Hop | Where |
|---|---|
| View | `frontend/src/views/labels/NewLabel.vue` (`createLabelDraft`, `useCreateLabelMutation`) |
| Query module | `frontend/src/client/queries/labels.ts` → `createLabelMutationOptions`, `labelKeys.all`, `labelsQuery` |
| Generated call | `frontend/src/client/generated/sdk.gen.ts` → `labelsCreate` (from operation id `labels-create`) |
| Client config | `frontend/src/client/http.ts` → `configureApiClient` (bearer, 401/code-11 refresh-and-retry) |
| Handler | `pkg/routes/api/v2/labels.go` → `labelsCreate`; registered by `RegisterLabelRoutes` via `init()` → `AddRouteRegistrar` |
| Pipeline and model | `pkg/web/handler/core.go` → `DoCreate`; `pkg/models/label_permissions.go` → `CanCreate`; `pkg/models/label.go` → `Create` |
| Errors | `translateDomainError` → problem+json; a `minLength:"1"` violation is rejected by Huma with 422 before the handler runs |
| Readers | `frontend/src/composables/useLabels.ts` → `useQuery(labelsQuery())` in `ListLabels.vue` and the filter autocomplete (`FilterInput.vue`, `FilterAutocomplete.ts`) |

Verified with curl on 2026-09-16: `POST /api/v2/labels {"title":"wiki-label"}` → 201; `{"title":""}` → 422.

## 4. Move a task between kanban buckets

```mermaid
sequenceDiagram
    participant K as components/project/views/ProjectKanban.vue
    participant KS as stores/kanban.ts
    participant TB as services/taskBucket.ts
    participant TP as services/taskPosition.ts
    participant R as pkg/routes/routes.go
    participant B as pkg/models/kanban_task_bucket.go
    participant P as pkg/models/task_position.go

    K->>K: drag end → updateTaskPosition(e)
    K->>K: calculateItemPosition(prev.position, next.position)
    K->>KS: setBucketById(optimistic bucket contents)
    K->>TP: taskPositionService.update({taskId, projectViewId, position})
    TP->>R: POST /api/v1/tasks/:task/position → taskPositionHandler.UpdateWeb → DoUpdate
    R->>P: TaskPosition.CanUpdate → Update (upsert; RecalculateTaskPositions on precision exhaustion)
    K->>TB: taskBucketService.update(new TaskBucketModel({taskId, bucketId, projectViewId, projectId}))
    TB->>R: POST /api/v1/projects/:project/views/:view/buckets/:bucket/tasks → taskBucketProvider.UpdateWeb → DoUpdate
    R->>B: TaskBucket.CanUpdate → Update: limit check (10004), done-bucket ⇄ done flag, upsert task_buckets, TaskUpdatedEvent
    B-->>K: updated task (done flag may have flipped)
    K->>KS: setTaskInBucket / ensureTaskIsInCorrectBucket
```

Files and symbols: `frontend/src/components/project/views/ProjectKanban.vue` → `updateTaskPosition` (line ~547), `frontend/src/helpers/calculateItemPosition.ts`, `frontend/src/stores/kanban.ts` → `moveTaskToBucket`, `setBucketById`, `ensureTaskIsInCorrectBucket`; backend `pkg/routes/routes.go` lines ~735 and ~971, `pkg/models/kanban_task_bucket.go` → `Update` (line ~248) → `updateTaskBucket` (done-bucket logic around lines 138–210), `pkg/models/task_position.go` → `Update`, `RecalculateTaskPositions`. Both writes are separate requests; a failure of the second leaves the position changed but the bucket not, which the store repairs on the next bucket load.

## 5. Background: comment → notification → mail, bell, websocket

```mermaid
sequenceDiagram
    participant C as components/tasks/partials/Comments.vue
    participant TC as pkg/models/task_comments.go
    participant D as pkg/web/handler/core.go
    participant EV as pkg/events (watermill gochannel)
    participant L1 as listeners.go: SendTaskCommentNotification
    participant L2 as listeners.go: MarkTaskUnreadOnComment / HandleTaskUpdateLastUpdated / mentions
    participant N as pkg/notifications
    participant MAIL as pkg/mail daemon
    participant WSL as pkg/websocket/listener.go
    participant BELL as components/notifications/Notifications.vue

    C->>D: PUT /api/v1/tasks/:task/comments → DoCreate
    D->>TC: TaskComment.Create → CreateWithTimestamps
    TC->>EV: DispatchOnCommit(s, &TaskCommentCreatedEvent{Task, Comment, Doer})
    D->>EV: Commit; DispatchPending → publish "task.comment.created"
    EV->>L1: Handle(msg) (retry up to 5x; poison topic after)
    L1->>N: for each subscriber ≠ doer: notifications.Notify(user, &TaskCommentNotification{...}, sess)
    N->>N: notifyDB → insert into notifications; events.Dispatch(&NotificationCreatedEvent{UserID, Notification})
    N->>MAIL: notifyMail → SendMail(opts) if the user has mail notifications enabled
    EV->>WSL: NotificationListener.Handle → hub.PublishForUser(userID, "notification.created", row)
    WSL-->>BELL: {"event":"notification.created","data":{...}} over /api/v1/ws
    BELL->>BELL: subscribe callback prepends the notification; polling fallback when disconnected
    EV->>L2: mark task unread for other users; bump task.updated; resolve @mentions
```

Files and symbols:

| Hop | Where |
|---|---|
| Comment create | `pkg/models/task_comments.go` → `Create`, `CreateWithTimestamps`, dispatch at line ~102 |
| Event and listeners | `pkg/models/events.go` → `TaskCommentCreatedEvent` (`task.comment.created`); `pkg/models/listeners.go` lines 39, 50, 61 register `SendTaskCommentNotification`, `HandleTaskUpdateLastUpdated`, `MarkTaskUnreadOnComment`; mention handling via `HandleTaskCommentEditMentions` on edits |
| Notification | `pkg/models/listeners.go` → `SendTaskCommentNotification.Handle` (line ~504) builds `TaskCommentNotification` (`pkg/models/notifications.go`) and calls `notifications.Notify` |
| Channels | `pkg/notifications/notification.go` → `Notify`, `notifyMail`, `notifyDB`; `pkg/notifications/database.go` dispatches `NotificationCreatedEvent` after insert |
| Mail | `pkg/mail/send_mail.go` → `SendMail` queues onto the daemon started by `StartMailDaemon` |
| Websocket | `pkg/websocket/listener.go` → `NotificationListener.Handle` → `Hub.PublishForUser`; registered in `RegisterListeners` |
| Frontend | `frontend/src/components/notifications/Notifications.vue` (`subscribe('notification.created', ...)` at line ~162, polling fallback at ~192) via `frontend/src/composables/useWebSocket.ts` |
| Webhooks | If the project has a webhook subscribed to `task.comment.created`, `RegisterEventForWebhook` fans out a `WebhookDeliveryEvent` per target (`pkg/models/listeners.go`, `webhooks.go`) |

What can go wrong: listeners run after the HTTP response, so a failure is invisible to the client; check the API log for the listener name and the `poison` topic. Nothing is durable: a restart mid-retry drops the event. See [cron-and-background-jobs](components/backend/cron-and-background-jobs.md) and [playbooks/background-job](playbooks/background-job.md).
