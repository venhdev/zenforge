package storage

import (
	"context"
	"errors"
	"strings"
	"testing"

	"zenf/internal/domain"
)

// boundTaskStore seeds one agent and one task bound to it.
func boundTaskStore(t *testing.T) (*Store, context.Context) {
	t.Helper()
	ctx := context.Background()
	store, ctx := newClaimTestStore(t, nil)

	if err := store.CreateProject(ctx, domain.Project{
		Slug: "bind-project", Name: "Bind Project", RootPath: t.TempDir(),
	}); err != nil {
		t.Fatalf("CreateProject failed: %v", err)
	}
	if err := store.CreateAgent(ctx, domain.Agent{
		Slug: "coder-alpha", Name: "Coder Alpha", Enabled: true,
	}); err != nil {
		t.Fatalf("CreateAgent failed: %v", err)
	}
	if err := store.CreatePlanWithTasks(ctx, domain.Plan{
		Slug: "bind-plan", ProjectSlug: "bind-project", Title: "Bind Plan", Status: domain.PlanStatusActive,
	}, []domain.Task{{
		ID: "BOUND-01", Title: "Bound task", Status: domain.StatusReady,
		AgentSlug: "coder-alpha", Dependencies: []string{},
	}}); err != nil {
		t.Fatalf("CreatePlanWithTasks failed: %v", err)
	}
	return store, ctx
}

func TestClaimTask_BoundAgentInvariant(t *testing.T) {
	store, ctx := boundTaskStore(t)

	// A conflicting declaration is refused; the binding is authoritative.
	if _, err := store.ClaimTask(ctx, "BOUND-01", domain.ClaimOptions{WorkerID: "someone-else"}); !errors.Is(err, ErrConflictStatus) {
		t.Fatalf("expected conflicting worker_id to be rejected, got %v", err)
	}

	// Silence is allowed and derives the identity from the binding.
	if _, err := store.ClaimTask(ctx, "BOUND-01", domain.ClaimOptions{}); err != nil {
		t.Fatalf("ClaimTask failed: %v", err)
	}
	task, err := store.GetTask(ctx, "BOUND-01")
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	if task.ClaimedBy != "coder-alpha" {
		t.Fatalf("expected claimed_by to derive from agent_slug, got %q", task.ClaimedBy)
	}
}

func TestClaimTask_UnboundFallsBackToExternal(t *testing.T) {
	store, ctx := newClaimTestStore(t, nil)
	seedClaimTasks(t, store, "FREE-01")

	if _, err := store.ClaimTask(ctx, "FREE-01", domain.ClaimOptions{}); err != nil {
		t.Fatalf("ClaimTask failed: %v", err)
	}
	task, err := store.GetTask(ctx, "FREE-01")
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	if task.ClaimedBy != "external" {
		t.Fatalf("expected honest external label, got %q", task.ClaimedBy)
	}
}

func TestClaimTask_RefusesDisabledOrMissingAgent(t *testing.T) {
	store, ctx := boundTaskStore(t)

	disabled := domain.Agent{Slug: "coder-alpha", Name: "Coder Alpha", Enabled: false}
	if err := store.UpdateAgent(ctx, "coder-alpha", domain.AgentPatch{Enabled: &disabled.Enabled}); err != nil {
		t.Fatalf("UpdateAgent failed: %v", err)
	}
	if _, err := store.ClaimTask(ctx, "BOUND-01", domain.ClaimOptions{}); !errors.Is(err, ErrConflictStatus) {
		t.Fatalf("expected disabled agent claim to be refused, got %v", err)
	}

	if err := store.DeleteAgent(ctx, "coder-alpha"); err != nil {
		t.Fatalf("DeleteAgent failed: %v", err)
	}
	if _, err := store.ClaimTask(ctx, "BOUND-01", domain.ClaimOptions{}); !errors.Is(err, ErrConflictStatus) {
		t.Fatalf("expected missing agent claim to fail closed, got %v", err)
	}
}

func TestResolveReview_ClearsReviewAndClaimState(t *testing.T) {
	store, ctx := newClaimTestStore(t, nil)
	seedClaimTasks(t, store, "REV-01")

	if _, err := store.ClaimTask(ctx, "REV-01", domain.ClaimOptions{WorkerID: "w1", SessionID: "s1"}); err != nil {
		t.Fatalf("ClaimTask failed: %v", err)
	}
	if err := store.RequestReview(ctx, "REV-01", "blocked", "needs a decision", []string{"A", "B"}); err != nil {
		t.Fatalf("RequestReview failed: %v", err)
	}
	if err := store.ResolveReview(ctx, "REV-01", "A"); err != nil {
		t.Fatalf("ResolveReview failed: %v", err)
	}

	task, err := store.GetTask(ctx, "REV-01")
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	if task.ClaimedBy != "" || task.ClaimSessionID != "" || task.ClaimedAt != nil {
		t.Fatalf("claim state not cleared: %+v", task)
	}
	if task.ReviewReason != "" || task.ReviewDetails != "" || len(task.ReviewOptions) != 0 {
		t.Fatalf("stale review payload left behind: %+v", task)
	}
	if !strings.Contains(task.Notes, "Review response: A") {
		t.Fatalf("review decision not recorded in notes: %+v", task)
	}
}

func TestUpdateTaskMetadata_BlocksAssignmentWhileRunning(t *testing.T) {
	store, ctx := boundTaskStore(t)

	if _, err := store.ClaimTask(ctx, "BOUND-01", domain.ClaimOptions{}); err != nil {
		t.Fatalf("ClaimTask failed: %v", err)
	}

	newAgent := "reviewer-bot"
	err := store.UpdateTaskMetadata(ctx, "BOUND-01", domain.TaskPatch{AgentSlug: &newAgent})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected assignment change on a RUNNING task to be refused, got %v", err)
	}
}
