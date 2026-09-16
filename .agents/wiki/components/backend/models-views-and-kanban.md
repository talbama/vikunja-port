# Models: project views and kanban

Project views (`project_views`) decide how a project's tasks are presented; kanban views add buckets (`buckets`) and per-view task membership (`task_buckets`). This page covers `pkg/models/project_view.go`, `kanban.go`, `kanban_task_bucket.go`, their permission files and the v2 routes on top. Ordering inside a bucket is `task_positions`, documented in [models-tasks](./models-tasks.md#positions-task_positiongo); listing tasks through a view is [models-filtering-and-search](./models-filtering-and-search.md). Entity summary: [Data model](../../06-data-model.md#kanban-membership-and-position).

## Responsibility

- Owns: view CRUD and defaults, view-kind and bucket-mode enums, bucket CRUD, "task X is in bucket Y of view Z", the done-bucket ↔ done-flag coupling, bucket limits, filter-mode buckets, the favorites pseudo views.
- Does not own: positions (`task_position.go`), the task row itself, saved filters (`saved_filters.go`, but their pseudo projects get views from here), the frontend drag logic (`frontend/src/components/project/views/ProjectKanban.vue`, `frontend/src/stores/kanban.ts`).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `ProjectView.ReadAll/ReadOne/Create/Update/Delete`, `Can*` | `project_view.go`, `project_view_permissions.go` | v1 `/projects/:project/views*`; v2 `pkg/routes/api/v2/project_views.go` → `project-views-list/read/create/update/delete` |
| `CreateDefaultViewsForProject(s, project, auth, createBacklogBucket, createDefaultListFilter)` | `project_view.go` | `project.go:1017` (new project, `createDefaultListFilter=true`), `saved_filters.go:143` (`true,false`), `pkg/modules/migration/create_from_structure.go:386` |
| `GetProjectViewByID`, `GetProjectViewByIDAndProject`, `getViewsForProject` | `project_view.go` | positions, buckets, collections |
| `Bucket.ReadAll/Create/Update/Delete`, `Can*` | `kanban.go`, `kanban_permissions.go` | v1 `/projects/:project/views/:view/buckets*`; v2 `buckets.go` → `buckets-list/create/update/delete` |
| `GetTasksInBucketsForView` | `kanban.go` | `getTaskOrTasksInBuckets` (`task_collection.go`) for kanban views; v2 `project-view-buckets-tasks-list` (`GET /projects/{project}/views/{view}/buckets/tasks`) |
| `getDefaultBucketID`, `getBucketByID`, `insertTaskBuckets` | `kanban.go`, `project_view.go` | task create/update, saved filters, view sync |
| `TaskBucket.Update`, `CanUpdate`; `updateTaskBucket` | `kanban_task_bucket.go` | v1 `POST /projects/:project/views/:view/buckets/:bucket/tasks`; v2 `task-bucket-update` `PUT` on the same path (`task_bucket.go`, URL wins over body for project, view and bucket) |

## Key types and functions

