package mcp

import (
	"context"
	"encoding/json"
	"testing"

	"zenf/internal/domain"
)

func TestToolFind_ProjectsAndPlans(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	// Seed second project and a plan
	if err := store.CreateProject(ctx, domain.Project{
		Slug: "alpha-project", Name: "Alpha Project", RootPath: "/tmp/alpha",
	}); err != nil {
		t.Fatalf("failed to create project: %v", err)
	}
	if err := store.CreatePlanWithTasks(ctx, domain.Plan{
		Slug: "core-plan", ProjectSlug: "test-project", Title: "Core Plan",
	}, nil); err != nil {
		t.Fatalf("failed to create plan: %v", err)
	}

	// 1. List projects via zenf_find
	res := callTool(t, srv, "zenf_find", map[string]any{"type": "project"})
	var out map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	items := out["items"].([]any)
	if len(items) < 2 {
		t.Fatalf("expected at least 2 projects, got %d", len(items))
	}

	// 2. Lookup project by ID
	res = callTool(t, srv, "zenf_find", map[string]any{
		"type": "project",
		"ids":  []string{"alpha-project"},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["count"].(float64) != 1 {
		t.Fatalf("expected 1 project, got %v", out["count"])
	}

	// 3. List plans with filter
	res = callTool(t, srv, "zenf_find", map[string]any{
		"type":   "plan",
		"filter": map[string]any{"project_slug": "test-project"},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	planItems := out["items"].([]any)
	if len(planItems) != 1 {
		t.Fatalf("expected 1 plan, got %d", len(planItems))
	}
}

func TestToolFind_TasksAndPackets(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	// Seed plan and tasks
	plan := domain.Plan{Slug: "task-plan", ProjectSlug: "test-project", Title: "Task Plan"}
	tasks := []domain.Task{
		{
			ID:          "T-01",
			ProjectSlug: "test-project",
			PlanSlug:    "task-plan",
			Title:       "Task One",
			Status:      domain.StatusReady,
		},
		{
			ID:           "T-02",
			ProjectSlug:  "test-project",
			PlanSlug:     "task-plan",
			Title:        "Task Two",
			Status:       domain.StatusPending,
			Dependencies: []string{"T-01"},
		},
	}
	if err := store.CreatePlanWithTasks(ctx, plan, tasks); err != nil {
		t.Fatalf("failed to seed tasks: %v", err)
	}

	// 1. Filter tasks by status=READY
	res := callTool(t, srv, "zenf_find", map[string]any{
		"type": "task",
		"filter": map[string]any{
			"status":    "READY",
			"plan_slug": "task-plan",
		},
	})
	var out map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	items := out["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 ready task, got %d", len(items))
	}

	// 2. Fetch task by IDs with packet
	res = callTool(t, srv, "zenf_find", map[string]any{
		"type":           "task",
		"ids":            []string{"T-01"},
		"include_packet": true,
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["count"].(float64) != 1 {
		t.Fatalf("expected 1 task packet, got %v", out["count"])
	}
}

func TestToolFind_FullTextSearch(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	// Seed resource
	if err := store.CreateResource(ctx, domain.Resource{
		ID:          "res-fts-1",
		ProjectSlug: "test-project",
		Key:         "ARCH",
		Slug:        "architecture",
		Kind:        domain.ResourceKindSpec,
		Path:        "/tmp/alpha/arch.md",
		Type:        domain.ResourceTypeArchitecture,
		Scope:       domain.ResourceScopeProject,
		Title:       "Distributed Event Bus",
		Summary:     "Architecture for WebSocket PTY streaming",
		Content:     "Full streaming pipeline implementation details with ANSI colors.",
		Status:      domain.ResourceStatusActive,
	}); err != nil {
		t.Fatalf("failed to create resource: %v", err)
	}

	// 1. Search resource specifically
	res := callTool(t, srv, "zenf_find", map[string]any{
		"type":  "resource",
		"query": "WebSocket",
	})
	var out map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["count"].(float64) < 1 {
		t.Fatalf("expected at least 1 resource search result, got %v", out["count"])
	}

	// 2. Cross-entity search
	res = callTool(t, srv, "zenf_find", map[string]any{
		"query": "Event Bus",
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["count"].(float64) < 1 {
		t.Fatalf("expected at least 1 cross-entity result, got %v", out["count"])
	}
}

func TestToolFind_UniversalURIAndAutoResolution(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	// Seed test resource & task
	if err := store.CreateResource(ctx, domain.Resource{
		ID:          "res_01a1beff",
		ProjectSlug: "test-project",
		Key:         "CONSTRUCTION_RULES",
		Slug:        "construction-rules",
		Kind:        domain.ResourceKindSpec,
		Type:        domain.ResourceTypeRule,
		Scope:       domain.ResourceScopeProject,
		Title:       "Construction Rules",
		Summary:     "Rules for building skills",
		Content:     "# Rules\nContent here.",
		Status:      domain.ResourceStatusActive,
	}); err != nil {
		t.Fatalf("failed to create resource: %v", err)
	}

	plan := domain.Plan{Slug: "uri-plan", ProjectSlug: "test-project", Title: "URI Plan"}
	tasks := []domain.Task{
		{
			ID:          "task-uri-01",
			ProjectSlug: "test-project",
			PlanSlug:    "uri-plan",
			Title:       "Test Task URI",
			Status:      domain.StatusReady,
		},
	}
	if err := store.CreatePlanWithTasks(ctx, plan, tasks); err != nil {
		t.Fatalf("failed to seed tasks: %v", err)
	}

	// 1. Direct lookup using uri parameter (zenf://<project>/resource/<key>)
	res := callTool(t, srv, "zenf_find", map[string]any{
		"uri": "zenf://test-project/resource/CONSTRUCTION_RULES",
	})
	var out map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["count"].(float64) != 1 {
		t.Fatalf("expected 1 resource from uri, got %v", out["count"])
	}
	items := out["items"].([]any)
	resItem := items[0].(map[string]any)
	if resItem["key"] != "CONSTRUCTION_RULES" {
		t.Fatalf("expected CONSTRUCTION_RULES, got %v", resItem["key"])
	}

	// 2. Direct lookup using zenf:// in ids array
	res = callTool(t, srv, "zenf_find", map[string]any{
		"ids": []string{"zenf://test-project/task/task-uri-01"},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["count"].(float64) != 1 {
		t.Fatalf("expected 1 task from ids with uri, got %v", out["count"])
	}

	// 3. Auto-detection from prefix without specifying type
	res = callTool(t, srv, "zenf_find", map[string]any{
		"ids": []string{"res_01a1beff"},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["count"].(float64) != 1 {
		t.Fatalf("expected 1 resource from prefixed id without type, got %v", out["count"])
	}

	// 4. Fallback lookup by key without project_slug or type
	res = callTool(t, srv, "zenf_find", map[string]any{
		"ids": []string{"CONSTRUCTION_RULES"},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["count"].(float64) != 1 {
		t.Fatalf("expected 1 resource by key without type, got %v", out["count"])
	}
}
