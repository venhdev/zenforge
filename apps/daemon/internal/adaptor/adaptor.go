package adaptor

import (
	"strings"
)

// ToolType uniquely identifies a recognized agent or CLI tool archetype.
type ToolType string

const (
	ToolAgy      ToolType = "agy"
	ToolClaude   ToolType = "claude"
	ToolOpenCode ToolType = "opencode"
	ToolCodex    ToolType = "codex"
	ToolCopilot  ToolType = "copilot"
	ToolGeneric  ToolType = "generic"
)

// ExecutionSpec encapsulates all runtime and task parameters required to
// assemble a safe, verified headless execution command.
type ExecutionSpec struct {
	TaskID         string
	Title          string
	Prompt         string
	WorkDir        string
	TimeoutSeconds int
	RunnerTemplate string // Custom runner string or preset from agent definition
	ExtraArgs      []string
}

// CommandSpec describes the assembled command ready for execution.
type CommandSpec struct {
	ToolType ToolType
	Binary   string
	Args     []string
	Env      []string
	ShellCmd string // Full shell command string with properly escaped arguments
}

// ToolAdaptor defines the flexible lifecycle interface for headless agent tools.
// Adaptors can easily be added, updated, or replaced as CLI tool capabilities evolve.
type ToolAdaptor interface {
	// Type returns the identifier for this tool adaptor.
	Type() ToolType

	// Matches determines if a runner command or binary string maps to this adaptor.
	Matches(runnerCmd string) bool

	// BuildCommand builds the optimal, scout-verified headless flags and command line.
	BuildCommand(spec ExecutionSpec) CommandSpec

	// FormatLine translates an NDJSON event or tool stdout line into ANSI-formatted text.
	// Returns formatted output and true if the line was handled by this adaptor.
	FormatLine(line string) (formatted string, handled bool)
}

// Registry manages the set of available tool adaptors and provides lookup capabilities.
type Registry struct {
	adaptors []ToolAdaptor
}

// NewRegistry constructs a Registry populated with all scouted and generic adaptors.
func NewRegistry() *Registry {
	r := &Registry{}
	r.Register(NewAgyAdaptor())
	r.Register(NewClaudeAdaptor())
	r.Register(NewOpenCodeAdaptor())
	r.Register(NewCodexAdaptor())
	r.Register(NewCopilotAdaptor())
	r.Register(NewGenericAdaptor())
	return r
}

// Register appends an adaptor to the registry.
func (r *Registry) Register(adaptor ToolAdaptor) {
	if adaptor == nil {
		return
	}
	r.adaptors = append(r.adaptors, adaptor)
}

// Resolve finds the matching ToolAdaptor for the given runner command.
// If no specific tool matches, it returns the GenericAdaptor.
func (r *Registry) Resolve(runnerCmd string) ToolAdaptor {
	trimmed := strings.TrimSpace(runnerCmd)
	for _, a := range r.adaptors {
		if a.Matches(trimmed) {
			return a
		}
	}
	return NewGenericAdaptor()
}

// FormatLine tries each registered adaptor in priority order to parse and format
// structured NDJSON events. If no adaptor handles the line, it returns (line, false).
func (r *Registry) FormatLine(line string) (string, bool) {
	for _, a := range r.adaptors {
		if formatted, handled := a.FormatLine(line); handled {
			return formatted, true
		}
	}
	return "", false
}

// Global default registry instance for easy reuse across daemon workers.
var defaultRegistry = NewRegistry()

// DefaultRegistry returns the singleton registry with all standard tool adaptors.
func DefaultRegistry() *Registry {
	return defaultRegistry
}
