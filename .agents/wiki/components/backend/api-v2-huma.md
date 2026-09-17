# API v2 (Huma)

`/api/v2` is a [Huma v2](https://github.com/danielgtaylor/huma) API mounted on an Echo group through `pkg/modules/humabridge`. Each operation is a typed handler in `pkg/routes/api/v2/<resource>.go` that calls the same `handler.Do*` pipeline as v1 and returns RFC 9457 errors. Every new route goes here. Step-by-step instructions live in the `api-v2-routes` skill (`../../../skills/api-v2-routes/SKILL.md`); this page is the map of the machinery. Context: [Backend architecture](../../03-backend-architecture.md), [API contract](../../05-api-contract.md).

## Responsibility

- Owns: Huma configuration (`huma.go`), the registrar registry and post-registration passes (`registry.go`), response envelopes (`types.go`), the auth/error bridge (`errors.go`), govalidator bridging (`validation.go`), rich-text `format` handling (`richtext.go`), Scalar docs (`docs.go`), the canonical spec for codegen (`canonical.go`), and every `pkg/routes/api/v2/<resource>.go`.
- Does not own: Echo middleware and the group wiring in `pkg/routes/routes.go` → `registerAPIRoutesV2` ([http-routing-and-middleware](./http-routing-and-middleware.md)); permissions (`Can*` in models, [crud-framework](./crud-framework.md)); the MCP module that consumes the spec ([mcp](./mcp.md)).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `GroupPrefix = "/api/v2"` | `huma.go` | `routes.go`, `mcp` module, `humabridge` prefix rewrite |
| `NewAPI(e, g) huma.API` | `huma.go` | `registerAPIRoutesV2`, `NewCanonicalAPI` |
| `Register[I, O](api, op, handler)` | `huma.go` | every resource file (never `huma.Register` directly) |
| `AddRouteRegistrar(f)` / `RegisterAll(api)` | `registry.go` | resource `init()` funcs / `registerAPIRoutesV2` |
| `RegisterMCPInfo(api, settings)` | `mcp.go` | `registerAPIRoutesV2` after `mcpmodule.New` (explicit, not via registry) |
| `ScalarUI`, `ScalarJS` | `docs.go` | raw Echo routes `/docs`, `/docs/scalar.standalone.js` |
| `NewCanonicalAPI()` | `canonical.go` | `mage generate:frontend-client`, `mage check:frontend-client`, tests |
| `RichTextFormatHeader = "X-Vikunja-Format"` | `richtext.go` | `mcp/loopback.go` |
| `humabridge.NewWithGroup`, `EchoContextFrom`, `InternalDispatchRoute` | `pkg/modules/humabridge/humabridge.go` | `NewAPI`, `errors.go`, `pkg/routes/api_tokens.go`, `mcp` |

## Key types and functions

### `huma.go` → `NewAPI`

| Setting | Value / rule |
|---|---|
| `huma.DefaultConfig("Vikunja API", version.Version)` | title and version |
| `OpenAPIPath = "/openapi"` | serves `/api/v2/openapi.json`, `.yaml`, `openapi-3.0.json`, `openapi-3.0.yaml` (all in `unauthenticatedAPIPaths`) |
| `DocsPath = ""` | Huma's CDN docs disabled; Scalar served locally instead |
| `FieldsOptionalByDefault = true` | schema stays permissive so partial bodies match v1; presence rules come from `valid:` tags via `validateInputBody` |
| `Formats[application/x-www-form-urlencoded] = formURLEncodedFormat` | request-only format that re-marshals form values to JSON (OAuth token endpoint, RFC 6749); the default map is copied, not mutated |
| `Info.Description = richTextFormatAPIDescription` | Scalar landing text about `?format=markdown` |
| Security schemes | `JWTKeyAuth` (bearer JWT), `APITokenAuth` (bearer `tk_`), `BasicAuth` (Atom feed only); `oapi.Security` applies JWT and API token globally; public ops set `Security: []map[string][]string{}` (`health.go`, `info.go`, `testing.go`, plus `auth_login.go`, `auth_refresh.go`, `auth_openid.go`, `oauth.go`, and the `publicSecurity` var shared by `auth_public.go`, `invite_links.go`) **and** must be listed in `unauthenticatedAPIPaths` |
| `Servers` | `[{URL: "/api/v2"}, {URL: publicURL + "/api/v2"}]`. **Index 0 must stay relative**: Huma's `SchemaLinkTransformer` reads `Servers[0]` and would double-prefix `$schema` links otherwise (comment in `huma.go`) |

`Register` sets `DefaultStatus` from the verb when unset (POST → 201, DELETE → 204), wraps the handler with `validateInputBody`, and forwards to `huma.Register`. So v2 validates-then-authorizes exactly like v1. `withUploadLimits(op)` sets `MaxBodyBytes = (maxfilesize + 2) MB` and `BodyReadTimeout = 15m` for multipart uploads (Huma's default 5 s read deadline spans the whole body). Echo's global `BodyLimit` still applies on top.

### `registry.go` → `RegisterAll`

Runs every registrar collected by `AddRouteRegistrar` (init-time only, unsynchronised slice), then three passes over `api.OpenAPI().Paths`:

1. `EnableAutoPatch` (`huma.go`): `autopatch.AutoPatch(api)` synthesises `PATCH` for every GET+PUT pair, then rewrites summaries from "Patch labels-read" to "<PUT summary> (partial)".
2. `requireMultipartBodies`: marks `RequestBody.Required = true` when a `multipart/form-data` schema has required fields.
3. `stripPatchFormatQuery` (`richtext.go`): removes the `format` query parameter from synthesised PATCH ops because AutoPatch's re-dispatch drops the query string.

Config-gated resources check config inside the registrar (config is not loaded at `init()` time); e.g. `RegisterTestingRoutes` returns early unless `service.testingtoken` is set.

### `types.go` envelopes

| Type | Use |
|---|---|
| `Paginated[T]{Items, Total, Page, PerPage, TotalPages}` + `NewPaginated` | every list body; nil items become `[]` |
| `ListParams{Page default 1, PerPage default 50 max 1000, Q}` | embed in list inputs; `q` is the search param (v1 used `s`) |
| `singleBody[T]{Body *T}` | create/update responses |
| `singleReadBody[T]{ETag header, Body *T}` | reads |
| `conditionalReadResponse(p *conditional.Params, body, modified, permission)` | ETag = `"<UnixNano>-<permission>"` (quoted); honours `If-None-Match`/`If-Modified-Since` via Huma's `conditional` package (304 or 412); permission is folded in so a share change invalidates caches |
| `emptyBody` | delete / no-content |

Per-resource read bodies embed the model by value plus `MaxPermission` (`labels.go` → `labelReadBody`), and the **update input reuses that read body** so AutoPatch's echoed `max_permission` passes schema validation (`labelsUpdate`, comment at `labels.go:154`).

### `errors.go`

- `authFromCtx(ctx)` → `auth.GetAuthFromContext`; failure is logged and returned as a generic 401 (the token middleware already ran, so a failure here is a programming error).
- `translateDomainError(err)`: `errors.As` to `web.HTTPErrorProcessor` → `huma.NewError(HTTPCode, Message)` with `code` and `i18n_params` copied onto `vikunjaErrorModel`; `models.ValidationHTTPError` (not an `HTTPErrorProcessor`, its embedded field shadows the method) → **422** with `errors[].location = "body.<field>"` from `invalidFieldDetails`; anything else falls through and Huma answers 500.
- `errReadForbidden(a)` reproduces `handler.DoReadOne`'s 403 and log line for hand-rolled read checks.
- `vikunjaErrorModel` embeds `huma.ErrorModel` and adds `code`, `i18n_params`.
- `init()` replaces `huma.NewError` globally: 5xx causes are logged and stripped (`errs = nil`) so driver errors never reach `problem+json`, including on public `/health`. `NewErrorWithContext` is left alone to avoid double logging.
- `defaultErrorResponse(api)` re-declares the error response for ops that declare their own responses (e.g. 307 redirects), since Huma drops the default once any response is declared.

### `validation.go`

`validateInputBody(in)` finds the `Body` field by reflection, skips non-struct bodies (`[]byte` uploads), runs `govalidator.ValidateStruct` plus `pointerSliceErrors` for `[]*T` fields (govalidator skips those; `readOnly:"true"` and `valid:"-"` fields are ignored), sorts the `field: message` strings and returns `models.InvalidFieldError`. Result: the same `valid:` tags govern v1 (412) and v2 (422).

### `richtext.go`

`requestWantsMarkdown(ctx)` reads `?format=markdown` **or** the `X-Vikunja-Format: markdown` header from the stashed Echo context; the header is the only channel that survives AutoPatch. Handlers call `convertToHTML` before persisting and `convertToMarkdown`/`convertTasksToMarkdown` (pointer-deduplicated) on the way out. Per-operation `Format string \`query:"format"\`` fields (`projects.go`, `bulk_task.go`, `labels.go`) exist only to document the parameter.

### `humabridge`

`NewWithGroup(e, g, prefix, cfg)` installs `stashEchoContext` on the group **before** `humaecho.NewWithGroup` (Echo snapshots group middleware at registration), then wraps the adapter in `groupPrefixAdapter`, which prepends `/api/v2` to internal dispatches and stores the originating route template under an unexported context key. `InternalDispatchRoute(ctx)` exposes it read-only; `EchoContextFrom(ctx)` returns the `*echo.Context` or nil.

### Docs, canonical spec, MCP hook

- Scalar: `docs.go` embeds `scalar/scalar.html` and `scalar/scalar.standalone.js` (bundle refreshed by `mage generate:scalarBundle`, pinned in `magefile.go`).
- `NewCanonicalAPI()` (`canonical.go`) builds a bare Echo, force-enables every feature flag (local auth, OpenID, registration, link sharing, TOTP, attachments, comments, webhooks, backgrounds, Todoist/Trello/Microsoft importers), clears the testing token and public URL, runs `RegisterAll` and `RegisterMCPInfo` with a stub, pins `Servers` to `/api/v2`, and asserts the OpenID callback exists and no `/test/` path leaked. `mage generate:frontend-client` feeds it to `openapi-ts`.
- `RegisterMCPInfo` (`mcp.go`) registers `GET /mcp/info` → `ConnectionSettings{Endpoint, Routes, Presets}`; it rejects API tokens (checks `api_token` on the Echo context) and link shares (`user.GetFromAuth`). Lives here, not in `pkg/modules/mcp`, because that package imports this one.

## Internal structure

```mermaid
sequenceDiagram
    participant C as Client
    participant MW as Echo group middleware (SetupTokenMiddleware)
    participant AP as AutoPatch PATCH handler (via humabridge.groupPrefixAdapter)
    participant H as labelsRead / labelsUpdate
    C->>MW: PATCH /api/v2/labels/1 (merge-patch+json, Bearer tk_...) — CanDoAPIRoute accepts PATCH as alias of stored PUT; RecordAPITokenUse
    MW->>AP: dispatch
    AP->>MW: internal GET /labels/1 (headers copied, query dropped); adapter prefixes /api/v2 and marks InternalDispatchRoute = "/api/v2/labels/:id"; shouldSkipRouteCheck → skip, no usage event
    MW->>H: labelsRead → DoReadOne → body + ETag; AutoPatch merge-patches the body
    AP->>MW: internal PUT /labels/1 (If-Match ETag); route check runs normally (PUT must be authorised)
    MW->>H: labelsUpdate → validateInputBody → DoUpdate
    H-->>C: 200 singleBody (or 304 when nothing changed)
```

API-token treatment (`pkg/routes/api_tokens.go` → `shouldSkipRouteCheck`, `checkAPITokenAndPutItInContext`): the GET leg inherits the PATCH's authorisation only when it is a bare GET with no query on the same route template it was authorised against; both internal legs skip `RecordAPITokenUse`. `CollectRoutesForAPITokenUsage` stores only the PUT (PATCH would clobber the `update` key) and `tokenAuthorizesRoute` accepts PATCH as its alias.

## Resource files and operation IDs

Operation IDs become generated client functions (`labels-list` → `labelsList`) and MCP tool names (`labels_list`).

| File | Operation IDs |
|---|---|
| `admin_invite_links.go` | admin-invite-links-list, -create, -delete |
| `admin_projects.go` | admin-projects-list, admin-projects-patch-owner |
| `admin_teams.go` | admin-teams-list |
| `admin_users.go` | admin-overview, admin-users-list, -create, -delete, -patch-admin, -patch-status, -set-password, -password-reset-email |
| `api_tokens.go` | tokens-list, tokens-create, tokens-delete |
| `auth_login.go`, `auth_refresh.go`, `auth_openid.go` | auth-login, auth-logout, auth-refresh-token, auth-openid-callback |
| `auth_public.go` | auth-register, auth-confirm-email, auth-password-token, auth-password-reset, auth-link-share |
| `avatar.go`, `avatar_upload.go` | avatar-get, user-avatar-upload |
| `backgrounds.go` | projects-background-get, -delete, -upload, -unsplash-set, backgrounds-unsplash-search, -image, -thumb |
| `bot_users.go` | bots-list, -read, -create, -update, -delete |
| `buckets.go` | buckets-list, -create, -update, -delete |
| `bulk_task.go`, `task_bulk_create.go` | tasks-bulk-update, tasks-bulk-create |
| `caldav_tokens.go` | caldav-tokens-list, -create, -delete |
| `health.go`, `info.go` | health, info (public) |
| `invite_links.go` | invite-links-check (public) |
| `label_tasks.go`, `label_task_bulk.go` | task-labels-list, -create, -delete, task-labels-bulk-replace |
| `labels.go` | labels-list, -read, -create, -update, -delete (reference implementation) |
| `link_sharing.go` | shares-list, -read, -create, -delete |
| `mcp.go` | mcp-info |
| `migration_credentials.go`, `migration_oauth.go`, `migration_shared.go`, `migration_file.go`, `migration_csv.go` | `migration-<name>-status`, `migration-<name>-migrate`, `migration-<name>-auth` built per importer; migration-csv-detect, -preview, -migrate, -status |
| `notifications.go`, `notifications_feed.go` | notifications-list, -mark-read, -mark-all-read, -delete-all, notifications-atom-feed (Basic auth) |
| `oauth.go` | oauth-authorize, oauth-token (form or JSON) |
| `project_duplicate.go`, `project_teams.go`, `project_users.go`, `project_views.go` | projects-duplicate; project-teams-*, project-users-* (list/create/update/delete); project-views-list, -read, -create, -update, -delete |
| `projects.go` | projects-list, -read, -create, -update, -delete |
| `reactions.go` | reactions-list, -create, -delete |
| `saved_filters.go` | filters-read, -create, -update, -delete |
| `sessions.go`, `subscriptions.go` | sessions-list, sessions-delete, subscriptions-create, subscriptions-delete |
| `task_assignees.go`, `task_assignees_bulk.go` | task-assignees-list, -create, -delete, task-assignees-bulk |
| `task_attachments.go` | task-attachments-list, -upload, -download, -delete |
| `task_bucket.go`, `task_position.go`, `task_unread_status.go`, `task_duplicate.go` | task-bucket-update, tasks-position-update, tasks-mark-read, tasks-duplicate |
| `task_collection.go` | tasks-list, project-tasks-list, project-view-tasks-list, project-view-buckets-tasks-list |
| `task_comments.go` | task-comments-list, -read, -create, -update, -delete |
| `task_relations.go` | tasks-relations-create, tasks-relations-delete |
| `tasks.go` | tasks-read, -read-by-index, -create, -update, -delete |
| `teams.go`, `team_members.go` | teams-list, -read, -create, -update, -delete, teams-members-add, -remove, -toggle-admin |
| `testing.go` | testing-truncate-all (`DELETE /test/all`, 200), testing-replace-table (`PUT /test/{table}`, 201); testing token in `Authorization`, only when configured |
| `time_entries.go` | time-entries-list, -read, -create, -update, -delete, -timer-stop, task-time-entries-list, project-time-entries-list |
| `token_meta.go` | token-test, token-check, token-renew, token-routes |
| `user_deletion.go`, `user_export.go`, `user_search.go` | user-deletion-request, -confirm, -cancel; user-export-request, -download, -status; users-search, projects-users-search |
| `user_settings.go` | user-show, user-update-settings, user-change-password, user-update-email, user-cancel-email-update, user-resend-email-confirmation, user-get-avatar-provider, user-set-avatar-provider, user-timezones |
| `user_totp.go` | totp-get, -enroll, -enable, -disable, -qrcode |
| `user_webhooks.go`, `webhooks.go`, `webhook_events.go` | user-webhooks-list, -create, -update, -delete, -events; webhooks-list, -create, -update, -delete; webhooks-events-list |

Raw Echo routes on the same group, outside the spec: `/ws` (`ws.UpgradeHandler`), `/docs`, `/docs/scalar.standalone.js`, `POST /mcp`.

## Dependencies

- **Uses:** `pkg/web/handler` (`Do*`), `pkg/models`, `pkg/user`, `pkg/modules/auth`, `pkg/routes/api/shared`, `pkg/richtext`, `pkg/db` (custom handlers open sessions), `github.com/danielgtaylor/huma/v2` (+ `autopatch`, `conditional`, `adapters/humaecho`), `govalidator`.
- **Used by:** `pkg/routes/routes.go`, `pkg/modules/mcp` (tools from `api.OpenAPI()`), `magefile.go` codegen, `frontend/src/client/generated`, `veans`.

## Invariants and assumptions

- `Servers[0]` is relative (`huma.go` comment; `schema_link_test.go` → `TestRegisterAllCreatesAllSchemaLinks`).
- `RegisterAll` runs once per API instance and after every registrar; nothing calls `EnableAutoPatch` directly. Registrar names are package-global, so they must be distinct (`RegisterAvatarRoutes` vs `RegisterAvatarUploadRoutes`).
- A public op needs both `Security: []map[string][]string{}` and an `unauthenticatedAPIPaths` entry; `unauthenticatedPathSet` panics at boot if a rate-limited path is missing from the map.
- Group middleware order in `registerAPIRoutesV2`: no-store, token middleware, refresh/credential rate limits, general rate limit, metrics, then `gateV2AdminRoutes` (must follow rate limiting; the gate does a DB read per request).
- The Echo context must be on the request context (`stashEchoContext`) or `authFromCtx` fails with 401.
- `NewCanonicalAPI` must contain no `/test/` paths and must contain the OpenID callback; CI's `mage check:frontend-client` regenerates twice and diffs.

## Configuration

No v2-specific keys. Feature flags checked inside registrars: `service.testingtoken`, `auth.*`, `service.enable*`, `webhooks.enabled`, `backgrounds.*`, `migration.*`. `service.publicurl` feeds `Servers[1]` and the MCP endpoint.

## Error handling

`translateDomainError` → `problem+json` with `code`/`i18n_params`; validation → 422; unknown errors → 500 with cause logged (`log.Errorf("v2: internal server error: ...")`) and stripped. `errors_test.go` → `TestNewError_StripsServerErrorDetail`. See [API contract](../../05-api-contract.md#error-format) for wire samples.

## Tests

- Harness: `pkg/webtests/integrations.go` → `webHandlerTestV2{user, basePath, idParam, t}` mirrors v1's `webHandlerTest` (`testReadAllWithUser`, `testCreateWithUser` sends POST, `testUpdateWithUser` sends PUT); `serve` mints a JWT with `auth.NewUserJWTAuthtoken`, runs the full Echo+Huma stack from `setupTestEnv()`, and converts >=400 responses into `v2HTTPError` so `assertHandlerErrorCode` works unchanged.
- Helpers: `pkg/webtests/huma_helpers_test.go` → `humaTokenFor(t, u)`, `humaRequest(t, e, method, path, body, token, contentType)` for chained calls (create → PATCH → GET).
- 69 `pkg/webtests/huma_*_test.go` files; cross-cutting ones: `huma_errors_test.go` (`TestHuma_ErrorShapeIsRFC9457`, `TestHuma_HealthcheckFailureDoesNotLeakCause`), `huma_non_crud_aliases_test.go`, `huma_richtext_test.go`, `huma_rate_limit_test.go`, `huma_testing_test.go`.
- Unit: `pkg/routes/api/v2/{errors,canonical,schema_link}_test.go`, `pkg/modules/humabridge/humabridge_test.go` (`TestAutoPatchUnderGroup`, `TestServeHTTPSkipsAlreadyPrefixedPath`).
- Run a webtest: `mage test:filter TestLabel 2>&1 | tee /tmp/out.log` (the second pass reruns `pkg/webtests` without `-short`).

## Gotchas and tech debt

- Embedded/shared query-param structs do not bind under Huma when combined with other params; declare each `query:"..."` field directly on the input struct (skill, "extra query params").
- `DoReadAll` returns `any`; a blind cast silently serialises `[]`. Always type-assert with `ok`.
- AutoPatch drops the query string: `?format=markdown` on PATCH is ignored, use `X-Vikunja-Format`. `stripPatchFormatQuery` hides the param from the spec for that reason.
- AutoPatch answers a no-op patch with 304 and an empty body (handled in `mcp/loopback.go` → `parseResponse`).
- v2 enforces `minLength`/`enum` struct tags at the schema layer, so bodies v1 accepted can fail with 422 (observed: empty label title).
- `RegisterMCPInfo` is the one operation registered outside the registry; keep it after `mcpmodule.New` in `routes.go` and in `NewCanonicalAPI`.
- No TODO/FIXME comments in `pkg/routes/api/v2/*.go` or `pkg/modules/humabridge/` (only inside the vendored Scalar bundle).

## Related pages

[api-v1](./api-v1.md), [mcp](./mcp.md), [http-routing-and-middleware](./http-routing-and-middleware.md), [auth-and-sessions](./auth-and-sessions.md), [crud-framework](./crud-framework.md), [operations-subsystems](./operations-subsystems.md) (richtext), [api-client-generated-and-queries](../frontend/api-client-generated-and-queries.md), [API contract](../../05-api-contract.md), [add-api-endpoint playbook](../../playbooks/add-api-endpoint.md), skill `../../../skills/api-v2-routes/SKILL.md`, rules `../../../docs/api.md`.
