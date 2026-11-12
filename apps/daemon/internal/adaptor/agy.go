package adaptor

import (
	"encoding/json"
	"fmt"
	"strings"
)

// AgyAdaptor implements ToolAdaptor for Google Antigravity CLI (agy).
type AgyAdaptor struct{}

func NewAgyAdaptor() *AgyAdaptor {
	return &AgyAdaptor{}
}

func (a *AgyAdaptor) Type() ToolType {
	return ToolAgy
}

func (a *AgyAdaptor) Matches(runnerCmd string) bool {
	fields := strings.Fields(runnerCmd)
	if len(fields) == 0 {
		return false
	}
	bin := strings.ToLower(fields[0])
	return bin == "agy" || strings.HasSuffix(bin, "/agy") || bin == "gemini" || strings.HasSuffix(bin, "/gemini")
}

func (a *AgyAdaptor) BuildCommand(spec ExecutionSpec) CommandSpec {
	timeout := spec.TimeoutSeconds
	if timeout <= 0 {
		timeout = 900 // 15m default
	}

	prompt := spec.Prompt
	if prompt == "" {
		prompt = spec.Title
	}

	// If user provided a full custom template containing flags and interpolation tokens
	if strings.Contains(spec.RunnerTemplate, "{prompt}") {
		cmdStr := spec.RunnerTemplate
		cmdStr = strings.ReplaceAll(cmdStr, "{prompt}", escapeShellArg(prompt))
		cmdStr = strings.ReplaceAll(cmdStr, "{task_id}", spec.TaskID)
		cmdStr = strings.ReplaceAll(cmdStr, "{worktree}", spec.WorkDir)
		cmdStr = strings.ReplaceAll(cmdStr, "{timeout}", fmt.Sprintf("%d", timeout))

		// Ensure essential headless flags are not inadvertently omitted
		if !strings.Contains(cmdStr, "--output-format") {
			cmdStr += " --output-format stream-json"
		}
		if !strings.Contains(cmdStr, "--dangerously-skip-permissions") && !strings.Contains(cmdStr, "--skip-permissions") {
			cmdStr += " --dangerously-skip-permissions"
		}
		if !strings.Contains(cmdStr, "--mode") {
			cmdStr += " --mode auto"
		}
		if !strings.Contains(cmdStr, "--print-timeout") {
			cmdStr += fmt.Sprintf(" --print-timeout %ds", timeout)
		}

		return CommandSpec{
			ToolType: ToolAgy,
			Binary:   "agy",
			ShellCmd: cmdStr,
		}
	}

	// Canonical Scout Archetype: agy -p "<prompt>" --output-format stream-json --dangerously-skip-permissions --mode auto --print-timeout <dur>s
	args := []string{
		"-p", prompt,
		"--output-format", "stream-json",
		"--dangerously-skip-permissions",
		"--mode", "auto",
		"--print-timeout", fmt.Sprintf("%ds", timeout),
	}

	shellCmd := fmt.Sprintf(
		"agy -p %s --output-format stream-json --dangerously-skip-permissions --mode auto --print-timeout %ds",
		quoteShellArg(prompt),
		timeout,
	)

	return CommandSpec{
		ToolType: ToolAgy,
		Binary:   "agy",
		Args:     args,
		ShellCmd: shellCmd,
	}
}

// Agy NDJSON event schema
type agyStreamEvent struct {
	Event      string            `json:"event"`
	Init       *agyInitPayload   `json:"init,omitempty"`
	StepUpdate *agyStepPayload   `json:"step_update,omitempty"`
	Result     *agyResultPayload `json:"result,omitempty"`
}

type agyInitPayload struct {
	Cwd   string   `json:"cwd"`
	Tools []string `json:"tools"`
}

type agyStepPayload struct {
	StepIndex       int             `json:"step_index"`
	State           string          `json:"state"`
	StepType        string          `json:"step_type"`
	TextDelta       string          `json:"text_delta,omitempty"`
	ToolName        string          `json:"tool_name,omitempty"`
	ToolInfo        json.RawMessage `json:"tool_info,omitempty"`
	DurationSeconds float64         `json:"duration_seconds,omitempty"`
}

type agyResultPayload struct {
	Status          string    `json:"status"`
	Response        string    `json:"response"`
	DurationSeconds float64   `json:"duration_seconds"`
	Usage           *agyUsage `json:"usage,omitempty"`
}

type agyUsage struct {
	InputTokens    int `json:"input_tokens"`
	OutputTokens   int `json:"output_tokens"`
	ThinkingTokens int `json:"thinking_tokens"`
	TotalTokens    int `json:"total_tokens"`
}

func (a *AgyAdaptor) FormatLine(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "{") || !strings.HasSuffix(trimmed, "}") || !strings.Contains(trimmed, `"event":`) {
		return "", false
	}

	var evt agyStreamEvent
	if err := json.Unmarshal([]byte(trimmed), &evt); err != nil || evt.Event == "" {
		return "", false
	}

	switch evt.Event {
	case "init":
		if evt.Init != nil {
			return fmt.Sprintf("\x1b[36m[agy] Session initialized (tools: %d, cwd: %s)\x1b[0m\r\n", len(evt.Init.Tools), evt.Init.Cwd), true
		}
		return "\x1b[36m[agy] Session initialized\x1b[0m\r\n", true

	case "step_update":
		if evt.StepUpdate == nil {
			return "", true
		}
		step := evt.StepUpdate
		if step.StepType == "tool" {
			if step.State == "ACTIVE" {
				return fmt.Sprintf("\x1b[38;5;141m> agy tool: %s\x1b[0m\r\n", step.ToolName), true
			}
			if step.State == "DONE" {
				if step.DurationSeconds > 0 {
					return fmt.Sprintf("\x1b[32m✔ agy tool completed (%0.2fs)\x1b[0m\r\n", step.DurationSeconds), true
				}
				return "\x1b[32m✔ agy tool completed\x1b[0m\r\n", true
			}
		}
		if step.StepType == "agent_response" && step.TextDelta != "" {
			delta := strings.ReplaceAll(step.TextDelta, "\r\n", "\n")
			delta = strings.ReplaceAll(delta, "\n", "\r\n")
			return delta, true
		}
		return "", true

	case "result":
		if evt.Result != nil {
			res := evt.Result
			tokens := 0
			if res.Usage != nil {
				tokens = res.Usage.TotalTokens
			}
			if res.Status == "SUCCESS" {
				return fmt.Sprintf("\r\n\x1b[1;32m✔ agy completed successfully (%0.2fs, tokens: %d)\x1b[0m\r\n", res.DurationSeconds, tokens), true
			}
			return fmt.Sprintf("\r\n\x1b[1;31m✖ agy execution failed (status: %s)\x1b[0m\r\n", res.Status), true
		}
		return "", true
	}

	return "", false
}
