package adaptor_test

import (
	"strings"
	"testing"

	"zenf/internal/adaptor"
)

func TestRegistry_Resolve(t *testing.T) {
	reg := adaptor.DefaultRegistry()

	tests := []struct {
		runnerCmd string
		wantType  adaptor.ToolType
	}{
		{"agy", adaptor.ToolAgy},
		{"/usr/local/bin/agy -p 'hi'", adaptor.ToolAgy},
		{"gemini -p 'hi'", adaptor.ToolAgy},
		{"claude", adaptor.ToolClaude},
		{"/home/dev/.local/bin/claude", adaptor.ToolClaude},
		{"opencode run 'fix'", adaptor.ToolOpenCode},
		{"/usr/bin/opencode", adaptor.ToolOpenCode},
		{"codex exec 'test'", adaptor.ToolCodex},
		{"copilot -p 'review'", adaptor.ToolCopilot},
		{"sh -c 'echo 1'", adaptor.ToolGeneric},
		{"python test.py", adaptor.ToolGeneric},
	}

	for _, tt := range tests {
		ad := reg.Resolve(tt.runnerCmd)
		if ad.Type() != tt.wantType {
			t.Errorf("Resolve(%q) = %v, want %v", tt.runnerCmd, ad.Type(), tt.wantType)
		}
	}
}

