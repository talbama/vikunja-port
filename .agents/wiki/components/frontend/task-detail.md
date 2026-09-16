# Task detail

`views/tasks/TaskDetailView.vue` (1534 lines) and everything under `components/tasks/`: the task document as a page or as a modal over a project view, its attribute partials, the quick-add box, the home/upcoming task lists, and the small helpers they share. Paths are under `frontend/src/`; verified 2026-09-16. Backend counterpart: [models-tasks](../backend/models-tasks.md).

## Responsibility

- Owns: loading one task with its expansions, the "which attribute sections are visible" state, the save path for every field, keyboard shortcuts, modal-vs-page rendering, permission gating, comments, attachments, relations, reminders, repeat settings, bucket selection.
- Does not own: the task list per view ([project-views](./project-views.md)), the kanban board copy ([stores](./stores.md#kanban-srcstoreskanbants)), the editor itself ([editor](./editor.md)), quick-add parsing ([filters-and-quick-add](./filters-and-quick-add.md)), time tracking (`components/time-tracking/TaskTimeTracking.vue`).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `task.detail` (`/tasks/:id`, props `taskId`) | `views/tasks/TaskDetailView.vue` | `RouterLink`s in list/table rows; `router.push({name: 'task.detail', state: {backdropView}})` from `KanbanCard.vue`, `ProjectKanban.openTask`, gantt bars |
| Modal rendering | `components/home/ContentAuth.vue` → `useRouteWithModal()` renders the route component inside `<Modal>` with `backdropView` added to the props while the previous route stays as backdrop | any push with `history.state.backdropView` |
| `AddTask.vue` (emits `tasksAdded`) | `components/tasks/AddTask.vue` | `ProjectList.vue`, `Home.vue`, `QuickActions.vue` |
| `TaskForm.vue` (emits `createTask(title)`) | `components/tasks/TaskForm.vue` | `ProjectGantt.vue` |
| `ShowTasks.vue` (props `dateFrom`, `dateTo`, `showNulls`, `showOverdue`, `labelIds`) | `views/tasks/ShowTasks.vue` | `Home.vue`, route `tasks.range` (`/tasks/by/upcoming`) |
| `fetchTaskById(id)` | `helpers/fetchTaskById.ts` | `components/input/editor/TaskLinkPill.vue`, `components/time-tracking/TimeEntryList.vue` |

## Key types and functions

### `TaskDetailView.vue`

| Area | Lines | What it does |
|---|---|---|
| Loading | 940-986 | `watch(props.taskId, immediate)`: `TaskService.get({id}, {expand: ['reactions','comments','is_unread','buckets', +'time_entries_count' if pro]})` → `Object.assign(task.value, loaded)`, `taskColor`, `setActiveFields()`, `taskStore.markTaskAsRead` when `isUnread`, `baseStore.handleSetCurrentProjectIfNotSet(lastProject)`. 403 and 404 → `router.replace({name: 'not-found'})`. `visible` flips in `finally` so partials never mount on an empty model (template comment line 10). |
| Heading and breadcrumb | 23-64 | `Heading` partial; ancestors from `projectStore.getAncestors(project)`; a crumb becomes `router.back()` when the history back entry contains `/projects/<id>/`; `BucketSelect` sits in the breadcrumb. |
| Attribute sections | 988-1104 | `FieldType` union and `activeFields` reactive map. `setActiveFields()` derives visibility from the model (assignees, attachments, timeTracking count, dates, labels, percentDone, priority, relatedTasks, reminders, repeatAfter). `setFieldActive(name)` shows a section, focuses its element via `activeFieldElements` (filled by `setFieldRef`), scrolls, and opens the `Datepicker` for date fields (`useTemplateRef`). `openAttachments()` also triggers `Attachments.openFilePicker()`. |
| Save | 1106-1142 | `saveTask(currentTask = klona(task), undoCallback?)`: bails when `!canWrite`; copies `taskColor` into `hexColor`; if `endDate` is null but start and due exist, `endDate = dueDate`; `taskStore.update` → `Object.assign(task.value, updated)` → `setActiveFields()` → `success(t('task.detail.updateSuccess'), [undo action])`. Callers: `Datepicker @closeOnChange`, `Reminders`, `RepeatAfter`, `ColorPicker`, `setPriority`, `setPercentDone`, `toggleTaskDone` (with `playPopSound` and itself as undo), `removeRepeatAfter`, `changeProject`, Ctrl/Meta+S. |
| Other actions | 1150-1240 | `deleteTask` → `taskStore.delete` → `project.index`; `changeProject` → `kanbanStore.removeTaskInBucket` first, then save, then `baseStore.setCurrentProject`; `toggleFavorite`, `duplicateCurrentTask` (pushes to the new task); `setRelatedTasksActive` clicks `#showRelatedTasksFormButton`. |
| Modal vs page | 838, 15-22, 445-448 | `isModal = Boolean(props.backdropView)`. Page mode shows a back button (`router.back()` when `lastProject`, else `project.index`). The action column renders when `canWrite || isModal`. `onBeforeRouteLeave` waits up to 5 s for `lastProjectOrTaskProject` and re-sets the current project so the sidebar highlight survives. |
| Permission gating | 825-828 | `canWrite = task.maxPermission !== null && task.maxPermission > PERMISSIONS.READ` (from the `x-max-permission` header via `AbstractService`). Read-only renders `AssigneeList` instead of `EditAssignees`, passes `disabled`/`can-write` to every partial, hides the action column, and shows `CreatedUpdated` under the content. |
| Pro gating | 738 | `timeTrackingEnabled = configStore.isProFeatureEnabled(PRO_FEATURE.TIME_TRACKING)` gates the `TaskTimeTracking` section, its button, and the `time_entries_count` expand. |
| Scroll helpers | 856-938 | `resolveScrollContainer` walks up to the first `overflow-y: auto|scroll|overlay` ancestor (the modal scrolls, the page does not); `useIntersectionObserver` on `contentBottomMarker` and `useMutationObserver` drive the floating "scroll to comments" button. |
| Shortcuts | 1144-1148 | `useTaskDetailShortcuts({task, taskTitle, onSave})`; per-button `v-shortcut` from `constants/shortcuts.ts` `SHORTCUTS.taskDetail` (`KeyT` done, `KeyS` favorite, `KeyL` labels, `KeyP` priority, `KeyC` color, `KeyA` assignees, `KeyF` attachments, `KeyR` relations, `KeyM` move, `KeyD` due date, `Alt/Shift+KeyR` reminder, `Delete/Backspace` delete, `KeyU` open project). |

`composables/useTaskDetailShortcuts.ts`: a document `keydown` listener; `Control/Meta+KeyS` saves even inside inputs; outside inputs `Control+Period` copies the URL and `Period` pressed 1/2/3 times within 300 ms copies identifier, identifier + title, or identifier + title + URL.

### Partials (`components/tasks/partials/`)

| Partial | Lines | Store / service | Notes |
|---|---|---|---|
| `Heading.vue` | 239 | `taskStore.update` | Contenteditable title; empty title is reverted with `error(t('task.detail.titleRequired'))`; unsaved changes block unload (`beforeunload`); `copyUrl` resolves `task.detail` with `?taskId=`; emits `update:task`, `close`. |
| `Description.vue` | 239 | `taskStore.update` | TipTap through `components/input/AsyncEditor`; 5 s debounce (`saveWithDelay`), save on `onBeforeUnmount` and `onBeforeRouteLeave`; draft key `task-description-<id>` cleared by `clearEditorDraft` after a successful save (drafts are written by the editor, see [editor](./editor.md)); a 404 during save is swallowed; "Saving…" is held for `MIN_SAVING_DWELL = 500` ms for screen readers. Attachment uploads from the editor go through `uploadFilesForEditor(props.attachmentUpload)`. |
| `Attachments.vue` | 811 | `AttachmentService` (`PUT/GET/DELETE /tasks/{t}/attachments`), `taskStore.setCoverImage` | Document-wide `useDropZone`, ignoring drops that target the editor (`eventTargetsEditor`) and drags without files; the overlay is teleported into the topmost open `dialog.modal-dialog` so it paints above the modal. Preview via `attachmentService.getBlobUrl` with a `previewRequestToken` to drop stale responses; `ImageLightbox`, `FilePreview`, `AudioPreview` (one player at a time). Emits `update:attachments` and `taskChanged` (cover image). Exposes `openFilePicker`. **No client-side size check**: the server's `maxFileSize` from `configStore` is not consulted here (Unverified: no TODO comment exists, but no validation was found either). |
| `Comments.vue` | 649 | `TaskCommentService` (`/tasks/{t}/comments[/{id}]`), `authStore.saveUserSettings` | Uses `initialComments` from the task expand when sorted ascending and below `maxItemsPerPage`, otherwise pages via `PaginationEmit`. Sort order lives in `frontendSettings.commentSortOrder` (local only for link shares). Edit autosaves after 5 s (`editCommentWithDelay`). Reply quotes the parent in a `<blockquote data-comment-id>` after stripping `<mention-user>` (no re-notification); `commentReplyContext.ts` provides `findComment`/`scrollAndHighlightComment` to the editor. Reactions per comment via `Reactions.vue`. Draft key `task-comment-<taskId>`. Disabled when `configStore.taskCommentsEnabled` is false. |
| `RelatedTasks.vue` | 512 | `TaskRelationService` (`PUT /tasks/{t}/relations`, `DELETE .../{kind}/{other}`), `TaskService.getAll` search, `taskStore.createNewTask`, `taskStore.update` | Keeps its own `relatedTasks` map; `createAndRelateTask(title)` creates in `props.projectId` then relates; default kind from `frontendSettings.defaultTaskRelationType`; `toggleTaskDone` on a related task. FIXME at line 504 about `FancyCheckbox` height. |
| `Reminders.vue` + `ReminderDetail.vue` + `ReminderPeriod.vue` | 117 / 332 / 153 | none (emit) | `v-model` array; `defaultRelativeTo` chosen by the view from due/start/end; `ReminderDetail` uses `Datepicker`-style presets and `helpers/time/period`. `Reminders.story.vue` is a Histoire story. |
| `RepeatAfter.vue` | 186 | none | `v-model` is the whole task; sets `repeatAfter {amount, type}` and `repeatMode` (`TASK_REPEAT_MODES`). |
| `EditLabels.vue`, `Labels.vue`, `Label.vue` | 169 / 41 / 20 | `taskStore.addLabel/removeLabel` (generated client), `useCreateLabelMutation`, `useLabels` | `taskId === 0` means "not yet created": only emits. `creatable` is false for link shares. |
| `EditAssignees.vue`, `AssigneeList.vue` | 146 / 116 | `taskStore.addAssignee/removeAssignee`, `ProjectUserService.getAll` (`/projects/{p}/projectusers?s=`) | Preloads users; filters out already-assigned; guarded by an `isAdding` flag. |
| `PrioritySelect.vue`, `PercentDoneSelect.vue` | 44 / 28 | none | `defineModel`; the view saves on `update:modelValue`. |
| `ProjectSearch.vue` | 88 | `projectStore.searchProject` | Used for "move task" and parent selection. |
| `BucketSelect.vue` | 203 | `BucketService.getAll`, `TaskBucketService.update`, `kanbanStore.moveTaskToBucket` | Shows only when the project has exactly one manual kanban view, or the active one (`baseStore.currentProjectViewId`) is manual kanban. Reads `task.buckets` (from `expand=buckets`). Only `done`/`doneAt` are taken from the response so `maxPermission` survives. |
| `ChecklistSummary.vue` | 93 | `helpers/checklistFromText.ts` `getChecklistStatistics` | Counts `data-checked="true|false"` in the description HTML. |
| `CreatedUpdated.vue` | 69 | none | Dates with `formatDateLong`/`formatDisplayDate`. |
| `KanbanCard.vue` | 430 | `taskStore.update`, `fetchAttachmentBlobUrl` | Done toggle with `playPopSound`; emits `taskCompletedRecurring`; cover image via `helpers/attachments.ts` (`PREVIEW_SIZE.LG`); opens the detail as a modal. |
| `SingleTaskInProject.vue` | 633 | `taskStore.update`, `taskStore.toggleFavorite` | List row: `markAsDone` fires the request immediately and delays only the follow-up 300 ms for the animation; undo re-sends; `DeferTask` popup (own `TaskService.update`, bypasses the store); overdue via `useGlobalNow`; exposes `focus()`/`click()` for J/K navigation. `// TODO: re-enable opening task detail in modal` at line 303. |
| `SingleTaskInlineReadonly.vue`, `TaskGlanceTooltip.vue`, `CommentCount.vue`, `PriorityLabel.vue`, `DateTableCell.vue`, `Sort.vue`, `FilePreview.vue`, `AudioPreview.vue`, `DeferTask.vue` | | | Display helpers used by list/table/kanban. |
| `QuickAddMagic.vue` | 156 | `authStore.settings.frontendSettings.quickAddMagicMode` | Help panel under the add box; hidden in the Electron quick-add window (`useQuickAddMode`). |
| `Subscription` (`components/misc/Subscription.vue`) | 123 | `SubscriptionService` | `entity="task"`; the view writes the result into `task.subscription`. |
| `Datepicker` (`components/input/Datepicker.vue`) | | | Props `modelValue`, `chooseDateLabel`, `title`, `disabled`, `showShortcuts`, `minDate`; emits `update:modelValue`, `close(changed)`, `closeOnChange(changed)`; exposes `open()`. Used by the view (due/start/end), `ReminderDetail`, `DeferTask`. Renders as a bottom sheet on mobile (e2e `mobile-bottom-sheet.spec.ts`). |

### Add and list

| Item | Notes |
|---|---|
| `AddTask.vue` (373) | Textarea with `useAutoHeightTextarea`; Enter creates, Shift+Enter newline. `parseSubtasksViaIndention(text, quickAddMagicMode)` splits lines into `{title, parent, project}`; labels are resolved once up front with `taskStore.ensureLabelsExist` (failed ones toasted via `task.label.createFailed`); project per line via `taskStore.findProjectId` when a `+project` prefix exists, else the route project or `settings.defaultProjectId`; `taskStore.createNewTasksBulk(entries)`; parent relations created afterwards with `TaskRelationService` through `runWrites(..., configStore.concurrentWrites)` and mirrored into `relatedTasks` on both sides. On `NO_PROJECT` the input is restored with `project.create.addProjectRequired`. Emits `tasksAdded(allCreated)`. |
| `helpers/parseSubtasksViaIndention.ts` | Normalises leading indentation from the first line, strips `* `, `- `, `+ `, `[ ] ` bullets, walks up to the nearest less-indented line as parent, inherits the parent's `+project`. |
| `ShowTasks.vue` (355) | Builds `TaskFilterParams` (`done = false`, optional `due_date` window, `labels in`, `expand: ['comment_count','is_unread']`) and calls `taskStore.loadTasks(params, projectId)` where `projectId` is `frontendSettings.filterIdUsedOnOverview` only on the plain overview without label filters. Query params `from`, `to`, `showOverdue`, `showNulls`. `updateTasks` moves a completed task to the end locally. |
| `Home.vue` (120) | Salutation, recent projects from `projectHistory`, `AddTask` + `ShowTasks` keyed by `showTasksKey` (`// FIXME: Should use pinia (somehow?)`, line 99) so a global add reloads the list; `?labels=` filter. |

### Helpers

| Helper | Purpose |
|---|---|
| `helpers/fetchTaskById.ts` + `helpers/taskCache.ts` | Promise cache per task id shared by all callers; 403/404 stay cached, other failures are evicted; `invalidateCachedTask` bumps `taskCacheVersion`, `clearTaskCache` (called on logout) bumps `taskCacheIdentityVersion`. |
| `helpers/attachments.ts` | `fetchAttachmentBlobUrl` (shared, never revoke; `clearAttachmentBlobCache`), `uploadFile`/`uploadFiles` (`AttachmentService.create`, throws joined server messages), `uploadFilesForEditor`, `generateAttachmentUrl`. |
| `helpers/editorDraftStorage.ts` | `saveEditorDraft`/`loadEditorDraft`/`clearEditorDraft` under `localStorage.editorDraft-<key>`; empty content removes the draft. |
| `helpers/checklistFromText.ts` | `findCheckboxesInText`, `getChecklistStatistics`. |

## Internal structure

Save path from a field edit to the API and back into the list and kanban copies:

```mermaid
sequenceDiagram
    participant P as Partial (Datepicker, PrioritySelect, Heading...)
    participant V as TaskDetailView.saveTask
    participant TS as stores/tasks.update
    participant API as POST /tasks/{id} (TaskService)
    participant KS as stores/kanban
    participant L as List / Gantt copies
    P->>V: update:modelValue / closeOnChange
    V->>V: klona(task), hexColor, endDate fallback, canWrite guard
    V->>TS: update(currentTask)
    TS->>API: taskService.update
    API-->>TS: updated ITask (camelCase, maxPermission from header)
    TS->>KS: ensureTaskIsInCorrectBucket(updated) → setTaskInBucket / moveTaskToBucket
    TS-->>V: updated
    TS-->>L: lastUpdatedTask (watched by useGanttTaskList)
    V->>V: Object.assign(task, updated), setActiveFields(), success toast (+undo)
    Note over L: ProjectList rows are not updated by the store; they refetch on return (keep-alive + useTaskList watcher) or via SingleTaskInProject @taskUpdated
```

Labels, assignees, attachments, comments, relations, reactions, subscriptions, and bucket changes do **not** go through `saveTask`; each partial calls its own service or store action and patches `task.value` through `v-model`/emits.

## Dependencies

- **Uses:** `stores/{tasks,kanban,projects,base,auth,config}`; legacy `TaskService`, `TaskCommentService`, `TaskRelationService`, `AttachmentService`, `ProjectUserService`, `BucketService`, `TaskBucketService`, `SubscriptionService`; generated client indirectly through `taskStore.addLabel/removeLabel` and `useCreateLabelMutation`; `components/input/{Datepicker,ColorPicker,Reactions,AsyncEditor}`; `helpers/scrollIntoView`, `playPop`, `getProjectTitle`.
- **Used by:** the router, `ContentAuth.vue` (modal), `ProjectList`/`ProjectKanban`/`ProjectTable` (rows and cards), `Home.vue`, `QuickActions.vue`.

## Invariants and assumptions

- `task.value` is the only source of truth inside the view; partials receive it by `v-model`/props and write back with `Object.assign(task, $event)`. Do not keep a second copy in a partial that outlives a save, or the next `saveTask` (which clones `task.value`) overwrites it. `taskColor` is the deliberate exception (comment at lines 806-811).
- `saveTask` always sends the **whole task** (`POST /tasks/{id}` is a full update on v1). A partial that mutated `task.value` optimistically before another save resolves will have that mutation sent along.
- `canWrite` derives from `task.maxPermission`, which comes from the response header; any code path that replaces `task.value` with an object lacking `maxPermission` (for example spreading a `TaskBucket` response) turns the view read-only. `BucketSelect` documents this.
- The modal is the same component with `backdropView` set; `isModal` must not be inferred from the route. `useRouteWithModal.closeModal` may push to `project.view` for the *current* project when the task was moved from a kanban board.
- `kanbanStore.removeTaskInBucket` must be called **before** the project change save in `changeProject`, otherwise `ensureTaskIsInCorrectBucket` would re-place the task on the old board.
- `Description` saves on unmount; closing the modal quickly after typing still persists (the "modal race condition" comment).
- `EditLabels`/`EditAssignees` with `taskId === 0` are create-mode and must only emit.
- `expand` list on load must include `buckets` for `BucketSelect` and `comments` for `Comments.initialComments`.

## Configuration

| Key | Where | Effect |
|---|---|---|
| `frontendSettings.commentSortOrder`, `defaultTaskRelationType`, `quickAddMagicMode`, `quickAddDefaultReminders`, `filterIdUsedOnOverview`, `defaultProjectId` | user settings via `authStore` | comments order, default relation kind, quick-add parsing, overview filter, add-task target |
| `/info` `taskCommentsEnabled`, `taskAttachmentsEnabled`, `maxFileSize`, `maxItemsPerPage`, `enabledProFeatures`, `frontendUrl`, `concurrentWrites` | `configStore` | comments on/off, attachments, comment paging threshold, time tracking section, comment permalinks, write throttling |
| `localStorage.editorDraft-task-description-<id>`, `editorDraft-task-comment-<id>` | `editorDraftStorage` | drafts |

## Error handling

- Load: 403/404 → `not-found`; anything else rethrows to the global handler (toast).
- Save: store actions throw; the global `errorHandler` toasts. `Description.save` re-marks `hasChanges` on failure except 404. `Heading.save` validates the empty title locally.
- Uploads: `uploadFiles` throws a joined `Error` with server messages; `Attachments.uploadFilesToTask` toasts it. Editor uploads reject through `uploadFilesForEditor`.
- `AddTask`: label creation failures are reported but never block; bulk errors restore the input text; relation failures are toasted after tasks exist.
- `ShowTasks.loadPendingTasks` returns early when not authenticated (`// FIXME: HACK!`, line 250) because the home route mounts before the login redirect.

## Tests

Unit (`pnpm vitest run <path>` in `frontend/`):

| File | Covers |
|---|---|
| `components/tasks/partials/Attachments.test.ts` | delete modal does not leak the name after closing |
| `components/tasks/partials/AudioPreview.test.ts` | single player, blob revocation, fetch-once, failure states |
| `components/tasks/partials/TaskGlanceTooltip.test.ts` | keyboard accessibility |
| `views/tasks/ShowTasks.test.ts` | reload on overdue/undated toggles, not on sidebar settings |
| `helpers/fetchTaskById.test.ts`, `taskCache.test.ts`, `attachments.test.ts`, `checklistFromText.test.ts`, `parseSubtasksViaIndention.test.ts` | pure helpers |

No unit test covers `TaskDetailView.vue`, `Heading`, `Description`, `Comments`, `RelatedTasks`, `AddTask`, `KanbanCard`, `SingleTaskInProject`; they are covered end to end.

E2E (`frontend/tests/e2e/task/`, 18 files, run through the `run-e2e-tests` skill):

| Spec | Tests | One line |
|---|---|---|
| `task.spec.ts` | 71 | Four describes (`Task`, `Task Detail View`, `Scroll to bottom button`, `Link functionality in description editor`): create at top, done, favorite, description icon rules, back/close navigation per origin view, 404, description editor and autosave, comments, move, delete, assignees, labels (including kanban sync), due/start/end date popups and keyboard handling, reminders (relative, fixed, no autosave), priority, progress, attachments (paste, PDF preview, read-only), checklists, scroll button, link input positioning (#1899) |
| `overview.spec.ts` | 8 | Home overview ordering: near due first, overdue first, new task at top |
| `bucket-select.spec.ts` | 7 | Bucket selector shows, changes bucket, hidden without kanban view |
| `drag-to-project.spec.ts` | 7 | Dragging a row or card onto a sidebar project moves it |
| `comment-sort-order.spec.ts` | 8 | Oldest/newest first toggle and new-comment placement |
| `related-tasks-quick-add-magic.spec.ts` | 6 | `*label`, `!priority`, `+project` prefixes when creating a related task |
| `recurrence.spec.ts` | 3 | Repeat presets, completing a recurring task advances the due date, monthly mode hides the amount |
| `comment-pagination.spec.ts` | 2 | Pagination appears only above the configured page size |
| `date-display.spec.ts` | 2 (parametrised) | Date display formats with 12 h and 24 h time |
| `mention-in-comment.spec.ts` | 2 | Typing `@` in the comment editor does not throw |
| `mobile-bottom-sheet.spec.ts` | 2 | Datepicker as a sheet saves and locks page scroll |
| `tiptap-editor-save.spec.ts` | 2 | Description save and rapid edit toggling do not crash (#1770) |
| `assignee-search-narrow-column.spec.ts` | 1 | Avatar and name visible in a narrow assignee column |
| `comment-reply.spec.ts` | 1 | Reply prefills a quote; saved reply links back to the parent |
| `nested-checklist-strikethrough.spec.ts` | 1 | Unchecked child of a checked item is not struck through (#3712) |
| `quick-add-default-reminders.spec.ts` | 1 | Default reminder attached when quick add parses a due date |
| `read-only-checkbox-overview.spec.ts` | 1 | Checkboxes disabled for tasks from read-only shares on the overview |
| `subtask-duplicates.spec.ts` | 1 | A subtask appears once per project list |

## Gotchas and tech debt

- `TaskDetailView.vue:1022` `// FIXME: are these lines necessary?` (commented-out date normalisation in `setActiveFields`); `:1130` `// TODO: markraw ?` on the store update result.
- `SingleTaskInProject.vue:303` and `ProjectTable.vue:477` TODO re-enable modal: list/table rows open the page, kanban/gantt open the modal, so `lastProject` and `closeModal` behave differently by origin.
- `ShowTasks.vue:250` FIXME HACK (unauthenticated early return) and `:295` FIXME "this modification should happen in the store" (`updateTasks`). `Home.vue:99` FIXME re-keying `ShowTasks` instead of a store signal.
- `RelatedTasks.vue:504` FIXME checkbox height.
- `DeferTask.vue` and `useGanttTaskList.updateTask` save through `TaskService` directly, so the kanban board is not synchronised for those edits.
- The view's `saveTask` toast fires for every field change, including each datepicker close; the undo action only exists for done toggles.
- `Comments.toggleSortOrder` rewrites the entire `frontendSettings` object, so any new frontend setting must be spread there too (it already special-cases `quickAddDefaultReminders`).
- Git history (`git log --follow`, `fix` subjects): `TaskDetailView.vue` 123 of 314 commits, `Attachments.vue` 32 of 132, `Comments.vue` 37 of 121. Recurrent themes: modal scroll containers, stale copies after moves, drag/drop overlays fighting the editor, permission fields lost on partial responses.

## Related pages

- [stores](./stores.md), [project-views](./project-views.md), [editor](./editor.md), [filters-and-quick-add](./filters-and-quick-add.md), [sharing-teams-labels-notifications](./sharing-teams-labels-notifications.md), [i18n-and-formatting](./i18n-and-formatting.md), [testing-infrastructure](./testing-infrastructure.md), [api-client-legacy](./api-client-legacy.md)
- Backend: [models-tasks](../backend/models-tasks.md), [models-views-and-kanban](../backend/models-views-and-kanban.md)
- [Data flows](../../10-data-flows.md) (task creation, comment to notification), [Data model](../../06-data-model.md#task-done-and-repeating), [Known issues](../../13-known-issues.md)
- Playbooks: [build-vue-feature](../../playbooks/build-vue-feature.md), [fix-a-bug](../../playbooks/fix-a-bug.md)
