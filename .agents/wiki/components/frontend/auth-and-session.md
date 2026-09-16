# Auth and session

Everything between "the user typed a password" and "every request carries a valid bearer token": the auth store, token storage and refresh, the two HTTP layers' 401 handling, API URL discovery, and the login-family views. Wire-level details of the tokens live in [API contract](../../05-api-contract.md#auth-and-session-flow) and backend [auth-and-sessions](../backend/auth-and-sessions.md). Verified 2026-09-16.

## Responsibility

- Owns: `stores/auth.ts`, `helpers/auth.ts` (token storage, refresh), the interceptors in `helpers/fetcher.ts` and `client/http.ts`, `helpers/checkAndSetApiUrl.ts`, `composables/useRenewTokenOnFocus.ts`, `helpers/{desktopAuth,redirectToProvider}.ts`, `client/inviteLink.ts`, the views under `views/user/` that log people in or out, and link-share auth.
- Does not own: the route guard that calls `checkAuth()` ([bootstrap-and-routing](./bootstrap-and-routing.md)), user settings pages ([user-settings-and-admin](./user-settings-and-admin.md)), the `/info` config store ([stores](./stores.md)), server-side session and cookie semantics ([auth-and-sessions](../backend/auth-and-sessions.md)).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `useAuthStore()` | `frontend/src/stores/auth.ts` | router guard, `App.vue`, views, `ContentAuth.vue`, most stores |
| `saveToken`, `getToken`, `removeToken`, `refreshToken`, `getTokenType`, `getTokenIdentity` | `frontend/src/helpers/auth.ts` | auth store, both HTTP layers |
| `HTTPFactory()`, `AuthenticatedHTTPFactory()`, `getApiBaseUrl()`, `getApiV2BaseUrl()`, `apiV2Url()` | `frontend/src/helpers/fetcher.ts` | `services/abstractService.ts`, auth store, `client/http.ts` |
| `configureApiClient()` | `frontend/src/client/http.ts` | `main.ts`, `checkAndSetApiUrl` |
| `checkAndSetApiUrl()`, `ERROR_NO_API_URL`, `NoApiUrlProvidedError`, `InvalidApiUrlProvidedError` | `frontend/src/helpers/checkAndSetApiUrl.ts` | `stores/base.ts`, `ApiConfig.vue`, `DesktopLogin.vue` |
| `useRenewTokenOnFocus()` | `frontend/src/composables/useRenewTokenOnFocus.ts` | `ContentAuth.vue` |
| `getAutoRedirectProvider`, `redirectToProvider`, `redirectToProviderOnLogout`, `getRedirectUrlFromCurrentFrontendPath` | `frontend/src/helpers/redirectToProvider.ts` | `Login.vue`, `OpenIdAuth.vue`, auth store |
| `hasInviteLink`, `checkInviteLink`, `registerViaInviteLink`, `onInviteLinkChange` | `frontend/src/client/inviteLink.ts` | `Register.vue`, auth store |
| `AUTH_TYPES` (`UNKNOWN 0`, `USER 1`, `LINK_SHARE 2`) | `frontend/src/modelTypes/IUser.ts` | store getters, both interceptors |
| `JUST_LOGGED_OUT_KEY` (`sessionStorage.justLoggedOut`) | `frontend/src/stores/auth.ts` | `Login.vue` |

## The auth store (`frontend/src/stores/auth.ts`)

State (all exposed `readonly`): `authenticated`, `needsTotpPasscode`, `info: IUser | null`, `settings: IUserSettings` (defaults filled in `loadSettings`), `currentSessionId` (JWT `sid`), `lastUserInfoRefresh`, `isLoading`, `isLoadingGeneralSettings`.

Getters: `authUser` (`authenticated && info.type === USER`), `authLinkShare` (`... === LINK_SHARE`), `isLinkShareAuth` (type only), `userDisplayName`.

A `watch` on `[info.id, info.type]` with `flush: 'sync'` calls `clearTaskCache()` and `queryClient.clear()` whenever the identity changes, so one user's cached data never leaks to the next (tests in `stores/auth.renewToken.test.ts` "query identity lifecycle").

