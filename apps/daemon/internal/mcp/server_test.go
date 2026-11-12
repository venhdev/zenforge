package mcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	mcpgo "github.com/mark3labs/mcp-go/mcp"

	"zenf/internal/domain"
	"zenf/internal/storage"
)

func newTestServer(t *testing.T) (*Server, *storage.Store) {
	t.Helper()
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "state.db")
	db, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("Failed to open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	store := storage.NewStore(db)

	ctx := context.Background()
	if err := store.CreateProject(ctx, domain.Project{
		Slug: "test-project", Name: "Test Project", RootPath: tempDir,
	}); err != nil {
		t.Fatalf("Failed to seed project: %v", err)
	}
	return NewServer(store), store
}

func callTool(t *testing.T, srv *Server, name string, args map[string]any) *mcpgo.CallToolResult {
	t.Helper()
	tool := srv.mcpServer.GetTool(name)
	if tool == nil {
		t.Fatalf("Tool %s not registered", name)
	}
	res, err := tool.Handler(context.Background(), mcpgo.CallToolRequest{
		Params: mcpgo.CallToolParams{Name: name, Arguments: args},
	})
	if err != nil {
		t.Fatalf("%s handler failed: %v", name, err)
	}
	if res == nil || res.IsError {
		t.Fatalf("%s returned error result: %+v", name, res)
	}
	return res
}

func resultText(t *testing.T, res *mcpgo.CallToolResult) string {
	t.Helper()
	if len(res.Content) == 0 {
		t.Fatal("expected tool result content")
	}
	text, ok := mcpgo.AsTextContent(res.Content[0])
	if !ok {
		t.Fatalf("expected text content, got %T", res.Content[0])
	}
	return text.Text
}

func createPlanTool(t *testing.T, srv *Server, slug string, title string) {
	t.Helper()
	callTool(t, srv, "zenf_create", map[string]any{
		"type": "plan",
		"items": []any{
			map[string]any{
				"project_slug": "test-project",
				"slug":         slug,
				"title":        title,
			},
		},
	})
}

func createTaskTool(t *testing.T, srv *Server, planID string, task map[string]any) {
	t.Helper()
	item := make(map[string]any, len(task)+2)
	for k, v := range task {
		item[k] = v
	}
	item["plan_slug"] = planID
	item["project_slug"] = "test-project"
	callTool(t, srv, "zenf_create", map[string]any{
		"type":  "task",
		"items": []any{item},
	})
}

func TestMCPServer_Surface(t *testing.T) {
	srv, _ := newTestServer(t)

	// Exactly the 6 unified tools must be registered
	expectedTools := []string{
		"zenf_find",
		"zenf_create",
		"zenf_update",
		"zenf_delete",
		"claim_task",
		"transition_task",
	}
	for _, name := range expectedTools {
		if srv.mcpServer.GetTool(name) == nil {
			t.Errorf("expected tool %s to be registered", name)
		}
	}

	removedTools := []string{
		"projects",
		"plans",
		"tasks",
		"docs",
		"agents",
		"sessions",
		"search",
		"review",
		"attach_media",
		"zenfd_plans",
		"zenfd_tasks",
		"zenfd_claim_task",
		"zenfd_review",
		"zenfd_transition_task",
		"zenfd_attach_media",
		"zenfd_create_plan",
		"zenfd_create_task",
		"zenfd_request_review",
		"zenfd_resolve_review",
		"zenfd_get_task",
		"zenfd_push_plan",
		"zenfd_reclaim_task",
		"zenfd_evict_task",
		"zenfd_complete_task",
		"zenfd_fail_task",
		"zenfd_merge_task",
		"zenfd_register_session",
		"zenfd_read_doc",
		"zenfd_write_doc",
		"zenfd_export_docs",
		"zenfd_upsert_spec",
		"zenfd_get_spec",
		"zenfd_search_specs",
		"zenfd_snapshot_plan",
	}
	for _, name := range removedTools {
		if srv.mcpServer.GetTool(name) != nil {
			t.Errorf("tool %s should not be registered", name)
		}
	}

	for uri := range srv.mcpServer.ListResources() {
		t.Errorf("unexpected direct resource registered: %s", uri)
	}
}

