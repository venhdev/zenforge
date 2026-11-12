# ZenForge MCP

The `zenf` MCP server exposes the ZenForge tracking plane over JSON-RPC 2.0 via
stdio. It owns projects, plans, tasks, SSOT resource metadata, soul resources, agent
definitions, cross-entity search, and the task state machine.
It does not run git operations; worktree lifecycle stays in the task domain.

## Build

```bash
cd apps/daemon && make build
```

## Client setup

Replace `/abs/path/to/apps/daemon/bin/zenf` with the built binary path and
`/home/<user>` with your home directory. Restart the AI client after setup so it
discovers the tools.

### Automated (agy, claude, cursor, opencode)

View status and available actions:
```bash
zenf mcp
```

Setup or audit individual AI clients:
```bash
zenf mcp check --client opencode
zenf mcp setup --client opencode --dry-run
zenf mcp setup --client opencode
```

Or view overall system and MCP status:
```bash
zenf status
```

| Client | `--client` | Config file |
| :--- | :--- | :--- |
| Antigravity | `agy` (default) | `~/.gemini/config/mcp_config.json` |
| Claude Code | `claude` | `~/.claude.json` |
| Cursor | `cursor` | `~/.cursor/mcp.json` |
| OpenCode | `opencode` | `~/.config/opencode/opencode.json` |

Flags: `check` takes `--client/-c`, `--config`, `--json`; `setup` takes those plus
`--db/-d`, `--binary/-b`, `--force/-f`, `--dry-run`; `mcp` takes `--db/-d`
(default `~/.zenforge/state.db`) and `--stdio` (force the stdio JSON-RPC server even
when attached to a terminal). Existing config is backed up to `<config>.bak`
and other MCP servers are preserved.

### Manual

Most clients read an `mcpServers` object:

```json
{
  "mcpServers": {
    "zenf": {
      "command": "/abs/path/to/apps/daemon/bin/zenf",
      "args": ["mcp", "--db", "/home/<user>/.zenforge/state.db"]
    }
  }
}
```

| Client | File |
| :--- | :--- |
| Claude Code | `~/.claude.json` (user) or `.mcp.json` (project) |
| Cursor | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project) |
| Antigravity | `~/.gemini/config/mcp_config.json` |
| Other `mcpServers` clients | that client's MCP config |

**OpenCode** (`opencode.json` at the repo root, or `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "zenf": {
      "type": "local",
      "command": ["/abs/path/to/apps/daemon/bin/zenf", "mcp", "--db", "/home/<user>/.zenforge/state.db"],
      "enabled": true
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "zenf": {
      "type": "stdio",
      "command": "/abs/path/to/apps/daemon/bin/zenf",
      "args": ["mcp", "--db", "/home/<user>/.zenforge/state.db"]
    }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`):

```bash
codex mcp add zenf -- /abs/path/to/apps/daemon/bin/zenf mcp --db /home/<user>/.zenforge/state.db
```

```toml
[mcp_servers.zenf]
command = "/abs/path/to/apps/daemon/bin/zenf"
args = ["mcp", "--db", "/home/<user>/.zenforge/state.db"]
```

## Hierarchy and scope

```text
project <- plans <- tasks
```

Every plan belongs to exactly one project. A task has exactly one scope:

| Scope | Identifying fields | Dependency container |
| :--- | :--- | :--- |
| Plan task | `plan_slug` + `project_slug` | `plan:<slug>` |
| Project task | `project_slug`, no `plan_slug` | `project:<slug>` |
| Orphan task | neither field | `orphan` |

Dependencies are validated inside the task's container. A plan task cannot
depend on a task from another plan.

## Roles

- **Main agent**: registers the project, authors plans and the task DAG,
  dispatches workers, relays human decisions, resolves reviews, and archives
  finished plans.
- **Worker**: claims one task, executes it, reports completion/failure/review,
  then exits.
- **Web Cockpit**: read-only for execution state. It may CRUD projects, resource
  registry entries (including souls), and agent definitions. It never creates, claims, or
  transitions tasks, and never drives a session.

## Lifecycle & State Machine

