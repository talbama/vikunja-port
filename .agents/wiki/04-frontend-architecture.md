# Frontend architecture

The Vue 3 single-page app in `frontend/`. Feature-level detail lives under [components/frontend/](README.md#frontend-components); this page explains the skeleton every feature hangs on.

## Bootstrap

`frontend/src/main.ts`, in this order (verified 2026-09-16):

1. `import './client/inviteLink'` first, so an `#invite-link=` fragment is consumed before the router or telemetry can touch the URL.
2. Resolve the API URL: `localStorage.API_URL` overrides `window.API_URL` (set by the inline script at the end of `index.html`, default `/api/v1`); a trailing slash is stripped.
3. `configureApiClient()` (`src/client/http.ts`) configures the generated fetch client's base URL and interceptors.
4. Import directives (`focus`, `tooltip`, `shortcut`, `cy`) and global components (`Icon`, `XButton`, `Modal`, `Card`), then `setupKeyboardModality()` and `handleChunkLoadErrors()`; the directives and components are registered on the app inside the callback below.
5. **Load the browser language before creating the app**: `setLanguage(getBrowserLanguage()).then(...)`.
6. Inside the callback: optional Sentry (`window.SENTRY_ENABLED`), `Notifications`, `VueQueryPlugin` with the shared `queryClient`, global error handler routing to `error()` from `src/message`, then `pinia` → `router` → `i18n` → `mount('#app')`.

`src/App.vue` chooses the layout inside `<Ready>` (`src/components/misc/Ready.vue`, which waits for `baseStore.appReady`):

| Condition | Renders |
|---|---|
| Electron quick-add window (`useQuickAddMode`) | `QuickAddOverlay` |
| `authStore.authUser` and route not in `AUTH_ROUTE_NAMES` | `AppHeader` + `ContentAuth` (sidebar, keep-alive'd `project.view`, quick actions, websocket connect) |
| `authStore.authLinkShare` | `ContentLinkShare` |
| otherwise | `NoAuthWrapper` with the login/register/reset views |

`src/stores/base.ts` → `hydrateConfig()` runs at store creation: `checkAndSetApiUrl(window.API_URL)` (probes `/info`, falls back to `+/api/v1`, https, and **port 3456**), then `authStore.checkAuth()`. The resulting promise is exported as `baseStore.appReady` so the router guard can await it without deadlocking on `router.isReady()`.

## Routing

`src/router/index.ts` (670 lines) uses `createWebHistory(import.meta.env.BASE_URL)`. Route families and their views:

| Family | Names | Views |
|---|---|---|
| Auth | `user.login`, `user.register`, `user.password-reset.*`, `openid.auth`, `oauth.authorize`, `link-share.auth` | `src/views/user/*`, `src/views/sharing/LinkSharingAuth.vue` |
| Home and tasks | `home`, `task.detail` (`/tasks/:id`), `tasks.range` (`/tasks/by/upcoming`) | `src/views/Home.vue`, `src/views/tasks/*` |
| Projects | `projects.index`, `project.create`, `project.index` (redirects to the remembered view), `project.view` (`/projects/:projectId/:viewId`), `project.settings.*` (modals) | `src/views/project/*` |
| Filters, labels, teams | `filters.create`, `filter.settings.*`, `labels.*`, `teams.*` | `src/views/{filters,labels,teams}/*` |
| User settings | `user.settings` and children: general, avatar, caldav, mcp, data-export, feeds, deletion, email-update, password-update, totp, apiTokens, sessions, webhooks, bots, plus the `migrate.*` routes | `src/views/user/settings/*`, `src/views/migrate/*` |
| Pro-gated | `time-tracking`, `admin.*` | `src/views/time-tracking/*`, `src/views/admin/*` |

Guard (`router.beforeEach`): `await authStore.checkAuth()`; `meta.requiresAdminPanel` / `requiresUserInvites` / `requiresTimeTracking` check `configStore.isProFeatureEnabled(...)` (and `authStore.info.isAdmin`) and redirect to `not-found` rather than 403; a `#share-auth-token=` hash redirects to `link-share.auth`; then `getAuthForRoute(to, authStore)` handles email confirmation, password reset, `#redirect=` targets, `saveLastVisited` (so the destination survives an external OIDC round trip), and finally sends unauthenticated users to `user.login`.

Routes with `meta.showAsModal` (project settings, filter settings) render on top of the previous route via `useRouteWithModal`. `Login`, `Register`, `LinkSharingAuth`, `OpenIdAuth`, `ShowTasks`, and `NotFound` are imported eagerly; everything else is lazy.

## State management

All stores are setup-style (`defineStore('x', () => {...})`); all but `viewFilters` end with the `import.meta.hot.accept(acceptHMRUpdate(...))` block. See [stores](components/frontend/stores.md).

| Store | Owns |
|---|---|
| `auth` (`src/stores/auth.ts`) | JWT session, user info and settings, TOTP, OIDC, link-share auth, `checkAuth()` debounced to once a minute |
| `base` | App readiness, current project/view, background image and blurhash, menu state (spread from `useMenuActive`), shortcuts/quick-actions overlays, update banner |
| `config` | The `/info` payload, `isProFeatureEnabled` |
| `project` (`projects.ts`) | Project map and tree, favorites, saved filters, views |
| `task` (`tasks.ts`) | Task CRUD, assignees, labels, quick-add magic, bulk create |
| `kanban` | Buckets and per-bucket task pagination |
| `timeTracking`, `migration`, `viewFilters` | Timer state (websocket-fed), import polling, per-view filter query in localStorage |

Convention: server state that is a plain list or entity cache should move to TanStack Query (`src/client/queries/<feature>.ts`) rather than a store. Labels are the reference: `src/client/queries/labels.ts` + `src/composables/useLabels.ts`. Stores still own UI state and orchestration.

## Two API layers

```mermaid
flowchart LR
    subgraph legacy [Legacy layer: 84 files import a service]
        SV[src/services/*Service.ts<br/>extends AbstractService]
        MO[src/models/*Model.ts<br/>extends AbstractModel]
        MT[src/modelTypes/I*.ts]
        AX[axios via helpers/fetcher.ts<br/>AuthenticatedHTTPFactory]
        SV --> MO --> MT
        SV --> AX
    end
    subgraph new [New layer: 22 importers incl. two tests]
        GEN[src/client/generated<br/>sdk.gen.ts + types.gen.ts]
        HTTP[src/client/http.ts<br/>fetch client config]
        Q[src/client/queries/*.ts<br/>TanStack Query options]
        COMP[composables/use*.ts]
        GEN --> HTTP
        Q --> GEN
        COMP --> Q
    end
    AX --> V1[/api/v1]
    HTTP --> V2[/api/v2]
```

**Legacy** (`src/services/abstractService.ts`, 520 lines): each service declares URL templates with `{placeholders}`; verbs are GET for read, **PUT for create, POST for update** (v1 semantics); request bodies are converted to snake_case by an axios interceptor and responses to camelCase by `AbstractModel.assignData` (`src/helpers/case.ts`). `maxPermission` comes from the `x-max-permission` header. Do not add services, models, or `modelTypes` for new routes; `frontend/docs/models-services.md` describes this layer and is historical.

**New** (`src/client/http.ts`): the `@hey-api` fetch client is configured with `baseUrl = getApiV2BaseUrl()` (derived from the v1 URL by swapping `/api/v1/` for `/api/v2/`), `credentials: 'include'`, and `throwOnError: true`. Types and functions use **snake_case exactly as the OpenAPI spec**. Regenerate with `mage generate:frontend-client`; CI fails if the committed output drifts.

TanStack Query layering (from `.agents/docs/api.md`, verified in `src/client/queries/labels.ts`):

- `client/queries/foo.ts`: `fooKeys` factory, `foosQuery()` via `queryOptions()`, `create/update/deleteFooMutationOptions()` via `mutationOptions()`, thin `useCreateFooMutation()` hooks, imperative `ensureFoos()` / `refreshFoos()` for non-component code, pure lookup helpers.
- `composables/useFoos.ts`: read side only, `useQuery(foosQuery())`, `data ?? []`.
- Components read through the composable and write through the mutation hooks. They never touch `queryClient`.
- All cache writes happen in mutation option callbacks using the `client` passed in the callback context; every mutation invalidates the list key in `onSettled`; optimistic flows do `onMutate` cancel+snapshot, `onError` restore, `onSettled` invalidate.

## Auth and token refresh

- Tokens live in memory first, then `localStorage.token` (`src/helpers/auth.ts` → `saveToken`, `getToken`, `getTokenIdentity`). The JWT payload is decoded by hand: `getTokenIdentity` reads `id` and `type` (1 user, 2 link share); `authStore.checkAuth()` (`src/stores/auth.ts`) reads `exp` and `sid`.
- Refresh is `POST /api/v2/user/token/refresh` with the HttpOnly cookie, falling back to the v1 path. Concurrent refreshes coalesce into one promise and take a Web Lock (`vikunja-token-refresh`) so multiple tabs do not race. An `authEpoch` counter prevents a late refresh from re-persisting a token after logout.
- Both HTTP layers retry once on `401` with error code `11` (`ERROR_CODE_INVALID_TOKEN` in `src/helpers/fetcher.ts`, `getProblemCode(...) !== 11` in `src/client/http.ts`), only for user tokens, and only if the current token still belongs to the same identity. This logic exists twice; change both.
- `authStore.checkAuth()` decodes the JWT, refreshes user info at most once a minute, and logs out on a 4xx from `/user`.

Full flow with file references: [Data flows](10-data-flows.md#1-login).

## Errors to the user

`src/message/index.ts` → `getErrorText(r)`: if the response carries a numeric `code`, look up `error.<code>` in `src/i18n/lang/en.json` with `i18n_params`; if no translation exists, fall back to `message` (v1) or `detail` (v2 problem+json). Codes 4016 to 4019 and 4024 also append the server message. `error(e)` and `success(e)` show toasts via `@kyvg/vue3-notification`. Field-level v2 validation errors are turned into a field map by `src/helpers/parseValidationErrors.ts`. The global `app.config.errorHandler` funnels uncaught component errors into the same toast.

## Component organization

| Directory | Role |
|---|---|
| `src/views/` | One component per route; owns data loading and composes partials |
| `src/components/home/` | App shell: header, sidebar (`Navigation.vue`, `ProjectsNavigation.vue`), `ContentAuth.vue` |
| `src/components/base/`, `src/components/input/` | Primitives and form controls; `input/editor/` is TipTap, `input/filter/` the filter DSL input, `input/datepicker/` the calendar |
| `src/components/misc/` | Cross-cutting widgets: `Modal.vue`, `Card.vue`, `Dropdown.vue`, `Popup.vue`, `Ready.vue`, `ApiConfig.vue`, keyboard shortcut overlay |
| `src/components/project/views/` | The four project views (`ProjectList`, `ProjectGantt`, `ProjectTable`, `ProjectKanban`) |
| `src/components/tasks/partials/` | Everything composed by `TaskDetailView.vue` and task list rows |
| `src/composables/` | Reusable stateful logic (`useTaskList`, `useRouteFilters`, `useWebSocket`, ...) |
| `src/helpers/` | Pure functions; `helpers/time/` for dates |

Reuse rules enforced by ESLint (`frontend/eslint.config.js`): `<script setup lang="ts">` only, PascalCase components in templates, multi-word names for new components (a grandfathered allowlist exists), the local `vikunja/icon-button-accessible-name` rule for icon-only buttons, no `for...in`.

## Shared types

Three sources, in order of preference for new code:

1. `src/client/generated/types.gen.ts`: mirrors the v2 OpenAPI, snake_case, regenerated.
2. `src/types/*.ts` and `src/constants/*.ts`: hand-mirrored enums from Go (repeat modes, relation kinds, priorities, permissions, pro features). Listed in [Data model](06-data-model.md#enums-duplicated-across-sides).
3. `src/modelTypes/I*.ts`: legacy camelCase interfaces; some already import generated types (`ITask.ts` uses `Label` from the generated client).

## Styling

Read `frontend/src/styles/README.md`; it is accurate. In short: `bulma-css-variables` with individually imported partials (`src/styles/global.scss`), design tokens as CSS custom properties in `src/styles/custom-properties/`, dark mode via a `dark` class on `<html>` toggled by `src/composables/useColorScheme.ts`, `common-imports.scss` injected into every SCSS block by Vite (must emit no CSS), and Tailwind v4 wired through `src/styles/tailwind.css` (imported only in `App.vue`) with a `tw-` prefix. As of 2026-09-16 no component uses a `tw-` class; Tailwind is available, not adopted. Stylelint enforces logical properties (`margin-inline-start`, not `margin-left`). Details: [styling-and-theming](components/frontend/styling-and-theming.md).

## Build and dev server

`frontend/vite.config.ts` switches on `command`: `serve` adds a dev proxy when `DEV_PROXY` is set (proxies `<base>/api/*` to that backend), `build` produces `dist/` with the PWA service worker (`src/sw.ts`, injectManifest), font preloads, and a Sentry plugin that is disabled unless `SENTRY_AUTH_TOKEN` is set. The Vitest configuration is the `test` block in this same file.

Reaching the backend in development, two options:

| Option | How | Verified |
|---|---|---|
| Proxy | `frontend/.env.local` with `DEV_PROXY=http://localhost:3456`; keep `window.API_URL = '/api/v1'` | not run in this session |
| Direct | Leave `DEV_PROXY` unset; on first load the app's `ApiConfig.vue`/`Ready.vue` asks for the API URL, or `checkAndSetApiUrl` finds it on port 3456 of the same host | `pnpm dev --port 4199` served `window.API_URL = '/api/v1'` on 2026-09-16 |

Ports: the dev server defaults to `127.0.0.1:4173` (`VIKUNJA_FRONTEND_PORT` or `--port`); the API defaults to `:3456`. `pnpm build` writes `dist/` and copies Workbox libraries (verified). `pnpm preview:vikunja` runs the Go binary from `../vikunja`, which serves the embedded `dist/`.

TypeScript: `tsconfig.json` references `tsconfig.app.json` (only `strictNullChecks`, not full `strict`), `tsconfig.config.json`, and `tsconfig.vitest.json`. `pnpm typecheck` (`vue-tsc --build --force`) reported 1535 errors on 2026-09-16 and is `continue-on-error` in CI; compare counts for the files you touch rather than expecting zero.

## Known structural debt

- Two API layers and two copies of the refresh logic.
- `src/modelSchema/common/repeats.ts` is dead (imports `zod`, which is not a dependency; nothing imports it).
- PWA manifest shortcuts in `vite.config.ts` point at routes that no longer exist (`/namespaces`, `/tasks/by/week`).
- A top-level `output.manualChunks` key in `vite.config.ts` sits outside `build.rollupOptions` and is likely inert (Unverified).
- The service worker's NetworkOnly rule only matches `/api/v1/`.

Tracked in [Known issues](13-known-issues.md).
