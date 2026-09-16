# Auth and sessions

Who the caller is, on every request. Covers the three auth types (user, link share, API token), JWT issuance and validation, refresh-token sessions, the credential flows shared by v1 and v2 (`pkg/routes/api/shared/auth.go`), OpenID Connect, LDAP, Vikunja's own OAuth2 server, TOTP and CalDAV tokens. Transport wiring (which group gets which middleware) is in [http-routing-and-middleware](./http-routing-and-middleware.md); the frontend half is in [frontend auth-and-session](../frontend/auth-and-session.md). Terms (session, link share, API token, bot) are in the [glossary](../../09-glossary.md).

## Responsibility

- Owns: JWT claims and signing (`pkg/modules/auth/auth.go`), the `sessions` table and refresh rotation (`pkg/models/sessions.go`), API tokens and their route scopes (`pkg/models/api_tokens.go`, `api_routes.go`), link-share JWTs, the shared login/register/reset/confirm/logout bodies, OIDC (`pkg/modules/auth/openid`), LDAP (`pkg/modules/auth/ldap`), the OAuth2 authorization-code server (`pkg/modules/auth/oauth2server`), TOTP and CalDAV tokens (`pkg/user/totp.go`, `caldav_token.go`).
- Does not own: the `users` table, password hashing, user tokens for reset/confirm/deletion (`./user-package.md`); per-entity authorization (`Can*` methods, `./crud-framework.md`); CalDAV/feed BasicAuth callbacks beyond what they call here (`./caldav.md`, `./notifications-and-mail.md`); MCP's own token check (`./mcp.md`).

## Entry points and public API

| Entry | Where | Called by |
|---|---|---|
| `SetupTokenMiddleware()` | `pkg/routes/api_tokens.go` | both API groups (`pkg/routes/routes.go`) |
| `GetAuthFromClaims(c)`, `GetAuthFromContext(ctx)`, `HasAuthInContext(c)`, `SessionIDFromContext(c)` | `pkg/modules/auth/auth.go` | `pkg/web/handler/*.go`, `pkg/routes/api/v2/errors.go` → `authFromCtx`, rate limiter, metrics, admin gate |
| `IssueUserToken`, `WriteUserAuthCookies`, `NewUserAuthTokenResponse`, `RefreshSession`, `IsUnusableRefreshToken` | `pkg/modules/auth/auth.go` | v1 `login.go`, v2 `auth_login.go`/`auth_refresh.go`, `openid`, `oauth2server` |
| `NewUserJWTAuthtoken`, `NewLinkShareJWTAuthtoken`, `GetUserIDFromToken`, `ValidateAPITokenString` | `pkg/modules/auth/auth.go` | token middleware, `pkg/websocket/connection.go:174` (WS uses `GetUserIDFromToken`), webtests |
| `AuthenticateUserCredentials`, `RegisterUser`, `CommitRegistration`, `LogoutSession`, `DeleteSession`, `ResetPassword`, `RequestPasswordResetToken`, `ConfirmEmail`, `AuthenticateLinkShare`, `GetAuthProviderName` | `pkg/routes/api/shared/auth.go`, `auth_provider.go` | v1 and v2 handlers (table below) |
| `models.CanDoAPIRoute`, `CollectRoutesForAPITokenUsage`, `GetAPITokenRoutes`, `PermissionsAreValid`, `(*APIToken).HasPermission/HasCaldavAccess/HasFeedsAccess/HasMCPAccess/CanUseRoute` | `pkg/models/api_routes.go`, `api_tokens.go` | middleware, `/routes`, CalDAV, feeds, MCP |
| `openid.AuthenticateCallback`, `HandleCallback`, `GetAllProviders`, `GetProvider`, `BuildEndSessionURL`, `GetProvidersStatus` | `pkg/modules/auth/openid/` | callbacks, `/info`, logout, health |
| `ldap.AuthenticateUserInLDAP`, `InitializeLDAPConnection` | `pkg/modules/auth/ldap/ldap.go` | `resolveLoginUser`, `pkg/initialize/init.go:114` |
| `oauth2server.Authorize`, `HandleAuthorize`, `ExchangeToken`, `HandleToken`, `ValidateRedirectURI`, `VerifyPKCE` | `pkg/modules/auth/oauth2server/` | v1 routes, v2 `oauth.go` |

## Key types and functions

