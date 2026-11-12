package gateway

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"zenf/internal/attachment"
	"zenf/internal/domain"
	"zenf/internal/storage"
)

func setupTestGateway(t *testing.T) (*Server, string, *storage.Store, func()) {
	t.Helper()

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_gateway.db")

	db, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("failed to init storage: %v", err)
	}

	store := storage.NewStore(db)
	if err := store.CreateProject(context.Background(), domain.Project{
		Slug: "test-project", Name: "Test Project", RootPath: tempDir,
	}); err != nil {
		t.Fatalf("failed to seed project: %v", err)
	}

	srv := NewServer(store)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	baseURL := fmt.Sprintf("http://%s", ln.Addr().String())

	go func() {
		_ = srv.Serve(ln)
	}()

	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
		_ = db.Close()
	}

	return srv, baseURL, store, cleanup
}

func TestGateway_PlansAndTasksLifecycle(t *testing.T) {
	_, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	// 1. POST /api/v1/plans
	planPayload := CreatePlanRequest{
		Slug:        "plan-alpha",
		ProjectSlug: "test-project",
		Title:       "Alpha Engineering Plan",
		Tasks: []domain.Task{
			{ID: "T-01", Title: "Scaffold Schema", Dependencies: []string{}},
			{ID: "T-02", Title: "Compile Engine", Dependencies: []string{"T-01"}},
		},
	}

	bodyBytes, _ := json.Marshal(planPayload)
	postResp, err := http.Post(baseURL+"/api/v1/plans", "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		t.Fatalf("failed to post plan: %v", err)
	}
	defer postResp.Body.Close()

	if postResp.StatusCode != http.StatusCreated {
		t.Fatalf("expected status 201 Created, got %d", postResp.StatusCode)
	}

	// 2. GET /api/v1/plans/plan-alpha
	getResp, err := http.Get(baseURL + "/api/v1/plans/plan-alpha")
	if err != nil {
		t.Fatalf("failed to get plan: %v", err)
	}
	defer getResp.Body.Close()

	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d", getResp.StatusCode)
	}

	var planData struct {
		Plan  domain.Plan   `json:"plan"`
		Tasks []domain.Task `json:"tasks"`
	}
	if err := json.NewDecoder(getResp.Body).Decode(&planData); err != nil {
		t.Fatalf("failed to decode plan response: %v", err)
	}

	if planData.Plan.Slug != "plan-alpha" || len(planData.Tasks) != 2 {
		t.Fatalf("unexpected plan payload: %+v", planData)
	}

	// 3. GET /api/v1/tasks?status=READY
	listResp, err := http.Get(baseURL + "/api/v1/tasks?status=READY")
	if err != nil {
		t.Fatalf("failed to list tasks: %v", err)
	}
	defer listResp.Body.Close()

	var taskPayload struct {
		Tasks []domain.Task `json:"tasks"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&taskPayload); err != nil {
		t.Fatalf("failed to decode task response: %v", err)
	}
	if len(taskPayload.Tasks) != 1 || taskPayload.Tasks[0].ID != "T-01" {
		t.Fatalf("expected 1 READY task (T-01), got: %+v", taskPayload.Tasks)
	}

	// 4. Test PATCH /api/v1/tasks/T-01
	newTitle := "Scaffold Schema Updated"
	trueVal := true
	patchBody, _ := json.Marshal(map[string]any{
		"title":    newTitle,
		"auto_run": trueVal,
	})
	patchReq, _ := http.NewRequest("PATCH", baseURL+"/api/v1/tasks/T-01", bytes.NewReader(patchBody))
	patchReq.Header.Set("Content-Type", "application/json")
	patchResp, err := http.DefaultClient.Do(patchReq)
	if err != nil {
		t.Fatalf("failed to patch task: %v", err)
	}
	defer patchResp.Body.Close()
	if patchResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK for PATCH task, got %d", patchResp.StatusCode)
	}
	var updatedTask domain.Task
	if err := json.NewDecoder(patchResp.Body).Decode(&updatedTask); err != nil {
		t.Fatalf("failed to decode patched task: %v", err)
	}
	if updatedTask.Title != newTitle || !updatedTask.AutoRun {
		t.Fatalf("unexpected patched task data: %+v", updatedTask)
	}

	// 5. Test DELETE /api/v1/tasks/T-01 (should cascade remove T-01 from T-02 deps and make T-02 READY)
	delReq, _ := http.NewRequest("DELETE", baseURL+"/api/v1/tasks/T-01", nil)
	delResp, err := http.DefaultClient.Do(delReq)
	if err != nil {
		t.Fatalf("failed to delete task: %v", err)
	}
	defer delResp.Body.Close()
	if delResp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for DELETE task, got %d", delResp.StatusCode)
	}

	// Verify T-02 is now READY and has no dependencies
	getT02Resp, err := http.Get(baseURL + "/api/v1/tasks/T-02")
	if err != nil {
		t.Fatalf("failed to get T-02: %v", err)
	}
	defer getT02Resp.Body.Close()
	var t02 domain.Task
	if err := json.NewDecoder(getT02Resp.Body).Decode(&t02); err != nil {
		t.Fatalf("failed to decode T-02: %v", err)
	}
	if t02.Status != domain.StatusReady || len(t02.Dependencies) != 0 {
		t.Fatalf("expected T-02 to be READY with 0 deps after T-01 deleted, got: status=%s, deps=%+v", t02.Status, t02.Dependencies)
	}
}

func TestGateway_ListPlansIncludesPlanWithoutTasks(t *testing.T) {
	_, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	bodyBytes, _ := json.Marshal(CreatePlanRequest{Slug: "empty-plan", ProjectSlug: "test-project", Title: "Empty Plan"})
	resp, err := http.Post(baseURL+"/api/v1/plans", "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		t.Fatalf("failed to post plan: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected status 201 Created, got %d", resp.StatusCode)
	}

	listResp, err := http.Get(baseURL + "/api/v1/plans")
	if err != nil {
		t.Fatalf("failed to list plans: %v", err)
	}
	defer listResp.Body.Close()

	var payload struct {
		Plans []domain.Plan `json:"plans"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode plans response: %v", err)
	}

	for _, plan := range payload.Plans {
		if plan.Slug == "empty-plan" {
			if plan.Title != "Empty Plan" {
				t.Errorf("expected plan title to be returned, got %q", plan.Title)
			}
			return
		}
	}
	t.Fatalf("expected empty plan in /api/v1/plans, got: %+v", payload.Plans)
}

