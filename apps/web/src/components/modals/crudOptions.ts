export const AUTORUN_TOOLS = [
  {
    id: 'agy',
    name: 'Google Antigravity (agy)',
    description: 'Autonomous runner via agy CLI with stream-json NDJSON telemetry',
    template: 'agy -p "{prompt}" --output-format stream-json --dangerously-skip-permissions --mode auto --print-timeout 900s',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude Code (claude)',
    description: 'Headless Claude Code with print mode and stream-json events',
    template: 'claude -p "{prompt}" --dangerously-skip-permissions --permission-mode dontAsk --output-format stream-json --verbose --include-partial-messages',
  },
  {
    id: 'opencode',
    name: 'OpenCode CLI (opencode)',
    description: 'Non-interactive runner with JSON telemetry and automated permissions',
    template: 'opencode run --format json --auto --standalone "{prompt}"',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex (codex)',
    description: 'Non-interactive Codex CLI execution with JSON progress stream',
    template: 'codex exec "{prompt}" --json --quiet',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot (copilot)',
    description: 'Non-interactive GitHub Copilot CLI in print mode',
    template: 'copilot -p "{prompt}" -s --no-ask-user',
  },
  {
    id: 'custom',
    name: 'Custom Command Runner',
    description: 'User-specified shell template with {prompt}, {task_id}, and {worktree} tokens',
    template: '',
  },
] as const

export type AutorunToolId = (typeof AUTORUN_TOOLS)[number]['id']

export const TASK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
export const TASK_COMPLEXITIES = ['LOW', 'MEDIUM', 'HIGH', 'SPIKE'] as const
export const TASK_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export const TASK_STATUS_OPTIONS = [
  'PENDING',
  'READY',
  'RUNNING',
  'AWAITING_REVIEW',
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
] as const
