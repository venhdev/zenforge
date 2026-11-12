---
name: zenf-mcp
description: "Unified 6-tool MCP tracking plane for ZenForge: zenf_find, zenf_create, zenf_update, zenf_delete, claim_task, transition_task."
---

# zenf-mcp — ZenForge Unified Tracking Plane

ZenForge is a SQLite WAL tracking plane for autonomous software engineering.
Work is coordinated through **6 canonical MCP tools**:

| Tool | Purpose | Key Parameters |
|---|---|---|
| `zenf_find` | Read, FTS, ID/URI lookup, relational filter | `uri`, `type`, `ids`, `filter`, `query`, `limit`, `include_packet` |
| `zenf_create` | Polymorphic batch creation | `type` ("project"|"plan"|"task"|"resource"|"agent"), `items` (plans carry `version: 1`, bump on update) |
| `zenf_update` | Polymorphic batch patch & notes | `type`, `items` (each with `id`/`slug` + patch fields; updates bump plan `version`) |
| `zenf_delete` | Polymorphic batch deletion/cancellation | `type`, `ids` (deleting a task cancels it; deleting a plan archives it) |
| `claim_task` | Atomic preflight claim & ContextPacket | `task_id`, `worker_id` (optional self-declaration), `session_id` |
| `transition_task` | State machine transitions & review gate | `task_ids` (or `task_id`), `action`, `context`, `items` |

Notes on the surface:

- `zenf_find` also accepts `type="tag_cloud"` for tag frequency maps.
- `transition_task` still honors the legacy flat arguments (`reason`, `summary`, `phase_id`, `phase_status`, `details`, `options`, `response`) alongside `context`.
- `zenf_update` accepts `archived` for plans, `refresh` for resources, and `notes` to append task notes. Resource patches cover `title`, `summary`, `kind`, `status`, `path`, `url`, `format`, `types`, `content`, `tags`; `type`, `scope`, and `scope_ref` are fixed at creation.
- `project_slug`, `plan_slug`, and `agent_slug` filters belong **inside** `filter`, never at the top level.
- `zenf_find` filter keys: `status`, `project_slug`, `plan_slug`, `agent_slug`,
  `include_archived`, `include_disabled`, `include_global`, `active_only`, `orphan`, `tag`,
  `kind`, `type`, `types`, `format`, `scope`, `scope_ref`. Unknown keys are ignored.

### Entity payload fields

| `type` | Create fields |
|---|---|
| `task` | `id`, `title`, `description`, `dependencies`, `priority`, `complexity`, `risk_level`, `agent_slug`, `skills`, `docs` (or `resources`), `target_files`, `acceptance_criteria`, `verification_commands`, `worktree_path`, `auto_run`, `phases`, `current_phase`, `media[]` |
| `resource` | `project_slug`, `key`, `slug`, `kind`, `type`, `types`, `scope`, `scope_ref`, `status`, `title`, `summary`, `path` **or** `url`, `format`, `content`, `blocks`, `tags` |
| `agent` | `slug`, `name`, `soul_key`, `mode`, `goal`, `runner`, `skills`, `schedule`, `enabled`, `start_conditions{task_status, max_risk_level, max_complexity, max_concurrency}`, `stop_conditions{on_failure, timeout_seconds}` |
| `plan` | `slug`, `project_slug`, `title`, `status`, `version`, `tasks[]` |

`skills` maps to `required_skills`, and `docs`/`resources` to `required_docs` on the task. `agent_slug` must reference a registered agent, and
`agent_slug`/`auto_run` can only change while the task is `READY` or `PENDING`.

`zenf_update` task patches accept the same authoring fields except `id`, plus `notes`, `media_add[]`, `media_remove[]`.
Plan patches accept `title`, `status`, `archived`. Agent patches accept every create field
except `slug`. Resource patches accept `title`, `summary`, `kind`, `status`, `path`, `url`,
`format`, `types`, `content`, `tags`.


## Universal Resource Identifiers (`zenf://`)

All ZenForge entities expose a canonical URI scheme:

- **Resources**: `zenf://<project>/resource/<key_or_slug>` (e.g. `zenf://zenforge/resource/CONSTRUCTION_RULES` or `zenf://global/resource/RULES`). `doc` is still accepted as a legacy alias for `resource`.
- **Tasks**: `zenf://<project>/task/<task_id>` (e.g. `zenf://zenforge/task/task-01`)
- **Plans**: `zenf://<project>/plan/<plan_slug>` (e.g. `zenf://zenforge/plan/v0.1.0`)
- **Agents**: `zenf://<project>/agent/<agent_slug>`
- **Direct by UUID**: `zenf://resource/<uuid>`

