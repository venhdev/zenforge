package domain

import (
	"fmt"
	"strings"
)

// PredicateEvaluationResult represents the outcome of evaluating a task against an agent's gate.
type PredicateEvaluationResult struct {
	Passed bool
	Reason string
}

// TypedPredicateEngine evaluates whether a task satisfies the structured start conditions
// of an agent before claiming and dispatching execution.
type TypedPredicateEngine struct{}

// NewTypedPredicateEngine creates a new TypedPredicateEngine.
func NewTypedPredicateEngine() *TypedPredicateEngine {
	return &TypedPredicateEngine{}
}

// Evaluate performs a strict verification of task invariants and agent start conditions.
func (e *TypedPredicateEngine) Evaluate(task Task, agent *Agent, currentAgentClaims int, soulSkills []string) PredicateEvaluationResult {
	// 1. Task status must strictly be READY
	if task.Status != StatusReady {
		return PredicateEvaluationResult{
			Passed: false,
			Reason: fmt.Sprintf("task status %s is not READY", task.Status),
		}
	}

	// 2. Dependencies graph must not be corrupt
	if task.DependenciesCorrupt {
		return PredicateEvaluationResult{
			Passed: false,
			Reason: "task has malformed or unresolved dependencies",
		}
	}

	// Fail closed when the task is bound to an agent that no longer exists.
	// Silently running without gates would drop every capability ceiling.
	if task.AgentSlug != "" && agent == nil {
		return PredicateEvaluationResult{
			Passed: false,
			Reason: fmt.Sprintf("assigned agent %q not found; refusing to run ungated", task.AgentSlug),
		}
	}

	// Unassigned tasks use standard auto-run defaults.
	if agent == nil {
		return PredicateEvaluationResult{Passed: true}
	}

	// If agent is explicitly disabled, forbid dispatch
	if !agent.Enabled {
		return PredicateEvaluationResult{
			Passed: false,
			Reason: fmt.Sprintf("agent %s is disabled", agent.Slug),
		}
	}

	cond := agent.StartConditions

	// 3. Expected status check (if specified)
	if cond.TaskStatus != "" && cond.TaskStatus != task.Status {
		return PredicateEvaluationResult{
			Passed: false,
			Reason: fmt.Sprintf("task status %s does not match required agent status %s", task.Status, cond.TaskStatus),
		}
	}

	// 5. Concurrency limit check
	if cond.MaxConcurrency > 0 && currentAgentClaims >= cond.MaxConcurrency {
		return PredicateEvaluationResult{
			Passed: false,
			Reason: fmt.Sprintf("agent %s reached max concurrency limit (%d/%d)", agent.Slug, currentAgentClaims, cond.MaxConcurrency),
		}
	}

	// 6. Max risk level check
	if cond.MaxRiskLevel != "" {
		taskRiskRank := riskRank(task.RiskLevel)
		maxRiskRank := riskRank(cond.MaxRiskLevel)
		if taskRiskRank > maxRiskRank {
			return PredicateEvaluationResult{
				Passed: false,
				Reason: fmt.Sprintf("task risk %s exceeds agent ceiling %s", task.RiskLevel, cond.MaxRiskLevel),
			}
		}
	}

	// 7. Max complexity check
	if cond.MaxComplexity != "" {
		taskCompRank := complexityRank(task.Complexity)
		maxCompRank := complexityRank(cond.MaxComplexity)
		if taskCompRank > maxCompRank {
			return PredicateEvaluationResult{
				Passed: false,
				Reason: fmt.Sprintf("task complexity %s exceeds agent ceiling %s", task.Complexity, cond.MaxComplexity),
			}
		}
	}

	// 7. Required skills compatibility. The requirement is the effective set:
	// soul baseline ∪ task extras. Task skills add to the soul workflow; they
	// never remove a step from it. The agent list is a ceiling, never a source.
	requiredSkills := MergeSkillSets(soulSkills, task.RequiredSkills)
	if len(requiredSkills) > 0 {
		allowedSkills := make(map[string]bool)
		for _, s := range agent.Skills {
			allowedSkills[strings.ToLower(strings.TrimSpace(s))] = true
		}

		if len(allowedSkills) > 0 {
			for _, required := range requiredSkills {
				norm := strings.ToLower(strings.TrimSpace(required))
				if !allowedSkills[norm] {
					return PredicateEvaluationResult{
						Passed: false,
						Reason: fmt.Sprintf("task requires skill %q not granted to agent %s", required, agent.Slug),
					}
				}
			}
		}
	}

	return PredicateEvaluationResult{Passed: true}
}

func riskRank(r TaskRisk) int {
	switch strings.ToUpper(string(r)) {
	case string(RiskLow):
		return 1
	case string(RiskMedium):
		return 2
	case string(RiskHigh):
		return 3
	case string(RiskCritical):
		return 4
	default:
		return 1
	}
}

func complexityRank(c TaskComplexity) int {
	switch strings.ToUpper(string(c)) {
	case string(ComplexityLow):
		return 1
	case string(ComplexityMedium):
		return 2
	case string(ComplexityHigh):
		return 3
	case string(ComplexitySpike):
		return 4
	default:
		return 2
	}
}