| Name | File | What it does |
|---|---|---|
| `ProjectViewKind` | `project_view.go` | `List 0, Gantt 1, Table 2, Kanban 3`; `MarshalJSON`/`UnmarshalJSON` as strings, `Schema()` so Huma emits a string enum; the `enums:` struct tag on `ProjectView.ViewKind` must be kept in sync by hand |
| `BucketConfigurationModeKind` | `project_view.go` | `None 0, Manual 1, Filter 2`, same JSON/Schema treatment |
| `ProjectView` | `project_view.go` | `Title`, `ProjectID`, `ViewKind`, `Filter *TaskCollection` (JSON column), `Position`, `BucketConfigurationMode`, `BucketConfiguration []*ProjectViewBucketConfiguration` (title + filter per synthetic bucket), `DefaultBucketID`, `DoneBucketID` |
| `Bucket` | `kanban.go` | `Title`, `ProjectViewID`, `Limit` (0 = unlimited), computed `Count`, `Position`, `CreatedBy`; embeds `TaskCollection` so bucket routes accept filter params; `ProjectID` is `xorm:"-"` and comes from the URL |
| `TaskBucket` | `kanban_task_bucket.go` | `(task_id, project_view_id)` unique, `bucket_id`; response carries the resolved `Bucket` (with count) and the `Task` after any done change |
| `FavoritesPseudoProject` | `project.go:162` | Project `-1` with in-memory views `-1` List (`done = false` filter), `-2` Gantt, `-3` Table; no kanban |
| `normalizeBucketConfigurationMode(OnUpdate)`, `resolveBucketIDs`, `syncManualKanbanBuckets`, `healBucketIDs` | `project_view.go` | Keep mode and bucket ids consistent across create/update |
| `createDefaultKanbanBuckets`, `addTasksToView`, `tasksWithoutBucketInView`, `filteredTasksWithoutBucketInView` | `project_view.go` | Seed To-Do/Doing/Done and place unbucketed tasks |
| `getFilterValueForBucketFilter` | `task_collection.go` | Rewrites `bucket_id = N` into the Nth configured filter for filter-mode views |
| `checkBucketLimit`, `moveTaskToDoneBuckets`, `moveTaskToDefaultBuckets`, `setTasksInBucketInViews` | `tasks.go` | The task side of the coupling ([models-tasks](./models-tasks.md)) |

## Internal structure

### View lifecycle

- `createProjectView`: `normalizeBucketConfigurationMode` (non-kanban → `none`; kanban with `none` → `manual`), `validateProjectViewFilters` (view filter and every per-bucket filter must parse), insert with `DefaultBucketID`/`DoneBucketID` zeroed, `Position = calculateDefaultPosition(id, position)` (`id * 2^16` when 0), then for manual kanban `createDefaultKanbanBuckets` (To-Do 100, Doing 200, Done 300; sets default = To-Do, done = Done) and, when `addExistingTasksToView`, `addTasksToView` + `RecalculateTaskPositions`.
- `CreateDefaultViewsForProject` creates List (position 100, filter `done = false` only when `createDefaultListFilter`), Gantt 200, Table 300, Kanban 400 (manual) and sets `project.Views`.
- `Update`: `normalizeBucketConfigurationModeOnUpdate` keeps a stored `filter`/`manual` mode when v1 omits it (and copies the stored configuration for filter mode), validates filters, `resolveBucketIDs` (an id of a bucket in another view → `ErrBucketDoesNotBelongToProjectView` 10002; a gone or stale id silently becomes 0), writes `title, view_kind, filter, position, bucket_configuration_mode, bucket_configuration` and, only for kanban, `default_bucket_id, done_bucket_id`; then `syncManualKanbanBuckets`: when a view just became a manual kanban (`pv.ID > 0` guards pseudo views), reuse existing buckets (`healBucketIDs`) or seed defaults, put unbucketed tasks in the default bucket, recalculate positions.
- `Delete` resolves the view under the path project first, then deletes the view, its `task_buckets` and `task_positions`. Buckets rows are not deleted here (Unverified: whether anything removes orphan `buckets` rows).
- Permissions (`project_view_permissions.go`): instance admins bypass; saved-filter views delegate to `SavedFilter.Can*`; read = project read; create/update/delete = project admin (`Project.IsAdmin`), and update/delete first check the view belongs to the path project.

### Buckets

- `Bucket.ReadAll` (v1 `GET …/buckets`, v2 `buckets-list`) needs `view.CanRead`, returns every bucket of the view sorted by `position`, unpaginated and without tasks; `Count` is 0 here. Buckets with tasks come from the tasks endpoint.
- `Create` inserts then sets the default position; `Update` writes only `title, limit, position`; `Delete` refuses the last bucket (`ErrCannotRemoveLastBucket` 10003), clears `DefaultBucketID`/`DoneBucketID` on the view through `pv.Update`, moves every `task_buckets` row to the (new) default bucket, then deletes the bucket. Tasks are never deleted with a bucket.
- `getDefaultBucketID`: `view.DefaultBucketID` if set, else the bucket with the lowest `position, id`.
- Permissions (`kanban_permissions.go`): `CanCreate` = write on the view's project; `CanUpdate/CanDelete` load the bucket, resolve its view under the path project, then `canWriteBucketProject` (instance admin → saved filter `CanUpdate` → `Project.CanWrite`; deliberately not `Project.CanUpdate`, which tolerates archived projects).