func TestAgyAdaptor_BuildCommandAndFormatLine(t *testing.T) {
	ad := adaptor.NewAgyAdaptor()

	spec := adaptor.ExecutionSpec{
		TaskID:         "TASK-01",
		Title:          "Agy Research",
		Prompt:         "Analyze codebase architecture",
		TimeoutSeconds: 600,
	}

	cmd := ad.BuildCommand(spec)
	if !strings.Contains(cmd.ShellCmd, "--output-format stream-json") {
		t.Errorf("expected --output-format stream-json in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--dangerously-skip-permissions") {
		t.Errorf("expected --dangerously-skip-permissions in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--mode auto") {
		t.Errorf("expected --mode auto in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--print-timeout 600s") {
		t.Errorf("expected --print-timeout 600s in %s", cmd.ShellCmd)
	}

	// Test stream formatting
	initLine := `{"event":"init","init":{"cwd":"/workspace","tools":["read_file","write_file"]}}`
	formatted, handled := ad.FormatLine(initLine)
	if !handled || !strings.Contains(formatted, "[agy] Session initialized") {
		t.Errorf("expected agy session init formatted, got %q (handled=%v)", formatted, handled)
	}

	toolLine := `{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"tool","tool_name":"read_file"}}`
	formatted, handled = ad.FormatLine(toolLine)
	if !handled || !strings.Contains(formatted, "> agy tool: read_file") {
		t.Errorf("expected tool active formatted, got %q", formatted)
	}

	resultLine := `{"event":"result","result":{"status":"SUCCESS","duration_seconds":3.5,"usage":{"total_tokens":420}}}`
	formatted, handled = ad.FormatLine(resultLine)
	if !handled || !strings.Contains(formatted, "completed successfully") || !strings.Contains(formatted, "tokens: 420") {
		t.Errorf("expected result formatted, got %q", formatted)
	}
}

func TestClaudeAdaptor_BuildCommandAndFormatLine(t *testing.T) {
	ad := adaptor.NewClaudeAdaptor()

	spec := adaptor.ExecutionSpec{
		TaskID: "TASK-CLAUDE",
		Title:  "Fix Typos",
		Prompt: "Fix spelling in docs",
	}

	cmd := ad.BuildCommand(spec)
	if !strings.Contains(cmd.ShellCmd, "--dangerously-skip-permissions") {
		t.Errorf("missing --dangerously-skip-permissions in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--permission-mode dontAsk") {
		t.Errorf("missing --permission-mode dontAsk in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--output-format stream-json") {
		t.Errorf("missing --output-format stream-json in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--verbose") {
		t.Errorf("missing --verbose in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--include-partial-messages") {
		t.Errorf("missing --include-partial-messages in %s", cmd.ShellCmd)
	}

	// Test Claude NDJSON stream
	initLine := `{"type":"message_start","message":{"id":"msg_123","role":"assistant"}}`
	formatted, handled := ad.FormatLine(initLine)
	if !handled || !strings.Contains(formatted, "[claude] Session initialized") {
		t.Errorf("expected claude init, got %q (handled=%v)", formatted, handled)
	}

	toolLine := `{"type":"content_block_start","content_block":{"type":"tool_use","name":"Bash"}}`
	formatted, handled = ad.FormatLine(toolLine)
	if !handled || !strings.Contains(formatted, "> claude tool: Bash") {
		t.Errorf("expected claude tool, got %q", formatted)
	}

	deltaLine := `{"type":"content_block_delta","delta":{"type":"text_delta","text":"Refactoring complete\n"}}`
	formatted, handled = ad.FormatLine(deltaLine)
	if !handled || !strings.Contains(formatted, "Refactoring complete") {
		t.Errorf("expected claude delta, got %q", formatted)
	}
}

func TestOpenCodeAdaptor_BuildCommandAndFormatLine(t *testing.T) {
	ad := adaptor.NewOpenCodeAdaptor()

	spec := adaptor.ExecutionSpec{
		TaskID: "TASK-OC",
		Title:  "OpenCode Test",
		Prompt: "Implement feature X",
	}

	cmd := ad.BuildCommand(spec)
	if !strings.Contains(cmd.ShellCmd, "opencode run") {
		t.Errorf("missing opencode run in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--format json") {
		t.Errorf("missing --format json in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--auto") {
		t.Errorf("missing --auto in %s", cmd.ShellCmd)
	}
	if !strings.Contains(cmd.ShellCmd, "--standalone") {
		t.Errorf("missing --standalone in %s", cmd.ShellCmd)
	}

	// Test OpenCode NDJSON stream
	stepStart := `{"type":"step_start","step_index":2}`
	formatted, handled := ad.FormatLine(stepStart)
	if !handled || !strings.Contains(formatted, "[opencode] Step 2 started") {
		t.Errorf("expected opencode step start, got %q", formatted)
	}

	toolLine := `{"type":"tool_use","tool":"bash","status":"completed"}`
	formatted, handled = ad.FormatLine(toolLine)
	if !handled || !strings.Contains(formatted, "opencode tool completed: bash") {
		t.Errorf("expected opencode tool completed, got %q", formatted)
	}

	finishLine := `{"type":"step_finish","usage":{"prompt_tokens":100,"completion_tokens":50,"cost_usd":0.0025}}`
	formatted, handled = ad.FormatLine(finishLine)
	if !handled || !strings.Contains(formatted, "tokens: 150") || !strings.Contains(formatted, "0.0025") {
		t.Errorf("expected opencode finish, got %q", formatted)
	}
}

func TestCodexAndCopilotAdaptors(t *testing.T) {
	codex := adaptor.NewCodexAdaptor()
	codexCmd := codex.BuildCommand(adaptor.ExecutionSpec{Prompt: "generate unit tests"})
	if !strings.Contains(codexCmd.ShellCmd, "codex exec") || !strings.Contains(codexCmd.ShellCmd, "--json") || !strings.Contains(codexCmd.ShellCmd, "--quiet") {
		t.Errorf("unexpected codex command: %s", codexCmd.ShellCmd)
	}

	copilot := adaptor.NewCopilotAdaptor()
	copilotCmd := copilot.BuildCommand(adaptor.ExecutionSpec{Prompt: "refactor service"})
	if !strings.Contains(copilotCmd.ShellCmd, "copilot -p") || !strings.Contains(copilotCmd.ShellCmd, "-s") || !strings.Contains(copilotCmd.ShellCmd, "--no-ask-user") {
		t.Errorf("unexpected copilot command: %s", copilotCmd.ShellCmd)
	}
}
