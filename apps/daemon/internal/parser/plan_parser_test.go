package parser

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"zenf/internal/domain"
)

func TestParseMarkdownPlan_Synthetic(t *testing.T) {
	mdContent := `
# Plan Dossier: feature-payment · ACTIVE

Target: payment-service

## Master Tasks

| Task ID | Description | Dependencies | Status | Harness |
| :--- | :--- | :--- | :--- | :--- |
| **T-01** | Create payment schema | - | **VERIFIED** | postgres |
| **T-02** | Stripe webhook | T-01 | **IN PROGRESS** | antigravity |
| **T-03** | Email receipt | T-02 | **PLANNED** | antigravity |
`

	plan, tasks, err := ParseMarkdownPlan(strings.NewReader(mdContent), "default")
	if err != nil {
		t.Fatalf("ParseMarkdownPlan failed: %v", err)
	}

	if plan.Slug != "feature-payment" {
		t.Fatalf("expected slug feature-payment, got %s", plan.Slug)
	}
	if plan.Status != "ACTIVE" {
		t.Fatalf("expected status ACTIVE, got %s", plan.Status)
	}

	if len(tasks) != 3 {
		t.Fatalf("expected 3 tasks, got %d", len(tasks))
	}

	// T-01
	if tasks[0].ID != "T-01" || tasks[0].Status != domain.StatusCompleted {
		t.Errorf("task 0 mismatch: %+v", tasks[0])
	}
	// T-02
	if tasks[1].ID != "T-02" || tasks[1].Status != domain.StatusRunning || len(tasks[1].Dependencies) != 1 || tasks[1].Dependencies[0] != "T-01" {
		t.Errorf("task 1 mismatch: %+v", tasks[1])
	}
	// T-03
	if tasks[2].ID != "T-03" || tasks[2].Status != domain.StatusPending {
		t.Errorf("task 2 mismatch: %+v", tasks[2])
	}
}

func TestParseMarkdownPlanFile_SyntheticDossier(t *testing.T) {
	content := `# Plan Dossier: zenf · ACTIVE

## Master State Dashboard

| Phase ID | Scope & Seam | Dependencies | Status | Branch / Owner | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P-00** | Walking Skeleton Plumbing Proof | - | **VERIFIED** | main | go test ./... |
| **P-01** | Domain Core, Entities & SQLite Engine | P-00 | **VERIFIED** | main | go test ./... |
| **P-02** | Batch Task Ingestion & Graph Validation | P-01 | **VERIFIED** | main | go test ./... |
| **P-03** | DAG Dependency Scheduler | P-01, P-02 | **VERIFIED** | main | go test ./... |
| **P-04** | Go 1.22+ Standard Gateway & SSE | P-01, P-03 | **VERIFIED** | main | go test ./... |
`
	tmpFile := filepath.Join(t.TempDir(), "README.md")
	if err := os.WriteFile(tmpFile, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write temp plan file: %v", err)
	}

	plan, tasks, err := ParseMarkdownPlanFile(tmpFile)
	if err != nil {
		t.Fatalf("ParseMarkdownPlanFile failed: %v", err)
	}

	if plan.Slug != "zenf" {
		t.Errorf("expected plan slug zenf, got %s", plan.Slug)
	}

	if len(tasks) != 5 {
		t.Fatalf("expected 5 phases parsed, got %d", len(tasks))
	}

	for _, task := range tasks {
		t.Logf("  Task: %s | Status: %s | Title: %s", task.ID, task.Status, task.Title)
	}
}

func TestBuildHeaderMap_NoColumnOverwrite(t *testing.T) {
	cases := []struct {
		name    string
		headers []string
		want    map[string]int
	}{
		{
			name:    "task status must not claim the id column",
			headers: []string{"Task ID", "Task Status", "Scope"},
			want:    map[string]int{"id": 0, "status": 1, "title": 2},
		},
		{
			name:    "generic task column binds first",
			headers: []string{"Task", "Status"},
			want:    map[string]int{"id": 0, "status": 1},
		},
		{
			name:    "phase and seam keep their roles",
			headers: []string{"Phase", "Scope & Seam", "Dependencies", "Status"},
			want:    map[string]int{"id": 0, "title": 1, "deps": 2, "status": 3},
		},
		{
			name:    "description is a title, not an id",
			headers: []string{"ID", "Description", "Dependencies"},
			want:    map[string]int{"id": 0, "title": 1, "deps": 2},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := buildHeaderMap(tc.headers)
			for role, idx := range tc.want {
				if got[role] != idx {
					t.Errorf("role %q = %d, want %d (map: %v)", role, got[role], idx, got)
				}
			}
		})
	}
}

func TestParseMarkdownPlan_StatusColumnIsNotTaskID(t *testing.T) {
	md := `
# Plan Dossier: header-regression · ACTIVE

| Task ID | Task Status | Scope |
| :--- | :--- | :--- |
| **T-01** | **READY** | Parse safely |
| **T-02** | **PENDING** | Remain queued |
`

	_, tasks, err := ParseMarkdownPlan(strings.NewReader(md), "default")
	if err != nil {
		t.Fatalf("ParseMarkdownPlan failed: %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(tasks))
	}
	if tasks[0].ID != "T-01" {
		t.Fatalf("expected task id T-01, got %q", tasks[0].ID)
	}
	if tasks[0].Status != domain.StatusReady {
		t.Fatalf("expected READY status, got %q", tasks[0].Status)
	}
	if tasks[0].Title != "Parse safely" {
		t.Fatalf("expected scope as title, got %q", tasks[0].Title)
	}
}
