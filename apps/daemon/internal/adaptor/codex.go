package adaptor

import (
	"encoding/json"
	"fmt"
	"strings"
)

// CodexAdaptor implements ToolAdaptor for OpenAI Codex CLI (`codex`).
type CodexAdaptor struct{}

func NewCodexAdaptor() *CodexAdaptor {
	return &CodexAdaptor{}
}

func (c *CodexAdaptor) Type() ToolType {
	return ToolCodex
}

func (c *CodexAdaptor) Matches(runnerCmd string) bool {
	fields := strings.Fields(runnerCmd)
	if len(fields) == 0 {
		return false
	}
	bin := strings.ToLower(fields[0])
	return bin == "codex" || strings.HasSuffix(bin, "/codex")
}

func (c *CodexAdaptor) BuildCommand(spec ExecutionSpec) CommandSpec {
	prompt := spec.Prompt
	if prompt == "" {
		prompt = spec.Title
	}

	if strings.Contains(spec.RunnerTemplate, "{prompt}") {
		cmdStr := spec.RunnerTemplate
		cmdStr = strings.ReplaceAll(cmdStr, "{prompt}", escapeShellArg(prompt))
		cmdStr = strings.ReplaceAll(cmdStr, "{task_id}", spec.TaskID)
		cmdStr = strings.ReplaceAll(cmdStr, "{worktree}", spec.WorkDir)

		if !strings.Contains(cmdStr, "--json") {
			cmdStr += " --json"
		}
		if !strings.Contains(cmdStr, "--quiet") && !strings.Contains(cmdStr, "-q") {
			cmdStr += " --quiet"
		}

		return CommandSpec{
			ToolType: ToolCodex,
			Binary:   "codex",
			ShellCmd: cmdStr,
		}
	}

	// Canonical Scout Archetype: codex exec "<prompt>" --json --quiet
	args := []string{
		"exec",
		prompt,
		"--json",
		"--quiet",
	}

	shellCmd := fmt.Sprintf(
		"codex exec %s --json --quiet",
		quoteShellArg(prompt),
	)

	return CommandSpec{
		ToolType: ToolCodex,
		Binary:   "codex",
		Args:     args,
		ShellCmd: shellCmd,
	}
}

type codexStreamEvent struct {
	Type    string          `json:"type"`
	Message string          `json:"message,omitempty"`
	Content string          `json:"content,omitempty"`
	Tool    string          `json:"tool,omitempty"`
	Status  string          `json:"status,omitempty"`
}

func (c *CodexAdaptor) FormatLine(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "{") || !strings.HasSuffix(trimmed, "}") || !strings.Contains(trimmed, `"type":`) {
		return "", false
	}

	var evt codexStreamEvent
	if err := json.Unmarshal([]byte(trimmed), &evt); err != nil || evt.Type == "" {
		return "", false
	}

	switch evt.Type {
	case "start", "init":
		return "\x1b[36m[codex] Session initialized\x1b[0m\r\n", true
	case "tool_call", "tool":
		return fmt.Sprintf("\x1b[38;5;141m> codex tool: %s\x1b[0m\r\n", evt.Tool), true
	case "chunk", "text_delta":
		txt := evt.Content
		if txt == "" {
			txt = evt.Message
		}
		if txt != "" {
			delta := strings.ReplaceAll(txt, "\r\n", "\n")
			delta = strings.ReplaceAll(delta, "\n", "\r\n")
			return delta, true
		}
		return "", true
	case "finish", "done":
		return "\r\n\x1b[1;32m✔ codex turn completed\x1b[0m\r\n", true
	}

	return "", false
}

// CopilotAdaptor implements ToolAdaptor for GitHub Copilot CLI (`copilot`).
type CopilotAdaptor struct{}

func NewCopilotAdaptor() *CopilotAdaptor {
	return &CopilotAdaptor{}
}

func (p *CopilotAdaptor) Type() ToolType {
	return ToolCopilot
}

func (p *CopilotAdaptor) Matches(runnerCmd string) bool {
	fields := strings.Fields(runnerCmd)
	if len(fields) == 0 {
		return false
	}
	bin := strings.ToLower(fields[0])
	return bin == "copilot" || strings.HasSuffix(bin, "/copilot") || bin == "gh-copilot"
}

func (p *CopilotAdaptor) BuildCommand(spec ExecutionSpec) CommandSpec {
	prompt := spec.Prompt
	if prompt == "" {
		prompt = spec.Title
	}

	if strings.Contains(spec.RunnerTemplate, "{prompt}") {
		cmdStr := spec.RunnerTemplate
		cmdStr = strings.ReplaceAll(cmdStr, "{prompt}", escapeShellArg(prompt))
		cmdStr = strings.ReplaceAll(cmdStr, "{task_id}", spec.TaskID)
		cmdStr = strings.ReplaceAll(cmdStr, "{worktree}", spec.WorkDir)

		if !strings.Contains(cmdStr, "-s") && !strings.Contains(cmdStr, "--silent") {
			cmdStr += " -s"
		}
		if !strings.Contains(cmdStr, "--no-ask-user") && !strings.Contains(cmdStr, "--allow-all") {
			cmdStr += " --no-ask-user"
		}

		return CommandSpec{
			ToolType: ToolCopilot,
			Binary:   "copilot",
			ShellCmd: cmdStr,
		}
	}

	// Canonical Scout Archetype: copilot -p "<prompt>" -s --no-ask-user
	args := []string{
		"-p", prompt,
		"-s",
		"--no-ask-user",
	}

	shellCmd := fmt.Sprintf(
		"copilot -p %s -s --no-ask-user",
		quoteShellArg(prompt),
	)

	return CommandSpec{
		ToolType: ToolCopilot,
		Binary:   "copilot",
		Args:     args,
		ShellCmd: shellCmd,
	}
}

func (p *CopilotAdaptor) FormatLine(line string) (string, bool) {
	// Copilot in -s print mode emits direct text responses; delegate to normal line ending
	return "", false
}