### Listing a kanban view (`GetTasksInBucketsForView`)

- Manual mode: buckets from the DB. Filter mode: one synthetic `Bucket` per `BucketConfiguration` entry, `ID` = index, `Position` = index, created-by = caller.
- Sort is forced to `position asc` for the view. If the parsed filter contains `bucket_id`, only that bucket is kept. For each bucket the searcher runs once with `(<request filter>) && bucket_id = N` (manual) or `(<bucket filter>)` (filter mode, whose `Search` also overrides the request search), so `page`/`per_page` apply per bucket and `bucket.Count` is that query's total. Tasks get `BucketID` set and are hydrated with `addMoreInfoToTasks(view)` so `Position` is filled. Tasks with no `task_buckets` row for the view do not appear anywhere (comment at `kanban.go:285`).
- `getFilterValueForBucketFilter` lets `filter=bucket_id = 2` on a filter-mode view mean "the second configured filter".

### Moving a task (`updateTaskBucket`)

```mermaid
sequenceDiagram
    participant UI as ProjectKanban.vue (drag end)
    participant P as PUT /tasks/{task}/position
    participant B as PUT /projects/{p}/views/{v}/buckets/{b}/tasks
    participant M as models.updateTaskBucket
    participant DB as task_buckets / tasks
    UI->>UI: position = midpoint(neighbours); optimistic count -1/+1
    UI->>P: TaskPositionService.update {task_id, project_view_id, position}
    P-->>UI: position (may differ after recalculation)
    alt bucket changed
        UI->>B: TaskBucketService.update {task_id}
        B->>M: handler.DoUpdate (CanUpdate: bucket.canDoBucket && task.CanWrite)
        M->>DB: read current row; no-op if same bucket
        M->>M: view + bucket must match (10002); task.ReadOne
        M->>M: checkBucketLimit when bucket changes (10004)
        M->>M: done bucket in? done=true (repeating: updateDone, reroute to DefaultBucketID or stay)
        M->>M: done bucket out? done=false
        M->>DB: UPDATE tasks done, due_date, start_date, end_date, done_at; updateReminders
        M->>DB: upsert done bucket in every other manual kanban view (when now done)
        M->>DB: upsert task_buckets (task_id, view) → bucket
        M-->>UI: {task, bucket{count}}; TaskUpdatedEvent on commit
    end
```

