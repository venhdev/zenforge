# ZenForge Skills

## Install

```bash
npx skills add venhdev/skills
```

## zenf

`zenf` is the single-binary control plane and multi-agent tracking daemon for ZenForge.

### Install

Install via **ZenCLI**:
```bash
zen i zenforge
```
Or download pre-compiled binaries directly from [GitHub Releases](https://github.com/venhdev/zenforge/releases).

### Build from source

```bash
cd apps/daemon && make build
# Binary is produced at apps/daemon/bin/zenf (and symlinked as zenfd)
```

### CLI Quickstart

```bash
zenf                  # Show quickstart overview and active daemon state
zenf daemon           # Display daemon management commands
zenf daemon start     # Start daemon in foreground
zenf daemon start -d  # Start daemon in background (detached mode)
zenf daemon start -f -d # Force-reclaim port from stale zenf process & start background daemon
zenf daemon stop      # Gracefully stop running background daemon
zenf daemon logs      # Stream live logs from background daemon
zenf status           # Comprehensive status report (daemon runtime + all AI MCP clients)
zenf mcp              # Audit MCP setups & view integration guide (zero hang)
```

Client setup, tool reference, write surfaces, and verification: [MCP.md](MCP.md).

Agent-facing cards:

- [zenf-mcp](skills/zenf-mcp/SKILL.md) — Unified 6-tool MCP tracking plane and task lifecycle.
- [zenf-soul](skills/zenf-soul/SKILL.md) — Operating axioms and execution gates.
- [zenf-init](skills/zenf-init/SKILL.md) — Repository scaffolding and tracking plane setup.