```text
PENDING ──deps done──▶ READY ──claim_task──▶ RUNNING ──CHECKPOINT_PHASE──▶ RUNNING
                                        │        └──COMPLETE_TASK──▶ COMPLETED
                                        ├──FAIL_TASK──▶ FAILED (blocks downstream)
                                        ├──REQUEST_REVIEW──▶ AWAITING_REVIEW ──RESOLVE_REVIEW──▶ READY
                                        ├──RESET_TO_READY──▶ READY | BLOCKED
                                        └──CANCEL_TASK──▶ CANCELLED
```

## Tool reference (6 Canonical Tools)

ZenForge exposes the entire MCP surface as **6 canonical tools**:

| Tool | Purpose | Key Parameters |
| :--- | :--- | :--- |
| `zenf_find` | Read, FTS, ID lookup, relational filter across all entities. | `type` ("project"\|"plan"\|"task"\|"resource"\|"agent"\|"tag_cloud"), `ids[]`, `filter`, `query`, `limit`, `include_packet` |
| `zenf_create` | Polymorphic batch creation. | `type` ("project"\|"plan"\|"task"\|"resource"\|"agent"), `items[]` |
| `zenf_update` | Polymorphic batch patch & notes. | `type`, `items[]` (each item carries `id`/`slug` + patch fields) |
| `zenf_delete` | Polymorphic batch deletion / cancellation (deleting a task cancels it, deleting a plan archives it). | `type`, `ids[]` |
| `claim_task` | Atomically claim a `READY` task, transition to `RUNNING`, return `ContextPacket`. | `task_id` (required); `worker_id` (optional self-declaration), `session_id` (live runner stream) |
| `transition_task` | State machine transitions & review gate. | `task_ids[]` (or `task_id`) + `action` + `context`, or `items[]` |

`doc` and `document` remain accepted as aliases for `resource`. Filter keys
(`project_slug`, `plan_slug`, `agent_slug`, `status`, `include_archived`,
`include_disabled`, `active_only`, `tag`) must live inside `filter`; a top-level
`project_slug` is ignored.

Clients namespace tools by server name: OpenCode shows `zenf.zenf_create`,
Claude Code shows `mcp__zenf__zenf_create`.

### Action Verbs (`transition_task`)

- `COMPLETE_TASK`: Transitions to `COMPLETED` and unblocks downstream dependents.
- `FAIL_TASK`: Transitions to `FAILED`. Cascades `BLOCKED` to downstream dependents.
- `CHECKPOINT_PHASE`: Advances intra-task phase (`context.phase_id`, `context.phase_status`) and appends milestone note without losing claim.
- `REQUEST_REVIEW`: Worker pauses at `AWAITING_REVIEW` with `context.reason`, `context.details`, and `context.options`.
- `RESOLVE_REVIEW`: Relays developer decision via `context.decision`, records guidance in notes, and resets task to `READY`.
- `RESET_TO_READY`: Evicts worker claim and returns task to `READY` (or `BLOCKED` if prerequisites changed).
- `CANCEL_TASK`: Terminal cancellation.

## Create a project, plan, and DAG (`zenf_create`)

```json
{
  "type": "project",
  "items": [
    {
      "slug": "zenforge",
      "name": "ZenForge",
      "root_path": "/home/dev/src/owner/zenforge"
    }
  ]
}
```

```json
{
  "type": "plan",
  "items": [
    {
      "project_slug": "zenforge",
      "slug": "auth-refactor",
      "title": "Auth refactor",
      "tasks": [
        { "id": "P-01", "title": "Freeze session schema", "media": [{ "file_path": "/abs/spec.pdf" }] },
        { "id": "P-02", "title": "Migrate call sites", "dependencies": ["P-01"] },
        { "id": "P-03", "title": "Delete legacy path", "dependencies": ["P-02"] }
      ]
    }
  ]
}
```

The plan and DAG commit in one transaction. To add tasks later:
`zenf_create(type="task", items=[{"plan_slug": "auth-refactor", "project_slug": "zenforge", "id": "P-04", ...}])`.

### Task item shape