- `TaskBucket.CanUpdate` checks the bucket through `canDoBucket` and the task through `Task.CanWrite`, because the body's task may live in another project.
- The bucket limit is enforced only when the bucket changes (`b.BucketID != oldTaskBucket.BucketID`); reordering inside a full bucket is allowed. `checkBucketLimit` counts `task_buckets` rows, or, for saved-filter and filtered views, runs a `TaskCollection` with `bucket_id = N` so tasks that no longer match the filter are not counted (#355, #2672). The check is `count + pending >= limit`.
- Moving a repeating task into the done bucket runs `updateDone` (dates shift, `done = false` again) and lands it in `view.DefaultBucketID`, or leaves it where it was when no default is configured; the response `Task` reflects that.
- Moving out of the done bucket clears `done` and `done_at`. The task's `task_positions` row is not touched here; the frontend writes the position first (`ProjectKanban.vue:610-619`).
- The reverse direction (`Task.Update` with `done` toggled) is `moveTaskToDoneBuckets`/`moveTaskToDefaultBuckets` in `tasks.go`; creating a task with `bucket_id = DoneBucketID` marks it done (`setTasksInBucketInViews`).

### Frontend consumer (brief)

`frontend/src/stores/kanban.ts` holds `buckets`, per-bucket pagination (`taskPagesPerBucket`, `allTasksLoadedForBucket`) and helpers (`setTaskInBucket`, `ensureTaskIsInCorrectBucket`, `moveTaskToBucket`, `loadBucketsForProject`, `loadNextTasksForBucket`, `createBucket/deleteBucket/updateBucket`). It still uses the legacy `BucketService`/`TaskCollectionService`; `ProjectKanban.vue` uses `TaskPositionService` then `TaskBucketService` on drop and adjusts counts optimistically. Generated-client equivalents exist (`taskBucketUpdate`, `tasksPositionUpdate` in `src/client/generated`). See [project-views](../frontend/project-views.md) and [stores](../frontend/stores.md).

## Dependencies

- **Uses:** `pkg/db` (`Type`, dialect-specific upserts), `pkg/events`, `pkg/user`, `pkg/log`, `huma` (schema hooks), `xorm.io/builder`; `tasks.go` helpers for limits and done routing; `task_position.go` for locking and recalculation; `task_collection.go`/`task_search.go` for listing.
- **Used by:** task create/update/delete (`tasks.go`), saved filters (views for pseudo projects), project create/duplicate (`project.go`, `project_duplicate.go`), importers, v1/v2 routes, MCP tools, the frontend kanban and list views.

## Invariants and assumptions

- One `task_buckets` row per `(task_id, project_view_id)`; every insert path is an upsert or ignore-on-conflict (`TaskBucket.upsert`, `insertTaskBuckets`).
- A bucket's `project_view_id` must equal the view being written; `updateTaskBucket`, `resolveBucketID`, `healBucketIDs` and `resolveProvidedBuckets` (`tasks.go`) all enforce it.
- Only manual kanban views have `task_buckets` rows and default/done buckets; filter-mode buckets are computed at read time and cannot be dragged into (bucket ids are indexes, not rows).
- A task marked done sits in the done bucket of every manual kanban view of its project that has one, and vice versa (`updateTaskBucket` fan-out; `moveTaskToDoneBuckets`). Repeating tasks are the exception: they go back to the default bucket.
- A view always has at least one bucket while it is a manual kanban (`ErrCannotRemoveLastBucket`), so `getDefaultBucketID` can return something.
- Bucket counts never join `tasks`, so soft-deleted tasks must have their `task_buckets` rows removed at delete time (`Task.Delete`).
- `ProjectView.Position` and `Bucket.Position` share `calculateDefaultPosition`; default views are 100/200/300/400.
- Pseudo views (`ID < 0`) exist only in memory; nothing may write rows keyed by them (`syncManualKanbanBuckets` guard, `GetProjectViewByIDAndProject` special case).
- Enum wire values are strings on both APIs; the frontend mirrors them in `frontend/src/modelTypes/IProjectView.ts` (`PROJECT_VIEW_KINDS`), see [Data model](../../06-data-model.md#enums-duplicated-across-sides).

## Configuration

None.

## Error handling

| Code | Error | HTTP | Raised by |
|---|---|---|---|
| 3014 | `ErrProjectViewDoesNotExist` | 404 | `GetProjectViewByID(AndProject)` |
| 10001 | `ErrBucketDoesNotExist` | 404 | `getBucketByID`, `resolveProvidedBuckets` (also used to hide orphaned buckets of deleted views) |
| 10002 | `ErrBucketDoesNotBelongToProjectView` | 400 | `updateTaskBucket`, `resolveBucketID` |
| 10003 | `ErrCannotRemoveLastBucket` | 412 | `Bucket.Delete` |
| 10004 | `ErrBucketLimitExceeded` | 412 | `checkBucketLimit` (task create, bulk create, bucket move) |
| 10005 | `ErrOnlyOneDoneBucketPerProject` | 412 | defined in `error.go`; no non-test code constructs it (grep 2026-09-16). One done bucket per view is enforced structurally by `done_bucket_id` being a single column |
| 10006 | `ErrTaskAlreadyExistsInBucket` | 400 | defined; no non-test code constructs it either |
| 4028 | `ErrNeedsFullRecalculation` | 500 | position repair fallback inside moves |

Filter validation errors on views are the 4xxx codes from [models-filtering-and-search](./models-filtering-and-search.md#error-handling).

## Tests

- `project_view_test.go` (614 lines): `TestProjectView_Create`, `TestProjectView_Update` (mode normalization, bucket id resolution, becoming a kanban), `TestProjectView_InsertTaskBuckets`, `TestProjectView_SavedFilterWithBucketIDFilter`. `mage test:filter TestProjectView`.
- `kanban_test.go`: `TestBucket_ReadAll`, `TestBucket_Delete`, `TestBucket_Update`, `TestBucket_CanCreate`, `TestBucket_CanUpdate`. `kanban_task_bucket_test.go` (463 lines): full bucket, reorder in a full bucket, bucket on another view, into/out of done bucket, repeating tasks (three cases), done task already in another view's done bucket, saved filter with a limited empty bucket, done timestamp kept across projects. `mage test:filter 'TestBucket_|TestTaskBucket_Update'`.
- `task_position_view_test.go`: `TestTaskPositionCanUpdateValidatesView` (GHSA-w39f-h553-h2mx). `tasks_test.go` subtests "marking a task as done should move it to the done bucket", "repeating tasks should not be moved to the done bucket", "move done task to another project with a done bucket".
- Fixtures: `pkg/db/fixtures/project_views.yml` (1017 lines; view 4 is project 1's kanban with `default_bucket_id: 1`, `done_bucket_id: 3`, `bucket_configuration_mode: 1`), `buckets.yml` (bucket 1 `limit: 9999999`, bucket 2 `limit: 3`, bucket 3 = done bucket, bucket 4 in view 8 of another project), `task_buckets.yml` (task 2 sits in the done bucket 3). Tests depend on these ids; append, never renumber.
- Not covered: filter-mode bucket listing beyond `TestKanbanViewBucketFiltering` (`task_search_test.go`); `Bucket.Delete` moving tasks to a newly computed default when the deleted bucket was the default.

## Gotchas and tech debt

- `Bucket.Delete` calls `pv.Update` to clear ids, which re-runs `syncManualKanbanBuckets`; harmless today because the view is already manual kanban, but a change there runs on every bucket deletion.
- `Bucket.Count` is only meaningful in tasks-in-buckets responses and in the `TaskBucket.Update` response (`bucket.Count++` after the upsert, or the count from `checkBucketLimit`); `buckets-list` returns 0.
- `updateTaskBucket` ignores the `updateDoneAt` return of `updateDone` and writes `done_at` itself; keep the two in sync if the semantics change.
- Per-bucket pagination means `per_page=50` on a kanban with 5 buckets returns up to 250 tasks; there is no global cap.
- Enum `enums:` tags (`ViewKind`, `BucketConfigurationMode`) are maintained by hand next to the `Schema()` methods (`project_view.go:86-88`, `:99-101`).
- `Delete` on a view leaves `buckets` rows behind; the orphan repair command only targets positions (`DeleteOrphanedTaskPositions`).
- Frontend still on the legacy service layer for kanban; new work must use the generated client ([Conventions](../../08-conventions.md#data-layer)).
- Hotspots: `kanban_task_bucket.go` and `tasks.go` bucket routing changed repeatedly around repeating tasks (#2573) and limits (#355, #2672); re-read the `kanban_task_bucket_test.go` cases before touching either.

## Related pages

- [models-tasks](./models-tasks.md), [models-filtering-and-search](./models-filtering-and-search.md), [models-projects-and-permissions](./models-projects-and-permissions.md)
- [crud-framework](./crud-framework.md), [api-v2-huma](./api-v2-huma.md), [events-and-listeners](./events-and-listeners.md), [db-and-migrations](./db-and-migrations.md), [cli-commands](./cli-commands.md)
- Frontend: [project-views](../frontend/project-views.md), [stores](../frontend/stores.md), [task-detail](../frontend/task-detail.md)
- [Data flows: kanban move](../../10-data-flows.md), [Data model](../../06-data-model.md), [playbooks/fix-a-bug](../../playbooks/fix-a-bug.md)
