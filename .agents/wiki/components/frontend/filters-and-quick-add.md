# Filters and quick add

Two small languages the frontend parses on behalf of the user: the **task filter DSL** (`done = false && dueDate < now/d+1d`) typed into `FilterInput.vue` and sent to the API, and **quick add magic** (`Call *urgent +Work !3 tomorrow`) parsed client-side into task fields. Context: [Frontend architecture](../../04-frontend-architecture.md), backend [models-filtering-and-search](../backend/models-filtering-and-search.md).

## Responsibility

- Owns: the filter editor (highlighting, autocomplete, inline date picker), the title↔id / camelCase↔snake_case transform between UI and API filter strings, URL and localStorage persistence of per-view filters, the saved-filter create/edit/delete views, the quick-add parser and the store code that turns a parsed title into a task.
- Does not own: filter *evaluation* (backend `pkg/models/task_collection_filter.go`), task list loading (`composables/useTaskList.ts`, see [project-views](./project-views.md)), the datepicker widget itself (`components/date/*`), label data ([sharing-teams-labels-notifications](./sharing-teams-labels-notifications.md#labels)).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `FilterInput.vue` (`projectId?`, `modelValue` = API-format string, emits `update:modelValue`, exposes `focus()`) | `frontend/src/components/input/filter/FilterInput.vue` | `components/project/partials/Filters.vue` |
| `Filters.vue` (`modelValue: TaskFilterParams`, `changeImmediately`, `filterFromView`, emits `update:modelValue`/`showResults`/`close`) | `frontend/src/components/project/partials/Filters.vue` | `FilterPopup.vue`, `views/filters/Filter{New,Edit}.vue` |
| `FilterPopup.vue` (`modelValue`, `projectId?`, `viewId?`) | `frontend/src/components/project/partials/FilterPopup.vue` | `components/project/views/ProjectList.vue`, `ProjectTable.vue`, `ProjectKanban.vue` (see [project-views](./project-views.md)) |
| `transformFilterStringForApi(filter, labelResolver, projectResolver)` / `transformFilterStringFromApi(filter, labelResolver, projectResolver)` | `frontend/src/helpers/filters.ts` | `FilterInput.vue`, `Filters.vue` |
| `AVAILABLE_FILTER_FIELDS`, `DATE_FIELDS`, `AUTOCOMPLETE_FIELDS`, `FILTER_OPERATORS`, `FILTER_JOIN_OPERATOR`, `FILTER_OPERATORS_REGEX`, `hasFilterQuery`, `isMultiValueOperator`, `getFilterFieldRegexPattern` | `frontend/src/helpers/filters.ts` | `FilterAutocomplete.ts`, `highlighter.ts`, `Filters.vue` |
| `useRouteFilters(route, getDefaultFilters, routeToFilters, filtersToRoute, routeAllowList)` | `frontend/src/composables/useRouteFilters.ts` | `views/project/helpers/useGanttFilters.ts`, `components/project/ProjectWrapper.vue` |
| `useViewFiltersStore()` (`setViewQuery`, `getViewQuery`, `clearViewQuery`) | `frontend/src/stores/viewFilters.ts` | `composables/useTaskList.ts` |
| `useSavedFilter(projectId?)` | `frontend/src/services/savedFilter.ts` (legacy service + composable) | `views/filters/*.vue` |
| `parseTaskText(text, mode = PrefixMode.Default, now = new Date())`, `PREFIXES`, `PrefixMode`, `cleanupItemText`, `getLabelsFromPrefix`, `getProjectFromPrefix` | `frontend/src/modules/quickAddMagic/index.ts` | `stores/tasks.ts`, `QuickActions.vue`, `QuickAddMagic.vue`, `views/user/settings/General.vue` |
| `taskStore.buildTaskFromQuickAddTitle`, `createNewTask`, `createNewTasksBulk`, `addLabelsToTask` | `frontend/src/stores/tasks.ts` | `createNewTask`: `RelatedTasks.vue`, `QuickActions.vue`, `ProjectKanban.vue`; `createNewTasksBulk`: `components/tasks/AddTask.vue` (multi-line paste) |

## Key types and functions

### Filter DSL on the frontend (`helpers/filters.ts`)

| Constant / function | Value or behaviour |
|---|---|
| `AVAILABLE_FILTER_FIELDS` | `dueDate startDate endDate doneAt reminders created updated` (`DATE_FIELDS`), `assignees`, `createdBy`, `labels`, `project`, `done`, `priority`, `percentDone` |
| `FILTER_OPERATORS` | `!= = > >= < <= like "not in" in ?=`; word operators get `\b` boundaries in `FILTER_OPERATORS_REGEX` |
| `FILTER_JOIN_OPERATOR` | `&& \|\| ( )` |
| `isMultiValueOperator(op)` | `in`, `?=`, `not in`, `?!=` (note: `?!=` is not in `FILTER_OPERATORS`) |
| `hasFilterQuery(filter)` | returns the first operator found or `false`; `Filters.vue` uses it to decide between `filter` and plain text search `s` |
| `getFilterFieldRegexPattern(field)` | `\b(field)\s*OP\s*(quoted \| unquoted-until-&&,\|\|,),<)` with `g`; shared by the transform, the highlighter and autocomplete |
| `transformFilterStringForApi` | 1) canonicalise field names case-insensitively, 2) `labels` and `project` values → ids through the resolvers (multi-value split on `,`, quotes stripped, a `\`-escaped retry), rebuilt as `field op value` from collected positional replacements, 3) field names → `snakeCase` |
| `transformFilterStringFromApi` | `replaceAll(snakeCase(f), f)` over the **whole string**, then ids → titles for `labels`/`project` |

### `FilterInput.vue` (397 lines, hotspot)

A single-paragraph TipTap editor (`StarterKit` with `history: false`, `Placeholder`) plus four local extensions:

| Extension | Does |
|---|---|
| `FilterHighlighter` → `highlighter.ts` `createFilterHighlighter(() => labels)` | Decoration plugin (`filterHighlighterKey`): fields, operators, logical operators, values; label values get the label's colour, date values get class `date-value` with `data-date-value` / `data-position`. Recomputed on doc change or when `labels` changes (`tr.setMeta(filterHighlighterKey, true)`). |
| `DateClickHandler` | Click on `.date-value` opens `DatepickerWithValues` anchored at the token; `updateDateInQuery` string-replaces the old value. |
| `FilterAutocomplete` (`FilterAutocomplete.ts`, 540 lines) | Popup `#filter-autocomplete-popup` (`position: fixed`, `z-index: 20000`, appended to the closest `<dialog>` or `body`, positioned with `@floating-ui/dom`). Sources: labels from `useLabels().filterLabelsByQuery`, users from `ProjectUserService` (`projectId`) or `UserService` (300 ms debounce, 10 max on empty search), projects from `projectStore.searchProject` **only without `projectId`**. `calculateReplacementRange` replaces only the segment after the last comma for multi-value operators and swallows a closing quote. A 1 s / position-based suppression stops the popup reopening right after a selection. |
| `enterHandler` | Swallows Enter unless the autocomplete popup is visible. |

Model sync: `onUpdate` → `transformFilterStringForApi(getText())` → `emit('update:modelValue')` and remembers `lastEmittedValue` so the `props.modelValue` watcher does not round-trip the editor's own emit (which would normalise whitespace and reset the cursor). Incoming values are set as a **JSON doc, never as HTML** (reflected-HTML fix for `?filter=`). If labels are still loading (`isPending`), the value is re-applied once they arrive unless the user edited meanwhile (`FilterInput.test.ts`).

### Filters and persistence

- `Filters.vue` → `change(event)`: `changeImmediately` (saved-filter forms) applies on every model change, otherwise only on blur, so project views never show the id-substituted string mid-typing. No operator → the text becomes `s`, not `filter`. Shows `FilterInputDocs.vue` (collapsible field/operator/example reference) and `filterFromView` (the view's own filter, read-only).
- `FilterPopup.vue` wraps `Filters.vue` in a modal, focuses the input on open, and reads the view filter from `projectStore.projects[projectId].views`.
- `useRouteFilters` keeps a `filters` ref and the URL in sync in both directions (`router.push` when filters change, `routeToFilters` when the route changes on an allow-listed route name) and exposes `hasDefaultFilters`/`setDefaultFilters`.
- `stores/viewFilters.ts` stores `{sort, filter, s, page}` per view id in `localStorage.viewFilters`; `useTaskList.ts` restores it with `router.replace` when the view changes and the URL carries no query, otherwise writes the URL query into the store. **URL wins.** `filter_timezone` is always `authStore.settings.timezone` (`useTaskList.ts:225`, `stores/tasks.ts:174`, `stores/kanban.ts:312`).
- Saved filters: `views/filters/FilterNew.vue` (`filters.create`, `/filters/new`), `FilterEdit.vue` (`filter.settings.edit`, modal), `FilterDelete.vue` (`filter.settings.delete`) all use `useSavedFilter()` from `services/savedFilter.ts` (legacy `SavedFilterService`; after create/save it calls `projectStore.loadAllProjects()` and navigates to the pseudo project `-(id+1)`, see [Data model](../../06-data-model.md#pseudo-projects-and-derived-ids)). Both forms embed `Filters.vue` with `changeImmediately` and the description editor ([editor](./editor.md)).

### Dates

- Datemath strings (`now`, `now/d`, `now/w+1w`, `now+7d`, ...) are **not parsed on the frontend**. `components/date/dateRanges.ts` → `DATE_VALUES` / `DATE_RANGES` supply the preset strings for `DatepickerWithValues.vue`; `components/date/DatemathHelp.vue` (used by `DatepickerShell.vue`) documents the syntax.
- `helpers/time/dateMath.ts` is unrelated to datemath despite its name: `startOfDay`, `addDays`, `isSameDay`, `isDayBetween` helpers.
- Backend: `getValueForField` in `pkg/models/task_collection_filter.go` tries `safeDatemathParse` (go-datemath, with a `recover` because the lexer panics on input like `no`), rounds in `filter_timezone`, converts to UTC and clamps to the driver's date range; otherwise `parseTimeFromUserInput` accepts RFC3339 and the Safari formats `2006-01-02 15:04` / `2006-01-02`.

### Quick add magic (`modules/quickAddMagic/`)

`parseTaskText` runs in this order (`quickAddMagic.ts`), each step removing what it consumed:

1. Whole text wrapped in `"…"` or `'…'` → strip quotes, parse nothing.
2. `getLabelsFromPrefix` → `cleanupItemText` (prefix from `PREFIXES[mode]`).
3. `getProjectFromPrefix` (first match only).
4. `getPriority` (`priorityParser.ts`, value must be one of `constants/priorities.ts`).
5. `getItemsFromPrefix(assignee)` — **assignees stay in the text** (`cleanupResult` comment: unknown users would lose their `@text`); the store removes them after verifying the user exists.
6. `getRepeats` (`repeatParser.ts`): `every|each [N|one..ten] hour(s)|day(s)|week(s)|month(s)|year(s)` or `daily|hourly|weekly|monthly|yearly|annually|biannually|semiannually|biennially` → `IRepeatAfter {amount, type}`.
7. `parseDate` (`dateParser.ts`): keywords `today`, `tonight`, `tomorrow`, `next monday`, `this weekend`, `later this week`, `later next week`, `next week`, `next month`, `end of month`; then explicit dates (`2021-06-24`, `06/24/2021`, `27/01`), `jan 21` / `21 jan`, weekdays (`next` optional), `in N hours|days|weeks|months`, ordinals only before time/month; a trailing ` at 14:00` / `@ 2pm` sets the time (`addTimeToDate`). Keyword matches must sit at a text boundary (`matchDateAtBoundary`).
8. `cleanupResult` trims and re-runs label/project/priority cleanup.

| Mode (`PrefixMode`) | label | project | priority | assignee |
|---|---|---|---|---|
| `vikunja` (default) | `*` | `+` | `!` | `@` |
| `todoist` | `@` | `#` | `!` | `+` |
| `disabled` | no parsing (`PREFIXES[...] === undefined`) | | | |

The mode is `authStore.settings.frontendSettings.quickAddMagicMode` (set in General settings, [user-settings-and-admin](./user-settings-and-admin.md)). `components/tasks/partials/QuickAddMagic.vue` renders the help popover from `PREFIXES[mode]`.

`stores/tasks.ts` → `buildTaskFromQuickAddTitle({title, projectId, bucketId, position})`: parse → `findProjectId` (parsed project title or the current project; throws `NO_PROJECT`) → `findAssignees` (`ProjectUserService.getAll({projectId}, {s})` + `validateUser`) → strip only matched assignees with `cleanupItemText` → `TaskModel` with `dueDate = toISOStringOrNull(date)`, `priority`, `assignees`, `repeatAfter`, `reminders = buildDefaultRemindersForQuickAdd(quickAddDefaultReminders, dueDate)`, and `repeatMode = REPEAT_MODE_MONTH` for "every 1 month". `createNewTask` then `TaskService.create` and `addLabelsToTask` (creates missing labels through `createLabelMutationOptions`).

## Internal structure

```mermaid
flowchart LR
    T[typed text] --> FI[FilterInput.vue<br/>TipTap doc]
    FI -->|onUpdate| TA[transformFilterStringForApi<br/>titles→ids, camel→snake]
    TA --> F[Filters.vue change()<br/>filter or s]
    F --> P[TaskFilterParams<br/>useTaskList / useRouteFilters]
    P --> URL[route query] --> LS[(localStorage viewFilters)]
    P --> API[GET /projects/:id/views/:view/tasks?filter=...&filter_timezone=...]
    API --> BE[getTaskFiltersFromFilterString<br/>preprocess → fexpr.Parse → datemath]
    SF[(saved_filters.filters)] -->|FilterEdit| TB[transformFilterStringFromApi] --> FI
```

## Dependencies

- **Uses:** `@tiptap/*`, `@floating-ui/dom`, `change-case` (`snakeCase`), `fast-deep-equal`, `@vueuse/core` (`useLocalStorage`, `useDebounceFn`); `composables/useLabels.ts`, `stores/projects.ts` (`findProjectByExactname`, `searchProject`), legacy `services/user.ts`, `services/projectUsers.ts`, `services/savedFilter.ts`, `services/taskCollection.ts` (`TaskFilterParams`, `getDefaultTaskFilterParams`); `constants/priorities.ts`, `types/IRepeatAfter.ts`.
- **Used by:** project views and Gantt (`useTaskList`, `useGanttFilters`), saved-filter views, Home overview (`filterIdUsedOnOverview`), `QuickActions.vue`, Kanban and list quick-add inputs, `RelatedTasks.vue`.

## Invariants and assumptions

- **Field and operator lists must match the backend.** `validateTaskField` (`pkg/models/task_collection.go`) accepts `assignees`, `labels`, `reminders`, `created_by` plus the sortable list in `validateTaskFieldForSorting` (`task_collection_sort.go`: id, title, description, done, done_at, due_date, created_by_id, project_id, repeat_after, priority, start_date, end_date, hex_color, percent_done, uid, created, updated, position, bucket_id, index). `project` is rewritten to `project_id` in `parseFilterFromExpression`. Comparators: `= > >= < <= != like in "not in"`; `replaceFilterOperators` maps ` in `→`?=`, ` not in `→`?!=`, ` like `→`~` (fexpr sigils), which is why `?=` also appears in the frontend list. Adding a field means: backend validation, `AVAILABLE_FILTER_FIELDS` (+ `DATE_FIELDS`/`AUTOCOMPLETE_FIELDS`), `FilterInputDocs.vue`, and `filters.query.help.fields.*` i18n keys ([Conventions](../../08-conventions.md#if-you-change-x-you-must-also-change-y)).
- Values reach the API as ids and snake_case; the UI only ever shows titles and camelCase. `Filters.vue` and `FilterInput.vue` both call `transformFilterStringForApi`; keep the resolvers identical.
- The filter string is bounded server-side: 16 KiB and nesting depth 100 (`validateFilterComplexity`, GHSA-xxc3-xpmc-vmvr).
- `useRouteFilters` assumes `filtersToRoute` is a pure function of `filters`; it compares `router.resolve(...).fullPath` to decide whether to push.
- Quick add relies on `PRIORITIES` (1–5) and `REPEAT_TYPES` mirroring Go ([Data model](../../06-data-model.md#enums-duplicated-across-sides)).

## Error handling

Filter parse errors come back as v1 `ErrInvalidTaskFilterComparator` / `ErrInvalidTaskField` / `ErrInvalidTaskFilterValue` (`isErrInvalidFilter`) and surface as toasts through `@/message`. Autocomplete fetch failures are `console.error`ed and yield `[]`. `buildTaskFromQuickAddTitle` throws `Error('NO_PROJECT')` when neither a `+project` nor a current project resolves; callers show the toast.

## Worked examples

**Filter string.** User types `Labels in Bug, "Needs Review" && duedate < now/d+1d && project = Inbox` in `FilterInput.vue`.

1. Field canonicalisation: `Labels` → `labels`, `duedate` → `dueDate`.
2. Label pass with `getLabelByExactTitle`: `labels in 12, 34` (quotes removed, ids joined with `, `). Project pass: `project = 7`.
3. Snake case: `labels in 12, 34 && due_date < now/d+1d && project = 7` is emitted and stored in `TaskFilterParams.filter` (`Filters.vue` keeps it as `filter` because `hasFilterQuery` found `in`).
4. Backend `prepareFilterForParsing` → `labels ?= …`, values quoted, `fexpr.Parse`; `project` becomes `project_id`; `now/d+1d` is evaluated by datemath in `filter_timezone`.
5. Reopening the saved filter runs `transformFilterStringFromApi`: `due_date` → `dueDate`, `12, 34` → `Bug, Needs Review`, `7` → `Inbox` (`filters.test.ts` "To API"/"For API" and the apostrophe cases cover the quoting rules).

**Quick add title.** `Call *urgent +Work !3 @alice every 2 weeks tomorrow at 14:00`, vikunja mode: labels `['urgent']`, project `Work`, priority `3`, assignees `['alice']`, repeats `{amount: 2, type: weeks}`, date = tomorrow 14:00; remaining `text` is `Call @alice` (Unverified: exact whitespace). `buildTaskFromQuickAddTitle` resolves `Work` to a project id, confirms `alice` via the project user search and only then strips `@alice`, giving the title `Call`; the label is attached after creation by `addLabelsToTask`.

## Tests

| File | Covers |
|---|---|
| `frontend/src/helpers/filters.test.ts` (591 lines) | `transformFilterStringForApi`/`FromApi`: every field, multi-value, quoting, apostrophes, snake-case in values |
| `input/filter/FilterInput.test.ts` | label loading race: ids resolve and highlighting refreshes; user edits are not overwritten |
| `input/filter/FilterAutocomplete.test.ts` | `calculateReplacementRange` for single/multi-value operators and closing quotes |
| `input/filter/highlighter.test.ts` | label colours from loaded data, date values clickable, field vs value naming collision |
| `modules/quickAddMagic/quickAddMagic.test.ts` (1050 lines) | quotes, every date form (incl. boundary rules and weekdays), labels, project, priority, assignee, recurring |
| e2e `tests/e2e/filters/filter-autocomplete.spec.ts` | project-name replacement (single/multi-word, after `&&`), #2010 regression on edit |
| e2e `tests/e2e/filters/filter-date-picker.spec.ts` | date picker opens on a value, moves between values, closes on outside click |
| e2e `tests/e2e/project/filter-persistence.spec.ts` | list/table/kanban filters survive reload; URL sharing |
| e2e `tests/e2e/task/related-tasks-quick-add-magic.spec.ts`, `quick-add-default-reminders.spec.ts` | `*label` on related tasks; default reminders attached on a parsed due date |

Run: `pnpm vitest run src/helpers/filters.test.ts src/components/input/filter src/modules/quickAddMagic`. Not covered: `Filters.vue` blur/immediate switching, `useRouteFilters`, `viewFilters` store (only via e2e).

## Gotchas and tech debt

- `FilterInput.vue` is a hotspot (`git log --follow` shows a long run of `fix(filters)` commits; 7 on the current path alone). Most were cursor resets, label-loading races and the HTML-injection fix; test both `FilterInput.test.ts` and the autocomplete e2e after touching it.
- `transformFilterStringFromApi` does `replaceAll(snakeCase(field), field)` on the whole string, so a label or project *title* containing `due_date` would be rewritten too.
- `hasFilterQuery` returns a string, not a boolean; callers use it truthily.
- `blurDebounced` in `FilterInput.vue` is an empty `useDebounceFn` (dead code).
- `?!=` is handled by `isMultiValueOperator` but absent from `FILTER_OPERATORS`, so it is neither highlighted nor autocompleted; `FilterInputDocs.vue` documents `in`/`not in` only.
- `dateParser.ts` uses `new Date()` instead of the `now` argument for `next month` and `end of month`, making those two cases wall-clock dependent in tests; `getDateFromWeekday` lowercases manually ("The i modifier does not seem to work").
- `FilterAutocomplete.ts` and `findAssignees` still go through legacy services (`UserService`, `ProjectUserService`); the label side already uses the TanStack cache ([api-client-legacy](./api-client-legacy.md)).
- No `TODO`/`FIXME` markers in this area.

## Related pages

[project-views](./project-views.md), [stores](./stores.md) (`tasks`, `viewFilters`), [api-client-generated-and-queries](./api-client-generated-and-queries.md) (labels cache), [user-settings-and-admin](./user-settings-and-admin.md) (quick add mode, timezone, default reminders), [i18n-and-formatting](./i18n-and-formatting.md) (date formatting), backend [models-filtering-and-search](../backend/models-filtering-and-search.md), [Data flows](../../10-data-flows.md#task-creation), [playbooks/build-vue-feature](../../playbooks/build-vue-feature.md).