### Resolving `zenf://` URIs
Whenever a prompt or user message references a `zenf://` URI:
```json
{
  "uri": "zenf://zenforge/resource/CONSTRUCTION_RULES"
}
```
Or pass directly in `ids`: `{"ids": ["zenf://zenforge/resource/CONSTRUCTION_RULES"]}`. `zenf_find` automatically resolves the project, entity type, and identifier.

## Souls and Agents

A **soul** is a `resource` with `kind="soul"`: a markdown persona and workflow document.
An **agent** is a dispatch contract (mode, gates, runner) that references exactly one soul
through `soul_key`. One soul can serve many agents; one agent has at most one soul.

A soul's markdown may open with YAML frontmatter:

```markdown
---
name: debugger
skills: [recon, diagnose, tdd]
---
You are a debugger. Never patch before reproducing.
```

At claim time the returned `ContextPacket` carries the soul body and a `skill_paths`
list resolved from `soul.skills ∪ task.required_skills` (soul order first, deduplicated).
The agent's `skills` list is a **ceiling only**: it can restrict what a task may run,
never add to it. `claimed_by` is runtime attribution recorded at claim and grants no
authorization; a task bound to an agent may only be claimed by that agent.

### Delegating to a defined agent

```text
1. zenf_find(type="agent")                                     pick by soul/name/skills
2. zenf_create(type="task", items=[{..., "agent_slug": "<slug>"}])
3. Spawn the worker with: claim_task(task_id="<id>") and follow the returned packet
```

The claim packet already carries the soul body and `skill_paths`. Never copy soul text
into the spawn prompt: it would fork the source of truth and drift from the resource.

## Context resources

A resource lives in exactly one container:

| `scope` | `project_slug` | `scope_ref` |
|---|---|---|
| `GLOBAL` | empty | empty |
| `PROJECT` | required | empty |
| `PLAN` | required | plan slug |
| `TASK` | required | task id |

Three lanes carry context:

- **Knowledge** — `resources.content`, indexed by FTS5, ≤ 4 MiB.
- **Attachment** — files under `~/.zenforge/attachments/<owner>/`, ≤ 25 MiB,
  content-addressed by SHA-256. Upload with `POST /api/v1/resources/{id}/files`
  (multipart field `file`); binaries attached to a task use
  `POST /api/v1/tasks/{id}/attachments` and land as INPUT artifacts.
- **Link** — `resources.url` for external http(s) references. `url` and `path`
  are mutually exclusive and refresh is refused for URL resources.

A task references knowledge through `required_docs` (`KEY`). Plan-scoped resources
are injected automatically into every task of that plan.

## Task State Machine

```text
PENDING ──deps done──▶ READY ──claim_task──▶ RUNNING ──CHECKPOINT_PHASE──▶ RUNNING
                                        │        └──COMPLETE_TASK──▶ COMPLETED
                                        ├──FAIL_TASK──▶ FAILED (blocks downstream)
                                        ├──REQUEST_REVIEW──▶ AWAITING_REVIEW ──RESOLVE_REVIEW──▶ READY
                                        ├──RESET_TO_READY──▶ READY | BLOCKED
                                        └──CANCEL_TASK──▶ CANCELLED
```

## Action Verbs (`transition_task`)
- `COMPLETE_TASK`: Transitions to `COMPLETED` and unblocks downstream dependents.
- `FAIL_TASK`: Transitions to `FAILED`. Cascades `BLOCKED` to downstream dependencies.
- `CHECKPOINT_PHASE`: Advances intra-task phase (`context.phase_id`, `context.phase_status`) and appends milestone note without losing claim.
- `REQUEST_REVIEW`: Worker requests human/architect review with `context.reason`, `context.details`, and `context.options`. Task moves to `AWAITING_REVIEW`.
- `RESOLVE_REVIEW`: Relays developer decision via `context.decision`, records guidance in notes, and resets task to `READY`.
- `RESET_TO_READY`: Evicts worker claim and returns task to `READY` (or `BLOCKED` if prerequisites changed).
- `CANCEL_TASK`: Terminal cancellation.

## Templates & Payloads
See [templates.md](references/templates.md) for complete copy-paste JSON structures.
