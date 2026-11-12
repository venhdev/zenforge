package mcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"zenf/internal/domain"
)

func TestToolCRUD_Create(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	// 1. Create project
	res := callTool(t, srv, "zenf_create", map[string]any{
		"type": "project",
		"items": []any{
			map[string]any{
				"slug": "p-crud-1",
				"name": "CRUD Project One",
			},
		},
	})
	var out map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["created"].(float64) != 1 {
		t.Fatalf("expected 1 created project, got %v", out["created"])
	}

	// 2. Create plan with composite tasks
	res = callTool(t, srv, "zenf_create", map[string]any{
		"type": "plan",
		"items": []any{
			map[string]any{
				"slug":         "plan-composite",
				"project_slug": "test-project",
				"title":        "Composite Plan",
				"tasks": []any{
					map[string]any{
						"id":    "comp-01",
						"title": "Task One",
					},
					map[string]any{
						"id":           "comp-02",
						"title":        "Task Two",
						"dependencies": []string{"comp-01"},
					},
				},
			},
		},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["created"].(float64) != 1 {
		t.Fatalf("expected 1 created plan, got %v", out["created"])
	}
	t1, err := store.GetTask(ctx, "comp-01")
	if err != nil || t1.Status != domain.StatusReady {
		t.Fatalf("expected comp-01 to be READY, got status %v, err: %v", t1.Status, err)
	}
	t2, err := store.GetTask(ctx, "comp-02")
	if err != nil || t2.Status != domain.StatusPending {
		t.Fatalf("expected comp-02 to be PENDING, got status %v, err: %v", t2.Status, err)
	}

	// 3. Create standalone task
	res = callTool(t, srv, "zenf_create", map[string]any{
		"type": "task",
		"items": []any{
			map[string]any{
				"id":           "standalone-01",
				"project_slug": "test-project",
				"plan_slug":    "plan-composite",
				"title":        "Standalone Task",
			},
		},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["created"].(float64) != 1 {
		t.Fatalf("expected 1 created task, got %v", out["created"])
	}

	// 4. Create resource
	tempDir := t.TempDir()
	docPath := filepath.Join(tempDir, "spec.md")
	if err := os.WriteFile(docPath, []byte("# Spec\nSample specification"), 0644); err != nil {
		t.Fatalf("failed to write doc file: %v", err)
	}
	res = callTool(t, srv, "zenf_create", map[string]any{
		"type": "resource",
		"items": []any{
			map[string]any{
				"project_slug": "test-project",
				"key":          "SPEC-01",
				"slug":         "spec-doc",
				"kind":         "spec",
				"title":        "Spec Document",
				"path":         docPath,
			},
		},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["created"].(float64) != 1 {
		t.Fatalf("expected 1 created resource, got %v", out["created"])
	}

	// 5. Create agent
	res = callTool(t, srv, "zenf_create", map[string]any{
		"type": "agent",
		"items": []any{
			map[string]any{
				"slug": "bot-builder",
				"name": "Builder Bot",
				"mode": "HEADLESS",
			},
		},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["created"].(float64) != 1 {
		t.Fatalf("expected 1 created agent, got %v", out["created"])
	}
}

func TestToolCRUD_Update(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	// Seed plan & task
	plan := domain.Plan{Slug: "up-plan", ProjectSlug: "test-project", Title: "Update Plan"}
	tasks := []domain.Task{{ID: "up-01", ProjectSlug: "test-project", PlanSlug: "up-plan", Title: "Original Title", Status: domain.StatusReady}}
	if err := store.CreatePlanWithTasks(ctx, plan, tasks); err != nil {
		t.Fatalf("failed to seed: %v", err)
	}

	// Update task title & notes
	res := callTool(t, srv, "zenf_update", map[string]any{
		"type": "task",
		"items": []any{
			map[string]any{
				"id":    "up-01",
				"title": "Patched Title",
				"notes": "Added investigation notes",
			},
		},
	})
	var out map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["updated"].(float64) != 1 {
		t.Fatalf("expected 1 updated task, got %v", out["updated"])
	}

	updatedTask, err := store.GetTask(ctx, "up-01")
	if err != nil {
		t.Fatalf("failed to fetch updated task: %v", err)
	}
	if updatedTask.Title != "Patched Title" {
		t.Fatalf("expected title Patched Title, got %s", updatedTask.Title)
	}
	if updatedTask.Notes != "Added investigation notes" {
		t.Fatalf("expected notes Added investigation notes, got %s", updatedTask.Notes)
	}
}

func TestToolCRUD_Delete(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	// Seed plan & tasks
	plan := domain.Plan{Slug: "del-plan", ProjectSlug: "test-project", Title: "Delete Plan"}
	tasks := []domain.Task{
		{ID: "del-01", ProjectSlug: "test-project", PlanSlug: "del-plan", Title: "Task to cancel", Status: domain.StatusReady},
	}
	if err := store.CreatePlanWithTasks(ctx, plan, tasks); err != nil {
		t.Fatalf("failed to seed: %v", err)
	}

	// Delete task (cancels)
	res := callTool(t, srv, "zenf_delete", map[string]any{
		"type": "task",
		"ids":  []string{"del-01"},
	})
	var out map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["deleted"].(float64) != 1 {
		t.Fatalf("expected 1 deleted task, got %v", out["deleted"])
	}
	t1, err := store.GetTask(ctx, "del-01")
	if err != nil || t1.Status != domain.StatusCancelled {
		t.Fatalf("expected del-01 to be CANCELLED, got %v, err: %v", t1.Status, err)
	}

	// Delete plan
	res = callTool(t, srv, "zenf_delete", map[string]any{
		"type": "plan",
		"ids":  []string{"del-plan"},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if out["deleted"].(float64) != 1 {
		t.Fatalf("expected 1 deleted plan, got %v", out["deleted"])
	}
	archived, err := store.GetPlan(ctx, "del-plan")
	if err != nil {
		t.Fatalf("expected del-plan to remain archived, got error: %v", err)
	}
	if archived.Status != domain.PlanStatusArchived {
		t.Fatalf("expected del-plan status ARCHIVED, got %s", archived.Status)
	}
}
