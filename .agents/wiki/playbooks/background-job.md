# Playbook: add, change, or fix a background job

Background work in Vikunja is either an **event listener** (reacts to something that happened in a request) or a **cron job** (runs on a schedule). There is no persistent queue. Read [events-and-listeners](../components/backend/events-and-listeners.md) and [cron-and-background-jobs](../components/backend/cron-and-background-jobs.md) for the mechanics; this page is the procedure.

## Choose the mechanism

| Need | Use | Because |
|---|---|---|
| React to a domain change (task created, comment added, user registered) | Event + listener | The event already exists or is one line to add; runs after commit; retried automatically |
| Periodic maintenance (reminders due, cleanup, expiry checks) | Cron via `cron.Schedule` | Only option for time-based work |
| Long work started by a request (import, export) | Event + listener that does the work, plus a status row the client polls | That is how imports (`pkg/modules/migration/handler`) and exports (`HandleUserDataExport`) work |
| Fan-out to external targets | Event → per-target events (`WebhookDeliveryEvent`) | Each target retries independently |

## Add an event and listener

1. Event: `mage dev:make-event TaskArchivedEvent models` appends a struct with `Name()` returning the topic to `pkg/models/events.go` (verified in `magefile.go` → `Dev.MakeEvent`). Fill in the fields; always include `Doer *user.User`. Topic strings are dotted lowercase (`task.archived`).
2. Dispatch from the model method inside the transaction: `events.DispatchOnCommit(s, &TaskArchivedEvent{Task: t, Doer: doerFromAuth(s, a)})`. It publishes only after `handler.Do*` commits. Outside a transaction use `events.Dispatch`.
3. Listener: `mage dev:make-listener SendTaskArchivedNotification TaskArchivedEvent models` appends a struct with `Name()` and `Handle(msg *message.Message) error` to `pkg/models/listeners.go` **and** inserts `events.RegisterListener((&TaskArchivedEvent{}).Name(), &SendTaskArchivedNotification{})` into `RegisterListeners()`. If you write it by hand, do both; an unregistered listener never runs.
4. In `Handle`: `json.Unmarshal(msg.Payload, &event)`, open `s := db.NewSession(); defer s.Close()`, do the work, `s.Commit()`. Return an error to trigger retry; return nil to ack. Do not log the payload (it may contain user data).
5. Opt in to webhooks (`RegisterEventForWebhook` in the `WebhooksEnabled` block) and audit (`registerEventsForAuditLogging`) if the event should reach those channels; add it to `pkg/websocket/connection.go` → `validEvents` plus a `pkg/websocket/listener.go` bridge if clients should receive it live.
6. Notification? `mage dev:make-notification TaskArchivedNotification models` appends a type with `ToMail`, `ToDB`, `Name` to `pkg/models/notifications.go`; register it and add `pkg/i18n/lang/en.json` strings; send with `notifications.Notify(user, n, s)`.

## Add a cron job

1. Next to the data it touches: `func RegisterFooCron() { err := cron.Schedule("0 * * * *", func() { ... }); if err != nil { log.Fatalf(...) } }` (pattern: `pkg/models/sessions.go` → `RegisterSessionCleanupCron`).
2. Inside the func: open a session, do the work in bounded batches, commit, log errors with `log.Errorf` including the job name. Nothing else will report a failure.
3. Call `RegisterFooCron()` from `pkg/initialize/init.go` → `FullInit()` after `cron.Init()`. Only `FullInit` (the `web` command) starts cron.
4. Config-gated jobs check their flag inside the func or skip registration (reminder mails check `config.MailerEnabled`).

## Retry, idempotency, ordering

- Listeners: Watermill retries a failing handler up to 5 times with exponential backoff (100 ms to 1 h, jittered) then moves the message to the `poison` topic, which is only logged and Sentry-reported (`pkg/events/events.go`). A restart drops everything in flight. Design handlers so a repeat is harmless: upsert instead of insert, check `IsUniqueConstraintError`, look up "already notified" state, and never assume exactly-once.
- Cron: no retry, no overlap protection. A job that takes longer than its interval overlaps with the next run (robfig/cron default). Keep jobs short or add your own guard in the keyvalue store.
- Ordering: listeners on the same topic run concurrently; different topics are independent. If B depends on A's side effect, have A dispatch a second event when done rather than relying on timing.
- Multi-instance: every instance runs every cron job and only sees its own events. Unverified: whether any deployment runs more than one instance.

## Test it

- Listener unit test: `db.LoadFixtures()`, build a `message.NewMessage(id, payloadJSON)`, call `Handle`, assert with `db.AssertExists`. `events.Fake()` (set in `pkg/models/main_test.go`) captures nested dispatches for assertion.
- Through the real router: `pkg/e2etests/` with `setupE2ETestEnv`; use an `httptest.Server` as a webhook or mail sink. `events.WaitForPendingHandlers()` drains before assertions.
- Cron: call the scheduled function directly in a model test; there is nothing else to mock. Freeze time via the fixtures' fixed timestamps rather than `time.Now()` where possible.
- Run: `mage test:filter TestFoo 2>&1 | tee /tmp/foo.log`; for e2etests `mage test:e2EApi`.

## Fix a failing job

1. Find the handler name in the API log (`ERROR` lines carry it; poison messages log handler + reason). Sentry groups by handler name plus normalized reason (`pkg/errorreport`).
2. Reproduce with a listener test using the fixture rows that match the failing case.
3. Fix at the boundary (validate the event payload, handle the missing-entity case explicitly) rather than swallowing the error; a swallowed error acks the message and hides the bug.
4. If the fix is a data repair, consider a `vikunja repair ...` subcommand (`pkg/cmd/repair*.go`) instead of a one-off migration.

## Observability you get for free, and not

| Have | Do not have |
|---|---|
| Watermill Prometheus metrics (handler counts, durations) when `metrics.enabled` | Per-cron-job metrics or last-run timestamps |
| Poison-topic log lines and Sentry events with stable fingerprints | Dead-letter storage or replay |
| `events.WaitForPendingHandlers()` for tests | Any admin UI for jobs |
| `migration_status` rows for imports | Generic job status rows |