```json
{
  "id": "P-02",
  "title": "Implement claim preflight",
  "description": "Move packet assembly outside the write transaction.",
  "dependencies": ["P-01"],
  "target_files": ["apps/daemon/internal/storage/task_lifecycle.go"],
  "skills": ["tdd"],
  "docs": ["ARCH"],
  "acceptance_criteria": ["claim no longer holds the write lock"],
  "verification_commands": ["go test ./..."],
  "priority": "P1",
  "complexity": "MEDIUM",
  "risk_level": "LOW",
  "agent_slug": "coder-alpha",
  "worktree_path": "/path/to/worktree",
  "media": [{ "file_path": "/abs/design.png", "name": "Checkout redesign" }]
}
```

## Resources (SSOT registry)

Resources are **native-first**: `content` is stored directly in the SQLite WAL. `path`
is an optional overlay that references an existing Git file; when `content` is empty
and `path` is set, the daemon snapshots the file into `content`. The registry also
stores identity (`id`, `key`, `slug`), classification (`kind`, `type`, `scope`,
`scope_ref`, `status`), `tags`, content hash, byte size, and an FTS-searchable snapshot.

`type` is one of `ARCHITECTURE`, `ADR`, `SPEC`, `RULE`, `GUIDE`, `REFERENCE`, `MEMORY`,
`OTHER`; `kind` is one of `spec`, `soul`, `harness`, `artifact`.

A resource carries either `path` (a repository file overlay) or `url` (an external
http(s) reference), never both. URL resources are never snapshotted and refresh is
refused for them.

### Scope matrix

| `scope` | `project_slug` | `scope_ref` |
| :--- | :--- | :--- |
| `GLOBAL` | empty | empty |
| `PROJECT` | required | empty |
| `PLAN` | required | plan slug |
| `TASK` | required | task id |

Plan-scoped resources are injected as briefs into every task of that plan, so a
technical contract only has to be attached once.

### Context lanes

| Lane | Entity | Storage | Searchable |
| :--- | :--- | :--- | :--- |
| Knowledge | `resources.content` | SQLite WAL (≤ 4 MiB) | FTS5 |
| Attachment | `artifacts` rows | `~/.zenforge/attachments/<owner>/` (≤ 25 MiB per file) | metadata only |
| Link | `resources.url` | SQLite metadata | title/summary |

Files are content-addressed by SHA-256, so uploading identical bytes twice stores
one file. `resources.version` and `content_hash` track the current revision; a GC
pass removes attachment files that no longer have a metadata row.

Register an external link:
```json
{
  "type": "resource",
  "items": [
    {
      "project_slug": "zenforge",
      "key": "REF-GO",
      "slug": "go-concurrency-ref",
      "type": "REFERENCE",
      "scope": "PROJECT",
      "title": "Go concurrency reference",
      "url": "https://go.dev/blog/waza-talk",
      "summary": "Canonical goroutine material"
    }
  ]
}
```

Create / register a resource:
```json
{
  "type": "resource",
  "items": [
    {
      "project_slug": "zenforge",
      "key": "ARCH",
      "slug": "architecture-topology",
      "type": "ARCHITECTURE",
      "scope": "PROJECT",
      "title": "Architecture topology",
      "path": "/home/dev/src/owner/zenforge/docs/architecture-topology.md",
      "summary": "Host-daemon topology and communication seams",
      "tags": ["architecture", "core"]
    }
  ]
}
```

Search resources (`zenf_find`) — `project_slug` goes inside `filter`:
```json
{
  "type": "resource",
  "query": "claim preflight",
  "filter": {
    "project_slug": "zenforge"
  },
  "limit": 10
}
```

## Souls and agents

A **soul** is a resource with `kind="soul"`: a markdown persona and workflow document.
An **agent** is a dispatch contract — mode, gates, runner — that references exactly one
soul through `soul_key`. One soul can serve many agents; one agent has at most one soul.

Create a soul:
```json
{
  "type": "resource",
  "items": [
    {
      "project_slug": "zenforge",
      "key": "SOUL_DEBUGGER",
      "slug": "debugger",
      "kind": "soul",
      "type": "GUIDE",
      "scope": "PROJECT",
      "title": "Debugger Soul",
      "format": "markdown",
      "content": "---\nname: debugger\nskills: [recon, diagnose, tdd]\n---\n\nYou are a debugger. Never patch before reproducing the defect."
    }
  ]
}
```