func TestGateway_SSEEventStreaming(t *testing.T) {
	srv, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "GET", baseURL+"/api/v1/events/stream", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("failed to connect to SSE stream: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK for SSE, got %d", resp.StatusCode)
	}

	reader := bufio.NewReader(resp.Body)

	// First line should be initial ping
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("failed to read initial SSE line: %v", err)
	}
	if !strings.Contains(line, "event: ping") {
		t.Fatalf("expected event: ping, got %s", line)
	}

	// Trigger broadcast
	go func() {
		time.Sleep(50 * time.Millisecond)
		srv.Broadcast(domain.EventMessage{
			Type:      "task.status",
			TaskID:    "T-01",
			Payload:   `{"status":"RUNNING"}`,
			Timestamp: time.Now().UTC(),
		})
	}()

	// Read until our broadcast event appears
	received := false
	for i := 0; i < 10; i++ {
		line, err = reader.ReadString('\n')
		if err != nil {
			break
		}
		if strings.Contains(line, "task.status") {
			received = true
			break
		}
	}

	if !received {
		t.Fatalf("did not receive broadcasted task.status event via SSE")
	}
}

func TestGateway_ArtifactServing(t *testing.T) {
	_, baseURL, store, cleanup := setupTestGateway(t)
	defer cleanup()

	tempDir := t.TempDir()
	artPath := filepath.Join(tempDir, "notes.md")
	artContent := "--- a/main.go\n+++ b/main.go\n@@ -1,2 +1,3 @@\n+package main\n"
	if err := os.WriteFile(artPath, []byte(artContent), 0644); err != nil {
		t.Fatalf("failed to create artifact file: %v", err)
	}

	plan := domain.Plan{Slug: "plan-art", ProjectSlug: "test-project", Title: "Art Plan", Status: domain.PlanStatusActive}
	task := domain.Task{ID: "task-100", ProjectSlug: "test-project", PlanSlug: "plan-art", Title: "Art Task", Status: domain.StatusReady}
	if err := store.CreatePlanWithTasks(context.Background(), plan, []domain.Task{task}); err != nil {
		t.Fatalf("failed to save plan and task: %v", err)
	}

	art := domain.Artifact{
		ID:        "art-100",
		TaskID:    "task-100",
		Type:      domain.ArtifactTypeMarkdown,
		FilePath:  artPath,
		MimeType:  "text/markdown",
		ByteSize:  int64(len(artContent)),
		Sha256:    "abc1234",
		CreatedAt: time.Now().UTC(),
	}

	if err := store.RecordArtifact(context.Background(), art); err != nil {
		t.Fatalf("failed to record artifact in storage: %v", err)
	}

	// GET /api/v1/artifacts/art-100
	resp, err := http.Get(baseURL + "/api/v1/artifacts/art-100")
	if err != nil {
		t.Fatalf("failed to retrieve artifact: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}

	var buf bytes.Buffer
	_, _ = buf.ReadFrom(resp.Body)
	if buf.String() != artContent {
		t.Fatalf("expected artifact content, got %s", buf.String())
	}
}

func TestGateway_StaticSPA(t *testing.T) {
	_, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	// GET /
	resp, err := http.Get(baseURL + "/")
	if err != nil {
		t.Fatalf("failed to get root: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}

	// GET /unknown-client-route (SPA fallback)
	resp2, err := http.Get(baseURL + "/dag/visualizer")
	if err != nil {
		t.Fatalf("failed to get client route: %v", err)
	}
	defer resp2.Body.Close()

	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on client route fallback, got %d", resp2.StatusCode)
	}
}

func TestGateway_TaskAttachmentsAndLogs(t *testing.T) {
	_, baseURL, store, cleanup := setupTestGateway(t)
	defer cleanup()

	plan := domain.Plan{Slug: "plan-attach", ProjectSlug: "test-project", Title: "Attach Plan", Status: domain.PlanStatusActive}
	task := domain.Task{ID: "task-attach-1", ProjectSlug: "test-project", PlanSlug: "plan-attach", Title: "Attach Task", Status: domain.StatusReady}
	if err := store.CreatePlanWithTasks(context.Background(), plan, []domain.Task{task}); err != nil {
		t.Fatalf("failed to save plan and task: %v", err)
	}

	// 1. Test POST /api/v1/tasks/{id}/attachments (multipart upload)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "mockup.png")
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	_, _ = part.Write([]byte("fake-png-binary-content"))
	_ = writer.WriteField("name", "Design Mockup")
	_ = writer.Close()

	uploadReq, _ := http.NewRequest("POST", baseURL+"/api/v1/tasks/task-attach-1/attachments", &body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())

	uploadResp, err := http.DefaultClient.Do(uploadReq)
	if err != nil {
		t.Fatalf("failed to upload attachment: %v", err)
	}
	defer uploadResp.Body.Close()

	if uploadResp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d", uploadResp.StatusCode)
	}

	var createdArt domain.Artifact
	if err := json.NewDecoder(uploadResp.Body).Decode(&createdArt); err != nil {
		t.Fatalf("failed to decode created artifact: %v", err)
	}
	if createdArt.Role != domain.ArtifactRoleInput || createdArt.Name != "Design Mockup" {
		t.Errorf("unexpected artifact payload: %+v", createdArt)
	}

	// 2. Test GET /api/v1/tasks/{id}/artifacts
	listResp, err := http.Get(baseURL + "/api/v1/tasks/task-attach-1/artifacts")
	if err != nil {
		t.Fatalf("failed to list artifacts: %v", err)
	}
	defer listResp.Body.Close()

	var artPayload struct {
		Artifacts []domain.Artifact `json:"artifacts"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&artPayload); err != nil {
		t.Fatalf("failed to decode artifact list: %v", err)
	}
	artList := artPayload.Artifacts
	if len(artList) != 1 || artList[0].ID != createdArt.ID {
		t.Errorf("expected 1 artifact in list, got %+v", artList)
	}

}

func TestGateway_ResourceRegistry(t *testing.T) {
	_, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	docPath := filepath.Join(t.TempDir(), "architecture.md")
	content := "# Architecture\n\nClaim preflight keeps packet assembly outside the transaction.\n"
	if err := os.WriteFile(docPath, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write document: %v", err)
	}

	payload := map[string]any{
		"project_slug": "test-project",
		"key":          "ARCH",
		"slug":         "architecture",
		"kind":         "spec",
		"type":         "ARCHITECTURE",
		"scope":        "PROJECT",
		"title":        "Architecture",
		"path":         docPath,
		"summary":      "Registry probe",
		"tags":         []string{"architecture", "core"},
	}
	body, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/api/v1/resources", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("create resource failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	var created domain.Resource
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("failed to decode resource: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected generated resource id in response")
	}
	if created.ContentHash == "" || created.ByteSize == 0 {
		t.Fatalf("expected hash and size, got %+v", created)
	}

	listResp, err := http.Get(baseURL + "/api/v1/resources?project_slug=test-project&include_global=true")
	if err != nil {
		t.Fatalf("list resources failed: %v", err)
	}
	defer listResp.Body.Close()
	var list struct {
		Resources []domain.Resource `json:"resources"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&list); err != nil {
		t.Fatalf("failed to decode resource list: %v", err)
	}
	if len(list.Resources) != 1 || list.Resources[0].ID != created.ID {
		t.Fatalf("unexpected resource list: %+v", list.Resources)
	}

	searchResp, err := http.Get(baseURL + "/api/v1/resources/search?query=preflight&project_slug=test-project&include_global=true")
	if err != nil {
		t.Fatalf("search resources failed: %v", err)
	}
	defer searchResp.Body.Close()
	var searchPayload struct {
		Results []domain.ResourceSearchResult `json:"results"`
	}
	if err := json.NewDecoder(searchResp.Body).Decode(&searchPayload); err != nil {
		t.Fatalf("failed to decode search hits: %v", err)
	}
	hits := searchPayload.Results
	if len(hits) != 1 || hits[0].Resource.ID != created.ID {
		t.Fatalf("unexpected search hits: %+v", hits)
	}

	refreshBody := strings.NewReader(`{"content":"# Architecture v2\n\nUpdated claim preflight.\n"}`)
	refreshResp, err := http.Post(baseURL+"/api/v1/resources/"+created.ID+"/refresh", "application/json", refreshBody)
	if err != nil {
		t.Fatalf("refresh resource failed: %v", err)
	}
	defer refreshResp.Body.Close()
	var refreshed domain.Resource
	if err := json.NewDecoder(refreshResp.Body).Decode(&refreshed); err != nil {
		t.Fatalf("failed to decode refreshed resource: %v", err)
	}
	if refreshed.Version != 2 || refreshed.ContentHash == created.ContentHash {
		t.Fatalf("expected version 2 with new hash, got %+v", refreshed)
	}

	// Test Native Resource with Blocks projection
	nativePayload := map[string]any{
		"project_slug": "test-project",
		"key":          "ENCYCLOPEDIA_TEST",
		"slug":         "encyclopedia-test",
		"kind":         "spec",
		"types":        []string{"research", "rules"},
		"scope":        "PROJECT",
		"title":        "Encyclopedia Test",
		"content":      "# Section\n\n```mermaid\ngraph LR\nA-->B\n```\n",
	}
	nativeBody, _ := json.Marshal(nativePayload)
	nResp, err := http.Post(baseURL+"/api/v1/resources", "application/json", bytes.NewReader(nativeBody))
	if err != nil {
		t.Fatalf("create native resource failed: %v", err)
	}
	defer nResp.Body.Close()
	if nResp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 for native resource, got %d", nResp.StatusCode)
	}
	var nativeResource domain.Resource
	_ = json.NewDecoder(nResp.Body).Decode(&nativeResource)

	// Fetch with ?format=blocks
	bResp, err := http.Get(baseURL + "/api/v1/resources/" + nativeResource.ID + "?format=blocks")
	if err != nil {
		t.Fatalf("get resource with format=blocks failed: %v", err)
	}
	defer bResp.Body.Close()
	var resourceWithBlocks domain.Resource
	_ = json.NewDecoder(bResp.Body).Decode(&resourceWithBlocks)
	if len(resourceWithBlocks.Blocks) != 2 {
		t.Fatalf("expected 2 parsed blocks, got %d", len(resourceWithBlocks.Blocks))
	}
	if resourceWithBlocks.Blocks[1].Type != "diagram" || resourceWithBlocks.Blocks[1].Format != "mermaid" {
		t.Fatalf("expected second block diagram/mermaid, got %s/%s", resourceWithBlocks.Blocks[1].Type, resourceWithBlocks.Blocks[1].Format)
	}
}

func TestGateway_JSONErrorFormat(t *testing.T) {
	_, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	resp, err := http.Get(baseURL + "/api/v1/tasks/non-existent-task-id")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
	var errResp ErrorResponse
	if err := json.NewDecoder(resp.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error.Code != "RESOURCE_NOT_FOUND" {
		t.Errorf("expected RESOURCE_NOT_FOUND code, got %q", errResp.Error.Code)
	}
}

func TestGateway_AgentRegistry(t *testing.T) {
	_, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	body := strings.NewReader(`{"slug":"coder-a","name":"Coder A","mode":"HEADLESS","goal":"implement","start_conditions":{"task_status":"READY"},"stop_conditions":{"on_failure":"AWAITING_REVIEW"},"enabled":true}`)
	resp, err := http.Post(baseURL+"/api/v1/agents", "application/json", body)
	if err != nil {
		t.Fatalf("create agent failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	var created domain.Agent
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("failed to decode agent: %v", err)
	}
	if created.Mode != domain.AgentModeHeadless || !created.Enabled {
		t.Fatalf("unexpected agent: %+v", created)
	}

	patchBody := strings.NewReader(`{"enabled":false}`)
	req, _ := http.NewRequest(http.MethodPatch, baseURL+"/api/v1/agents/coder-a", patchBody)
	req.Header.Set("Content-Type", "application/json")
	patchResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("update agent failed: %v", err)
	}
	defer patchResp.Body.Close()
	var updated domain.Agent
	if err := json.NewDecoder(patchResp.Body).Decode(&updated); err != nil {
		t.Fatalf("failed to decode updated agent: %v", err)
	}
	if updated.Enabled {
		t.Fatal("expected agent to be disabled")
	}
}

func TestGateway_RuntimeTelemetryStatus(t *testing.T) {
	_, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	resp, err := http.Get(baseURL + "/api/v1/status")
	if err != nil {
		t.Fatalf("get status failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK from /api/v1/status, got %d", resp.StatusCode)
	}

	var tm RuntimeTelemetryResponse
	if err := json.NewDecoder(resp.Body).Decode(&tm); err != nil {
		t.Fatalf("failed to decode telemetry response: %v", err)
	}

	if tm.PID <= 0 {
		t.Errorf("expected positive PID, got %d", tm.PID)
	}
	if tm.Goroutines <= 0 {
		t.Errorf("expected positive Goroutines, got %d", tm.Goroutines)
	}
	if tm.RSSBytes == 0 || tm.HeapAllocBytes == 0 || tm.SysBytes == 0 {
		t.Errorf("expected non-zero memory telemetry, got RSS=%d Heap=%d Sys=%d", tm.RSSBytes, tm.HeapAllocBytes, tm.SysBytes)
	}
	if tm.OS == "" || tm.Arch == "" {
		t.Errorf("expected OS/Arch populated, got %s/%s", tm.OS, tm.Arch)
	}
}

func TestGateway_AgentSoulKeyValidation(t *testing.T) {
	_, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	soulPayload := map[string]any{
		"project_slug": "test-project",
		"key":          "SOUL_DEBUGGER",
		"slug":         "debugger",
		"kind":         "soul",
		"type":         "GUIDE",
		"scope":        "PROJECT",
		"title":        "Debugger Soul",
		"format":       "markdown",
		"content":      "---\nname: debugger\nskills: [recon, diagnose]\n---\nYou are a debugger.",
	}
	soulBody, _ := json.Marshal(soulPayload)
	soulResp, err := http.Post(baseURL+"/api/v1/resources", "application/json", bytes.NewReader(soulBody))
	if err != nil {
		t.Fatalf("create soul failed: %v", err)
	}
	defer soulResp.Body.Close()
	if soulResp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 for soul, got %d", soulResp.StatusCode)
	}

	// A soul_key bound to a real soul resource is accepted.
	good := strings.NewReader(`{"slug":"debug-bot","name":"Debug Bot","soul_key":"SOUL_DEBUGGER","enabled":true}`)
	goodResp, err := http.Post(baseURL+"/api/v1/agents", "application/json", good)
	if err != nil {
		t.Fatalf("create agent failed: %v", err)
	}
	defer goodResp.Body.Close()
	if goodResp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", goodResp.StatusCode)
	}

	// A soul_key that resolves to no soul resource is rejected.
	bad := strings.NewReader(`{"slug":"bad-bot","name":"Bad Bot","soul_key":"NOPE","enabled":true}`)
	badResp, err := http.Post(baseURL+"/api/v1/agents", "application/json", bad)
	if err != nil {
		t.Fatalf("create bad agent failed: %v", err)
	}
	defer badResp.Body.Close()
	if badResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown soul_key, got %d", badResp.StatusCode)
	}
}