func TestMCPServer_RequiredParams(t *testing.T) {
	srv, _ := newTestServer(t)

	expected := map[string][]string{
		"zenf_find":       {},
		"zenf_create":     {"type", "items"},
		"zenf_update":     {"type", "items"},
		"zenf_delete":     {"type", "ids"},
		"claim_task":      {"task_id"},
		"transition_task": {},
	}

	for name, required := range expected {
		tool := srv.mcpServer.GetTool(name)
		if tool == nil {
			t.Fatalf("tool %s is not registered", name)
		}
		got := make(map[string]bool, len(tool.Tool.InputSchema.Required))
		for _, field := range tool.Tool.InputSchema.Required {
			got[field] = true
		}
		for _, field := range required {
			if !got[field] {
				t.Errorf("%s: expected required parameter %q, schema has %v", name, field, tool.Tool.InputSchema.Required)
			}
		}
	}
}

func TestMCPServer_LifecycleAndTransition(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	createPlanTool(t, srv, "test-mcp-plan", "MCP Server Verification")
	createTaskTool(t, srv, "test-mcp-plan", map[string]any{
		"id":                    "task-mcp-01",
		"title":                 "Test MCP Tool Lifecycle",
		"description":           "Verify claim, review, and transition tools via MCP",
		"priority":              "P1",
		"acceptance_criteria":   []string{"MCP claim returns context packet", "Transition completes task"},
		"verification_commands": []string{"go test ./..."},
	})

	// Claim.
	callTool(t, srv, "claim_task", map[string]any{
		"task_id":   "task-mcp-01",
		"worker_id": "test-agent-worker",
	})
	task, _ := store.GetTask(ctx, "task-mcp-01")
	if task.Status != domain.StatusRunning {
		t.Fatalf("expected RUNNING after claim, got %s", task.Status)
	}
	if len(task.AcceptanceCriteria) != 2 || len(task.VerificationCommands) != 1 {
		t.Errorf("create_task did not persist criteria/verification: %+v", task)
	}

	// Worker requests review via transition_task.
	callTool(t, srv, "transition_task", map[string]any{
		"task_ids": []string{"task-mcp-01"},
		"action":   "REQUEST_REVIEW",
		"context": map[string]any{
			"reason":  "Schema drift",
			"details": "Need developer decision on migration vs recreate",
			"options": []string{"Option A: Migrate", "Option B: Recreate"},
		},
	})
	task, _ = store.GetTask(ctx, "task-mcp-01")
	if task.Status != domain.StatusAwaitingReview {
		t.Fatalf("expected AWAITING_REVIEW, got %s", task.Status)
	}
	if task.ReviewReason != "Schema drift" || len(task.ReviewOptions) != 2 {
		t.Errorf("expected review question persisted, got %+v", task)
	}

	// Main agent relays human decision and resolves review.
	callTool(t, srv, "transition_task", map[string]any{
		"task_ids": []string{"task-mcp-01"},
		"action":   "RESOLVE_REVIEW",
		"context": map[string]any{
			"decision": "Option A chosen",
		},
	})
	task, _ = store.GetTask(ctx, "task-mcp-01")
	if task.Status != domain.StatusReady {
		t.Fatalf("expected READY after review resolution, got %s", task.Status)
	}

	// Re-claim and complete without a worktree.
	callTool(t, srv, "claim_task", map[string]any{
		"task_id":   "task-mcp-01",
		"worker_id": "subagent-coder-2",
	})
	res := callTool(t, srv, "transition_task", map[string]any{
		"task_ids": []string{"task-mcp-01"},
		"action":   "COMPLETE_TASK",
		"context": map[string]any{
			"summary": "Implementation verified",
		},
	})
	var payload struct {
		Results []struct {
			TaskID string `json:"task_id"`
			Status string `json:"status"`
			Error  string `json:"error"`
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(resultText(t, res)), &payload); err != nil {
		t.Fatalf("failed to decode transition result: %v", err)
	}
	if len(payload.Results) != 1 || payload.Results[0].Status != "COMPLETED" {
		t.Fatalf("unexpected transition result: %+v", payload)
	}

	task, _ = store.GetTask(ctx, "task-mcp-01")
	if task.Status != domain.StatusCompleted {
		t.Fatalf("expected COMPLETED, got %s", task.Status)
	}
	if task.Notes == "" {
		t.Error("expected completion summary appended to Notes")
	}
}

func TestMCPServer_WorktreeCompletesDirectly(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	createPlanTool(t, srv, "wt-plan", "Worktree Plan")
	createTaskTool(t, srv, "wt-plan", map[string]any{
		"id":            "task-wt-01",
		"title":         "Worktree Task",
		"worktree_path": "/tmp/fake-worktree",
	})
	callTool(t, srv, "claim_task", map[string]any{"task_id": "task-wt-01"})

	callTool(t, srv, "transition_task", map[string]any{
		"task_ids": []string{"task-wt-01"},
		"action":   "COMPLETE_TASK",
	})
	task, _ := store.GetTask(ctx, "task-wt-01")
	if task.Status != domain.StatusCompleted {
		t.Fatalf("expected COMPLETED, got %s", task.Status)
	}
}

func TestMCPServer_BatchTransitionIsPerTask(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	createPlanTool(t, srv, "batch-plan", "Batch Plan")
	for _, id := range []string{"batch-01", "batch-02"} {
		createTaskTool(t, srv, "batch-plan", map[string]any{
			"id":    id,
			"title": id,
		})
		callTool(t, srv, "claim_task", map[string]any{"task_id": id})
	}

	// batch-01 completes, missing batch-99 fails without blocking batch-02.
	res := callTool(t, srv, "transition_task", map[string]any{
		"task_ids": []string{"batch-01", "batch-99", "batch-02"},
		"action":   "COMPLETE_TASK",
	})
	var payload struct {
		Results []struct {
			TaskID string `json:"task_id"`
			Status string `json:"status"`
			Error  string `json:"error"`
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(resultText(t, res)), &payload); err != nil {
		t.Fatalf("failed to decode batch result: %v", err)
	}
	if len(payload.Results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(payload.Results))
	}
	if payload.Results[1].Error == "" {
		t.Error("expected error for missing batch-99")
	}

	for _, id := range []string{"batch-01", "batch-02"} {
		task, _ := store.GetTask(ctx, id)
		if task.Status != domain.StatusCompleted {
			t.Errorf("expected %s COMPLETED, got %s", id, task.Status)
		}
	}
}

func TestMCPServer_TransitionFailResetCancel(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	createPlanTool(t, srv, "state-plan", "State Plan")
	for _, id := range []string{"state-fail", "state-reset", "state-cancel"} {
		createTaskTool(t, srv, "state-plan", map[string]any{
			"id":    id,
			"title": id,
		})
		callTool(t, srv, "claim_task", map[string]any{"task_id": id})
	}

	callTool(t, srv, "transition_task", map[string]any{
		"task_ids": []string{"state-fail"},
		"action":   "FAIL_TASK",
		"context": map[string]any{
			"reason": "compile error",
		},
	})
	task, _ := store.GetTask(ctx, "state-fail")
	if task.Status != domain.StatusFailed {
		t.Fatalf("expected FAILED, got %s", task.Status)
	}

	callTool(t, srv, "transition_task", map[string]any{
		"task_ids": []string{"state-reset"},
		"action":   "RESET_TO_READY",
		"context": map[string]any{
			"reason": "worker hung",
		},
	})
	task, _ = store.GetTask(ctx, "state-reset")
	if task.Status != domain.StatusReady {
		t.Fatalf("expected READY, got %s", task.Status)
	}

	callTool(t, srv, "transition_task", map[string]any{
		"task_ids": []string{"state-cancel"},
		"action":   "CANCEL_TASK",
		"context": map[string]any{
			"reason": "obsolete",
		},
	})
	task, _ = store.GetTask(ctx, "state-cancel")
	if task.Status != domain.StatusCancelled {
		t.Fatalf("expected CANCELLED, got %s", task.Status)
	}
}

func TestMCPServer_GetTask(t *testing.T) {
	srv, _ := newTestServer(t)

	createPlanTool(t, srv, "read-plan", "Read Plan")
	createTaskTool(t, srv, "read-plan", map[string]any{
		"id":    "read-01",
		"title": "Read Task",
	})

	res := callTool(t, srv, "zenf_find", map[string]any{
		"type": "task",
		"ids":  []string{"read-01"},
	})
	if resultText(t, res) == "" {
		t.Fatal("expected zenf_find task content")
	}
}

func TestMCPServer_BatchCreateAndArchive(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	createPlanTool(t, srv, "batch-plan", "Batch Plan")

	res := callTool(t, srv, "zenf_create", map[string]any{
		"type": "task",
		"items": []any{
			map[string]any{"id": "b-01", "project_slug": "test-project", "plan_slug": "batch-plan", "title": "first"},
			map[string]any{"id": "b-02", "project_slug": "test-project", "plan_slug": "batch-plan", "title": "second", "dependencies": []string{"b-01"}},
		},
	})
	var created struct {
		Created int      `json:"created"`
		TaskIDs []string `json:"task_ids"`
	}
	if err := json.Unmarshal([]byte(resultText(t, res)), &created); err != nil {
		t.Fatalf("failed to decode create result: %v", err)
	}
	if created.Created != 2 || len(created.TaskIDs) != 2 {
		t.Fatalf("unexpected create result: %+v", created)
	}

	first, _ := store.GetTask(ctx, "b-01")
	second, _ := store.GetTask(ctx, "b-02")
	if first.Status != domain.StatusReady || second.Status != domain.StatusPending {
		t.Errorf("unexpected statuses: %s / %s", first.Status, second.Status)
	}

	callTool(t, srv, "zenf_update", map[string]any{
		"type": "plan",
		"items": []any{
			map[string]any{
				"slug":     "batch-plan",
				"archived": true,
			},
		},
	})

	res = callTool(t, srv, "zenf_find", map[string]any{
		"type": "plan",
	})
	var listOut map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &listOut); err != nil {
		t.Fatalf("failed to decode plan list: %v", err)
	}
	items := listOut["items"].([]any)
	if len(items) != 0 {
		t.Errorf("archived plan should be hidden from default list, got %d items", len(items))
	}

	res = callTool(t, srv, "zenf_find", map[string]any{
		"type": "plan",
		"filter": map[string]any{
			"include_archived": true,
		},
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &listOut); err != nil {
		t.Fatalf("failed to decode plan list: %v", err)
	}
	items = listOut["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected archived plan in include_archived list, got %+v", items)
	}
}

