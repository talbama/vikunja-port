# Generated API client and TanStack Query modules

The new data layer: `@hey-api/openapi-ts` output in `frontend/src/client/generated/` (typed functions per v2 operation), the shared fetch configuration in `client/http.ts`, and per-feature TanStack Query modules under `client/queries/`. Labels are the reference implementation. Rules come from [API design](../../../docs/api.md#frontend-clients); the layer diagram is in [Frontend architecture](../../04-frontend-architecture.md#two-api-layers). Verified 2026-09-16.

## Responsibility

- Owns: codegen config and pipeline, the generated SDK/types, the configured `client`, the `QueryClient` defaults, query/mutation option factories and hooks, RFC 9457 error → field-map parsing.
- Does not own: token storage and refresh semantics ([auth-and-session](./auth-and-session.md)), v1 services ([api-client-legacy](./api-client-legacy.md)), UI state (stores, [stores](./stores.md)), the Go side of the spec ([api-v2-huma](../backend/api-v2-huma.md)).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `mage generate:frontend-client` → `Generate.FrontendClient` | `magefile.go` | developers after any v2 change; `Check.FrontendClient` |
| `mage check:frontend-client` → `Check.FrontendClient` | `magefile.go` | CI |
| `pnpm run generate:api-client` (`openapi-ts`) | `frontend/package.json`, `frontend/openapi-ts.config.ts` | the mage target (needs `VIKUNJA_OPENAPI_INPUT`) |
| `client` | `frontend/src/client/generated/client.gen.ts` | `configureApiClient`, every SDK function |
| SDK functions (214 `export const`) and 1333 types | `frontend/src/client/generated/{sdk,types}.gen.ts`, re-exported by `index.ts` | 24 files (table below) |
| `configureApiClient()` | `frontend/src/client/http.ts` | `main.ts`, `checkAndSetApiUrl` |
| `queryClient` | `frontend/src/client/queryClient.ts` | `main.ts` (`VueQueryPlugin`), query modules, stores, `checkAndSetApiUrl`, `stores/auth.ts` (`clear()`) |
| `labelKeys`, `labelsQuery`, `ensureLabels`, `refreshLabels`, `*MutationOptions`, `use*LabelMutation`, pure helpers | `frontend/src/client/queries/labels.ts` | `composables/useLabels.ts`, `views/labels/ListLabels.vue`, `components/tasks/partials/EditLabels.vue`, `stores/tasks.ts` |
| `useLabels()` | `frontend/src/composables/useLabels.ts` | label-reading components |
| `parseValidationErrors(error)` | `frontend/src/helpers/parseValidationErrors.ts` | `Register.vue`, `stores/auth.ts`, settings forms |

## Codegen pipeline

1. `Generate.FrontendClient` (`magefile.go`) calls `apiv2.NewCanonicalAPI()` (the same Huma registry the server uses, `pkg/routes/api/v2/huma.go`), writes `api.OpenAPI()` to a temp JSON file, and runs `pnpm run generate:api-client` in `frontend/` with `VIKUNJA_OPENAPI_INPUT=<temp file>`.
2. `frontend/openapi-ts.config.ts` reads that env var (throws without it), outputs to `src/client/generated`, plugins `@hey-api/typescript`, `@hey-api/sdk`, `@hey-api/client-fetch` with `throwOnError: true`.
3. `Check.FrontendClient` generates twice, hashes the directory (`frontendClientDirectoryHash`, SHA-256 over every file) to prove idempotence, then fails on any `git status --porcelain -- frontend/src/client/generated` output: "run 'mage generate:frontend-client' and commit the result".

Never hand-edit `frontend/src/client/generated/`; ESLint ignores it and CI regenerates it.

## Generated layout (`frontend/src/client/generated/`)

| File | Contents |
|---|---|
| `index.ts` | re-exports every SDK function and every type |
| `sdk.gen.ts` (4350 lines) | one arrow function per operation; the name is the operation ID camel-cased (`labels-list` → `labelsList`, `admin-invite-links-create` → `adminInviteLinksCreate`); each declares its security schemes (`JWTKeyAuth`, `APITokenAuth`, ...) and the URL; generic `<ThrowOnError extends boolean = true>` |
| `types.gen.ts` | request/response types per operation (`LabelsListData`, `LabelsListResponses`, `LabelsListErrors`) plus schema types in **snake_case** (`Label`, `LabelWritable`, `VikunjaErrorModel`, `ErrorDetail`); `readOnly` Go tags become `readonly` fields on the read type, and a separate `*Writable` type omits them |
| `client.gen.ts` | `export const client = createClient(createConfig({baseUrl: '/api/v2', throwOnError: true}))`; `http.ts` overrides this at runtime |
| `client/` and `core/` | the vendored `@hey-api/client-fetch` runtime (interceptors, serializers, `serverSentEvents`) |

AutoPatch operations appear as `patch<Resource>Read` (`patchLabelsRead`, `patchTasksRead`, ...), matching the PATCH synthesized from each GET+PUT pair ([API contract](../../05-api-contract.md#two-versions-one-model-layer)). Calling convention: `labelsList({query: {page, per_page}})`, `labelsUpdate({path: {id}, body})`; the result is `{data, response}` and errors **throw** (a `Response`-shaped problem, or the parsed body; see `client/http.test.ts` for the shapes).

## Runtime configuration

`client/http.ts` → `configureApiClient()` (full 401/refresh behaviour in [auth-and-session](./auth-and-session.md#two-interceptor-implementations-change-both)): `baseUrl = getApiV2BaseUrl()`, `credentials: 'include'`, `throwOnError: true`; request interceptor adds `Bearer <token>` unless an `Authorization` header is already present and records the request's identity; response interceptor retries once on `401` + problem `code === 11` for user tokens whose identity is unchanged. It is re-run by `checkAndSetApiUrl` whenever the API URL changes.

`client/queryClient.ts`: `staleTime: 60_000`, `retry: 1`, `refetchOnWindowFocus: false` for queries; `retry: false` for mutations. `stores/auth.ts` calls `queryClient.clear()` on identity change; `checkAndSetApiUrl` clears it on server change.

## Reference module: `client/queries/labels.ts`, function by function

| Symbol | What it does |
|---|---|
| `labelKeys = {all: ['labels'] as const}` | the only key; there is no `detail(id)` key because nothing queries a single label (rule: keys only for queries that exist) |
| `LabelDraft`, `CreateLabelInput`, `UpdateLabelInput`, `createLabelDraft()` | input shapes derived from generated `LabelWritable` / `Label` with `Pick`/`Required`; `createLabelDraft` gives forms an empty object |
| `fetchAllLabels()` | loops `labelsList({query: {page, per_page: 1000}})` until `page >= total_pages`, concatenating `data.items` (v2 envelope) |
| `sortLabelsAlphabetically(labels, locale)` | `localeCompare` with `ignorePunctuation`, on a copy |
| `labelsQuery()` | `queryOptions({queryKey: labelKeys.all, queryFn: fetchAllLabels, select: sortLabelsAlphabetically, staleTime: 5 min})`; `select` keeps the cache unsorted so cache writers can push |
| `ensureLabels()` | `queryClient.ensureQueryData(labelsQuery())` for non-component code (dedupes concurrent loads) |
| `refreshLabels()` | `queryClient.fetchQuery({...labelsQuery(), staleTime: 0})`, forces a network read |
| `getLabelById`, `getLabelsByIds`, `getLabelByExactTitle`, `getLabelsByExactTitles`, `filterLabelsByQuery` | pure functions over `Label[]`; case-insensitive title matching; `filterLabelsByQuery` returns `[]` for an empty query and hides the given labels |
| `labelBody(label)` | narrows input to `LabelWritable` and normalises colour with `colorFromHex` |
| `createLabelMutationOptions()` | `mutationFn` → `labelsCreate({body})` returns `data`; `onSuccess` appends to the list **only if cached** (`current ? [...current, created] : current`); `onSettled` invalidates `labelKeys.all` |
| `snapshotLabels(client)` / `restoreLabels(client, previous)` | `cancelQueries` + `getQueryData`; restore only when a snapshot existed |
| `updateLabelMutationOptions()` | full optimistic flow: `onMutate` snapshot and map-replace with `labelBody`, `onError` restore, `onSuccess` replace with the server entity and toast `label.edit.success`, `onSettled` invalidate |
| `deleteLabelMutationOptions()` | throws without an id; optimistic filter, restore on error, toast `label.deleteSuccess`, invalidate |
| `useCreateLabelMutation()` etc. | `useMutation(<options>())`; the thin hooks components call |

Every callback uses the `client` from its context argument (`(created, _vars, _ctx, {client})`), never the `queryClient` import, so tests and stores can pass their own client.

`composables/useLabels.ts`: `useQuery(labelsQuery())`, `labels = computed(() => data ?? [])`, `isPending`, and the pure helpers bound to the reactive list. Read side only; a create-only view must not subscribe to the list.

## Consumers

| Consumer | Uses |
|---|---|
| `views/labels/ListLabels.vue` | `useLabels()` for the list; `useUpdateLabelMutation` / `useDeleteLabelMutation` with `mutateAsync`; `loading` combines `isPending` flags |
| `components/tasks/partials/EditLabels.vue` | `useLabels().filterLabelsByQuery`, `useCreateLabelMutation` to create-then-attach, then `taskStore.addLabel` / `removeLabel` |
| `stores/tasks.ts` | `useMutation(createLabelMutationOptions(), queryClient)` in the store setup (explicit client because setup may run without inject context); `ensureLabelsExist()` reads via `ensureLabels()` and falls back to `refreshLabels()` when a quick-add-magic label is missing; attaches via generated `taskLabelsCreate` / `taskLabelsDelete` |
| `components/tasks/partials/{Label,Labels}.vue`, `composables/useLabelStyles.ts`, `components/input/filter/{FilterAutocomplete.ts,FilterCommandsList.vue,highlighter.ts}` | generated `Label` type only |
| `models/task.ts`, `modelTypes/ITask.ts` | `labels: Label[]` (snake_case inside a camelCase model) |
| `client/inviteLink.ts`, `views/user/Register.vue`, `stores/auth.ts` | `inviteLinksCheck`, `authRegister`, `RegisterUserRequestWritable`, `PublicInviteLink` |
| `views/admin/InviteLinksView.vue` | `adminInviteLinksList/Create/Delete`, `adminTeamsList` called directly (no query module yet) |
| `views/user/settings/Mcp.vue` | `mcpInfo`, `ConnectionSettings` |
| `modelTypes/IApiTokenSettings.ts` | `RouteDetail` |
| `helpers/parseValidationErrors.ts` | `VikunjaErrorModel` |
| `client/http.ts` | `client`, `ResolvedRequestOptions` |
| tests: `client/queries/labels.test.ts`, `stores/tasks.test.ts`, `views/user/settings/Mcp.test.ts` | mock `@/client/generated` |

23 files import `@/client/generated` (`grep -rl` on 2026-09-16); `client/inviteLink.ts` makes 24 with its dynamic `./generated` import, which is why the foundation page says 23.

## Validation errors → field map

`helpers/parseValidationErrors.ts` accepts `VikunjaErrorModel`-like objects and returns `Record<field, message>`: v2 RFC 9457 `errors[].location` starting with `body.` is stripped to the field name; v1 `invalid_fields: ["email: msg"]` is split on the first colon. Views map the result onto form fields (`Register.vue` → `serverValidationErrors`). `stores/auth.ts` uses it to detect a rejected `language` on registration. Tests: `helpers/parseValidationErrors.test.ts`.

## Dependencies

- **Uses:** `@hey-api/client-fetch` runtime (vendored), `@tanstack/vue-query`, `helpers/auth.ts`, `helpers/fetcher.ts` (`getApiV2BaseUrl`), `i18n`, `message`, `helpers/color/colorFromHex.ts`.
- **Used by:** components and stores above; `veans/` and MCP consume the same OpenAPI document but not this client.

## Invariants and assumptions

- Generated output is byte-for-byte reproducible from `NewCanonicalAPI()`; `Check.FrontendClient` enforces it. `Servers[0]` in the Go API must stay the relative `/api/v2` ([API contract](../../05-api-contract.md#where-the-contract-is-defined)).
- `throwOnError: true` everywhere: never check `error` on the result; catch instead.
- Fields are snake_case exactly as the spec; do not camelCase generated types (the legacy `objectToCamelCase` must not run on them).
- Cache writes happen only inside mutation option callbacks with the context `client`; updaters bail on `undefined`; every mutation invalidates its list key in `onSettled`; `cancelQueries` only inside a full optimistic flow (`.agents/docs/api.md`).
- `setQueryData` needs the exact key; `invalidateQueries` matches by prefix (add `exact: true` when a prefix would hit other keys).
- Outside components, read via `ensure*`/`refresh*` and write via `useMutation(options, queryClient)`; `use*` hooks need inject context.

## Configuration

| Source | Key | Effect |
|---|---|---|
| env (build/codegen) | `VIKUNJA_OPENAPI_INPUT` | spec path for `openapi-ts`; set by the mage target |
| `window.API_URL` | derived `getApiV2BaseUrl()` | runtime base URL |
| `QueryClient` defaults | `staleTime 60 s`, `retry 1`, no focus refetch, mutations `retry false` | override per query (`labelsQuery` uses 5 min) |

## Error handling

Failures throw from the SDK call; `mutationFn` lets them propagate so `onError` can roll back and the component's `mutateAsync` rejects. Toasts for mutation outcomes live in the option callbacks (`success(...)` in `labels.ts`); error toasts come from the calling component via `error(e)` / `getErrorText(e)` (`message/index.ts` reads `code` and `detail` from problem+json). 422 validation bodies go through `parseValidationErrors`.

## Tests

- `client/queries/labels.test.ts` (198 lines): `vi.mock('@/client/generated', () => sdk)` with hoisted `vi.fn()`s and `vi.mock('@/message')`; query tests assert pagination, sorting, stale time, `ensureLabels` dedup, `refreshLabels`; mutation tests run the real lifecycle with `queryClient.getMutationCache().build(queryClient, options).execute(vars)` and assert cache contents (`cachedLabels()`), including "does not materialize a label list nobody loaded" and rollback on failure (assert inside the mocked request before throwing).
- `client/inviteLink.test.ts`: `vi.resetModules()` per test and dynamic `import('./inviteLink')` so the module side effect runs against a prepared `window.location`.
- `client/http.test.ts`: stubs `fetch`, uses the real generated `client`.
- `helpers/parseValidationErrors.test.ts`, `stores/tasks.test.ts` (mocks both `@/client/queries/labels` and `@/client/generated`).
- Run: `cd frontend && pnpm vitest run src/client src/helpers/parseValidationErrors`. e2e touching labels: `tests/e2e/task/task.spec.ts` ("Can add a new label", "existing label", kanban visibility), `sharing/linkShare.spec.ts` label picker.
- Not covered: `useLabels.ts` itself, `queryClient.ts` defaults, `InviteLinksView.vue` direct SDK calls.

## Add a query module for feature X

1. Make sure the v2 operations exist and are registered (`api-v2-routes` skill), then `mage generate:frontend-client`; commit `frontend/src/client/generated/`.
2. Create `frontend/src/client/queries/x.ts`: `xKeys` (`all`, plus `detail(id)` only if a detail query will exist), `xsQuery()` with `queryOptions`, `fetchAllXs` paginating the `Paginated` envelope, pure helpers over `X[]`, `create/update/deleteXMutationOptions()` with `onSettled` invalidation (optimistic `onMutate`/`onError` only when the UI benefits), thin `useCreateXMutation()` hooks, `ensureXs()` / `refreshXs()`.
3. Create `frontend/src/composables/useXs.ts` for reads (`useQuery(xsQuery())`, `data ?? []`).
4. In components: read through `useXs()`, write through the hooks; never import `queryClient`.
5. In stores or the router: `ensureXs()` / `refreshXs()` and `useMutation(createXMutationOptions(), queryClient)`.
6. Errors: `parseValidationErrors` for 422 field maps; toasts in option callbacks; redirects in the component.
7. Tests: copy `labels.test.ts` (mock `@/client/generated`, run mutations through `getMutationCache().build().execute()`); add an e2e spec for the user-visible flow.
8. Add an `en.json` key for any new toast; run `pnpm lint:fix`; update this page's consumer table and [stores](./stores.md) if a store changed.

## Gotchas and tech debt

- `client.gen.ts` hard-codes `baseUrl: '/api/v2'`; anything that imports the SDK before `configureApiClient()` runs would hit the wrong origin on split deployments. `main.ts` calls it before creating the app; `inviteLink.ts` dynamically imports `./generated` only when used.
- Two refresh implementations (`client/http.ts`, `helpers/fetcher.ts`); see [auth-and-session](./auth-and-session.md#gotchas-and-tech-debt).
- `views/admin/InviteLinksView.vue` calls SDK functions directly without a query module; treat it as the "before" state when adding one.
- `models/task.ts` re-snake-cases labels after `assignData` so the generated `Label` type survives inside a legacy model; any camelCase pass over a task must skip `labels`.
- The foundation page counts 23 generated-client importers (`@/client/generated`); it is 24 once `client/inviteLink.ts`'s relative `./generated` import is included.
- Type generation reflects Go struct tags: a missing `readOnly:"true"` makes a server-controlled field writable in `*Writable` types; fix it in Go, not here.

## Related pages

[api-client-legacy](./api-client-legacy.md), [auth-and-session](./auth-and-session.md), [stores](./stores.md), [sharing-teams-labels-notifications](./sharing-teams-labels-notifications.md), [testing-infrastructure](./testing-infrastructure.md), backend [api-v2-huma](../backend/api-v2-huma.md), [API contract](../../05-api-contract.md), [API design](../../../docs/api.md), [Conventions](../../08-conventions.md#data-layer), [Data flows: label mutation](../../10-data-flows.md), [Build a Vue feature](../../playbooks/build-vue-feature.md), [Add an API endpoint](../../playbooks/add-api-endpoint.md), [build-and-release](../build-and-release.md).