| Action | Endpoint (via) | Notes |
|---|---|---|
| `login(credentials)` | `POST login` (`HTTPFactory`, v1) | `removeToken()` first; body snake_cased; `saveToken(token, true)`; then `checkAuth()`. Error code `1017` without `totpPasscode` sets `needsTotpPasscode` and rethrows |
| `register(credentials, language?, viaInvite)` | `POST register` (v1) or `registerViaInviteLink` (v2 `authRegister`) | picks `i18n.global.locale` as language; on code `2002` with a `language` validation error retries with `'en'`; normalises v2 `detail` into `message`; then `login()` |
| `registerWithInvite(credentials)` | same with `viaInvite = true` | typed by generated `RegisterUserRequestWritable` |
| `openIdAuth({provider, code, totpPasscode?})` | `POST /auth/openid/:provider/callback` (v1) | `redirect_url` from `getRedirectUrlFromCurrentFrontendPath`; stores `localStorage.loggedInViaProvider` for logout |
| `handleDesktopOAuthTokens(tokens)` | none | saves `access_token`, `localStorage.desktopOAuthRefreshToken`; `checkAuth()` |
| `linkShareAuth({hash, password})` | `POST /shares/:hash/auth` (v1) | `saveToken(token, false)` (memory only, so several shares can be open in different tabs); resets `lastUserInfoRefresh` so `checkAuth()` is not debounced; returns the body (`project_id`) |
| `checkAuth()` | `GET user` via `refreshUserInfo` | see below |
| `refreshUserInfo()` | `GET user` (`AuthenticatedHTTPFactory`) | keeps `type`/`exp` from the JWT-derived `info`; `setLanguage(settings.language)`; on any 4xx or the "invalid token" message → `logout()` and return `undefined`; other errors are rethrown as `Error('Error while refreshing user info', {cause})` (tests: `auth.refreshUserInfo.test.ts`) |
| `verifyEmail(token = localStorage.emailConfirmToken)` | `POST user/confirm` (v1) | always removes the localStorage key; rethrows with `cause` |
| `saveUserSettings({settings, showMessage})` | `services/userSettings` → `POST /user/settings/general` | optimistic `setUserSettings`, language switch, avatar invalidation if the name changed with the `initials` provider; nulls `language` in demo mode |
| `renewToken()` | link share: `POST user/token` (v1); user: `refreshTokenWithRetry(true)` | then `checkAuth()`; logs out only if the JWT is already expired **and** the failure carried an HTTP status (`auth.renewToken.test.ts`) |
| `logout()` | `POST user/logout` (best effort, returns `oidc_logout_url`) | `useWebSocket().disconnect()` first; `removeToken()`; `localStorage.clear()`; `sessionStorage.justLoggedOut = 'true'`; full-page redirect to `oidc_logout_url` or the provider's `logoutUrl`, else `router.push(user.login)` + `checkAuth()` |