func TestGateway_ResourceFilesLifecycle(t *testing.T) {
	_, baseURL, store, cleanup := setupTestGateway(t)
	defer cleanup()
	t.Setenv(attachment.RootEnv, t.TempDir())

	// A resource carrying an external link instead of a local path.
	linkBody, _ := json.Marshal(map[string]any{
		"project_slug": "test-project",
		"key":          "REF-ONE",
		"slug":         "ref-one",
		"kind":         "spec",
		"type":         "REFERENCE",
		"scope":        "PROJECT",
		"title":        "Reference one",
		"url":          "https://example.com/ref",
		"summary":      "external reference",
	})
	linkResp, err := http.Post(baseURL+"/api/v1/resources", "application/json", bytes.NewReader(linkBody))
	if err != nil {
		t.Fatalf("create link resource failed: %v", err)
	}
	defer linkResp.Body.Close()
	if linkResp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 for url resource, got %d", linkResp.StatusCode)
	}
	var link domain.Resource
	if err := json.NewDecoder(linkResp.Body).Decode(&link); err != nil {
		t.Fatalf("decode resource: %v", err)
	}
	if link.URL != "https://example.com/ref" {
		t.Fatalf("expected url to roundtrip, got %q", link.URL)
	}

	// Refresh must refuse a URL-only resource instead of touching the filesystem.
	refreshResp, err := http.Post(baseURL+"/api/v1/resources/"+link.ID+"/refresh", "application/json", bytes.NewReader([]byte(`{}`)))
	if err != nil {
		t.Fatalf("refresh request failed: %v", err)
	}
	defer refreshResp.Body.Close()
	if refreshResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 when refreshing an external link, got %d", refreshResp.StatusCode)
	}

	// Upload a file owned by the resource.
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", "diagram.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write([]byte("\x89PNG\r\n\x1a\nfake")); err != nil {
		t.Fatalf("write part: %v", err)
	}
	_, _ = writer.CreateFormField("name")
	_ = writer.Close()

	uploadReq, _ := http.NewRequest(http.MethodPost, baseURL+"/api/v1/resources/"+link.ID+"/files", &buf)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadResp, err := http.DefaultClient.Do(uploadReq)
	if err != nil {
		t.Fatalf("upload failed: %v", err)
	}
	defer uploadResp.Body.Close()
	if uploadResp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 for upload, got %d", uploadResp.StatusCode)
	}
	var file domain.Artifact
	if err := json.NewDecoder(uploadResp.Body).Decode(&file); err != nil {
		t.Fatalf("decode file: %v", err)
	}
	if file.ResourceID != link.ID || file.TaskID != "" {
		t.Fatalf("expected resource ownership, got %+v", file)
	}
	onDisk := file.FilePath
	if _, err := os.Stat(onDisk); err != nil {
		t.Fatalf("expected stored file on disk: %v", err)
	}

	// List.
	listResp, err := http.Get(baseURL + "/api/v1/resources/" + link.ID + "/files")
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	defer listResp.Body.Close()
	var listPayload struct {
		Files []domain.Artifact `json:"files"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listPayload.Files) != 1 || listPayload.Files[0].ID != file.ID {
		t.Fatalf("expected one file, got %+v", listPayload.Files)
	}

	// Download through the shared artifact route.
	downloadResp, err := http.Get(baseURL + "/api/v1/artifacts/" + file.ID)
	if err != nil {
		t.Fatalf("download failed: %v", err)
	}
	defer downloadResp.Body.Close()
	if downloadResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for download, got %d", downloadResp.StatusCode)
	}

	// Delete removes the row and the bytes when nothing else references them.
	delReq, _ := http.NewRequest(http.MethodDelete, baseURL+"/api/v1/resources/"+link.ID+"/files/"+file.ID, nil)
	delResp, err := http.DefaultClient.Do(delReq)
	if err != nil {
		t.Fatalf("delete failed: %v", err)
	}
	defer delResp.Body.Close()
	if delResp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 for delete, got %d", delResp.StatusCode)
	}
	if _, err := store.GetArtifact(context.Background(), file.ID); err == nil {
		t.Fatal("expected artifact row to be removed")
	}
	if _, err := os.Stat(onDisk); !os.IsNotExist(err) {
		t.Fatalf("expected backing file to be removed")
	}
}
