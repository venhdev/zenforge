package worker_test

import (
	"strings"
	"testing"

	"zenf/internal/worker"
)

func TestStreamFormatter_RawLinePassthrough(t *testing.T) {
	formatter := worker.NewStreamFormatter()

	out := formatter.FormatLine("echo 'hello world'")
	expected := "echo 'hello world'\r\n"
	if out != expected {
		t.Errorf("expected %q, got %q", expected, out)
	}
}

func TestStreamFormatter_AgyNDJSONEvents(t *testing.T) {
	formatter := worker.NewStreamFormatter()

	// 1. Init event
	initJSON := `{"event":"init","init":{"cwd":"/home/dev/src","tools":["run_command","read_file"]}}`
	outInit := formatter.FormatLine(initJSON)
	if !strings.Contains(outInit, "[agy] Session initialized") || !strings.Contains(outInit, "tools: 2") {
		t.Errorf("unexpected init formatting: %q", outInit)
	}

	// 2. Active tool event
	toolActive := `{"event":"step_update","step_update":{"state":"ACTIVE","step_type":"tool","tool_name":"run_command"}}`
	outToolActive := formatter.FormatLine(toolActive)
	if !strings.Contains(outToolActive, "> agy tool: run_command") {
		t.Errorf("unexpected active tool formatting: %q", outToolActive)
	}

	// 3. Completed tool event
	toolDone := `{"event":"step_update","step_update":{"state":"DONE","step_type":"tool","tool_name":"run_command","duration_seconds":1.24}}`
	outToolDone := formatter.FormatLine(toolDone)
	if !strings.Contains(outToolDone, "✔ agy tool completed (1.24s)") {
		t.Errorf("unexpected completed tool formatting: %q", outToolDone)
	}

	// 4. Agent response streaming delta
	delta := `{"event":"step_update","step_update":{"state":"ACTIVE","step_type":"agent_response","text_delta":"Processing task..."}}`
	outDelta := formatter.FormatLine(delta)
	if outDelta != "Processing task..." {
		t.Errorf("unexpected text delta: %q", outDelta)
	}

	// 5. Success Result event
	result := `{"event":"result","result":{"status":"SUCCESS","duration_seconds":5.4,"usage":{"total_tokens":1250}}}`
	outResult := formatter.FormatLine(result)
	if !strings.Contains(outResult, "✔ agy completed successfully") || !strings.Contains(outResult, "tokens: 1250") {
		t.Errorf("unexpected result formatting: %q", outResult)
	}
}

func TestStreamFormatter_MultiToolNDJSON(t *testing.T) {
	formatter := worker.NewStreamFormatter()

	// Claude Code tool
	claudeTool := `{"type":"content_block_start","content_block":{"type":"tool_use","name":"Bash"}}`
	outClaude := formatter.FormatLine(claudeTool)
	if !strings.Contains(outClaude, "> claude tool: Bash") {
		t.Errorf("expected claude tool formatting, got %q", outClaude)
	}

	// OpenCode step start & finish
	ocStep := `{"type":"step_start","step_index":1}`
	outOC := formatter.FormatLine(ocStep)
	if !strings.Contains(outOC, "[opencode] Step 1 started") {
		t.Errorf("expected opencode step formatting, got %q", outOC)
	}

	ocFinish := `{"type":"step_finish","usage":{"prompt_tokens":100,"completion_tokens":50,"cost_usd":0.005}}`
	outFinish := formatter.FormatLine(ocFinish)
	if !strings.Contains(outFinish, "opencode step finished") || !strings.Contains(outFinish, "tokens: 150") {
		t.Errorf("expected opencode finish formatting, got %q", outFinish)
	}
}
