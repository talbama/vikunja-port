# Styling and theming

How CSS reaches the page: a hand-picked subset of `bulma-css-variables`, a CSS-custom-property token system with a `dark` class on `<html>`, SCSS variables injected into every style block, prefixed Tailwind v4 utilities, and stylelint enforcing logical properties. The source of truth is `frontend/src/styles/README.md`; this page summarises it and adds the wiring, the numbers, and the debt. Skeleton context: [Frontend architecture](../../04-frontend-architecture.md#styling).

## Responsibility

- **Owns:** everything under `frontend/src/styles/` (global entry, tokens, theme rules, legacy component rules, fonts, transitions, Tailwind entry), `composables/useColorScheme.ts`, the SCSS/PostCSS/Tailwind wiring in `vite.config.ts`, `.stylelintrc.json`, and the font pipeline in `frontend/scripts/fonts-*.sh`.
- **Does not own:** component-scoped `<style scoped lang="scss">` blocks (each component), the `dir`/`lang` attributes on `<html>` (set by `i18n/index.ts` → `setLanguage`, see [i18n-and-formatting](./i18n-and-formatting.md)), or the `colorSchema` user setting itself (auth store, [user-settings-and-admin](./user-settings-and-admin.md)).

## Entry points and public API

| Entry | Where | Loaded by |
|---|---|---|
| `global.scss` | `frontend/src/styles/global.scss` | `App.vue:129` `<style lang="scss" src="@/styles/global.scss" />`; `src/histoire.setup.ts:6` |
| `tailwind.css` | `frontend/src/styles/tailwind.css` | `App.vue:127` `<style src="@/styles/tailwind.css" />`; `histoire.setup.ts:5`. Nowhere else |
| `common-imports.scss` | `frontend/src/styles/common-imports.scss` | Prepended to **every** SCSS compile by `vite.config.ts:24-25` (`PREFIXED_SCSS_STYLES`) via `css.preprocessorOptions.scss.additionalData` (`vite.config.ts:127`) |
| `useColorScheme()` → `{store, isDark}` | `frontend/src/composables/useColorScheme.ts` | `App.vue:123` (side effect: toggles the class), `components/home/Logo.vue:18`, `components/input/Reactions.vue:29` (read `isDark`) |
| Global components `Card`, `Modal`, `XButton` | `components/misc/Card.vue`, `components/misc/Modal.vue`, `components/input/Button.vue` | registered in `main.ts` and `histoire.setup.ts`; carry the styles Bulma's `box`, `modal`, `button` partials used to provide |

## Key files

| File | Lines | Role |
|---|---|---|
| `styles/global.scss` | 104 | Imports `fonts`, `transitions`, the Bulma partials (each exclusion commented), then `theme`, `components`, `custom-properties`, and a `.skip-to-content` rule |
| `styles/common-imports.scss` | 45 | `$family-sans-serif`, Bulma `utilities/_all`, `$vikunja-font`, `$navbar-height/width`, `$transition`, `$button-height`, `@mixin focus-ring`. **Must emit zero CSS** (header comment lines 1-11) |
| `styles/custom-properties/colors.scss` | 351 | `:root` tokens and the `&.dark { @media screen {...} }` overrides |
| `styles/custom-properties/shadows.scss` | 25 | `--shadow-xs/sm/md/lg` from `--grey-500-hsl`; dark variants from `--grey-50-hsl` |
| `styles/theme/*.scss` | 750 total with `components/` | Global selectors, see table below |
| `styles/tailwind.css` | 3 | `@layer` order + `theme.css` and `utilities.css` with `prefix(tw)` |
| `styles/fonts.scss` | 37 | Three `@font-face` (Quicksand, Open Sans, Open Sans Italic), variable `wght 400 700`, latin `unicode-range`, `font-display: swap` |
| `styles/transitions.scss` | 19 | `.fade-*` and `.width-*` Vue transition classes using `$transition-duration` |
| `.stylelintrc.json` | 95 | `stylelint-config-standard-scss` + `recommended-vue`, `postcss-html`, plugin `stylelint-use-logical` with `csstools/use-logical: true` |

## Internal structure

### Bulma partial selection (`global.scss`)

Bulma is `bulma-css-variables` 0.9.33 (`package.json:86`), whose output uses `var(--primary)` etc. so runtime theming works. `global.scss` imports partials individually; excluded ones are commented with a reason:

| Bucket | Partials | Where the rules went |
|---|---|---|
| Ported into components | `elements/box`, `elements/button`, `form/checkbox-radio`, `components/dropdown`, `media`, `modal`, `navbar`, `pagination` | `Card.vue`, `Button.vue`, `FormCheckbox.vue`, dropdown component, `Comments.vue`, `Modal.vue`, `AppHeader.vue`, `BasePagination.vue` |
| Not used | `notification`, `progress`, `form/file`, `breadcrumb`, `level`, `message`, `panel`, `tabs`, `grid/tiles`, `helpers/other|overflow|position`, `layout/hero|section|footer` | none |
| Replaced | `helpers/spacing`, `helpers/float` | `theme/logical-spacing.scss` (logical `m*/p*` utilities), `theme/helpers.scss` (`.is-pulled-end`) |

Still imported: `base/*`, `elements/container|content|icon|image|table|tag|title|other`, `form/shared|input-textarea|select|tools`, `components/menu`, `grid/columns`, `helpers/color|flexbox|typography|visibility`. Re-enable by uncommenting rather than copying rules.

Bulma classes still in templates (files, 2026-09-16 grep of `class="..."` in `src/**/*.vue`): `has-text-*` 43, `icon` 35, `content` 30, `field` 27, `container` 27, `control` 23, `title` 23, `table` 17, `is-flex` 11, `menu` 7, `columns` 6, `tag` 6. Logical spacing utilities (`mbe-2`, `mis-4`, ...) appear in 67 files. Tailwind `tw-` utilities appear in **0** files: the README describes Tailwind as available, but nothing uses it yet.

### Token system (`custom-properties/colors.scss`)

- Lines 6-176: a verbatim block of Bulma's own `--scheme-*`, `--border*`, `--text*`, `--input-*`, per-colour `-invert/-light/-dark` variables. It exists to work around `bulma-css-variables` scoping (issue vikunja/frontend#1064, cited at line 10). Values overridden further down are commented out. Only touch when updating Bulma.
- Lines 179-275, "Vikunja specific variables": the neutral ramp `--grey-50`..`--grey-900` (with `-hsl` companions for `--grey-100`, `--grey-500` in light mode), `--site-background`, `--text-muted`, overrides of Bulma greys/`--border`/`--input-*`, and the HSL-component pattern for `--white`, `--black`, `--warning` (27.9deg), `--success` (146.3deg), `--danger` (3.3deg, plus `--danger-text` darkened for contrast), `--primary` (217deg 98% 53%, with `--primary-hsl` for `hsla(var(--primary-hsl), .5)` composition), `--link`, `--card-border-color`, `--logo-text-color`, `--switch-view-*`, `--code-*`.
- Lines 277-350: `&.dark { @media screen { ... } }` reverses the grey ramp (`--grey-900` becomes the light `--grey-50` value), remaps `--white`/`--text*`, tweaks only `--primary-l` to 58%, and overrides the Bulma component variables that would otherwise stay light.
- `shadows.scss` follows the same shape but its dark block is `&.dark { ... }` **without** `@media screen`, unlike the README's step 3 ("inside the `&.dark { @media screen { … } }` block"). Unverified whether printing in dark mode shows dark shadows because of this.

### Dark mode mechanism

```mermaid
flowchart LR
    S[authStore.settings.frontendSettings.colorSchema<br/>'light' | 'dark' | 'auto'] --> C[useColorScheme.ts<br/>createSharedComposable]
    P[usePreferredColorScheme<br/>@vueuse] --> C
    C -->|watch isDark, flush post| H["html.classList.toggle('dark'|'light')"]
    H --> T[":root.dark @media screen {tokens}"<br/>colors.scss / shadows.scss]
    T --> V["var(--token) in every component"]
```

`useColorScheme.ts`: `isDark` is `colorSchema === 'dark'`, or for `'auto'` the OS preference with `'no-preference'` falling back to `DEFAULT_COLOR_SCHEME_SETTING = 'light'`. `onChanged` toggles both `dark` and `light` classes on `<html>`; it runs on mount (`tryOnMounted`) and on every change. There is no SCSS-level light/dark split, and no `prefers-color-scheme` media query in the stylesheets: the class is the only switch.

### Theme and legacy component files

| File | One line |
|---|---|
| `theme/theme.scss` (126) | Focus-visible ring on `--primary`, body background, heading font, generic helpers `.has-no-border`, `.has-rounded-corners`, `.has-overflow`, `.has-horizontal-overflow`, `button.table` |
| `theme/typography.scss` (8) | `h1`-`h6` use `$vikunja-font` |
| `theme/navigation.scss` (141) | `.menu`/`.menu-list` sidebar styling ("should be in own components", line 2) |
| `theme/form.scss` (107) | `.field.has-addons` button height and add-on tweaks |
| `theme/scrollbars.scss` (31) | Custom scrollbar colours from `--grey-*` |
| `theme/link-share.scss` (17) | `.field.has-addons.no-input-mobile` for the public share layout |
| `theme/loading.scss` (40) | `.loader-container.is-loading` spinner |
| `theme/background.scss` (54) | `.app-container.has-background` / `.link-share-container.has-background` image layer |
| `theme/content.scss` (53) | `.content` (Bulma rich-text) overrides |
| `theme/helpers.scss` (13) | `.d-print-none`, `.is-pulled-end` with `[dir="rtl"]` flip |
| `theme/logical-spacing.scss` (50) | Generates `m{is,ie,bs,be}-N` / `p…-N` from `$bulma-sizes`, `.has-text-start/end`, `[dir="rtl"] .is-mirrored-rtl` |
| `components/tasks.scss` (48) | Legacy `.tasks` tree, "used all over, very hard to untangle" |
| `components/task.scss` (4) | `.task-view` on the share page, "should be in TaskDetailView.vue" |
| `components/labels.scss` (29) | `.labels-list`, "adapt labels.vue" |
| `components/tooltip.scss` (12) | `v-popper` tooltip theme (`--grey-900` background) |

### Build wiring (`vite.config.ts`)

- `css.preprocessorOptions.scss.additionalData = PREFIXED_SCSS_STYLES` (`@use "sass:math"` then `@import` of `common-imports.scss`), `charset: false`, `quietDeps: true` for both `sass` and `scss`.
- PostCSS plugins: `postcss-easing-gradients`, `postcss-preset-env` with `logical-properties-and-values: false` (logical properties are shipped as written, not transpiled).
- `@tailwindcss/vite` 4.3.3 is the first plugin. There is **no** `tailwind.config.js`; `tsconfig.app.json:10` still lists one in `include`, which is harmless.
- `UnpluginInjectPreload` (`vite.config.ts:159`) preloads only the variable fonts: `createFontMatcher(['Quicksand', 'OpenSans', 'OpenSans-Italic'])` matches output files named `<name>_wght__<8>-<8>.woff2`. Renaming a font file breaks the preload silently.
- Fonts: `scripts/fonts-download.sh` fetches the upstream variable TTFs into `originalMedia/fonts`; `scripts/fonts-subset.sh` instances them with fonttools to `wght` only and writes woff2 into `src/assets/fonts`. The hashed filenames are then updated **by hand** in `fonts.scss` (`$font-files-path` + `Quicksand[wght]_a912b486.woff2` etc.).

### Global components as style carriers

`Card.vue` (145 lines, scoped style from line 69), `Modal.vue` (651 lines; scoped block at 275 and an unscoped block at 640), and `Button.vue` (281 lines, scoped from 71) hold the rules that replaced Bulma's `box`, `modal`, and `button` partials. `Button.vue` exposes `variant`, `shadow`, `wrap` (see `Button.test.ts`). Prefer these components over re-creating Bulma markup.

### Print and RTL

- Print: `.d-print-none` (`theme/helpers.scss`), `@media print { display: none }` in `AddToHomeScreen.vue`, and the `@media screen` guard on the dark token block so prints are light.
- RTL: `setLanguage()` sets `document.documentElement.dir` for `ar-SA`, `he-IL`, `fa-IR` (`i18n/index.ts:56-115`). Layout mirrors automatically because stylelint forces logical properties; explicit `[dir="rtl"]` rules exist only in `theme/helpers.scss`, `theme/logical-spacing.scss`, `Modal.vue`, `AppHeader.vue`, `Button.vue`, `Navigation.vue`.

## Dependencies

- **Uses:** `bulma-css-variables`, `tailwindcss` + `@tailwindcss/vite`, `sass`, `postcss-preset-env`, `postcss-easing-gradients`, `@vueuse/core` (`usePreferredColorScheme`, `createSharedComposable`), `stores/auth` (colour setting).
- **Used by:** every component's `<style lang="scss">` (via `additionalData`), `App.vue`, Histoire.

## Invariants and assumptions

- `common-imports.scss` produces no CSS. Anything with a selector there is duplicated into every compiled style block (`README.md` "contract" section; the file header).
- The `@use "sass:math"` line must stay first in `PREFIXED_SCSS_STYLES` (`vite.config.ts:23` comment).
- Tokens are declared once on `:root`; components consume `var(--x)` and never redeclare (README "Adding a new token" step 4).
- `--primary-hsl` and `--grey-*-hsl` exist so alpha composition works; keep the `-hsl` companion when you change a base value.
- `isDark` must not be set directly; change `frontendSettings.colorSchema` (composable header comment, `useColorScheme.ts:11-16`).
- Physical properties fail `pnpm lint:styles` (`csstools/use-logical: true`); `postcss-preset-env` does not rewrite them.

## Configuration

| Key | Effect |
|---|---|
| `frontendSettings.colorSchema` (user setting, `IUserSettings.ts`) | `light` / `dark` / `auto` |
| `VIKUNJA_FRONTEND_BASE` (build env) | Base path; affects font URLs only through Vite's normal asset handling |

## Error handling

None at runtime. Lint failures: `pnpm lint:styles` (`stylelint 'src/**/*.{css,scss,vue}'`), fix with `pnpm lint:styles:fix`. `.ts`/`.js` files are ignored by stylelint (`ignoreFiles`).

## Tests

- No unit tests target styles. `components/home/Logo.test.ts` mocks `useColorScheme`.
- Visual references: 8 Histoire stories (`BaseButton`, `Button`, `Card`, `ColorPicker`, `FancyCheckbox`, `ProgressBar`, `DatemathHelp`, `Reminders` `.story.vue`), run with `pnpm story:dev` (`histoire.config.ts`, setup in `src/histoire.setup.ts` which registers the same global components and directives as `main.ts`).
- Playwright screenshots on failure (`playwright.config.ts` → `screenshot: 'only-on-failure'`) are the only visual regression signal; see [testing-infrastructure](./testing-infrastructure.md).

## Where do I add X

Mirrors the README table with the file paths verified:

| I want to... | Put it in |
|---|---|
| A colour or shadow token (with dark override) | `styles/custom-properties/colors.scss` / `shadows.scss`, inside `:root` and the `&.dark` block |
| A one-component tweak | That component's `<style scoped lang="scss">` |
| An SCSS variable or mixin shared by components | `styles/common-imports.scss` (no selectors) |
| A `@font-face` | `styles/fonts.scss` + the preload matcher in `vite.config.ts:161` |
| A `<Transition>` class pair | `styles/transitions.scss` |
| A global rule on a Bulma class you cannot scope | the matching `styles/theme/*.scss`; never `components/*.scss` (those are marked for removal) |
| A Bulma partial | uncomment in `styles/global.scss` |
| A utility class | logical spacing from `theme/logical-spacing.scss`, or `tw-*` inline (currently unused) |

## Gotchas and tech debt

- `components/tasks.scss:1,23,43`, `components/task.scss:1`, `components/labels.scss:1,11`, `theme/loading.scss:1,28` (`move to Loading.vue`, `move to ShowTasks.vue`), `theme/theme.scss:57` (`these helpers should be mixins`), `theme/form.scss:75`: all `FIXME` markers for rules that belong in components.
- `theme/navigation.scss:1-2`: "these are general menu styles, should be in own components".
- z-index is ad hoc: `UpdateNotification.vue:63` and `AddToHomeScreen.vue:51` carry `// FIXME: We should prevent usage of z-index or at least define it centrally` (5000; `.hint-modal` is 4500; `.skip-to-content` 10000; `DemoMode.vue` 100).
- `stylelint-config-property-sort-order-smacss` is installed (`package.json:149`) but not in `extends`; Unverified whether it is intentionally unused.
- `histoire.setup.ts:13` imports `@/components/input/button.vue` (lowercase) while the file is `Button.vue`; works on case-insensitive macOS, Unverified on Linux CI (Histoire is not part of CI).
- Dark-mode colours that must not flip are hard-coded (`DemoMode.vue:41`, `UpdateNotification.vue:80`) instead of using the `--switch-view-color` style "no-change" token pattern.

## Related pages

- [i18n-and-formatting](./i18n-and-formatting.md) (`dir`/`lang` attributes), [user-settings-and-admin](./user-settings-and-admin.md) (colour scheme setting), [bootstrap-and-routing](./bootstrap-and-routing.md) (`App.vue`), [realtime-and-pwa](./realtime-and-pwa.md) (banners that own their own z-index)
- [Conventions](../../08-conventions.md#frontend), [Development workflow](../../07-development-workflow.md#lint-and-format), [Repository map](../../02-repository-map.md)
