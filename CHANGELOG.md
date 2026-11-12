# Changelog

All notable changes to ZenForge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-12

Initial baseline. This release is a deliberate cold start: no pre-0.1.0 history
is carried forward, and the schema is `0001_baseline.sql` with no migrations to
apply.

### Added

- **Tracking plane**: SQLite WAL database at `~/.zenforge/state.db` holding the
  project → plan → task hierarchy, the SSOT resource registry (native content,
  tags, FTS5 search), owner-polymorphic artifacts, and a trigger-backed activity
  log.
- **Embedded migration runner**: ordered `migrations/NNNN_*.sql` steps applied
  automatically at startup, recorded in `schema_migrations` with a content
  checksum, one `state.db.pre-migration.bak` recovery point, and fail-closed
  guards for legacy or newer databases. See `docs/MIGRATIONS.md`.
- **Task lifecycle**: `PENDING → READY → RUNNING → COMPLETED/FAILED/BLOCKED/
  CANCELLED` with review handshakes, intra-task phase checkpoints, dependency
  gates, claim mutual exclusion (`claimed_by` + `claim_session_id`), and autorun
  workers.
- **Soul-bound agents**: one `kind=soul` resource per agent through `soul_key`,
  plus mode, goal, start/stop conditions, schedule, runner, and skills.
- **MCP surface**: six canonical tools (`zenf_find`, `zenf_create`, `zenf_update`,
  `zenf_delete`, `claim_task`, `transition_task`) over stdio, plus `zenf://` URIs.
- **HTTP gateway and CLI**: public definition/ingestion routes, SSE event stream,
  terminal streaming, runtime telemetry, and `zenf` commands for daemon, plans,
  tasks, resources, status, and updates.
- **Cockpit**: embedded web workbench with Hierarchy, Resources, Harness,
  Activity, Stage, and Inspector views, a persistent ActivityBar, and a
  Panel-menu enable switch.

### Changed

- **Workbench zones are stable**: hiding a view closes its panel but keeps the
  dock group and its size; reopening restores the panel into the same zone.
  Only `Reset Layout` (or an explicit drag) changes column geometry.
- **Enabled is separate from open**: the Panels menu owns enable/disable and the
  ActivityBar rail; closing a tab only hides the view and dims its icon. Disabled
  views disappear from both the rail and the Panels list.
- **Tab titles are single words**: `Hierarchy`, `Resources`, `Harness`,
  `Activity`, `Stage`, `Inspector`.
- **Inspector no longer auto-closes** when the selection is cleared; it keeps its
  zone and shows its empty state, so selecting tasks cannot move the layout.
- **Plan deletion semantics**: `zenf_delete(type="plan")` archives the plan;
  `DELETE /api/v1/plans/{slug}` remains the only hard delete.
- **Cold-start data policy**: databases from pre-0.1.0 builds are rejected
  without modification. Back them up and delete the file to start fresh.

### Removed

- Prototype-only verticals that never had a real writer or consumer:
  `agent_sessions`, `resource_links`, `resource_versions` (and `KEY@vN`
  pinning), `tasks.required_tools`, `tasks.harness`, `tasks.conflict_files`,
  `tasks.review_response`, `tasks.resolved_by`, `plans.archived_at`,
  `resources.mime_type`, and `events.actor`.
- The worktree merge gate (`AWAITING_MERGE`, `CONFLICT`, `merge_outcome`);
  `COMPLETE_TASK` now transitions `RUNNING → COMPLETED`.
- Pre-0.1.0 release history, tags, and changelog entries.
