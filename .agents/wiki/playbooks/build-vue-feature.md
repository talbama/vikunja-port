# Playbook: build a new Vue page or feature

Route → view → components → data layer → strings → tests → lint. Read [Frontend architecture](../04-frontend-architecture.md) for the skeleton and [Conventions](../08-conventions.md#frontend) for the rules that ESLint enforces.

## 1. Route

`frontend/src/router/index.ts`:

- Add a route with a lazy import: `component: () => import('@/views/<area>/<Name>.vue')`. Names follow `area.action` (`labels.create`, `project.settings.share`).
- Modal on top of the previous page (settings dialogs): `meta: {showAsModal: true}`; `useRouteWithModal` handles it.
- Pro-gated: `meta: {requiresTimeTracking: true}` / `requiresAdminPanel` / `requiresUserInvites`; the guard redirects to `not-found`.
- Public (no login): add the name to `AUTH_ROUTE_NAMES` in `frontend/src/constants/authRouteNames.ts` so `App.vue` renders it inside `NoAuthWrapper`.
- Link it from `Navigation.vue`, `AppHeader.vue`, or a settings list as appropriate; add a keyboard shortcut in `frontend/src/constants/shortcuts.ts` plus the overlay entry if warranted.

## 2. View and components

- `frontend/src/views/<area>/<Name>.vue`, `<script setup lang="ts">`, multi-word file name.
- Reusable pieces go in `frontend/src/components/<area>/`. Use the global `Card`, `Modal`, `XButton`, `Icon`, and the `input/` primitives (`FormInput`, `FormSelect`, `Multiselect`, `Datepicker`, `ColorPicker`).
- Set the document title with `useTitle(...)`.
- Test ids: `v-cy="feature-thing"` (rendered only in dev/testing builds).
- Accessibility: icon-only buttons need `aria-label` or the local ESLint rule fails.
- Styles: scoped SCSS in the component; tokens from `src/styles/custom-properties/`; Tailwind utilities with the `tw-` prefix; logical properties only.

## 3. Data layer

Server state: create `frontend/src/client/queries/<feature>.ts` and `frontend/src/composables/use<Feature>.ts` following `labels.ts` / `useLabels.ts` (see [add-api-endpoint](add-api-endpoint.md#5-frontend-data-layer-frontendsrcclientqueriesfeaturets)). If the v2 route does not exist yet, add it first; do not fall back to a legacy service.

UI state that outlives a component (selected view, collapsed buckets, drafts): a setup-style Pinia store in `frontend/src/stores/<name>.ts` with the `acceptHMRUpdate` block, or `useLocalStorage` for per-browser preferences (`stores/viewFilters.ts` is an example).

Existing legacy stores (`tasks`, `projects`, `kanban`) may be consumed; do not add new service classes to them.

Errors: let the generated client throw; catch in the component only to show `error(e)` from `@/message` or to map RFC 9457 field errors with `parseValidationErrors`.

## 4. Strings

- Add keys to `frontend/src/i18n/lang/en.json` only, under an existing section if one fits. Reuse a key with the same English text.
- Use `const {t} = useI18n({useScope: 'global'})` in script, `$t('...')` in templates.
- `mage check:translations` must pass (missing and dead keys both fail).

## 5. Tests

- Unit tests where logic is pure or the composable is testable in isolation: `frontend/src/<path>/<Name>.test.ts`, run with `pnpm vitest run <file>`.
- E2E for the user-visible flow: `frontend/tests/e2e/<area>/<name>.spec.ts`, seed with factories, use `authenticatedPage`. Run `VIKUNJA_E2E_API_PORT=3456 mage test:e2e "tests/e2e/<area>/<name>.spec.ts" 2>&1 | tee /tmp/e2e.log`.
- Prefer extending an existing e2e spec over a component test for UI behavior.

## 6. Lint and typecheck

```bash
cd frontend
pnpm lint:fix
pnpm lint:styles:fix     # if you touched styles
pnpm typecheck > /tmp/tc.log 2>&1; grep -c "error TS" /tmp/tc.log   # compare with main's ~1535; only your files matter
```

## 7. Verify in the app

`pnpm dev` against a running API (set `DEV_PROXY` in `.env.local` or enter the API URL in the UI), or `pnpm build && mage build && ./vikunja --config config.yml web` to check the embedded build. Check the flow logged in and, if applicable, as a link share (`/share/<hash>/auth`) and on a narrow viewport.

## Commonly missed

- Eager import in the router (bundle size); the two remaining eager `FIXME`s are the exception, not the pattern.
- Registering the route name in `AUTH_ROUTE_NAMES` for public pages, otherwise the guard bounces to login.
- Adding strings to a non-English file or hardcoding English in templates.
- A `queryClient` call inside a component; move it to the mutation options.
- Physical CSS properties (stylelint fails) and unprefixed Tailwind classes (silently no-op).
- Single-word component names (ESLint fails unless grandfathered).
- Forgetting `v-cy` ids, making the e2e spec brittle.
- The desktop build: if you touch `index.html`'s inline script, update `desktop/build.js`.
