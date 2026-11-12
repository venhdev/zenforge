package domain_test

import (
	"testing"

	"zenf/internal/domain"
)

func TestPredicateEngine_StatusAndClaim(t *testing.T) {
	engine := domain.NewTypedPredicateEngine()

	// 1. Non-READY task must fail
	taskRunning := domain.Task{ID: "T1", Status: domain.StatusRunning}
	res := engine.Evaluate(taskRunning, nil, 0, nil)
	if res.Passed {
		t.Errorf("expected non-READY task to fail predicate check")
	}

	// 2. Corrupted dependency task must fail
	taskCorrupt := domain.Task{ID: "T2", Status: domain.StatusReady, DependenciesCorrupt: true}
	res = engine.Evaluate(taskCorrupt, nil, 0, nil)
	if res.Passed {
		t.Errorf("expected task with corrupt dependencies to fail predicate check")
	}

	// 3. READY task with no agent passes
	taskReady := domain.Task{ID: "T3", Status: domain.StatusReady}
	res = engine.Evaluate(taskReady, nil, 0, nil)
	if !res.Passed {
		t.Errorf("expected unassigned READY task to pass, got: %s", res.Reason)
	}

	// 4. claimed_by is attribution only: a READY task with a stale claim row
	// must still pass, because mutual exclusion lives in the claim transition.
	taskClaimed := domain.Task{ID: "T4", Status: domain.StatusReady, ClaimedBy: "other-worker"}
	agent := &domain.Agent{
		Slug:            "worker-1",
		Enabled:         true,
		StartConditions: domain.AgentStartConditions{},
	}
	res = engine.Evaluate(taskClaimed, agent, 0, nil)
	if !res.Passed {
		t.Errorf("expected attribution field to be ignored by the gate, got: %s", res.Reason)
	}

	// 5. A task bound to an agent that cannot be resolved must fail closed
	// instead of running without gates.
	orphaned := domain.Task{ID: "T5", Status: domain.StatusReady, AgentSlug: "deleted-agent"}
	res = engine.Evaluate(orphaned, nil, 0, nil)
	if res.Passed {
		t.Error("expected a bound task with a missing agent to fail closed")
	}
}

func TestPredicateEngine_RiskAndComplexityCeilings(t *testing.T) {
	engine := domain.NewTypedPredicateEngine()

	agent := &domain.Agent{
		Slug:    "safe-worker",
		Enabled: true,
		StartConditions: domain.AgentStartConditions{
			MaxRiskLevel:  domain.RiskMedium,
			MaxComplexity: domain.ComplexityMedium,
		},
	}

	// 1. Task within ceiling passes
	taskSafe := domain.Task{
		ID:         "T-SAFE",
		Status:     domain.StatusReady,
		RiskLevel:  domain.RiskLow,
		Complexity: domain.ComplexityLow,
	}
	res := engine.Evaluate(taskSafe, agent, 0, nil)
	if !res.Passed {
		t.Fatalf("expected safe task to pass, got: %s", res.Reason)
	}

	// 2. Task exceeding risk ceiling fails
	taskRisky := domain.Task{
		ID:         "T-RISKY",
		Status:     domain.StatusReady,
		RiskLevel:  domain.RiskHigh,
		Complexity: domain.ComplexityLow,
	}
	res = engine.Evaluate(taskRisky, agent, 0, nil)
	if res.Passed {
		t.Fatalf("expected high risk task to fail against medium risk ceiling")
	}

	// 3. Task exceeding complexity ceiling fails
	taskComplex := domain.Task{
		ID:         "T-COMPLEX",
		Status:     domain.StatusReady,
		RiskLevel:  domain.RiskLow,
		Complexity: domain.ComplexitySpike,
	}
	res = engine.Evaluate(taskComplex, agent, 0, nil)
	if res.Passed {
		t.Fatalf("expected spike complexity task to fail against medium complexity ceiling")
	}
}

func TestPredicateEngine_ConcurrencyAndSkills(t *testing.T) {
	engine := domain.NewTypedPredicateEngine()

	agent := &domain.Agent{
		Slug:    "skilled-worker",
		Enabled: true,
		Skills:  []string{"go", "docker"},
		StartConditions: domain.AgentStartConditions{
			MaxConcurrency: 2,
		},
	}

	// 1. Concurrency limit exceeded
	task := domain.Task{ID: "T1", Status: domain.StatusReady}
	res := engine.Evaluate(task, agent, 2, nil)
	if res.Passed {
		t.Errorf("expected concurrency limit check to fail when claims >= limit")
	}

	res = engine.Evaluate(task, agent, 1, nil)
	if !res.Passed {
		t.Errorf("expected concurrency check to pass when claims < limit")
	}

	// 2. Missing required skill
	taskWithSkills := domain.Task{
		ID:             "T2",
		Status:         domain.StatusReady,
		RequiredSkills: []string{"go", "rust"},
	}
	res = engine.Evaluate(taskWithSkills, agent, 0, nil)
	if res.Passed {
		t.Errorf("expected task requiring rust to fail against agent with only [go, docker]")
	}

	taskGranted := domain.Task{
		ID:             "T3",
		Status:         domain.StatusReady,
		RequiredSkills: []string{"go"},
	}
	res = engine.Evaluate(taskGranted, agent, 0, nil)
	if !res.Passed {
		t.Errorf("expected task requiring go to pass, got: %s", res.Reason)
	}

	// 3. Soul baseline skills are gated exactly like task skills.
	taskNoSkills := domain.Task{ID: "T4", Status: domain.StatusReady}
	res = engine.Evaluate(taskNoSkills, agent, 0, []string{"go", "python"})
	if res.Passed {
		t.Errorf("expected soul skill python to fail against agent with only [go, docker]")
	}

	res = engine.Evaluate(taskNoSkills, agent, 0, []string{"go", "docker"})
	if !res.Passed {
		t.Errorf("expected soul skills to pass within the allowlist, got: %s", res.Reason)
	}
}
