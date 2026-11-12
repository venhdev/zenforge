# Unified MCP Surface — Reference Templates

Copy-paste payloads for the 6 canonical ZenForge MCP tools.

---

## 1. `zenf_find`

### 1.0 Canonical URI Lookup (`zenf://...`)
Single-parameter zero-guesswork resolution for any ZenForge entity:
```json
{
  "uri": "zenf://zenforge/resource/CONSTRUCTION_RULES"
}
```
Or in `ids` array:
```json
{
  "ids": ["zenf://zenforge/task/task-01", "zenf://zenforge/resource/CONSTRUCTION_RULES"]
}
```
`doc` still resolves as a legacy alias for `resource`, but `/resource/` is canonical.

### 1.1 Direct ID / Slug Lookup
```json
{
  "type": "task",
  "ids": ["task-01", "task-02"],
  "include_packet": false
}
```

### 1.2 Relational Filter
```json
{
  "type": "task",
  "filter": {
    "status": "READY",
    "plan_slug": "core-engine",
    "project_slug": "zenf"
  },
  "limit": 20
}
```

### 1.3 Full-Text Search (FTS)
```json
{
  "type": "resource",
  "query": "websocket PTY streaming",
  "limit": 10
}
```

### 1.4 Cross-Entity Global Search
```json
{
  "query": "authentication bearer token",
  "limit": 25
}
```

---

## 2. `zenf_create`

### 2.1 Project
```json
{
  "type": "project",
  "items": [
    {
      "slug": "zenf",
      "name": "ZenForge",
      "root_path": "/home/dev/src/owner/zenforge",
      "description": "Autonomous software engineering tracking plane"
    }
  ]
}
```

### 2.2 Plan with Composite Task DAG
Plans start at `version: 1` by default and increment on re-ingest or `zenf_update`.
```json
{
  "type": "plan",
  "items": [
    {
      "slug": "mcp-v4",
      "project_slug": "zenf",
      "title": "Unified MCP Surface",
      "version": 1,
      "tasks": [
        {
          "id": "mcp-01",
          "title": "Implement zenf_find primitive",
          "priority": "P1",
          "complexity": "MEDIUM",
          "risk_level": "LOW",
          "target_files": ["apps/daemon/internal/mcp/tool_find.go"]
        },
        {
          "id": "mcp-02",
          "title": "Implement polymorphic CRUD",
          "dependencies": ["mcp-01"],
          "priority": "P1",
          "complexity": "MEDIUM",
          "risk_level": "LOW",
          "target_files": ["apps/daemon/internal/mcp/tool_crud.go"]
        }
      ]
    }
  ]
}
```

### 2.3 Standalone Tasks
```json
{
  "type": "task",
  "items": [
    {
      "id": "hotfix-01",
      "project_slug": "zenf",
      "plan_slug": "mcp-v4",
      "title": "Repair race condition in task claim",
      "priority": "P0",
      "skills": ["tdd", "diagnose"]
    }
  ]
}
```

### 2.4 Resources (SSOT & Plan Technical Documents)
```json
{
  "type": "resource",
  "items": [
    {
      "project_slug": "zenf",
      "key": "ARCH-MCP",
      "slug": "mcp-architecture",
      "type": "ARCHITECTURE",
      "scope": "PROJECT",
      "title": "MCP Server Surface Architecture",
      "path": "docs/architecture/mcp.md",
      "tags": ["mcp", "architecture"]
    },
    {
      "project_slug": "zenf",
      "key": "TECH_SPEC",
      "slug": "mcp-v4-spec",
      "type": "SPEC",
      "scope": "PLAN",
      "scope_ref": "mcp-v4",
      "title": "Technical Specification for MCP v4",
      "content": "Detailed slice contract for tasks in mcp-v4..."
    }
  ]
}
```
Valid `type` values: `ARCHITECTURE`, `ADR`, `SPEC`, `RULE`, `GUIDE`, `REFERENCE`, `MEMORY`, `OTHER`.

### 2.5 Agent Definition
An agent is a dispatch contract that references one soul via `soul_key`.
```json
{
  "type": "agent",
  "items": [
    {
      "slug": "coder-bot",
      "name": "Coder Bot",
      "soul_key": "SOUL_CODER",
      "mode": "HEADLESS",
      "goal": "Executes claimed tasks in isolation",
      "start_conditions": {
        "task_status": "READY",
        "max_risk_level": "MEDIUM",
        "max_concurrency": 1
      },
      "stop_conditions": {
        "on_failure": "AWAITING_REVIEW",
        "timeout_seconds": 900
      },
      "runner": "opencode",
      "enabled": true
    }
  ]
}
```
`soul_key` must reference a resource with `kind="soul"`; the request is rejected otherwise.
Scheduled agents are not dispatched yet (`schedule` is reserved).