`checkAuth()` in detail: debounced to once per minute via `lastUserInfoRefresh` (callers that need a fresh read reset it, as `linkShareAuth` does, or call `refreshUserInfo()` directly, as the admin guard does). It decodes the JWT payload by hand (`split('.')[1]`, base64url → `atob`), builds a `UserModel`, and compares `exp` to now. The comment at the `info.value.id !== jwtUser.id || info.value.type !== jwtUser.type` check explains why **both id and type** are compared: users and link shares share one numeric id space, and a signed-in user opening a share with a colliding id would otherwise never flip `authLinkShare` and loop between `/share/:hash/auth` and the project (e2e: `sharing/linkShare.spec.ts` "colliding id"). An expired user JWT triggers `refreshTokenWithRetry(true)` (exactly one retry, because a lock-race loser's cookie is already rotated). Non-link-share sessions then `refreshUserInfo()`; if that returns nothing the function bails so `logout()`'s state wins. Unauthenticated → `setUser(null)` and `redirectToSpecifiedProvider()` (`?redirectToProvider=` query on `/login` or `/`).

## Token storage and refresh (`frontend/src/helpers/auth.ts`)

- Precedence: module-level `savedToken` first, then `localStorage.token` (`getToken`). `saveToken(token, persist)` writes localStorage only when `persist` is true (user sessions yes, link shares no).
- `getTokenIdentity(token)` → `{id, type}` from the payload; `getTokenType` → `type` only.
- `removeToken()` clears memory, `token`, `desktopOAuthRefreshToken`, bumps `authEpoch`, and drops `inFlightRefresh`.
- `refreshToken(persist)`: same-tab calls coalesce onto one `inFlightRefresh` promise; `doRefresh` snapshots `authEpoch` and `localStorage.token` before requesting the Web Lock `vikunja-token-refresh` (`navigator.locks`, secure contexts only; plain call otherwise). Under the lock: abort if logged out since; desktop → `refreshDesktopToken` IPC with `desktopOAuthRefreshToken`; browser → adopt a token another tab wrote meanwhile, else `POST apiV2Url('user/token/refresh')`, falling back to v1 `POST user/token/refresh` unless the v2 failure was a `429` (comment: drop the fallback once pre-v2 clients have cycled out). The result is persisted only if the epoch is unchanged. Tests: `helpers/auth.test.ts`.

## Two interceptor implementations (change both)

| | axios: `helpers/fetcher.ts` → `AuthenticatedHTTPFactory` | fetch: `client/http.ts` → `configureApiClient` |
|---|---|---|
| Base URL | `getApiBaseUrl()` re-read per request; `withCredentials: true` | `getApiV2BaseUrl()` (v1 URL with `/api/v1/` → `/api/v2/`); `credentials: 'include'`; `throwOnError: true` |
| Auth header | `Bearer <getToken()>` always | only if the caller did not set `Authorization` (basic auth and explicit bearers pass through) |
| Retry trigger | `401` and `data.code === ERROR_CODE_INVALID_TOKEN` (11) and not `_retried` | `401` and `getProblemCode(response) === 11` and the request was one it stamped |
| Identity check | token exists and `getTokenType === USER` | original identity was `USER` and the current token still has the same `{id, type}`, before and after refreshing |
| Refresh | module-level `refreshPromise` → `doRefresh()`: `refreshToken(true)`, one retry after 1 s unless the cause was `429`; never removes the token on failure (another tab may have rotated it) | `refreshToken(true)` only if the token has not changed since the request was sent; otherwise reuse the newer token |
| Retry | `instance.request(originalRequest)` with the new header; `payloadTransformed` flag in `abstractService.ts` stops the snake_case interceptor running twice | re-issue a clone of the original `Request` through `options.fetch ?? globalThis.fetch` |
| Tests | `services/abstractService.test.ts` "payload transforms on a retried request" | `client/http.test.ts` (12 cases incl. identity change mid-refresh) |

`apiV2Url(path)` builds an absolute v2 URL for axios callers that still need v2 (`helpers/auth.ts`, `services/timeEntry.ts`, `services/emailUpdate.ts`, `services/admin/userService.ts`, `services/migrator/abstractMigration.ts`, `services/task.ts` bulk create); the comment marks it as temporary.

```mermaid
sequenceDiagram
    participant C as Caller (service or generated fn)
    participant I as Interceptor
    participant R as helpers/auth.ts refreshToken
    participant API
    C->>API: request, Authorization: Bearer old
    API-->>I: 401 {code: 11}; USER token, identity unchanged?
    I->>R: refreshToken(true) (coalesced, Web Lock)
    R->>API: POST /api/v2/user/token/refresh (cookie)
    API-->>R: 200 {token: new} + rotated cookie
    R->>R: epoch unchanged? saveToken(new, true)
    I->>API: retry once with Bearer new
    API-->>C: 200
```

## Proactive renewal (`composables/useRenewTokenOnFocus.ts`)

Mounted by `ContentAuth.vue`: calls `authStore.renewToken()` once on load, schedules a timer for `exp - 60 s` whenever `info.exp` changes, clears it on logout, and on window `focus` renews immediately if expired (falling back to `checkAuth()` + push `user.login` on failure) or within the 60 s buffer.

## API URL discovery

`helpers/checkAndSetApiUrl.ts` → `checkAndSetApiUrl(url)`: empty → throw `NoApiUrlProvidedError`; a leading `/` is prefixed with `window.location.host`; missing scheme gets `window.location.protocol`; unparsable → `InvalidApiUrlProvidedError`. It then sets `window.API_URL` and probes `configStore.update()` (`GET /info`) in this order, each step only if the previous failed:

1. the URL as given;
2. `+ /api/v1` if the path does not already end with it;
3. the same again (the code resets the pathname and repeats step 2; comments say "via https" but the scheme is not changed; Unverified whether this step can ever succeed where step 2 failed);
4. port `3456` (`API_DEFAULT_PORT`) on whatever pathname step 3 left (already `+ /api/v1` unless the input had it; the pathname is not reset here);
5. port `3456` with the pathname reset and `+ /api/v1` appended again (identical to step 4 when the input lacked `/api/v1`);
6. restore the old `window.API_URL` and rethrow.

On success: if the URL changed, `configureApiClient()` and `queryClient.clear()`; then `localStorage.API_URL = window.API_URL`. Tests: `helpers/checkAndSetApiUrl.test.ts`.

## OIDC, OAuth, desktop, invites

- `helpers/redirectToProvider.ts`: `redirectToProvider` stores a random `localStorage.state` and navigates to `provider.authUrl` with `redirect_uri = <origin><base>auth/openid/<key>`. `getAutoRedirectProvider` returns the single provider only when: not desktop, not `justLoggedOut`, no `#redirect=` hash on `/login`, local and LDAP auth disabled, OpenID enabled with exactly one provider (`helpers/redirectToProvider.test.ts`).
- `helpers/desktopAuth.ts`: thin wrappers over `window.vikunjaDesktop` (`isDesktop`, `startOAuthLogin`, `onOAuthTokens`, `onOAuthError`, `refreshToken`).
- `client/inviteLink.ts`: module side effect at import (first line of `main.ts`): on `/register#invite-link=<token>` it captures the token, strips the fragment with the saved `history.replaceState`, and re-checks on `popstate`/`hashchange`. `checkInviteLink` → generated `inviteLinksCheck`; `registerViaInviteLink` → `authRegister` with `invite_token`, forgetting the token only on success (`client/inviteLink.test.ts`).

## Views (one line each)

| View | Does |
|---|---|
| `views/user/Login.vue` | redeems `emailConfirmToken`, pushes `home` if already authenticated, consumes `justLoggedOut`, auto-redirects to a sole OIDC provider, reads inputs from refs (autofill bug), shows the TOTP field when `needsTotpPasscode`, then `redirectIfSaved()`; desktop renders `DesktopLogin.vue` |
| `views/user/Register.vue` | invite-aware (`hasInviteLink`, `checkInviteLink`), `parseValidationErrors` for field errors, `register`/`registerWithInvite` then `redirectIfSaved()`; FIXME `:182` wants a `beforeEnter` |
| `views/user/OpenIdAuth.vue` | verifies `localStorage.state`, calls `openIdAuth`, parks a TOTP passcode in `sessionStorage.openid_pending_totp_<provider>` and restarts the provider round trip when code `1017` comes back |
| `views/user/OAuthAuthorize.vue` | Vikunja as OAuth server: `POST oauth/authorize` (v1, authenticated) then full-page redirect to `redirect_uri?code=&state=` |
| `views/user/DesktopLogin.vue` | server URL input via `checkAndSetApiUrl`, `startDesktopOAuthLogin`, receives tokens through `handleDesktopOAuthTokens` |
| `views/user/RequestPasswordReset.vue` | `services/passwordReset` → `POST /user/password/token` (legacy service) |
| `views/user/PasswordReset.vue` | token from `?userPasswordReset=`, `POST /user/password/reset` (legacy service) |
| `views/sharing/LinkSharingAuth.vue` | calls `linkShareAuth` on setup; code `13001` → show password form, `13002` → invalid password; then pushes the last-visited route, `project.view` (`?view=`) or `project.index`, always with `#share-auth-token=<hash>`; `?logoVisible=false` hides the logo |
| `components/home/ContentLinkShare.vue` | link-share shell; keeps `route.hash` on internal links |

TOTP in login: the server answers `1017` when a passcode is needed; `login()` sets `needsTotpPasscode`, `Login.vue` re-submits with `totpPasscode`, and `setNeedsTotpPasscode(false)` after success. OIDC users with TOTP go through the `OpenIdAuth.vue` sessionStorage dance instead.

## Dependencies

- **Uses:** axios, the generated fetch client (`client/generated/client.gen.ts`), `stores/config.ts`, `client/queryClient.ts`, `helpers/case.ts`, `models/user.ts`, `models/userSettings.ts`, `services/{userSettings,avatar,passwordReset}.ts`, `composables/useWebSocket.ts`, `router`.
- **Used by:** the router guard, `App.vue`, `ContentAuth.vue`, every service (through `AuthenticatedHTTPFactory`), every generated call (through `configureApiClient`).

## Invariants and assumptions

- Only `USER` tokens are ever refreshed; link-share JWTs renew through `POST user/token` and are never persisted (`helpers/auth.ts` header comment, both interceptors).
- Error code `11` is the only 401 that triggers refresh; other 401s are final (both interceptors, `05-api-contract`).
- A refresh result is discarded if `authEpoch` moved (logout during refresh) or, in `client/http.ts`, if the identity changed.
- `queryClient.clear()` and `clearTaskCache()` must run on identity change; the store's sync watcher is the single place.
- `logout()` calls `localStorage.clear()`: anything that must survive logout belongs in `sessionStorage` (`justLoggedOut`) or is re-derived.
- `checkAuth()` may be a no-op for up to a minute; code that needs a fresh `/user` must call `refreshUserInfo()`.

## Configuration

| Store | Key | Meaning |
|---|---|---|
| `localStorage` | `token`, `API_URL`, `loggedInViaProvider`, `desktopOAuthRefreshToken`, `state` (OIDC), `emailConfirmToken`, `lastVisited` | persisted session and flow state |
| `sessionStorage` | `justLoggedOut`, `openid_pending_totp_<provider>` | per-tab flow state |
| `/info` (`stores/config.ts`) | `auth.local.enabled`, `auth.ldap.enabled`, `auth.openidConnect.{enabled,providers}`, `demoModeEnabled`, `totpEnabled` | which login forms render, auto-redirect |
| Web Locks | `vikunja-token-refresh` | cross-tab refresh serialisation |

## Error handling

Login errors are rendered by the views with `getErrorText(e)` (`message/index.ts`); code `1017` is intercepted for TOTP. `refreshUserInfo` converts any 4xx into `logout()`. Refresh failures inside the axios interceptor log with `console.warn('[Vikunja] Token refresh ...')` and reject the original error so the UI can redirect; the fetch interceptor swallows the refresh error and returns the original 401 response. Link-share auth never logs the error object (it would contain the plaintext password, see comment in `LinkSharingAuth.vue`).

## Tests

- Unit: `stores/auth.{linkShare,refreshUserInfo,renewToken}.test.ts`, `helpers/auth.test.ts`, `helpers/fetcher.test.ts` (v2 URL derivation only), `client/http.test.ts`, `helpers/checkAndSetApiUrl.test.ts`, `helpers/redirectToProvider.test.ts`, `client/inviteLink.test.ts`, `services/abstractService.test.ts`, `views/user/{PasswordReset,RequestPasswordReset}.test.ts`. Run: `cd frontend && pnpm vitest run src/stores/auth src/helpers/auth src/client/http`.
- e2e (`frontend/tests/e2e/user/`): `login`, `logout`, `registration`, `email-confirmation`, `password-reset`, `openid-login` (Dex), `oauth-authorize` (PKCE), `session-refresh` (401 code 11 retried and JWT rotated; non-11 not retried), `api-tokens`, `settings`; `sharing/linkShare.spec.ts` for share auth.
- Not covered: `checkAuth()` debounce and JWT decoding paths, `useRenewTokenOnFocus`, `logout()` OIDC redirect branches, `DesktopLogin.vue`, `OpenIdAuth.vue` TOTP restart.

## Gotchas and tech debt

- The refresh-and-retry logic exists twice (`helpers/fetcher.ts`, `client/http.ts`) with different identity checks; the fetch version is stricter. Keep them aligned (also listed in [Known issues](../../13-known-issues.md)).
- `checkAuth()` decodes the JWT twice in two slightly different ways (initial and post-refresh); the post-refresh branch compares only `id`, not `type`.
- The v1 refresh fallback in `helpers/auth.ts` is scheduled for removal.
- `register()` retries with `'en'` on a language validation error, hiding misconfigured locale lists.
- `logout()` wipes all of localStorage, including `API_URL`; browser users fall back to `window.API_URL`, desktop users see the server prompt again.
- `stores/auth.ts` has 34 commits since 2025-09-01; read the test files before touching `checkAuth`, `renewToken`, or `logout`.
- Security-relevant: `#redirect=` uses the hash so OAuth params stay out of logs (#2654); `OAuthAuthorize.vue` refuses to run without `response_type`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method` (`requiredParams`), so PKCE is mandatory from the browser side too.

## Related pages

[bootstrap-and-routing](./bootstrap-and-routing.md), [api-client-legacy](./api-client-legacy.md), [api-client-generated-and-queries](./api-client-generated-and-queries.md), [stores](./stores.md), [user-settings-and-admin](./user-settings-and-admin.md), [sharing-teams-labels-notifications](./sharing-teams-labels-notifications.md), [realtime-and-pwa](./realtime-and-pwa.md), backend [auth-and-sessions](../backend/auth-and-sessions.md), [API contract](../../05-api-contract.md), [Data flows: login](../../10-data-flows.md#1-login), [desktop](../desktop.md).