Register a reusable WORKER definition bound to that soul:
```json
{
  "type": "agent",
  "items": [
    {
      "slug": "coder-alpha",
      "name": "Coder Alpha",
      "soul_key": "SOUL_DEBUGGER",
      "mode": "HEADLESS",
      "goal": "Implement READY tasks inside the assigned plan scope.",
      "start_conditions": {
        "task_status": "READY",
        "max_concurrency": 1
      },
      "stop_conditions": {
        "on_failure": "AWAITING_REVIEW",
        "timeout_seconds": 900
      },
      "skills": ["tdd", "forge"],
      "runner": "local-worker",
      "enabled": true
    }
  ]
}
```

**Skill resolution at claim time**

```text
soul.frontmatter.skills  ∪  task.skills
        │
        ├─► gate: ⊆ agent.skills
        └─► ContextPacket.skill_paths  (soul order first, deduplicated)
```

Task skills are additive only; a task can extend a soul's workflow but never remove a
step from it. `agent.skills` is a ceiling, never a source. `schedule` and `mode` are
reserved: no scheduler or interactive dispatcher consumes them yet.

**Claim identity**

Mutual exclusion comes from the claim transition (`READY -> RUNNING`), not from any
field. `claimed_by` is runtime attribution only and grants no authorization.

- A task bound to an agent (`agent_slug` set) may only be claimed by that agent;
  `claimed_by` is derived from it and a conflicting `worker_id` is rejected.
- An unbound task accepts an optional self-declared `worker_id`, else records
  `"external"` so the cockpit always shows an honest label.
- Claiming a task whose assigned agent was deleted or disabled is refused rather than
  run without gates.

Delegating work to a defined agent:

```text
1. zenf_find(type="agent")                  -> pick the agent whose soul matches the work
2. zenf_create(type="task", items=[{..., "agent_slug": "<slug>"}])
3. Spawn the worker with: claim_task(task_id="<id>") and follow the returned packet
```

The claim packet already carries the soul body and `skill_paths`; never copy soul text
into the spawn prompt.

## Write surfaces

| Surface | Use |
| :--- | :--- |
| MCP (stdio) | Agent path: 6 canonical tools (`zenf_find`, `zenf_create`, `zenf_update`, `zenf_delete`, `claim_task`, `transition_task`). |
| `zenf` CLI | `zenf daemon`, `zenf mcp`, `zenf plan`, `zenf task`, `zenf status`. |
| HTTP API | Gateway on `127.0.0.1:1123`; endpoint list below. |
| Web Cockpit | Read-only execution dashboard + Project / Encyclopedia / Agent definition management. |

### HTTP endpoints

| Method | Path |
| :--- | :--- |
| `GET/POST` | `/api/v1/projects` |
| `GET/PATCH/DELETE` | `/api/v1/projects/{slug}` |
| `GET/POST` | `/api/v1/plans` |
| `GET/DELETE` | `/api/v1/plans/{slug}` |
| `GET/POST` | `/api/v1/tasks` |
| `GET/PATCH/DELETE` | `/api/v1/tasks/{id}` |
| `POST` | `/api/v1/tasks/{id}/status`, `/claim`, `/evict`, `/dependencies`, `/attachments` |
| `PATCH` | `/api/v1/tasks/{id}/context` |
| `GET` | `/api/v1/tasks/{id}/artifacts` |
| `GET/POST` | `/api/v1/resources` |
| `GET/POST` | `/api/v1/resources/{id}/files` (multipart, field `file`) |
| `DELETE` | `/api/v1/resources/{id}/files/{fileId}` |
| `GET` | `/api/v1/resources/search?query=` |
| `GET/PATCH/DELETE` | `/api/v1/resources/{id}` |
| `POST` | `/api/v1/resources/{id}/refresh` |
| `GET/POST` | `/api/v1/agents` |
| `GET/PATCH/DELETE` | `/api/v1/agents/{slug}` |
| `GET` | `/api/v1/sessions/{id}/terminal` (live runner stream) |
| `GET` | `/api/v1/search?q=&project_slug=` |
| `GET` | `/api/v1/status`, `/api/v1/env/global` |
| `GET` | `/api/v1/events`, `/api/v1/events/stream` (SSE) |

Every mutation triggers database events, reflected live in the Cockpit via SSE.

## Reference templates

For complete copy-paste JSON structures, see [templates.md](skills/zenf-mcp/references/templates.md).
