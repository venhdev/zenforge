package worker_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"zenf/internal/domain"
	"zenf/internal/runner"
	"zenf/internal/storage"
	"zenf/internal/worker"
)

func TestAutoRunWorker_SuccessAndFailure(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "autorun.db")
	db, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("failed to init storage: %v", err)
	}
	defer db.Close()

	store := storage.NewStore(db)
	ctx := context.Background()

	if err := store.CreateProject(ctx, domain.Project{
		Slug: "proj-ar", Name: "Project AutoRun", RootPath: tempDir,
	}); err != nil {
		t.Fatalf("failed to create project: %v", err)
	}

	// 1. Seed plan and tasks
	plan := domain.Plan{
		Slug: "plan-ar", ProjectSlug: "proj-ar", Title: "AutoRun Plan",
	}
	tasks := []domain.Task{
		{
			ID:                   "TASK-SUCCESS",
			ProjectSlug:          "proj-ar",
			PlanSlug:             "plan-ar",
			Title:                "Success AutoRun Task",
			Status:               domain.StatusReady,
			AutoRun:              true,
			VerificationCommands: []string{"echo 'AUTORUN_STREAMING_PROOF'"},
		},
		{
			ID:                   "TASK-FAIL",
			ProjectSlug:          "proj-ar",
			PlanSlug:             "plan-ar",
			Title:                "Failing AutoRun Task",
			Status:               domain.StatusReady,
			AutoRun:              true,
			VerificationCommands: []string{"sh -c 'exit 7'"},
		},
		{
			ID:          "TASK-MANUAL",
			ProjectSlug: "proj-ar",
			PlanSlug:    "plan-ar",
			Title:       "Manual Task",
			Status:      domain.StatusReady,
			AutoRun:     false,
		},
	}
	if err := store.CreatePlanWithTasks(ctx, plan, tasks); err != nil {
		t.Fatalf("failed to create plan with tasks: %v", err)
	}

	reg := runner.NewSessionRegistry()
	w := worker.NewAutoRunWorker(store, reg, nil, 1*time.Second)

	// 2. Trigger Tick
	w.Tick(ctx)

	// 3. Poll for completion of both tasks (up to 3 seconds)
	deadline := time.Now().Add(3 * time.Second)
	var successTask, failTask, manualTask *domain.Task
	for time.Now().Before(deadline) {
		successTask, _ = store.GetTask(ctx, "TASK-SUCCESS")
		failTask, _ = store.GetTask(ctx, "TASK-FAIL")
		manualTask, _ = store.GetTask(ctx, "TASK-MANUAL")

		if successTask != nil && successTask.Status == domain.StatusCompleted &&
			failTask != nil && failTask.Status == domain.StatusFailed {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// 4. Assertions on Success Task
	if successTask == nil || successTask.Status != domain.StatusCompleted {
		t.Fatalf("expected TASK-SUCCESS to be COMPLETED, got %+v", successTask)
	}
	if !strings.HasPrefix(successTask.ClaimSessionID, "sess-worker-TASK-SUCCESS-") {
		t.Errorf("expected session prefix sess-worker-TASK-SUCCESS-, got %s", successTask.ClaimSessionID)
	}

	// Verify terminal output streamed to SessionRegistry
	rnr, err := reg.Get(successTask.ClaimSessionID)
	if err != nil {
		t.Fatalf("expected runner to be registered for session %s: %v", successTask.ClaimSessionID, err)
	}
	outBytes := rnr.Buffer().Snapshot()
	if !strings.Contains(string(outBytes), "AUTORUN_STREAMING_PROOF") {
		t.Errorf("expected ringbuffer to contain AUTORUN_STREAMING_PROOF, got %q", string(outBytes))
	}

	// 5. Assertions on Failing Task
	if failTask == nil || failTask.Status != domain.StatusFailed {
		t.Fatalf("expected TASK-FAIL to be FAILED, got %+v", failTask)
	}

	// 6. Assertions on Manual Task (must remain untouched)
	if manualTask == nil || manualTask.Status != domain.StatusReady || manualTask.ClaimSessionID != "" {
		t.Fatalf("expected TASK-MANUAL to remain READY and unclaimed, got %+v", manualTask)
	}
}

func TestAutoRunWorker_DAGCascade(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "cascade.db")
	db, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("failed to init storage: %v", err)
	}
	defer db.Close()

	store := storage.NewStore(db)
	ctx := context.Background()

	_ = store.CreateProject(ctx, domain.Project{
		Slug: "proj-dag", Name: "DAG Cascade", RootPath: tempDir,
	})

	plan := domain.Plan{
		Slug: "plan-dag", ProjectSlug: "proj-dag", Title: "DAG Plan",
	}
	tasks := []domain.Task{
		{
			ID:                   "DAG-01",
			ProjectSlug:          "proj-dag",
			PlanSlug:             "plan-dag",
			Title:                "Root Task",
			Status:               domain.StatusReady,
			AutoRun:              true,
			VerificationCommands: []string{"echo 'STEP_1'"},
		},
		{
			ID:                   "DAG-02",
			ProjectSlug:          "proj-dag",
			PlanSlug:             "plan-dag",
			Title:                "Child Task",
			Dependencies:         []string{"DAG-01"},
			Status:               domain.StatusPending,
			AutoRun:              true,
			VerificationCommands: []string{"echo 'STEP_2'"},
		},
	}
	if err := store.CreatePlanWithTasks(ctx, plan, tasks); err != nil {
		t.Fatalf("CreatePlanWithTasks failed: %v", err)
	}

	reg := runner.NewSessionRegistry()
	w := worker.NewAutoRunWorker(store, reg, nil, 1*time.Second)

	// 1. Tick for DAG-01
	w.Tick(ctx)

	// Wait for DAG-01 to complete
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		t1, _ := store.GetTask(ctx, "DAG-01")
		if t1 != nil && t1.Status == domain.StatusCompleted {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify DAG-02 is now READY
	t2, err := store.GetTask(ctx, "DAG-02")
	if err != nil || t2.Status != domain.StatusReady {
		t.Fatalf("expected DAG-02 to transition to READY, got %+v, err=%v", t2, err)
	}

	// 2. Tick for DAG-02
	w.Tick(ctx)

	// Wait for DAG-02 to complete
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		t2, _ = store.GetTask(ctx, "DAG-02")
		if t2 != nil && t2.Status == domain.StatusCompleted {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if t2 == nil || t2.Status != domain.StatusCompleted {
		t.Fatalf("expected DAG-02 to be COMPLETED, got %+v", t2)
	}
}

func TestAutoRunWorker_AgentGatesAndTemplate(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "agent_autorun.db")
	db, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	store := storage.NewStore(db)
	ctx := context.Background()

	_ = store.CreateProject(ctx, domain.Project{
		Slug: "proj-agent", Name: "Project Agent", RootPath: tempDir,
	})

	// 1. Create agent with Low Risk limit and OnFailure=AWAITING_REVIEW
	agent := domain.Agent{
		Slug:    "strict-coder",
		Name:    "Strict Coder",
		Mode:    domain.AgentModeHeadless,
		Runner:  "{prompt}",
		Enabled: true,
		StartConditions: domain.AgentStartConditions{
			MaxRiskLevel: domain.RiskLow,
		},
		StopConditions: domain.AgentStopConditions{
			OnFailure:      "AWAITING_REVIEW",
			TimeoutSeconds: 60,
		},
	}
	if err := store.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("CreateAgent failed: %v", err)
	}

	// 2. Task 1: Exceeds risk (HIGH risk vs LOW ceiling) -> Should NOT be claimed
	//    Task 2: Matches risk (LOW risk), failing command -> Should become AWAITING_REVIEW
	plan := domain.Plan{
		Slug: "plan-agent", ProjectSlug: "proj-agent", Title: "Agent Plan",
	}
	tasks := []domain.Task{
		{
			ID:                   "TASK-BLOCKED-RISK",
			ProjectSlug:          "proj-agent",
			PlanSlug:             "plan-agent",
			Title:                "Risky Task",
			Status:               domain.StatusReady,
			RiskLevel:            domain.RiskHigh,
			AgentSlug:            "strict-coder",
			AutoRun:              true,
			VerificationCommands: []string{"echo 'SHOULD_NOT_RUN'"},
		},
		{
			ID:                   "TASK-AWAITING-REVIEW",
			ProjectSlug:          "proj-agent",
			PlanSlug:             "plan-agent",
			Title:                "Failing Safe Task",
			Status:               domain.StatusReady,
			RiskLevel:            domain.RiskLow,
			AgentSlug:            "strict-coder",
			AutoRun:              true,
			VerificationCommands: []string{"sh -c 'exit 5'"},
		},
	}
	if err := store.CreatePlanWithTasks(ctx, plan, tasks); err != nil {
		t.Fatalf("CreatePlanWithTasks failed: %v", err)
	}

	reg := runner.NewSessionRegistry()
	w := worker.NewAutoRunWorker(store, reg, nil, 1*time.Second)

	// 3. Trigger worker tick
	w.Tick(ctx)

	// Wait for TASK-AWAITING-REVIEW to finalize
	deadline := time.Now().Add(3 * time.Second)
	var tReview *domain.Task
	for time.Now().Before(deadline) {
		tReview, _ = store.GetTask(ctx, "TASK-AWAITING-REVIEW")
		if tReview != nil && tReview.Status == domain.StatusAwaitingReview {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if tReview == nil || tReview.Status != domain.StatusAwaitingReview {
		t.Fatalf("expected TASK-AWAITING-REVIEW to be AWAITING_REVIEW, got %+v", tReview)
	}

	// Assert TASK-BLOCKED-RISK remained READY and unclaimed due to predicate gate
	tBlocked, _ := store.GetTask(ctx, "TASK-BLOCKED-RISK")
	if tBlocked == nil || tBlocked.Status != domain.StatusReady || tBlocked.ClaimedBy != "" {
		t.Fatalf("expected TASK-BLOCKED-RISK to remain READY and unclaimed, got %+v", tBlocked)
	}
}
