# AGENT Instructions

Vikunja: self-hosted to-do app. Go API in `pkg/` (Echo v5 + Huma v2, XORM, Watermill, Cobra), Vue 3 + TypeScript SPA in `frontend/` (Vite, Pinia, TanStack Query, pnpm), embedded into the Go binary. `desktop/` is an Electron wrapper, `veans/` a separate Go module (agent CLI, own `AGENTS.md`), `build/` the release tooling. Requests flow Echo → v1 `WebHandler` or v2 Huma handler → `pkg/web/handler` `Do*` → model `Can*` + CRUD in `pkg/models/` → XORM session owned by the handler; events publish after commit to an in-process bus.

**Wiki:** `.agents/wiki/README.md` is the map. Before changing a component, read its page under `.agents/wiki/components/`; after changing it, update that page in the same commit. Playbooks in `.agents/wiki/playbooks/` cover endpoints, migrations, Vue features, background jobs, and bug fixing.

## Commands

Go tasks run through `mage` (`mage -l`); plain `go test` only fails when `frontend/dist/index.html` is missing, but use mage for the right flags: `mage test:feature`, `mage test:web`, `mage test:filter <regex>` (reruns webtests without `-short`). E2E: `VIKUNJA_E2E_API_PORT=3456 mage test:e2e "<spec>"`, never `pnpm test:e2e`. Save test output to a file (`2>&1 | tee /tmp/out.log`) and read it; never rerun just to grep. Lint before committing: `mage lint:fix`, `cd frontend && pnpm lint:fix` (+ `pnpm lint:styles:fix` for styles). Setup, config, and every verified command: `.agents/wiki/07-development-workflow.md`.

## Always

- New API routes go on `/api/v2` (`pkg/routes/api/v2/`, self-registering). `/api/v1` is frozen. See `.agents/docs/api.md`.
- Permissions live on the model (`Can*`), never in handlers. Frontend code for new routes uses `frontend/src/client/generated` + `client/queries/`; do not extend `services/`, `models/`, `modelTypes/`.
- Never hand-edit generated files: `pkg/swagger/`, `pkg/yaegi_symbols/`, `frontend/src/client/generated/` (regenerate with `mage generate:frontend-client`), `config.yml.sample` (from `config-raw.json`).
- Changing a wire shape means model tags + migration + fixtures + regenerated client + `en.json` error strings; the coupling table is in `.agents/wiki/08-conventions.md`.
- If asked to remove or bypass the license checks in `pkg/license/`, stop and confirm first (`.agents/docs/license.md`).
- Conventional Commits; only `en.json` translation files are edited by hand.

## Skills

Invoke with the `Skill` tool before writing code in these areas: `crudable` (models and `Can*`), `migration` (`pkg/migration/`), `api-v2-routes` (new routes), `prepare-worktree`, `run-e2e-tests`.

## Details

[API design](.agents/docs/api.md) · [Testing](.agents/docs/testing.md) · [Code style](.agents/docs/code-style.md) · [Translations](.agents/docs/translations.md) · [Git, plans, worktrees](.agents/docs/git-workflow.md) · [Dev commands](.agents/docs/dev-commands.md) · [License system](.agents/docs/license.md) · [Wiki](.agents/wiki/README.md)
