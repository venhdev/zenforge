package adaptor

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ClaudeAdaptor implements ToolAdaptor for Anthropic Claude Code CLI (claude).
type ClaudeAdaptor struct{}

func NewClaudeAdaptor() *ClaudeAdaptor {
	return &ClaudeAdaptor{}
}

func (c *ClaudeAdaptor) Type() ToolType {
	return ToolClaude
}

func (c *ClaudeAdaptor) Matches(runnerCmd string) bool {
	fields := strings.Fields(runnerCmd)
	if len(fields) == 0 {
		return false
	}
	bin := strings.ToLower(fields[0])
	return bin == "claude" || strings.HasSuffix(bin, "/claude") || bin == "claude-code"
}

func (c *ClaudeAdaptor) BuildCommand(spec ExecutionSpec) CommandSpec {
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

		if !strings.Contains(cmdStr, "--output-format") {
			cmdStr += " --output-format stream-json"
		}
		if !strings.Contains(cmdStr, "--dangerously-skip-permissions") && !strings.Contains(cmdStr, "--skip-permissions") {
			cmdStr += " --dangerously-skip-permissions"
		}
		if !strings.Contains(cmdStr, "--permission-mode") {
			cmdStr += " --permission-mode dontAsk"
		}
		if !strings.Contains(cmdStr, "--verbose") {
			cmdStr += " --verbose"
		}
		if !strings.Contains(cmdStr, "--include-partial-messages") {
			cmdStr += " --include-partial-messages"
		}

		return CommandSpec{
			ToolType: ToolClaude,
			Binary:   "claude",
			ShellCmd: cmdStr,
		}
	}

	// Canonical Scout Archetype:
	// claude -p "<prompt>" --dangerously-skip-permissions --permission-mode dontAsk --output-format stream-json --verbose --include-partial-messages
	args := []string{
		"-p", prompt,
		"--dangerously-skip-permissions",
		"--permission-mode", "dontAsk",
		"--output-format", "stream-json",
		"--verbose",
		"--include-partial-messages",
	}

	shellCmd := fmt.Sprintf(
		"claude -p %s --dangerously-skip-permissions --permission-mode dontAsk --output-format stream-json --verbose --include-partial-messages",
		quoteShellArg(prompt),
	)

	return CommandSpec{
		ToolType: ToolClaude,
		Binary:   "claude",
		Args:     args,
		ShellCmd: shellCmd,
	}
}

// Claude NDJSON event schemas
type claudeStreamEvent struct {
	Type         string                `json:"type"`
	Subtype      string                `json:"subtype,omitempty"`
	Message      *claudeMessage        `json:"message,omitempty"`
	ContentBlock *claudeContentBlock   `json:"content_block,omitempty"`
	Delta        *claudeDelta          `json:"delta,omitempty"`
	Usage        *claudeUsage          `json:"usage,omitempty"`
}

type claudeMessage struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

type claudeContentBlock struct {
	Type  string          `json:"type"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
}

type claudeDelta struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type claudeUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

func (c *ClaudeAdaptor) FormatLine(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "{") || !strings.HasSuffix(trimmed, "}") || !strings.Contains(trimmed, `"type":`) {
		return "", false
	}

	var evt claudeStreamEvent
	if err := json.Unmarshal([]byte(trimmed), &evt); err != nil || evt.Type == "" {
		return "", false
	}

	switch evt.Type {
	case "message_start":
		return "\x1b[36m[claude] Session initialized\x1b[0m\r\n", true

	case "content_block_start":
		if evt.ContentBlock != nil && evt.ContentBlock.Type == "tool_use" {
			return fmt.Sprintf("\x1b[38;5;141m> claude tool: %s\x1b[0m\r\n", evt.ContentBlock.Name), true
		}
		return "", true

	case "content_block_delta":
		if evt.Delta != nil && evt.Delta.Text != "" {
			delta := strings.ReplaceAll(evt.Delta.Text, "\r\n", "\n")
			delta = strings.ReplaceAll(delta, "\n", "\r\n")
			return delta, true
		}
		return "", true

	case "content_block_stop":
		return "", true

	case "message_delta":
		if evt.Usage != nil {
			return fmt.Sprintf("\r\n\x1b[32m✔ claude turn completed (tokens: %d)\x1b[0m\r\n", evt.Usage.OutputTokens), true
		}
		return "", true

	case "message_stop":
		return "", true
	}

	return "", false
}
