package adaptor

import (
	"encoding/json"
	"fmt"
	"strings"
)

// OpenCodeAdaptor implements ToolAdaptor for OpenCode CLI.
type OpenCodeAdaptor struct{}

func NewOpenCodeAdaptor() *OpenCodeAdaptor {
	return &OpenCodeAdaptor{}
}

func (o *OpenCodeAdaptor) Type() ToolType {
	return ToolOpenCode
}

func (o *OpenCodeAdaptor) Matches(runnerCmd string) bool {
	fields := strings.Fields(runnerCmd)
	if len(fields) == 0 {
		return false
	}
	bin := strings.ToLower(fields[0])
	return bin == "opencode" || strings.HasSuffix(bin, "/opencode")
}

func (o *OpenCodeAdaptor) BuildCommand(spec ExecutionSpec) CommandSpec {
	prompt := spec.Prompt
	if prompt == "" {
		prompt = spec.Title
	}

	// Custom template support
	if strings.Contains(spec.RunnerTemplate, "{prompt}") {
		cmdStr := spec.RunnerTemplate
		cmdStr = strings.ReplaceAll(cmdStr, "{prompt}", escapeShellArg(prompt))
		cmdStr = strings.ReplaceAll(cmdStr, "{task_id}", spec.TaskID)
		cmdStr = strings.ReplaceAll(cmdStr, "{worktree}", spec.WorkDir)

		if !strings.Contains(cmdStr, "--format") {
			cmdStr += " --format json"
		}
		if !strings.Contains(cmdStr, "--auto") {
			cmdStr += " --auto"
		}
		if !strings.Contains(cmdStr, "--standalone") {
			cmdStr += " --standalone"
		}

		return CommandSpec{
			ToolType: ToolOpenCode,
			Binary:   "opencode",
			ShellCmd: cmdStr,
		}
	}

	// Canonical Scout Archetype:
	// opencode run --format json --auto --standalone "<prompt>"
	args := []string{
		"run",
		"--format", "json",
		"--auto",
		"--standalone",
		prompt,
	}

	shellCmd := fmt.Sprintf(
		"opencode run --format json --auto --standalone %s",
		quoteShellArg(prompt),
	)

	return CommandSpec{
		ToolType: ToolOpenCode,
		Binary:   "opencode",
		Args:     args,
		ShellCmd: shellCmd,
	}
}

// OpenCode NDJSON event schema
type openCodeStreamEvent struct {
	Type      string           `json:"type"`
	SessionID string           `json:"session_id,omitempty"`
	StepIndex int              `json:"step_index,omitempty"`
	Text      string           `json:"text,omitempty"`
	Tool      string           `json:"tool,omitempty"`
	Status    string           `json:"status,omitempty"`
	Usage     *openCodeUsage   `json:"usage,omitempty"`
}

type openCodeUsage struct {
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	CostUSD          float64 `json:"cost_usd"`
}

func (o *OpenCodeAdaptor) FormatLine(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "{") || !strings.HasSuffix(trimmed, "}") || !strings.Contains(trimmed, `"type":`) {
		return "", false
	}

	var evt openCodeStreamEvent
	if err := json.Unmarshal([]byte(trimmed), &evt); err != nil || evt.Type == "" {
		return "", false
	}

	switch evt.Type {
	case "step_start":
		return fmt.Sprintf("\x1b[36m[opencode] Step %d started\x1b[0m\r\n", evt.StepIndex), true

	case "tool_use":
		if evt.Status == "completed" {
			return fmt.Sprintf("\x1b[32m✔ opencode tool completed: %s\x1b[0m\r\n", evt.Tool), true
		}
		return fmt.Sprintf("\x1b[38;5;141m> opencode tool: %s\x1b[0m\r\n", evt.Tool), true

	case "text":
		if evt.Text != "" {
			delta := strings.ReplaceAll(evt.Text, "\r\n", "\n")
			delta = strings.ReplaceAll(delta, "\n", "\r\n")
			return delta, true
		}
		return "", true

	case "step_finish":
		if evt.Usage != nil {
			totalTokens := evt.Usage.PromptTokens + evt.Usage.CompletionTokens
			return fmt.Sprintf("\r\n\x1b[1;32m✔ opencode step finished (tokens: %d, cost: $%0.4f)\x1b[0m\r\n",
				totalTokens, evt.Usage.CostUSD), true
		}
		return "\r\n\x1b[1;32m✔ opencode step finished\x1b[0m\r\n", true
	}

	return "", false
}