func TestMCPServer_TaskMediaLifecycle(t *testing.T) {
	t.Setenv("ZENFD_ATTACHMENTS_DIR", t.TempDir())

	srv, store := newTestServer(t)
	ctx := context.Background()

	createPlanTool(t, srv, "media-plan", "Media Plan")

	src := filepath.Join(t.TempDir(), "design.png")
	if err := os.WriteFile(src, []byte("\x89PNG\r\n\x1a\nfake"), 0o644); err != nil {
		t.Fatalf("failed to write fixture: %v", err)
	}

	res := callTool(t, srv, "zenf_create", map[string]any{
		"type": "task",
		"items": []any{
			map[string]any{
				"id":           "m-01",
				"project_slug": "test-project",
				"plan_slug":    "media-plan",
				"title":        "media task",
				"media":        []any{map[string]any{"file_path": src, "name": "Design mockup"}},
			},
		},
	})
	var created struct {
		Media []struct {
			Artifact *domain.Artifact `json:"artifact"`
			Error    string           `json:"error"`
		} `json:"media"`
	}
	if err := json.Unmarshal([]byte(resultText(t, res)), &created); err != nil {
		t.Fatalf("failed to decode create result: %v", err)
	}
	if len(created.Media) != 1 || created.Media[0].Artifact == nil {
		t.Fatalf("expected one attached artifact, got %+v", created.Media)
	}
	artifact := *created.Media[0].Artifact
	if artifact.Role != domain.ArtifactRoleInput || artifact.Name != "Design mockup" {
		t.Errorf("unexpected artifact: %+v", artifact)
	}
	if _, err := os.Stat(artifact.FilePath); err != nil {
		t.Errorf("attached file is missing: %v", err)
	}

	// Detach while READY: row and file both go away.
	callTool(t, srv, "zenf_update", map[string]any{
		"type": "task",
		"items": []any{
			map[string]any{
				"id":           "m-01",
				"media_remove": []string{artifact.ID},
			},
		},
	})
	if _, err := os.Stat(artifact.FilePath); !os.IsNotExist(err) {
		t.Errorf("expected file removal, stat err = %v", err)
	}
	if left, err := store.GetArtifactsByTask(ctx, "m-01", string(domain.ArtifactRoleInput)); err != nil || len(left) != 0 {
		t.Errorf("expected no input artifacts, got %d (err %v)", len(left), err)
	}

	// Attach again while READY, then claim.
	callTool(t, srv, "zenf_update", map[string]any{
		"type": "task",
		"items": []any{
			map[string]any{
				"id":        "m-01",
				"media_add": []any{map[string]any{"file_path": src}},
			},
		},
	})
	artifacts, err := store.GetArtifactsByTask(ctx, "m-01", string(domain.ArtifactRoleInput))
	if err != nil || len(artifacts) != 1 {
		t.Fatalf("expected one re-attached artifact, got %d (err %v)", len(artifacts), err)
	}

	if _, err := store.ClaimTask(ctx, "m-01", domain.ClaimOptions{WorkerID: "worker"}); err != nil {
		t.Fatalf("claim failed: %v", err)
	}
}

