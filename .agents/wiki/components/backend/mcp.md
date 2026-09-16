# MCP server

`pkg/modules/mcp` exposes a subset of the v2 API as [Model Context Protocol](https://modelcontextprotocol.io) tools at `POST /api/v2/mcp`. Tools are derived from the Huma OpenAPI document at startup and executed by dispatching a synthetic HTTP request back through the v2 handler stack, so permissions, validation, and API-token scopes are exactly those of the REST API. Context: [api-v2-huma](./api-v2-huma.md), [API contract](../../05-api-contract.md#realtime-and-other-channels).

## Responsibility

- Owns: tool derivation from the spec (`tools.go`, `spec.go`), the exposure allow-list (`exposure.go`), the `find_action`/`do_action` meta-tools (`catalog.go`), argument validation (`args.go`), the loopback dispatcher (`loopback.go`), the streamable-HTTP transport and request guards (`mcp.go`), and the connection-settings payload (`info.go`).
- Does not own: authentication (the group's `SetupTokenMiddleware` runs first), the `mcp` token scope table (`pkg/models/api_routes.go`), the `/mcp/info` operation (`pkg/routes/api/v2/mcp.go`, because `mcp` imports `apiv2`), or the UI (`frontend/src/views/user/settings/Mcp.vue`).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `New(api huma.API, allowOrigin func(string) bool) (*Module, error)` | `mcp.go` | `pkg/routes/routes.go` → `registerAPIRoutesV2`, after `apiv2.RegisterAll` (AutoPatch must have run) |
| `(*Module).Register(group)` | `mcp.go` | registers `POST /mcp` only |
| `(*Module).ConnectionInfo() apiv2.ConnectionSettings` | `info.go` | `apiv2.RegisterMCPInfo` for `GET /api/v2/mcp/info` |
| `RoutePrefix = "/api/v2/mcp"` | `mcp.go` | `pkg/routes/api_tokens.go` → `shouldSkipRouteCheck` |
| `ExposedToolNames()` | `exposure.go` | tests comparing the allow-list to live routes |

## Key types and functions

| Symbol | File | Role |
|---|---|---|
| `Module{api, index, order, authorize, streamable, origin, allowOrigin}` | `mcp.go` | `index` is tool name → `*tool`; `order` is name-sorted; `authorize` defaults to `(*models.APIToken).CanUseRoute` |
| `tool{name, op, echoPath, typed, spec, contentType, description}` | `tools.go` | `echoPath` is `/api/v2` + the Huma path with `{id}` → `:id`, i.e. the string the token table stores |
| `candidates(item)` | `tools.go` | picks GET, POST, DELETE, and for update the PATCH op under the **PUT's** operation ID (so `labels-update` executes as merge-patch) |
| `buildTools(oapi, prefix)` | `tools.go` | walks every path, applies `exposure`, builds specs, fails on duplicate names |
| `exposedOperations map[string]toolTier` | `exposure.go` | the allow-list; `typedTool` = first-class tool, `catalogTool` = reachable via `find_action`/`do_action` |
| `exposure(id, op)` | `exposure.go` | listed **and** (if it has a body) JSON or merge-patch body; multipart ops are never exposed |
| `buildToolSpec(oapi, op)` | `spec.go` | path/query params + body properties (minus `readOnly` and fields bound from the path) into one flat JSON schema; PATCH fields become nullable unless `mustHaveValue`; POST adds `valid:"required"` fields and `title` for `tasks-create`; `additionalProperties: false` |
| `bodySchemaOp` | `spec.go` | reads PATCH shape/description from the sibling PUT (AutoPatch's own body schema collapses refs) |
| `describe` | `tools.go` | summary + description from the PUT for PATCH, plus "Only fields present in the arguments are changed." and the format hint |
| `decodeArgs`, `decodeToolArgs` | `args.go` | JSON-schema validation of arguments; `null` for a parameter means unset |
| `callTool(ctx, name, rawArgs)` | `loopback.go` | lookup → caller Echo context → `authorized` → decode → `newRequest` → `api.Adapter().ServeHTTP` into an `httptest.ResponseRecorder` → `RecordAPITokenUse` on <400 → `parseResponse` |
| `(*tool).newRequest` | `loopback.go` | path params substituted, query params encoded (explode-aware), remaining args become the JSON body, `format` on PATCH becomes `X-Vikunja-Format`; copies the caller's `Authorization`, `Host`, `TLS`, `X-Forwarded-*`, `User-Agent`, request id, `RemoteAddr` |
| `parseResponse`, `errorText`, `problemText` | `loopback.go` | 304 → `{ok, unchanged}`, empty → `{ok}`, >=300 → tool error text (problem+json flattened, 401 gets a scope hint, 2000-rune cap) |
| `installCatalogTools`, `findActionHandler`, `doActionHandler` | `catalog.go` | `find_action{action?, resource?}` lists catalog tools (schemas only when filtered); `do_action{action, arguments}` forwards to `rawToolHandler` |
| `limitRequestBody`, `countBatchMessages` | `mcp.go` | 4 MiB body cap (413 written directly, since `error_handler.go` rewrites returned 413s into "file too large"), max 20 batched JSON-RPC messages (400) |

## Internal structure

```mermaid
sequenceDiagram
    participant A as MCP client
    participant MW as SetupTokenMiddleware
    participant H as Module.handler / per-request mcp.Server
    participant L as callTool (loopback) → v2 Huma handler
    A->>MW: POST /api/v2/mcp, Bearer tk_... — shouldSkipRouteCheck: MCP prefix → skip route table, set api_token
    MW->>H: CrossOriginProtection.Check or CORS allow-list; require api_token; HasMCPAccess; body limits
    H->>H: newServerForRequest: AddTool for typed tools the token authorizes; find_action/do_action for the rest
    A->>H: tools/call labels_update {id, title} → rawToolHandler → callTool
    H->>L: authorized(tool, token) via CanUseRoute(echoPath, method)
    L->>L: PATCH /labels/1 through api.Adapter() (humabridge prefix rewrite, AutoPatch GET+PUT) → 200 JSON → RecordAPITokenUse; parseResponse
    H-->>A: CallToolResult (text + structuredContent for objects)
```

Design points, each sourced from a comment in the code:

- **Stateless, per-request server** (`newStreamableHandler`, `Stateless: true`): `tools/list` is filtered by the caller's token, so the server is rebuilt for every request. `DisableLocalhostProtection: true` because deployments sit behind loopback reverse proxies.
- **Only `POST /mcp` is registered**; the SDK's GET (SSE stream) and DELETE (session end) verbs are deliberately not routed (`pkg/webtests/mcp_transport_test.go` → `TestMCP_GetNotAllowed`, `TestMCP_DeleteNotAllowed`), and `TestMCP_SessionIDDoesNotCarryIdentity` asserts a session id never substitutes for the token.
- **JWTs are rejected** (`handler`: "MCP requires an API token"). JWTs would bypass route scopes.
- **Origin check**: `http.CrossOriginProtection` (Go stdlib) first; if it fails, the `Origin` header is accepted only when `routes.corsOriginAllowed` says so (supports `http://host:*`). Non-browser clients send no `Origin` and pass.
- **Loopback carries the caller's exact `Authorization` value** (`models.APITokenAuthorization`) so it cannot authenticate as a different header, and the loopback leg is an internal dispatch: the middleware skips its usage event (`callTool` records one itself on success) but **does not skip the route check** (`shouldSkipRouteCheck` only skips paths under the MCP prefix and AutoPatch's bare GET).
- **Merge-patch semantics**: update tools are PATCH; `null` clears a body field, a missing field is untouched; a no-op patch yields `unchanged: true`.

### Token scope `mcp:access`

`pkg/models/api_routes.go` → `init()` seeds `apiTokenRoutesV2["mcp"] = {"access": {Path: "/api/v2/mcp", Method: POST}}`; `CollectRoutesForAPITokenUsage` skips groups named `mcp`/`mcp_*` so the route walk does not duplicate it. `(*APIToken).HasMCPAccess()` (`pkg/models/api_tokens.go:280`) is `HasPermission("mcp", "access")`. A token needs `mcp:access` **plus** the ordinary scopes of every tool it should see (`labels:read_all`, `tasks:update`, ...); tools the token cannot use are simply absent from `tools/list` and `find_action`. `ConnectionInfo` computes exactly which `(group, permission)` pairs unlock at least one tool and publishes presets: `read_only` (`*: read_one, read_all`), `typed` (exact permissions of typed tools), `full` (`*: *`).

## How to expose a new operation

1. Register the v2 operation normally (`api-v2-routes` skill). It must accept `application/json` (or be PATCH via AutoPatch); multipart or binary bodies are rejected by `exposure` → `bodyMedia`.
2. Add its **operation ID** to `exposedOperations` in `pkg/modules/mcp/exposure.go` as `catalogTool` (discoverable through `find_action`, default for anything niche) or `typedTool` (listed directly; keep this set small, it is what every client sees on connect). For updates use the **PUT's** operation ID (`foos-update`); `candidates` maps it to the PATCH op.
3. Make sure the tool name (`-` → `_`) is unique; `buildTools` panics at startup on duplicates.
4. Check the spec is representable: body property names must not collide with path/query parameter names (`buildToolSpec` errors), and nested schemas inline to depth 8 (`maxInlineDepth`).
5. Add a `TestBuildToolSpec_*` or extend `exposure_test.go` if the shape is unusual. `pkg/webtests/mcp_catalog_test.go` → `TestMCP_Catalog_EveryExposedOperationIsReachable` asserts `mcp.ExposedToolNames()` equals the tools reachable on the live v2 API with an all-scopes token, so a listed ID that no route produces (or a typo) fails that test.
6. Nothing else: `ConnectionInfo` and the frontend presets derive from the allow-list automatically.

Deliberately absent (comment in `exposure.go`): credentials, account settings, webhooks, link shares, file transfer, admin routes. Also not listed (no comment, but absent from the map): bots, health/info, the Atom feed. Keep it that way unless the security review says otherwise.

## Dependencies

- **Uses:** `pkg/routes/api/v2` (`GroupPrefix`, `RichTextFormatHeader`, `ConnectionSettings`), `pkg/modules/humabridge` (`EchoContextFrom`), `pkg/models` (`APIToken`, `CanUseRoute`, `RecordAPITokenUse`, `GetAPITokenRoutes`), `pkg/config` (`service.publicurl`), `github.com/modelcontextprotocol/go-sdk/mcp`, `github.com/google/jsonschema-go/jsonschema`.
- **Used by:** `pkg/routes/routes.go` (wiring), `pkg/routes/api_tokens.go` (`RoutePrefix`), `pkg/routes/api/v2/mcp.go` (`/mcp/info`).

## Invariants and assumptions

- `New` runs after `RegisterAll`; otherwise PATCH ops (and therefore all update tools) are missing.
- `tool.echoPath` must equal the path string `CollectRoutesForAPITokenUsage` stored, since `CanUseRoute` compares exact `(Path, Method)`. Huma `{id}` and Echo `:id` are bridged by `echoPath()`.
- The caller's Echo context is read **before** dispatch (`callTool` comment): the loopback re-enters the group middleware and stashes its own context.
- `shouldSkipRouteCheck` returns true for the MCP prefix; the module enforces `HasMCPAccess` itself. Removing that check in `api_tokens.go` would make `mcp:access` tokens fail before reaching the handler.
- `ConnectionSettings` lives in `apiv2` to avoid an import cycle; `NewCanonicalAPI` registers `/mcp/info` with a stub so the generated client has the type.

## Configuration

No dedicated keys. `service.publicurl` builds `Endpoint`; `cors.enable`/`cors.origins` feed `allowOrigin`. Rate limiting and the `Cache-Control: no-store` header come from the v2 group.

## Error handling

- Transport: 403 (origin, missing `mcp:access`), 401 (no API token / JWT), 413 (body > 4 MiB), 400 (unreadable body, > 20 batched messages), 500 (`api_token` of wrong type, logged `[mcp]`).
- Tool level: domain/HTTP failures become `CallToolResult{IsError: true}` with the flattened problem text, never Go errors (`//nolint:nilerr` sites). Only marshal failures return an error to the SDK.
- A loopback 401 is reported as a missing scope with `scopeHint`, because the transport already authenticated the token.

## Tests

- `pkg/modules/mcp/*_test.go` build a synthetic `things` API (`testapi_test.go` → `newTestAPI`, `newTestModule`) and extend `exposedOperations` in an `init()` in `exposure_test.go`. Coverage: `spec_test.go` (schema shapes, PATCH nullability, path-bound fields, recursion, `tasks-create` title), `loopback_test.go` (auth forwarding, merge-patch, null handling, client address, request id, forwarded host, scope errors), `catalog_test.go`, `exposure_test.go`, `info_test.go`. Run: `mage test:filter 'TestCallTool|TestBuildToolSpec|TestCatalog|TestExposure|TestMCP'`.
- Frontend: `frontend/src/views/user/settings/Mcp.test.ts`, `frontend/src/components/token/McpClientGuide.test.ts`; e2e `frontend/tests/e2e/user/settings/mcp.spec.ts` (creates a token with locked `mcp:access`, asserts presets include `tasks:update` and `other:users`, checks the client guide for Claude Code, Codex, Claude Desktop, Mistral Vibe, ChatGPT, and that the secret is gone after reload). Run e2e through the `run-e2e-tests` skill.
- Integration through the real Echo stack: `pkg/webtests/mcp_test.go` (`TestMCP_AnonymousRejected`, `TestMCP_JWTRejected`, `TestMCP_TokenWithoutMCPScopeRejected`, `TestMCP_Initialize`, `TestMCP_ToolsListMatchesScopes`, `TestMCP_BatchLimits`, `TestMCP_OversizedBodyRejected`, `TestMCP_NonLoopbackHostAccepted`), `mcp_transport_test.go` (GET/DELETE 405, cross-origin rejected, wildcard CORS origin allowed, sub-path 404), `mcp_catalog_test.go` (allow-list vs reachable tools), `mcp_info_test.go` (`TestMCPInfo`). Run with `mage test:filter TestMCP` (the second pass reruns `pkg/webtests` without `-short`).

## Frontend

- Route `/user/settings/mcp` (`frontend/src/router/index.ts:120`) → `frontend/src/views/user/settings/Mcp.vue`: calls generated `mcpInfo()` for endpoint and presets, lists API tokens filtered to `permissions.mcp` including `access` via the legacy `ApiTokenService` (v1 `/tokens`), embeds `ApiTokenForm` with `:locked-scopes="{mcp: ['access']}"` and the `typed` preset preselected, and shows `McpClientGuide` once with the fresh secret.
- `frontend/src/components/token/McpClientGuide.vue`: `props {endpoint, token}`, client choice persisted in `localStorage['mcp-client']`, renders copyable setup steps per client (`claude mcp add --transport http ...`, `codex mcp add ...`, config snippets); help link `MCP_HELP = https://vikunja.io/help/mcp/` (`frontend/src/urls.ts`).
- See [user-settings-and-admin](../frontend/user-settings-and-admin.md).

## Gotchas and tech debt

- Adding an operation to v2 does **not** expose it; forgetting `exposure.go` fails silently (tool absent). The sync checklist in [API contract](../../05-api-contract.md#keeping-both-sides-in-sync) lists this step.
- `Mcp.vue` still uses the legacy `ApiTokenService` for token CRUD because token routes are v1-era; new token features should move to the generated client.
- Typed tools are hard-coded to labels, projects, tasks, task assignees, task comments, and `users-search`; there is no per-instance configuration of the allow-list.
- History: `git log -- pkg/modules/mcp` shows the module landed in five commits (`e115c375f` spec derivation, `9d57de26d` loopback, `4ccf95bf8` catalog, `bba48e40b` transport, `d390a7c37` connection settings).
- No TODO/FIXME comments in `pkg/modules/mcp/`.

## Related pages

[api-v2-huma](./api-v2-huma.md), [auth-and-sessions](./auth-and-sessions.md) (API tokens), [http-routing-and-middleware](./http-routing-and-middleware.md), [user-package](./user-package.md), [user-settings-and-admin](../frontend/user-settings-and-admin.md), [API contract](../../05-api-contract.md), rules `../../../docs/api.md`, skill `../../../skills/api-v2-routes/SKILL.md`.
