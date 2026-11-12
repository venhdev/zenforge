package adaptor

import (
	"fmt"
	"strings"
)

// GenericAdaptor provides a fallback execution adaptor for standard POSIX/Windows shell
// commands, custom tool wrappers, or direct verification scripts.
type GenericAdaptor struct{}

func NewGenericAdaptor() *GenericAdaptor {
	return &GenericAdaptor{}
}

func (g *GenericAdaptor) Type() ToolType {
	return ToolGeneric
}

func (g *GenericAdaptor) Matches(runnerCmd string) bool {
	// Fallback matches everything not claimed by specific adaptors
	return true
}

func (g *GenericAdaptor) BuildCommand(spec ExecutionSpec) CommandSpec {
	timeout := spec.TimeoutSeconds
	if timeout <= 0 {
		timeout = 900
	}

	prompt := spec.Prompt
	if prompt == "" {
		prompt = spec.Title
	}

	var cmdStr string
	if strings.TrimSpace(spec.RunnerTemplate) != "" {
		tmpl := spec.RunnerTemplate
		tmpl = strings.ReplaceAll(tmpl, "{prompt}", escapeShellArg(prompt))
		tmpl = strings.ReplaceAll(tmpl, "{task_id}", spec.TaskID)
		tmpl = strings.ReplaceAll(tmpl, "{worktree}", spec.WorkDir)
		tmpl = strings.ReplaceAll(tmpl, "{timeout}", fmt.Sprintf("%d", timeout))
		cmdStr = tmpl
	} else if len(spec.ExtraArgs) > 0 {
		cmdStr = strings.Join(spec.ExtraArgs, " && ")
	} else {
		cmdStr = "echo 'auto_run: task execution completed (no verification commands defined)'"
	}

	return CommandSpec{
		ToolType: ToolGeneric,
		Binary:   "sh",
		ShellCmd: cmdStr,
	}
}

func (g *GenericAdaptor) FormatLine(line string) (string, bool) {
	// Generic shell output is normal terminal text; formatLine returns false so StreamFormatter normalizes CRLF
	return "", false
}
