# Schema Migrations

ZenForge does not rotate or delete the database when the schema changes. Every
schema change is an ordered migration step embedded in the binary; the daemon
applies whatever the database is missing at startup.

## Layout

```text
apps/daemon/internal/storage/
  migrations/
    0001_baseline.sql     ← frozen v0.1.0 baseline (never edit after release)
    NNNN_<slug>.sql       ← one step per schema change
  migrate.go              ← runner + guards
```

The database records what it has applied in `schema_migrations`:

| Column | Meaning |
| :--- | :--- |
| `version` | `0001`, `0002`, … from the file-name prefix |
| `name` | file name without the numeric prefix |
| `checksum` | SHA-256 of the file content at apply time |
| `applied_at` | UTC timestamp |

## Startup behaviour

1. **Empty database** → the ledger is created and every migration is applied.
2. **Ledger present, steps pending** → the database file is checkpointed and
   copied to `state.db.pre-migration.bak` (a single, overwritten recovery
   point), then the missing steps run in order, each inside one transaction.
3. **Ledger present, nothing pending** → no-op.
4. **Ledger present but a step is newer than the binary** → startup fails with
   `database schema is newer than this binary`. Rebuild/upgrade `zenf` before
   opening that file.
5. **Tables but no ledger** (pre-v0.1.0 files, `schema_info`, or any unknown
   SQLite file) → startup fails with `incompatible legacy database`. The file is
   never modified. Back it up and delete it to start fresh.
6. **Applied file edited** (checksum mismatch) → startup fails with
   `applied migration was modified`. Restore the original content or reset the
   development database.

## Development workflow

- **Before the first release tag (`v0.1.0`)**: edit `0001_baseline.sql` directly
  and run `make db-reset` (stops the daemon, removes `state.db*` and the backup).
  No migration file is needed while the baseline is still mutable.
- **After `v0.1.0`**: `0001` is frozen. Any schema change is a new `0002_*.sql`
  (or next number). Dev and production use the same database file and the same
  runner, so there is no second schema to keep in sync.

> Dev and the installed binary share `~/.zenforge/state.db`. When development
> adds a step, rebuild the installed binary (`make build-local`) before starting
> it again; an older binary fails closed with "database schema is newer".

## Adding a migration

1. Create `apps/daemon/internal/storage/migrations/NNNN_<slug>.sql`
   (`NNNN` = next integer, zero padded).
2. Write forward-only SQL. Do **not** include `BEGIN`/`COMMIT`; the runner wraps
   the step in a transaction. Triggers use `BEGIN … END` and are fine.
3. Do not edit an applied file — add a follow-up step instead.
4. Run `go test ./internal/storage/` (the runner and ledger are exercised there),
   then start the daemon and confirm the step is applied.
5. Add an entry to the log below.

## Recovery

- **Failed migration**: the transaction rolls back and startup aborts; the
  ledger and schema stay at the previous version. Fix the SQL, rebuild, retry.
- **Need the previous state**: stop the daemon and restore
  `state.db.pre-migration.bak` over `state.db` (remove `-wal`/`-shm` first).
- **Cold reset**: `make db-reset` deletes the database family and the backup.

## Log

### 0001 — baseline (2026-11-12)

Initial v0.1.0 schema: projects, plans, tasks, resources (+ FTS5 and tags),
agents, owner-polymorphic artifacts, events, and audit triggers. Frozen at the
v0.1.0 release.
