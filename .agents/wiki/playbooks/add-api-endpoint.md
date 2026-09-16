# Playbook: add a new API endpoint end to end

From a new capability to a working v2 route, generated client, query module, and component. The `api-v2-routes` and `crudable` skills (`.agents/skills/`) are the authoritative checklists for the Go side; this page orders the whole job and names every file. Read [API contract](../05-api-contract.md) first if you have not.

Decide first: is it standard CRUD on an entity (list/read/create/update/delete) or a custom action (`POST /tasks/{id}/duplicate`)? CRUD gets `handler.Do*` for free; a custom action owns its permission check and session.

## 1. Model layer (`pkg/models/`)

Skip if the entity already exists and is CRUDable.

1. `pkg/models/<entity>.go`: struct with `xorm`, `json` (snake_case), `valid`, `doc:` and `readOnly:"true"` tags; `TableName()`; `Create/ReadOne/ReadAll/Update/Delete(s, a)`. Embed `web.CRUDable` and `web.Permissions` with `xorm:"-"` for methods you do not implement.
2. `pkg/models/<entity>_permissions.go`: `CanRead` (return the caller's max permission), `CanCreate`, `CanUpdate`, `CanDelete`. Load what you need here; the CRUD method trusts it. Reference: `pkg/models/label_permissions.go`.
3. Register the table in `pkg/models/models.go` → `GetTables()`; add `pkg/db/fixtures/<table>.yml`; add a migration ([add-migration](add-migration.md)).
4. Errors: `Err<X>DoesNotExist` etc. in `pkg/models/error.go` with the next free code in the right block; strings in `frontend/src/i18n/lang/en.json` → `error.<code>`.
5. Events if anything should react: `<Entity>CreatedEvent` in `pkg/models/events.go`, dispatched with `events.DispatchOnCommit(s, ...)` inside `Create` ([background-job](background-job.md)).
6. Tests in `pkg/models/<entity>_test.go`: each CRUD method plus positive and negative cases for every `Can*`. Run `mage test:filter Test<Entity> 2>&1 | tee /tmp/entity.log`.

## 2. v2 route (`pkg/routes/api/v2/<resource>.go`)

Copy `pkg/routes/api/v2/labels.go`.

1. Declare the list body type: `type fooListBody struct { Body Paginated[*models.Foo] }`.
2. `func RegisterFooRoutes(api huma.API)` with one `Register(api, huma.Operation{OperationID: "foos-list", Summary, Description, Method, Path: "/foos", Tags}, foosList)` per operation. Use the package `Register`, not `huma.Register` (it sets 201/204 defaults and runs govalidator). Verbs: POST create, PUT update, GET/DELETE as usual. Do not add PATCH; AutoPatch synthesizes it.
3. `func init() { AddRouteRegistrar(RegisterFooRoutes) }`. Registrar names must be unique across the package.
4. Handlers: `a, err := authFromCtx(ctx)`; call `handler.DoReadAll/DoReadOne/DoCreate/DoUpdate/DoDelete`; wrap every error with `translateDomainError(err)`. Type-assert the `DoReadAll` result with `ok` and return an error on mismatch. Read handlers embed `conditional.Params` and return through `conditionalReadResponse` with the max permission from `DoReadOne`; update bodies use the same read body type so AutoPatch round-trips.
5. Extra query params go directly on the handler input struct, not in an embedded helper (they silently fail to bind otherwise).
6. Custom actions: load the entity, call the right `Can*`, open `db.NewSession()`, commit or rollback yourself, then `singleBody`.
7. Public endpoint? Set `Security: []map[string][]string{}` on the operation and add the path to `unauthenticatedAPIPaths` in `pkg/routes/routes.go`.
8. Config-gated? Check the flag inside the registrar, not in `init()`.

Do not touch `pkg/routes/api/v1/` unless you are fixing a bug there.

## 3. Backend tests (`pkg/webtests/`)

- `pkg/webtests/huma_<resource>_test.go` using `webHandlerTestV2` (same `urlParams` shape as v1's `webHandlerTest`): list, read, create, update, delete, forbidden user, nonexistent id. Mirror the existing v1 test file if the resource has one so parity is reviewable.
- v2-only behavior (ETag/304, PATCH merge) in separate `Test<Resource>_*` functions using `humaRequest` / `humaTokenFor`.
- Run: `mage test:filter Test<Resource> 2>&1 | tee /tmp/resource.log` (webtests run in the second pass without `-short`).

## 4. Contract artifacts

1. `mage generate:frontend-client` and commit `frontend/src/client/generated/`. `mage check:frontend-client` must pass (CI gate).
2. MCP: add the operation id to `exposedOperations` in `pkg/modules/mcp/exposure.go` if agents should call it (typed or catalog tier). See [mcp](../components/backend/mcp.md).
3. API tokens: nothing to do; verify the derived scope name reads well (`GET /api/v1/routes` lists them) and that `pkg/models/api_routes.go` special cases do not apply.
4. Do not run `mage generate:swagger-docs`; v1 docs are CI-generated.

## 5. Frontend data layer (`frontend/src/client/queries/<feature>.ts`)

Copy the shape of `frontend/src/client/queries/labels.ts`:

- `export const fooKeys = { all: ['foos'] as const }`.
- `foosQuery()` via `queryOptions({queryKey: fooKeys.all, queryFn: async () => (await foosList({query: {...}})).data ...})`, paginate if the list can exceed a page.
- `createFooMutationOptions()` etc. via `mutationOptions()`: `mutationFn` calls the generated function and returns the entity; `onMutate` cancel + snapshot + optimistic write (bail when the cache is `undefined`); `onError` restore; `onSettled` invalidate `fooKeys.all`. Use the `client` from the callback context.
- Thin hooks `useCreateFooMutation()`; imperative `ensureFoos()` / `refreshFoos()` for stores and the router.
- `frontend/src/composables/useFoos.ts`: `useQuery(foosQuery())`, `data ?? []`, `isPending`, lookup helpers. Read side only.
- Tests: `frontend/src/client/queries/<feature>.test.ts` with `vi.mock('@/client/generated', () => sdk)` and the mutation-cache lifecycle pattern.

Do not add a `services/`, `models/`, or `modelTypes/` file.

## 6. Component and route

- View in `frontend/src/views/<area>/<Name>.vue`, route in `frontend/src/router/index.ts` (lazy import, `meta.showAsModal` if it is a settings modal), strings in `en.json`, `v-cy` test ids. Read through `useFoos()`, write through `useCreateFooMutation().mutateAsync(...)`; redirects and success toasts stay in the component, cache writes stay in the query module.
- Details in [build-vue-feature](build-vue-feature.md).

## 7. Verify end to end

1. `mage lint:fix`, `cd frontend && pnpm lint:fix`.
2. `mage test:filter Test<Resource>`; `pnpm vitest run src/client/queries/<feature>.test.ts`.
3. Run the API with your `config.yml`, `pnpm dev` (or `mage build && ./vikunja web` to serve the built SPA), exercise the UI, and check `curl` against `/api/v2/<resource>` with a bearer token; confirm `PATCH` works with `application/merge-patch+json`.
4. Add or extend a Playwright spec under `frontend/tests/e2e/<area>/` and run `VIKUNJA_E2E_API_PORT=3456 mage test:e2e "tests/e2e/<area>/<name>.spec.ts"`.
5. `mage check:frontend-client` and `mage check:translations`.

## Commonly missed

- `doc:` tags and `Summary`/`Description`; Huma cannot read Go comments, so the spec ships blank.
- `readOnly:"true"` on `id`, `created`, `updated`, `created_by`.
- The `ok` check on `DoReadAll`'s result (silent empty list).
- Discarding `DoReadOne`'s max permission (`_`), which breaks the ETag and `max_permission`.
- Fixture rows for the new table; tests then start with nothing to read.
- Negative permission tests (unrelated user, link share).
- Regenerating the client after a late struct change; CI fails on drift.
- `en.json` strings for new error codes.
- Registering a listener for a new event (an unregistered listener never runs).