func TestMCPServer_CreatePlanWithTasksAndMedia(t *testing.T) {
	t.Setenv("ZENFD_ATTACHMENTS_DIR", t.TempDir())

	srv, store := newTestServer(t)
	ctx := context.Background()

	src := filepath.Join(t.TempDir(), "spec.pdf")
	if err := os.WriteFile(src, []byte("%PDF-1.4 fake"), 0o644); err != nil {
		t.Fatalf("failed to write fixture: %v", err)
	}

	res := callTool(t, srv, "zenf_create", map[string]any{
		"type": "plan",
		"items": []any{
			map[string]any{
				"project_slug": "test-project",
				"slug":         "inline-plan",
				"title":        "Inline DAG",
				"tasks": []any{
					map[string]any{"id": "i-01", "title": "root"},
					map[string]any{
						"id":           "i-02",
						"title":        "child",
						"dependencies": []string{"i-01"},
						"media":        []any{map[string]any{"file_path": src, "name": "Spec"}},
					},
				},
			},
		},
	})
	var payload struct {
		Items []struct {
			TaskIDs []string `json:"task_ids"`
			Media   []struct {
				Artifact *domain.Artifact `json:"artifact"`
				Error    string           `json:"error"`
			} `json:"media"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(resultText(t, res)), &payload); err != nil {
		t.Fatalf("failed to decode create result: %v", err)
	}
	if len(payload.Items) != 1 || len(payload.Items[0].TaskIDs) != 2 {
		t.Fatalf("expected 2 tasks, got %+v", payload)
	}
	if len(payload.Items[0].Media) != 1 || payload.Items[0].Media[0].Artifact == nil {
		t.Fatalf("expected media on the child task, got %+v", payload.Items[0].Media)
	}

	root, err := store.GetTask(ctx, "i-01")
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	child, err := store.GetTask(ctx, "i-02")
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	if root.Status != domain.StatusReady || child.Status != domain.StatusPending {
		t.Errorf("unexpected statuses: root=%s child=%s", root.Status, child.Status)
	}
}

func TestMCPServer_TaskUpdateMetadata(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	createPlanTool(t, srv, "update-plan", "Update")
	createTaskTool(t, srv, "update-plan", map[string]any{"id": "u-01", "title": "old title"})
	createTaskTool(t, srv, "update-plan", map[string]any{"id": "u-02", "title": "blocker"})

	callTool(t, srv, "zenf_update", map[string]any{
		"type": "task",
		"items": []any{
			map[string]any{
				"id":           "u-01",
				"title":        "new title",
				"dependencies": []string{"u-02"},
				"priority":     "P0",
			},
		},
	})

	u01, err := store.GetTask(ctx, "u-01")
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	if u01.Title != "new title" || u01.Priority != domain.PriorityP0 {
		t.Errorf("metadata not applied: %+v", u01)
	}
	if u01.Status != domain.StatusPending {
		t.Errorf("expected PENDING after adding an unfinished dependency, got %s", u01.Status)
	}

	if err := store.UpdateTaskStatus(ctx, "u-02", domain.StatusReady, domain.StatusRunning); err != nil {
		t.Fatalf("failed to start blocker: %v", err)
	}
	if err := store.UpdateTaskStatus(ctx, "u-02", domain.StatusRunning, domain.StatusCompleted); err != nil {
		t.Fatalf("failed to complete blocker: %v", err)
	}
	updated, err := store.GetTask(ctx, "u-01")
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	if updated.Status != domain.StatusReady {
		t.Errorf("expected READY after blocker completion, got %s", updated.Status)
	}
}

func TestMCPServer_TaskAutoRun(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	createPlanTool(t, srv, "autorun-plan", "AutoRun Plan")
	createTaskTool(t, srv, "autorun-plan", map[string]any{
		"id":       "ar-01",
		"title":    "Auto task",
		"auto_run": true,
	})

	task, err := store.GetTask(ctx, "ar-01")
	if err != nil || !task.AutoRun {
		t.Fatalf("expected AutoRun=true, got %v, err=%v", task.AutoRun, err)
	}

	callTool(t, srv, "zenf_update", map[string]any{
		"type": "task",
		"items": []any{
			map[string]any{
				"id":       "ar-01",
				"auto_run": false,
			},
		},
	})
	taskAfter, err := store.GetTask(ctx, "ar-01")
	if err != nil || taskAfter.AutoRun {
		t.Fatalf("expected AutoRun=false after update, got %v", taskAfter.AutoRun)
	}
}

func TestMCPServer_GetTaskPacketOptIn(t *testing.T) {
	srv, _ := newTestServer(t)

	createPlanTool(t, srv, "get-plan", "Get")
	createTaskTool(t, srv, "get-plan", map[string]any{"id": "g-01", "title": "read"})

	res := callTool(t, srv, "zenf_find", map[string]any{
		"type": "task",
		"ids":  []string{"g-01"},
	})
	var out map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("failed to decode metadata: %v", err)
	}
	items := out["items"].([]any)
	item := items[0].(map[string]any)
	if _, ok := item["prompt_markdown"]; ok {
		t.Error("default get must not compile a ContextPacket")
	}

	res = callTool(t, srv, "zenf_find", map[string]any{
		"type":           "task",
		"ids":            []string{"g-01"},
		"include_packet": true,
	})
	if err := json.Unmarshal([]byte(resultText(t, res)), &out); err != nil {
		t.Fatalf("failed to decode packet: %v", err)
	}
	items = out["items"].([]any)
	item = items[0].(map[string]any)
	if item["prompt_markdown"] == "" {
		t.Error("include_packet=true must return the prompt")
	}
}

func TestMCPServer_MixedTransitions(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()

	createPlanTool(t, srv, "mix-plan", "Mix")
	createTaskTool(t, srv, "mix-plan", map[string]any{"id": "x-01", "title": "pass"})
	createTaskTool(t, srv, "mix-plan", map[string]any{"id": "x-02", "title": "fail"})
	for _, id := range []string{"x-01", "x-02"} {
		callTool(t, srv, "claim_task", map[string]any{"task_id": id})
	}

	res := callTool(t, srv, "transition_task", map[string]any{
		"items": []any{
			map[string]any{"task_id": "x-01", "action": "COMPLETE_TASK", "context": map[string]any{"summary": "ok"}},
			map[string]any{"task_id": "x-02", "action": "FAIL_TASK", "context": map[string]any{"reason": "bad"}},
		},
	})
	var payload struct {
		Results []struct {
			TaskID string `json:"task_id"`
			Status string `json:"status"`
			Error  string `json:"error"`
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(resultText(t, res)), &payload); err != nil {
		t.Fatalf("failed to decode results: %v", err)
	}
	if len(payload.Results) != 2 {
		t.Fatalf("expected 2 results, got %+v", payload.Results)
	}
	first, _ := store.GetTask(ctx, "x-01")
	second, _ := store.GetTask(ctx, "x-02")
	if first.Status != domain.StatusCompleted || second.Status != domain.StatusFailed {
		t.Errorf("unexpected statuses: %s / %s", first.Status, second.Status)
	}
}

func TestMCPServer_ResourceRegistry(t *testing.T) {
	srv, _ := newTestServer(t)

	docPath := filepath.Join(t.TempDir(), "spec.md")
	if err := os.WriteFile(docPath, []byte("# Spec\n\nClaim preflight outside the transaction.\n"), 0o644); err != nil {
		t.Fatalf("failed to write document: %v", err)
	}

	res := callTool(t, srv, "zenf_create", map[string]any{
		"type": "resource",
		"items": []any{
			map[string]any{
				"project_slug": "test-project",
				"key":          "SPEC",
				"slug":         "spec",
				"kind":         "spec",
				"type":         "SPEC",
				"scope":        "PROJECT",
				"title":        "Spec",
				"path":         docPath,
				"tags":         []any{"core"},
			},
		},
	})
	var createdOut map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &createdOut); err != nil {
		t.Fatalf("failed to decode resource: %v", err)
	}
	items := createdOut["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("unexpected items count: %d", len(items))
	}
	item := items[0].(map[string]any)
	resID := item["id"].(string)
	if resID == "" {
		t.Fatalf("unexpected empty resource ID: %+v", item)
	}

	res = callTool(t, srv, "zenf_find", map[string]any{
		"type":  "resource",
		"query": "preflight",
	})
	var findOut map[string]any
	if err := json.Unmarshal([]byte(resultText(t, res)), &findOut); err != nil {
		t.Fatalf("failed to decode hits: %v", err)
	}
	findItems := findOut["items"].([]any)
	if len(findItems) != 1 {
		t.Fatalf("unexpected hits: %+v", findItems)
	}
}

func TestMCP_ResourceURLCreateAndUpdate(t *testing.T) {
	srv, store := newTestServer(t)

	callTool(t, srv, "zenf_create", map[string]any{
		"type": "resource",
		"items": []any{map[string]any{
			"project_slug": "test-project",
			"key":          "REF-MCP",
			"slug":         "ref-mcp",
			"kind":         "spec",
			"type":         "REFERENCE",
			"scope":        "PROJECT",
			"title":        "MCP reference",
			"url":          "https://example.com/mcp",
		}},
	})

	created, err := store.GetResourceByKey(context.Background(), "test-project", "REF-MCP")
	if err != nil {
		t.Fatalf("GetResourceByKey failed: %v", err)
	}
	if created.URL != "https://example.com/mcp" {
		t.Fatalf("expected url on create, got %q", created.URL)
	}

	callTool(t, srv, "zenf_update", map[string]any{
		"type": "resource",
		"items": []any{map[string]any{
			"id":  created.ID,
			"url": "https://example.com/mcp-v2",
		}},
	})

	updated, err := store.GetResource(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("GetResource failed: %v", err)
	}
	if updated.URL != "https://example.com/mcp-v2" {
		t.Fatalf("expected url patch to apply, got %q", updated.URL)
	}
}