| Name | File | One line |
|---|---|---|
| `web.Auth` (`GetID() int64`) | `pkg/web/web.go` | The only thing models require of a caller. `*user.User` and `*models.LinkSharing` implement it; a link share's id is **negative** (`share.ID * -1`, `link_sharing.go` → `getUserID`) |
| `AuthTypeUnknown=0`, `AuthTypeUser=1` (`pkg/user/user.go:544`), `AuthTypeLinkShare=2` | `auth.go` | The JWT `type` claim |
| `Token{Token string}` | `auth.go` | The `{"token": "..."}` login body on both versions (v2 inlines it to avoid a schema-name clash, `auth_login.go:33`) |
| `RefreshTokenCookieName = vikunja_refresh_token`, `RefreshTokenPathV1/V2` | `auth.go` | Cookie set **once per refresh path**, prefixed with the base path of `service.publicurl` (`getRefreshTokenCookiePaths`) |
| `IssuedUserToken`, `RefreshResult` | `auth.go` | Transport-agnostic results consumed by v1 and v2 |
| `models.Session` | `sessions.go` | `id` (uuid, JWT `sid`), `token_hash` (SHA-256 of the refresh token), `is_long_session`, `oidc_id_token`/`oidc_provider_key` for RP-initiated logout, `last_active` |
| `models.APIToken`, `APIPermissions map[string][]string` | `api_tokens.go` | `tk_` + 40 hex; `token_sha256` unique; legacy PBKDF2 columns kept for old tokens; `owner_id` may be a bot |
| `apiTokenRoutes`, `apiTokenRoutesV2`, `RouteDetail{Path, Method}` | `api_routes.go` | Group → permission → exact route, filled at startup |
| `ErrCodeInvalidToken = 11` | `pkg/routes/api_tokens.go` | Middleware-level 401 body, the frontend's "try a refresh" signal |
| `openid.Provider`, `openid.Callback{Code, Scope, RedirectURL, TOTPPasscode}` | `openid/openid.go` | Provider is cached in keyvalue under `openid_provider_<key>` and `openid_providers` |
| `oauth2server.AuthorizeRequest/Response`, `TokenRequest/Response`, `models.OAuthCode` | `oauth2server/*.go`, `pkg/models/oauth_codes.go` | Codes stored hashed, 10 min TTL, single use |
| `user.TOTP`, `user.TOTPPasscode` | `pkg/user/totp.go` | `enabled` only after a passcode is confirmed; `APICopy` hides the secret once enabled |

## Internal structure

### Request-time resolution (`pkg/routes/api_tokens.go`, `pkg/modules/auth/auth.go`)