### 2.6 Soul (Persona Resource)
A soul is a resource with `kind="soul"`. Its markdown body is the persona and workflow
narrative; its optional YAML frontmatter declares the skills it composes.
```json
{
  "type": "resource",
  "items": [
    {
      "project_slug": "zenf",
      "key": "SOUL_DEBUGGER",
      "slug": "debugger",
      "kind": "soul",
      "type": "GUIDE",
      "scope": "PROJECT",
      "title": "Debugger Soul",
      "format": "markdown",
      "content": "---\nname: debugger\nskills: [recon, diagnose, tdd]\n---\n\nYou are a debugger. Never patch before reproducing the defect.\nIsolate the smallest failing seam, prove the root cause, then write a failing test."
    }
  ]
}
```

**Skill resolution at claim time**

```text
soul.frontmatter.skills  ∪  task.required_skills
        │
        ├─► gate: ⊆ agent.skills                     (ceiling, never a source)
        └─► ContextPacket.skill_paths  (soul order first, deduplicated)
```

Task skills are additive only: a task can extend a soul's workflow, never remove a step from it.
The agent allowlist is a ceiling, never a source.

---

### 2.7 Resource with an external link
A resource carries either `path` (repository overlay) or `url` (external reference).
```json
{
  "type": "resource",
  "items": [
    {
      "project_slug": "zenf",
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

### 2.8 Attach a file to a resource
Binary payloads never go into `content`. Upload them to the resource:
```bash
curl -F "file=@diagram.png" http://127.0.0.1:1123/api/v1/resources/<resource_id>/files
```
Files are content-addressed (identical bytes are stored once) and served through the
shared artifact route `GET /api/v1/artifacts/{fileId}`.

## 3. `zenf_update`

### 3.1 Task Metadata & Notes
```json
{
  "type": "task",
  "items": [
    {
      "id": "mcp-01",
      "title": "Polymorphic Read Primitive (zenf_find)",
      "priority": "P0",
      "notes": "Verified against sqlite FTS triggers."
    }
  ]
}
```

### 3.2 Plan Archive
```json
{
  "type": "plan",
  "items": [
    {
      "slug": "legacy-plan",
      "archived": true
    }
  ]
}
```

---

## 4. `zenf_delete`

### 4.1 Delete / Cancel Tasks
```json
{
  "type": "task",
  "ids": ["obsolete-01", "obsolete-02"]
}
```

### 4.2 Archive Plan
```json
{
  "type": "plan",
  "ids": ["temporary-plan"]
}
```

---

## 5. `claim_task`

### 5.1 Claim Ready Task
Claims the task atomically and returns a compiled `ContextPacket` containing the resolved soul body, linked plan resources (`scope="PLAN"`), and `skill_paths` (soul skills ∪ task skills). Retrieve individual slice contents with `zenf_find(type="resource", ids=["<KEY>"])`.
```json
{
  "task_id": "mcp-01",
  "worker_id": "worker-runner-1",
  "session_id": "sess-abc123"
}
```
`worker_id` is an optional self-declaration recorded as `claimed_by` for unbound tasks. A task
bound to an agent may only be claimed by that agent, and the recorded `claimed_by` is derived
from the binding — a conflicting `worker_id` is rejected. `claimed_by` is attribution only and
grants no authorization.

---

## 6. `transition_task`

### 6.1 Complete Task
```json
{
  "task_ids": ["mcp-01"],
  "action": "COMPLETE_TASK",
  "context": {
    "summary": "Implemented zenf_find with FTS and ID lookup",
    "artifacts": ["apps/daemon/internal/mcp/tool_find.go"]
  }
}
```

### 6.2 Fail Task
```json
{
  "task_ids": ["mcp-02"],
  "action": "FAIL_TASK",
  "context": {
    "reason": "Integration tests failed under -race",
    "error_details": "panic: unexpected nil pointer at tool_crud.go:88"
  }
}
```

### 6.3 Checkpoint Phase
```json
{
  "task_ids": ["mcp-01"],
  "action": "CHECKPOINT_PHASE",
  "context": {
    "phase_id": "unit-tests",
    "phase_status": "COMPLETED",
    "summary": "Unit tests passing with 100% coverage"
  }
}
```

### 6.4 Request Review (Worker Gate)
```json
{
  "task_ids": ["mcp-02"],
  "action": "REQUEST_REVIEW",
  "context": {
    "reason": "Database migration schema conflict",
    "details": "Table tasks requires new column without breaking backwards compatibility",
    "options": ["A: Add migrations/0002_*.sql step", "B: Reset the dev database only"]
  }
}
```

### 6.5 Resolve Review (Main Agent Gate)
```json
{
  "task_ids": ["mcp-02"],
  "action": "RESOLVE_REVIEW",
  "context": {
    "decision": "A: Add an ordered migration step"
  }
}
```

### 6.6 Reset to Ready
```json
{
  "task_ids": ["mcp-01"],
  "action": "RESET_TO_READY",
  "context": {
    "reason": "Worker timeout after 15m idle"
  }
}
```

### 6.7 Cancel Task
```json
{
  "task_ids": ["mcp-99"],
  "action": "CANCEL_TASK",
  "context": {
    "reason": "Superseded by architectural decision ADR-014"
  }
}
```
