# Playbook: add or change a database migration

Schema changes across SQLite, MySQL/MariaDB, and PostgreSQL. The `migration` skill (`.agents/skills/migration/SKILL.md`) is the rule list; [db-and-migrations](../components/backend/db-and-migrations.md) explains the machinery. Migrations run automatically on every `vikunja web` start and are effectively irreversible in production.

## 0. Decide the shape

| Change | Approach |
|---|---|
| Add a column | Local struct with only the new field(s) + `partialSync` |
| Add a table | Full struct + plain `tx.Sync` (the only case where plain Sync is allowed) + `Rollback` that drops it |
| Add a unique index on an existing table | Explicit `CREATE UNIQUE INDEX` per dialect after checking for duplicates; `partialSync` skips unique constraints |
| Rename or retype a column | `renameColumn` / `modifyColumn` helpers in `pkg/migration/migration.go`, then explicit data migration; `modifyColumn` is a no-op on SQLite, so verify the result on all three |
| Backfill data | XORM builder queries inside the migration, batched; never raw SQL strings |

## 1. Scaffold

```bash
mage dev:make-migration AddFooToTasks
```

Verified output: `pkg/migration/<YYYYMMDDHHMMSS>.go` containing a local struct `AddFooToTasks<ts>` with a `TableName()` and an `init()` that appends an `xormigrate.Migration{ID, Description, Migrate: partialSync(...), Rollback: nil}`.

Edit it:

- Set `TableName()` to the real table (`"tasks"`), fill `Description`.
- Declare only the columns you add or change, with `xorm` tags identical to the model's. Suffix struct names with the timestamp (already done) so future changes to the model do not alter old migrations.
- Use `time.Time` for times, never string columns.
- Return every error from `tx.Exec`/xorm calls. If you must ignore one, comment why on the same line.
- Sanitize any user-supplied paths (import/restore migrations).

## 2. Model and fixtures

1. Update the struct in `pkg/models/<entity>.go` (or `pkg/user/user.go`): matching `xorm` tag, `json` name, `doc:`/`readOnly:` tags for v2. Mind that xorm orders composite index columns by struct field order.
2. Update `pkg/db/fixtures/<table>.yml` so every row has the new column where required; tests load these into a schema created from the structs, not from migrations.
3. If it is a new table: add it to `pkg/models/models.go` → `GetTables()` and create the fixture file.
4. If the field is exposed over the API: `mage generate:frontend-client`; update legacy `frontend/src/modelTypes/I*.ts` and the model class only if legacy code reads the field.

## 3. Test

- Model tests: `mage test:feature 2>&1 | tee /tmp/feature.log` (SQLite). For a specific entity: `mage test:filter TestTask`.
- Migration test next to the file, copying `pkg/migration/20260830162731_test.go`: create `db.CreateTestEngine()`, run `Migrate(tx)`, assert the column exists and **no index or unique constraint disappeared** (the v2.4.0 regression, issue #3244). Declare a full-row struct in the test if you read rows back.
- Other databases: `VIKUNJA_TESTS_USE_CONFIG=1 VIKUNJA_DATABASE_TYPE=postgres VIKUNJA_DATABASE_HOST=... mage test:feature` if you have one locally; otherwise rely on CI's `test-api` matrix and the `test-migration-smoke` job, and say so in the PR.
- Apply against a real DB: `./vikunja --config config.yml migrate` then `./vikunja --config config.yml migrate list` (on a fresh DB the list command fails until a migration table exists; run `web` or `migrate` first).

## 4. Rollback reality

`Rollback` exists in the struct and `vikunja migrate rollback` exists as a command, but most migrations leave `Rollback` as `return nil`. Write a real rollback only for a new table (drop it). For anything destructive, prefer an additive migration plus a later cleanup migration.

## 5. Verify and commit

1. `mage lint:fix` (forbidigo bans `tx.Sync` in `pkg/migration/`; `goheader` needs the license header).
2. Never commit `config.yml.sample` or `pkg/swagger/`.
3. Commit message `feat(migration): ...` or `fix(...)`. Mention DB-specific behavior for reviewers.

## Commonly missed

- Plain `tx.Sync` on an existing table drops undeclared indexes; use `partialSync`.
- Forgetting the fixture update, so `mage test:feature` fails in unrelated packages.
- MySQL silently coercing types on `ALTER`; PostgreSQL needing explicit casts; SQLite ignoring `modifyColumn`.
- Postgres `columnExists` checks must filter on `current_schema()` (already done in the helper; do not hand-roll a query).
- Changing struct field order and thereby a composite index.
- Adding the column to the model but not to `doc:` tags, so the v2 spec and generated client lack the description.
- Three agents picking the same "next" migration timestamp is impossible, but three picking the same error code is not; grep `origin/main` before choosing a code.