1. `SetupTokenMiddleware` is `echojwt` with `service.secret`. Its `Skipper`: route template in `unauthenticatedAPIPaths` → skip; else if any `Authorization: Bearer tk_...` header is present (`models.APITokenAuthorization`) → `checkAPITokenAndPutItInContext`; success skips JWT parsing, failure falls through to the JWT parser which rejects the `tk_` string, so both paths end in 401 code 11.
2. `checkAPITokenAndPutItInContext`: `auth.ValidateAPITokenString` (read session; `GetTokenFromTokenString`; expiry; owner loaded, disabled/locked owner rejected) → `models.CanDoAPIRoute` unless `shouldSkipRouteCheck` → `c.Set("api_token")`, `c.Set("api_user")` → `models.RecordAPITokenUse` (audit event, skipped for AutoPatch's internal legs).
3. `shouldSkipRouteCheck`: `/api/v{1,2}/token/test`; anything under `mcp.RoutePrefix` (MCP checks `HasMCPAccess` itself and rejects JWTs, `pkg/modules/mcp/mcp.go:150`); and the AutoPatch GET leg, only when the request is a bare GET with no query string whose `humabridge.InternalDispatchRoute` equals `c.Path()`.
4. `GetAuthFromClaims`: `api_user` from context (avoids two extra lookups per request, commit `912e899c1`) → `api_token` fallback lookup → JWT claims: type 2 with link sharing enabled → `models.GetLinkShareFromClaims` (DB read every call); type 1 → `user.GetUserFromClaims` (builds `User{ID, Username, IsAdmin}` from claims, **no DB**); else 400. Handlers that need the full row call `user.GetUserByID`/`GetFromAuth`.

### Login → JWT → refresh

```mermaid
sequenceDiagram
    participant FE as Client
    participant H as v1 Login / v2 authLogin
    participant S as shared.AuthenticateUserCredentials
    participant A as auth.IssueUserToken
    participant DB as sessions table
    FE->>H: POST /login {username,password,totp_passcode?,long_token?}
    H->>S: resolveLoginUser (LDAP first if enabled, then local) → status gates → enforceLoginTOTP → clear failed counters → commit
    S-->>H: *user.User or ErrWrongUsernameOrPassword 1011 / ErrInvalidTOTPPasscode 1017 (412) / ErrAccountDisabled 1020 / ErrAccountLocked 1040
    H->>A: IssueUserToken(ctx, u, UA, IP, long, oidc=nil)
    A->>DB: CreateSession: uuid id, 128 random bytes → hex refresh token, SHA-256 stored
    A-->>H: AccessToken (HS256, exp = now + service.jwtttlshort), RefreshToken, CookieMaxAge (jwtttl or jwtttllong)
    H-->>FE: 200 {"token"} + Set-Cookie vikunja_refresh_token for /api/v1/user/token/refresh and /api/v2/user/token/refresh (HttpOnly; Secure+SameSite=None only on https publicurl, else Lax) + Cache-Control: no-store
    FE->>H: POST /user/token/refresh (cookie only)
    H->>A: RefreshSession(cookie)
    A->>DB: GetSessionByRefreshToken → age check vs LastActive → UpdateSessionLastActive → RotateRefreshToken (UPDATE … WHERE token_hash = old; 0 rows = replay) → GetUserByID
    A-->>H: RefreshResult{AccessToken, NewRefreshToken, IsLongSession, SessionID}
    H-->>FE: 200 {"token"} + rotated cookie; on ErrSessionExpired or user-status error the cookie is cleared (IsUnusableRefreshToken)
```

- JWT claims (`NewUserJWTAuthtoken`): `type=1`, `id`, `username`, `is_admin`, `exp`, `sid`, `jti`. `is_admin` is only a hint; `RequireInstanceAdmin` re-reads the DB.
- Refresh errors: not found → `ErrInvalidRefreshToken` 16002 (401); older than `jwtttl`/`jwtttllong` since `last_active` → session deleted, `ErrSessionExpired` 16003; rotated by a concurrent refresh → `ErrRefreshTokenAlreadyUsed` 16004, which deliberately does **not** clear the cookie (the winner just set a new one).
- Logout (`v1 Logout`, v2 `authLogout`): clear cookie, `SessionIDFromContext`, `shared.LogoutSession` deletes the row and returns the OIDC end-session URL; v1 also dispatches `user.LogoutEvent`. An empty `sid` (API token, link share) is a no-op.
- Sessions are also wiped by `ChangeUserPassword` (`pkg/models/user_settings.go:90`), `shared.ResetPassword`, and enabling TOTP (`pkg/routes/api/v1/user_totp.go:123`). `RegisterSessionCleanupCron` deletes stale rows hourly using the per-kind TTL. `Session.CanDelete` requires ownership and rejects link shares; `ReadAll` lists the caller's sessions newest-active first.

### API-token scopes (`pkg/models/api_routes.go`)

- `getRouteGroupName`: strip `/api/v1/` or `/api/v2/`, drop `:param` segments, `-` → `_` (`canonicalAPITokenGroup`, because the frontend snake_cases payloads), join with `_`. Special cases: `projects_tasks` and `tasks_all` → `tasks`; `projects_tasks_bulk` → `tasks_bulk`.
- `getRouteDetail` (permission name from method): `GET` → `read_one` if the path ends in a param else `read_all`; `PUT` → `update` on v2 / `create` on v1; `POST` → `create` on v2 / `update` on v1; `PATCH` → `update`; `DELETE` → `delete`.
- `CollectRoutesForAPITokenUsage` skips not-found routes, routes without JWT, and groups `token_test`, `subscriptions`, `tokens`, `*`, `oauth_authorize`, `mcp*`, `user_*`. v2 `PATCH` is not stored (it would clobber `PUT` under `update`). Standard CRUD groups (`isStandardCRUDRoute` list) get the derived permission; `_bulk` → `<perm>_bulk` on the parent; other multi-segment paths land on the first segment with the rest as the permission (`projects` → `background`), single-segment ones in `other`; `POST /notifications` → `notifications.mark_all_as_read`; `tasks_attachments` is special-cased (PUT → `create`, GET `:attachment` → `read_one`).
- Built-in entries: `caldav.access` (`/dav/*`), `feeds.access` (`/feeds/*`), `mcp.access` (`POST /api/v2/mcp`, v2 table).
- `CanDoAPIRoute`: exact `(path, method)` match against the stored detail in either table (GHSA-v479-vf79-mg83 closed the method/sub-resource confusion); v2 `PATCH` is an alias of the stored `PUT`; `tasks.read_all` explicitly covers the four list paths. Then `expandScopesSatisfied` (GHSA-9rg3-v78m-26q8): on the routes in `expandScopeRoutes`, `expand=comments|comment_count` needs `tasks_comments.read_all`, `reactions` → `reactions.read_all`, `time_entries_count` → `time_entries.read_all`.
- `GetAPITokenRoutes` (the `/routes` endpoint) merges v1 as base plus v2-only groups and filters license-gated routes per call (`licenseFeaturesForRoute`); `PermissionsAreValid` is unfiltered so existing tokens keep validating across a license lapse.
- Token storage: `Create` mints `tk_` + 20 random bytes hex, stores `HashAPIToken` (SHA-256; 160-bit random tokens gain nothing from a KDF), validates permissions, checks bot ownership (`IsBotOwnedBy`, else `user.ErrBotNotOwned`), dispatches `APITokenIssuedEvent`. Lookup `GetTokenFromTokenString`: length guard, SHA-256 hit, else legacy `token_last_eight` + PBKDF2 constant-time compare and a `backfillTokenSha256` on its own 2 s autocommit session. `CanCreate` requires a real user principal (GHSA-vvcv-vpph-h844); `CanDelete` allows owner or bot owner.

### Link shares

`shared.AuthenticateLinkShare(hash, password)`: `GetLinkShareByHash` → for `SharingTypeWithPassword`, `VerifyLinkSharePassword` (bcrypt; `ErrLinkSharePasswordRequired` 13001, `ErrLinkSharePasswordInvalid` 13002/403) → `NewLinkShareJWTAuthtoken` (claims `type=2, id, hash, project_id, permission, sharedByID, exp = jwtttl`, 72 h default) → `LinkShareToken{Token, LinkSharing (by value, go#15924), ProjectID}`. On every request `GetLinkShareFromClaims` re-reads the row by `id`, checks `hash`, ignores the `permission`/`sharedByID` claims and blanks the password (GHSA-96q5-xm3p-7m84 / CVE-2026-35594: deletion or downgrade takes effect immediately). Link-share JWTs have no refresh session; they are renewed via `POST /user/token` (v1 `RenewToken`, v2 `token-renew`), which rejects user JWTs.

### OpenID Connect (`pkg/modules/auth/openid/`)

- Providers come from `auth.openid.providers`; `GetAllProviders` builds them once, rejects duplicate issuers (`FindDuplicateIssuers`; fatal at startup, `pkg/initialize/init.go:117`), and caches in keyvalue. `GetProvider` triggers discovery (`setOicdProvider`, retried with backoff; fatal if `require_availability`); `getCachedProvider` never dials and is what logout uses.
- `AuthenticateCallback` (shared by v1 `HandleCallback` and v2 `authOpenIDCallback`): `exchangeOidcTokens` (code exchange with the callback's `redirect_url`, `id_token` verified against `client_id`) → `getClaims` (userinfo fetched when `force_user_info` or a claim is missing; `mergeClaims`; no email → `ErrNoOpenIDEmailProvided`) → `getOrCreateUser`: lookup by issuer+subject; else fallbacks from `fallbackSearchUsers` (email fallback **only** with `email_verified`, GHSA-xv7q-fvmc-jx96; username fallback tries `sub` then `preferred_username`); bots rejected; new users via `auth.CreateUserWithRandomUsername` (petname on collision) which also creates their default project; existing users get name/email/`extra_settings_links` updated and avatar synced → status gates → `enforceTOTPIfRequired` (GHSA-8jvc-mcx6-r4cg; on failure the user-creation writes are committed first, then `HandleFailedTOTPAuth`, GHSA-fgfv-pv97-6cmj) → `getTeamDataFromToken` from the `vikunja_groups` claim → `models.SyncExternalTeamsForUser` → commit → `DispatchPending`. The session stores the raw ID token and provider key for logout.
- Logout: `BuildEndSessionURL` uses the discovered `end_session_endpoint` cached at init or the static `logouturl`, adding `client_id`, `id_token_hint`, `post_logout_redirect_uri=service.publicurl`.
- Crons: `RegisterEmptyOpenIDTeamCleanupCron` (every minute, deletes external teams with no members), `RegisterProviderAvailabilityCron` (every minute; `retryUnavailableProviders` with 1 min → 15 min capped backoff and jitter, fixes vikunja#3135), `CleanupSavedOpenIDProviders` at startup.

### LDAP (`pkg/modules/auth/ldap/ldap.go`)

`InitializeLDAPConnection` is fatal without host, port, base DN or user filter and retries the bind with backoff. `AuthenticateUserInLDAP`: service-account or anonymous bind → `sanitizedUserQuery` with RFC 4515 escaping (`escapeLDAPFilterValue`) → search must return exactly one entry → bind as the user DN (invalid credentials → `ErrWrongUsernameOrPassword`) → `getOrCreateLdapUser` → optional avatar from `auth.ldap.avatarsyncattribute` → optional group sync (re-binds as the service account when `groupsyncuseserviceaccount`) → `SyncExternalTeamsForUser(issuer = IssuerLDAP)`. `resolveLoginUser` tries LDAP before local so local accounts keep working alongside it.

### OAuth2 server (`pkg/modules/auth/oauth2server/`)

- `Authorize` (authenticated; v1 `HandleAuthorize` rejects API tokens with 403): `response_type` must be `code`; `ValidateRedirectURI` accepts `vikunja-*` schemes or `http://` loopback/`localhost` (RFC 8252), nothing else; PKCE `S256` required (`ErrOAuthMissingPKCE` 17003); `models.CreateOAuthCode` stores `HashSessionToken(code)` with a 10 min expiry.
- `ExchangeToken` (public, refresh-rate-limited): `authorization_code` → `consumeAuthorizationCode` in its own transaction (`GetAndDeleteOAuthCode` is single-use with an affected-rows race guard; expiry is checked after deletion) → `client_id` and `redirect_uri` must match → `VerifyPKCE` → `CreateSession` (short) + JWT → `LoginSucceededEvent` → `{access_token, token_type: bearer, expires_in: jwtttlshort, refresh_token}`; `refresh_token` → `auth.RefreshSession`. v2 also accepts `application/x-www-form-urlencoded` (`pkg/routes/api/v2/huma.go` → `formURLEncodedFormat`).

### TOTP and CalDAV tokens (`pkg/user/`)

- `TOTPEnabledForUser` returns false when `service.enabletotp` is off. `EnrollTOTP` (issuer "Vikunja") → `EnableTOTP` (validates a passcode) → enabled. `ValidateTOTPPasscode` adds a 90 s replay guard in keyvalue (`totp_used_<uid>_<code>`, `ErrTOTPPasscodeUsed` 1039). The QR code is refused once enabled (`ErrTOTPQrCodeNotAvailable` 1037). `HandleFailedTOTPAuth` opens its own session (the login session was rolled back, GHSA-fgfv-pv97-6cmj): 3 failures → `InvalidTOTPNotification`; 10 → password reset token + `StatusAccountLocked`. Password failures are counted separately by `user.handleFailedPassword` (`pkg/user/user.go:449`, notification at 3, `LoginFailedEvent`).
- CalDAV tokens are `user.Token` rows of kind `TokenCaldavAuth` (`pkg/user/token.go`); `GenerateNewCaldavToken`, `GetCaldavTokens`, `DeleteCaldavTokenByID` open their own sessions (`GetCaldavTokensWithSession` exists for callers already holding one; nested sessions deadlock SQLite). `pkg/routes/caldav/auth.go` → `BasicAuth` accepts a `tk_` API token with `caldav.access`, a CalDAV token, or the password only when TOTP is **not** enabled; bots are rejected on every path.

## Credential and auth endpoints

| Endpoint | v1 (`pkg/routes/routes.go` registration → handler file) | v2 (`pkg/routes/api/v2/`, operation id) | Shared core |
|---|---|---|---|
| `POST /register` | `v1/user_register.go` → `RegisterUser` (if `auth.local.enabled`) | `auth_public.go` `auth-register` | `shared.RegisterUser` |
| `POST /user/password/token`, `/user/password/reset`, `/user/confirm` | `v1/user_password_reset.go`, `v1/user_confirm_email.go` | `auth_public.go` `auth-password-token`, `auth-password-reset`, `auth-confirm-email` | `shared.RequestPasswordResetToken`, `ResetPassword`, `ConfirmEmail` |
| `POST /login` | `v1/login.go` → `Login` (local or LDAP enabled) | `auth_login.go` `auth-login` | `shared.AuthenticateUserCredentials` + `auth.IssueUserToken` |
| `POST /user/token/refresh` | `v1/login.go` → `RefreshToken` | `auth_refresh.go` `auth-refresh-token` | `auth.RefreshSession` |
| `POST /user/logout` (v1) / `POST /logout` (v2) | `v1/login.go` → `Logout` | `auth_login.go` `auth-logout` | `shared.LogoutSession` |
| `POST /auth/openid/:provider/callback` | `openid/openid.go` → `HandleCallback` | `auth_openid.go` `auth-openid-callback` | `openid.AuthenticateCallback` |
| `POST /shares/:share/auth` | `v1/link_sharing_auth.go` | `auth_public.go` `auth-link-share` | `shared.AuthenticateLinkShare` |
| `POST /user/token` (link-share renew) | `v1/login.go` → `RenewToken` | `token_meta.go` `token-renew` | `auth.NewLinkShareJWTAuthtoken` |
| `GET`/`POST /token/test`, `GET /routes` | `v1/token_check.go`, `models.GetAvailableAPIRoutesForToken` | `token_meta.go` `token-test`, `token-check`, `token-routes` | `models.GetAPITokenRoutes` |
| `POST /oauth/authorize` (auth), `POST /oauth/token` (public) | `oauth2server/authorize.go`, `token.go` | `oauth.go` `oauth-authorize`, `oauth-token` | `oauth2server.Authorize`, `ExchangeToken` |
| `/tokens` list/create/delete | `WebHandler{APIToken}` (`routes.go:920`) | `api_tokens.go` `tokens-*` | `handler.Do*` → `models.APIToken` |
| `/user/sessions` list, delete | `WebHandler{Session}` (`routes.go:615`) | `sessions.go` `sessions-*` | `models.Session` |
| `/user/settings/token/caldav` create/list/delete | `v1/user_caldav_token.go` | `caldav_tokens.go` `caldav-tokens-*` | `user.GenerateNewCaldavToken` etc. |
| `/user/settings/totp` get/enroll/enable/disable/qrcode | `v1/user_totp.go` (if `service.enabletotp`) | `user_totp.go` `totp-*` | `pkg/user/totp.go` |
| `POST /user/password` | `v1/user_update_password.go` | `user_settings.go` `user-change-password` | `models.ChangeUserPassword` |
| `POST /invite-links/check` (public) | n/a | `invite_links.go` `invite-links-check` | see `./models-sharing-teams-labels.md` |
| `/test/*` (testing token in `Authorization`) | `v1/testing.go` | `testing.go` | `shared/testing.go` |

Public v2 ops set `Security: publicSecurity` (empty list, `auth_public.go:36`) **and** must be in `unauthenticatedAPIPaths`; `/health` and `/info` opt out the same way, `notifications.atom` declares `BasicAuth`.

## Dependencies

- **Uses:** `pkg/user`, `pkg/models` (sessions, tokens, link shares, team sync, events), `pkg/db`, `pkg/config`, `pkg/events`, `pkg/keyvalue` (failed-attempt counters, TOTP replay guard, provider cache), `pkg/notifications`, `pkg/license` (route discovery), `pkg/modules/humabridge`, `pkg/modules/avatar/upload`, `github.com/golang-jwt/jwt/v5`, `github.com/labstack/echo-jwt/v5`, `github.com/coreos/go-oidc/v3`, `golang.org/x/oauth2`, `github.com/go-ldap/ldap/v3`, `github.com/pquerna/otp`.
- **Used by:** every handler via `GetAuthFromClaims`/`authFromCtx`; `pkg/routes` middleware; `pkg/websocket` (`GetUserIDFromToken`); `pkg/routes/caldav`, `pkg/routes/feeds`, `pkg/modules/mcp` (token helpers); `pkg/initialize` (LDAP connect, provider discovery, crons).

## Invariants and assumptions

- Only three `web.Auth` implementations exist; code that type-asserts `a.(*LinkSharing)` or `user.GetFromAuth(a)` relies on this (`Session.ReadAll`, `APIToken.CanCreate`).
- Link-share auth ids are negative; nothing may treat `GetID()` as a `users.id` without checking the type.
- A user JWT carries no authorization state beyond `is_admin`; permissions come from the DB on each request (`Can*`), admin status is re-read by `RequireInstanceAdmin`.
- Refresh tokens, API tokens and OAuth codes are stored as plain SHA-256 (`HashSessionToken`, `HashAPIToken`); passwords stay bcrypt. Never log them.
- `RotateRefreshToken` and `GetAndDeleteOAuthCode` rely on affected-row counts for single use; both need a real transaction (`db.NewSession`).
- `HandleFailedTOTPAuth` must never share the login session (it is rolled back before the call).
- v1 and v2 share the token permission keys, so a route path chosen for v2 must derive the same `(group, permission)` a v1 user would expect (see the `api-v2-routes` skill).

## Configuration

| Key (`config.yml`) | Env var | Effect |
|---|---|---|
| `service.secret` | `VIKUNJA_SERVICE_SECRET` | HS256 key for every JWT |
| `service.jwtttlshort` (600) | `VIKUNJA_SERVICE_JWTTTLSHORT` | Access-token lifetime, `expires_in` |
| `service.jwtttl` (259200 = 72 h), `service.jwtttllong` (2592000 = 30 d) | `VIKUNJA_SERVICE_JWTTTL`, `..._JWTTTLLONG` | Refresh-session max age since `last_active`, cookie max-age, link-share JWT TTL (`jwtttl`) |
| `service.publicurl` | `VIKUNJA_SERVICE_PUBLICURL` | Cookie base path, `Secure`/`SameSite=None` when https, OIDC `post_logout_redirect_uri` |
| `service.enabletotp` (true), `service.enablelinksharing` (true), `service.enableregistration` | | Gates TOTP checks, link-share claims, registration |
| `auth.local.enabled` (true), `auth.ldap.*`, `auth.openid.enabled`, `auth.openid.providers` | `VIKUNJA_AUTH_*` | Which credential paths are registered and consulted |
| `ratelimit.noauthlimit`, `ratelimit.tokenrefreshlimit` | | Floors on these endpoints (see routing page) |

## Error handling

- Middleware: 401 code 11 for any missing/invalid JWT or API token, on both versions. Wrong-scope API tokens also produce 401 (`checkAPITokenAndPutItInContext` returns `echo.NewHTTPError(401)`), never 403.
- Login: `ErrWrongUsernameOrPassword` 1011 (403), `ErrEmailNotConfirmed`, `ErrAccountIsNotLocal` 1021, `ErrAccountIsBot` 1031, `ErrAccountDisabled` 1020, `ErrAccountLocked` 1040, `ErrInvalidTOTPPasscode` 1017 (412), `ErrTOTPPasscodeUsed` 1039 (all `pkg/user/error.go`).
- Sessions 16xxx (`pkg/models/error.go`): 16002/16003/16004 map to 401. Link shares 13xxx (13003 `ErrLinkShareTokenInvalid` is 400). API tokens 14001/14002 (400). OpenID 15001 `ErrOpenIDBadRequest` (400; `ErrOpenIDBadRequestWithDetails` gets a bespoke v1 body with `details`). OAuth 17001–17007 (400).
- Failed login attempts are audited via `LoginFailedEvent`; successful logins dispatch `LoginSucceededEvent` (also from the OAuth code exchange). API-token use dispatches `APITokenUsedEvent` only when `audit.enabled`.
- Swallowed: `backfillTokenSha256` failures (warning), OIDC avatar sync failures (error log, login continues), end-session URL build failures (logout proceeds), `RecordAPITokenUse` failures.

## Tests

| Area | Files | Run |
|---|---|---|
| Cookie paths, unusable-refresh classification, `api_user` reuse, Huma context bridge | `pkg/modules/auth/auth_test.go` (`TestGetRefreshTokenCookiePaths`, `TestIsUnusableRefreshToken`, `TestGetAuthFromContext_NoEchoContext`), `auth_context_test.go` (`TestGetAuthFromClaimsUsesTheAPIUserFromContext`) | `mage test:filter TestGetRefreshTokenCookiePaths` |
| OIDC claims, fallbacks, TOTP gate, logout URL, providers, availability backoff | `pkg/modules/auth/openid/{openid,logout,providers,status}_test.go` | `mage test:filter TestRetryUnavailableProvidersBackoff` |
| LDAP escaping and auth | `pkg/modules/auth/ldap/ldap_test.go` | |
| OAuth redirect and PKCE | `pkg/modules/auth/oauth2server/{client,pkce}_test.go` | |
| Token scopes and method matching | `pkg/models/api_routes_test.go` (17 tests), `api_tokens_test.go`, `pkg/webtests/api_token_method_matching_test.go`, `expand_scope_routes_test.go`, `huma_api_token_patch_test.go` | `mage test:filter TestAPIToken` |
| TOTP replay and lockout | `pkg/user/totp_test.go` | `mage test:filter TestHandleFailedTOTPAuth` |
| HTTP flows: login, refresh, logout, register, reset, link share, sessions, OAuth2, TOTP, CalDAV tokens on both versions | `pkg/webtests/{login,register,token,sessions,link_sharing_auth,oauth2,user_totp,user_password_*}_test.go`, `huma_auth_*_test.go`, `huma_session_test.go`, `huma_caldav_token_test.go`, `huma_user_totp_test.go` | `go test -run TestLogin ./pkg/webtests/` (`mage test:filter` passes `-short`, which skips webtests) |

Gaps: `RefreshSession` concurrency (`ErrRefreshTokenAlreadyUsed`) is covered only at the model level, Unverified whether any webtest races two refreshes; there is no test file for `pkg/routes/api/shared/` itself (its callers are tested).

## Gotchas and tech debt

- `ValidateAPITokenString`'s comment says it is shared with WebSocket auth, but `pkg/websocket/connection.go` → `handleAuth` (line 174) only calls `GetUserIDFromToken`, which accepts user JWTs alone. API tokens therefore cannot authenticate a WebSocket; the comment is stale.
- `GetAuthFromClaims` on a link share hits the DB every call by design (CVE-2026-35594); expensive endpoints for link shares pay that lookup once per request.
- `Session.CanCreate` returns `true` but no route creates sessions through `DoCreate`; it exists only to satisfy `web.Permissions`.
- Legacy PBKDF2 API tokens are verified by scanning every token sharing the same last eight characters; the backfill removes them from that path on first use.
- The `is_admin` claim lives in the JWT for up to `jwtttlshort`; only admin routes re-check it. Anything else reading `u.IsAdmin` from claims is stale after demotion.
- `enforceLoginTOTP` rolls back before `HandleFailedTOTPAuth`, so an LDAP user created during that same login is **not** persisted on a failed TOTP; the OIDC path commits first (different behaviour, both intentional per comments).
- `openid.GetProvider` performs live discovery on the request path; `/info` calls `GetAllProviders` (`pkg/routes/api/shared/info.go:139`) which may rebuild the cache.
- Link-share JWTs default to 72 h with no revocation list; revocation works only because every request re-reads the row.
- GHSA ids in code: GHSA-8jvc-mcx6-r4cg, GHSA-fgfv-pv97-6cmj, GHSA-xv7q-fvmc-jx96 (`openid/openid.go`), GHSA-96q5-xm3p-7m84 / CVE-2026-35594 (`link_sharing.go:93`), GHSA-v479-vf79-mg83 and GHSA-9rg3-v78m-26q8 (`api_routes.go:441,448,549`), GHSA-vvcv-vpph-h844 (`api_tokens_permissions.go`), GHSA-m469-88xx-8rx2 (`rate_limit.go`). No `TODO`/`FIXME` in these packages (grep 2026-09-16).

## Related pages

- [http-routing-and-middleware](./http-routing-and-middleware.md) — where the middleware and rate limits are attached
- [crud-framework](./crud-framework.md) — `web.Auth` as seen by models
- [user-package](./user-package.md) — users, password checks, user tokens, bots
- [models-sharing-teams-labels](./models-sharing-teams-labels.md) — link shares, team sync, invite links
- [api-v1](./api-v1.md), [api-v2-huma](./api-v2-huma.md), [caldav](./caldav.md), [websocket](./websocket.md), [mcp](./mcp.md), [cron-and-background-jobs](./cron-and-background-jobs.md), [events-and-listeners](./events-and-listeners.md)
- [API contract, auth flow](../../05-api-contract.md#auth-and-session-flow), [Data flows](../../10-data-flows.md), [frontend auth-and-session](../frontend/auth-and-session.md)
- Skills: [api-v2-routes](../../../skills/api-v2-routes/SKILL.md) (public ops and token scope naming)
