package domain

import (
	"fmt"
	"time"
)

type AgentMode string

const (
	AgentModeHeadless    AgentMode = "HEADLESS"
	AgentModeInteractive AgentMode = "INTERACTIVE"
)

func (m AgentMode) IsValid() bool {
	return m == AgentModeHeadless || m == AgentModeInteractive
}

// AgentStartConditions defines the typed predicate gate evaluated before an agent
// is dispatched to claim and execute a task.
type AgentStartConditions struct {
	TaskStatus     TaskStatus     `json:"task_status,omitempty"`
	MaxRiskLevel   TaskRisk       `json:"max_risk_level,omitempty"`
	MaxComplexity  TaskComplexity `json:"max_complexity,omitempty"`
	MaxConcurrency int            `json:"max_concurrency,omitempty"`
}

// AgentStopConditions defines failure and circuit breaker policies for agent execution.
type AgentStopConditions struct {
	OnFailure      string `json:"on_failure,omitempty"` // "AWAITING_REVIEW" | "FAIL"
	TimeoutSeconds int    `json:"timeout_seconds,omitempty"`
}

// Agent is a reusable worker definition: a dispatch contract with typed
// start/stop gates and a runner template. It carries no persona text; the
// persona and workflow live in the soul resource referenced by SoulKey.
type Agent struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
	// SoulKey references exactly one resource with Kind == ResourceKindSoul.
	// Empty means no persona context is injected; one soul may back many agents.
	SoulKey string `json:"soul_key,omitempty"`
	// Mode is RESERVED. HEADLESS/INTERACTIVE dispatch is not implemented yet;
	// nothing reads this field to alter execution.
	Mode AgentMode `json:"mode"`
	// Goal is DISPLAY-only: it surfaces in the cockpit and never alters the
	// compiled prompt. Persona behaviour comes from the soul body.
	Goal            string               `json:"goal,omitempty"`
	StartConditions AgentStartConditions `json:"start_conditions"`
	StopConditions  AgentStopConditions  `json:"stop_conditions"`
	// Schedule is RESERVED. No scheduler consumes it yet.
	Schedule string `json:"schedule,omitempty"`
	// Skills is an execution ceiling, never a source: it can restrict which
	// skills a task may load, but cannot add skills the task did not ask for.
	Skills    []string  `json:"skills,omitempty"`
	Runner    string    `json:"runner,omitempty"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (a *Agent) Validate() error {
	if a.Slug == "" {
		return fmt.Errorf("agent slug cannot be empty")
	}
	if a.Name == "" {
		return fmt.Errorf("agent name cannot be empty")
	}
	if a.Mode != "" && !a.Mode.IsValid() {
		return fmt.Errorf("invalid agent mode: %s", a.Mode)
	}
	return nil
}

// AgentPatch carries partial updates. Nil fields are left untouched.
type AgentPatch struct {
	Name            *string
	SoulKey         *string
	Mode            *AgentMode
	Goal            *string
	StartConditions *AgentStartConditions
	StopConditions  *AgentStopConditions
	Schedule        *string
	Skills          *[]string
	Runner          *string
	Enabled         *bool
}
