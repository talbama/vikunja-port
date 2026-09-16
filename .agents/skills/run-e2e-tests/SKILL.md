---
name: run-e2e-tests
description: Run Vikunja's Playwright end-to-end tests through `mage test:e2e`. Use when asked to run e2e tests, reproduce a bug in the browser, or verify a frontend change end to end.
---

# Running E2E Tests

**ALWAYS use `mage test:e2e`.** Do NOT run `pnpm test:e2e` directly. The mage command builds the API, starts it with an isolated SQLite database, builds and serves the frontend, runs the Playwright tests, and tears everything down automatically.

```bash
mage test:e2e ""                                      # run all tests
mage test:e2e "tests/e2e/misc/menu.spec.ts"           # specific file
mage test:e2e "--grep menu"                            # filter by name
mage test:e2e "--headed tests/e2e/misc/menu.spec.ts"  # headed mode
```

**Always save test output to a file.** E2E tests are expensive (they rebuild the API, start servers, run browsers). NEVER re-run tests just to look at the output differently (e.g., with different `grep`/`tail` filters). Save the output on the first run and then read the file:

```bash
# First run: save output to a file
mage test:e2e "tests/e2e/misc/menu.spec.ts" 2>&1 | tee /tmp/e2e-output.log

# Subsequent analysis: read the file, don't re-run
cat /tmp/e2e-output.log | grep -E '(passed|failed)'
cat /tmp/e2e-output.log | tail -20
```

Environment variables read by `mage test:e2e` (see `magefile.go` → `Test.E2E`):

- `VIKUNJA_E2E_API_PORT`: API port, random by default. **Set it to `3456` locally.** Specs that log in through the UI post to a relative `/api/v1`, and the frontend then falls back to port 3456 on the same host (`frontend/src/helpers/checkAndSetApiUrl.ts`); with a random port those specs fail with 404. CI runs the API on 3456.
- `VIKUNJA_E2E_FRONTEND_PORT`: preview server port, random by default.
- `VIKUNJA_E2E_TESTING_TOKEN`: seeding token, random by default.
- `VIKUNJA_E2E_SKIP_BUILD=true`: skip rebuilding the API binary when iterating on frontend-only changes.

```bash
VIKUNJA_E2E_API_PORT=3456 mage test:e2e "tests/e2e/user/login.spec.ts" 2>&1 | tee /tmp/e2e-output.log
```

Specs that need Dex (OpenID login) or Mailpit (email confirmation, registration notice) only pass in CI, where those run as Docker services. On macOS `misc/menu.spec.ts`'s keyboard-shortcut test fails because Playwright sends Meta while the emulated Windows user agent makes the app expect Ctrl. Details: [.agents/wiki/11-testing-guide.md](../../wiki/11-testing-guide.md).
