package storage_test

import (
	"context"
	"errors"
	"testing"

	"zenf/internal/domain"
	"zenf/internal/storage"
)

func TestTaskStore_CreateScopedTasks(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedPlan(t, store, ctx, "alpha", "p1", nil)

	if err := store.CreateTasks(ctx, []domain.Task{
		{ID: "PROJ-1", ProjectSlug: "alpha", Title: "Project task"},
	}); err != nil {
		t.Fatalf("create project task failed: %v", err)
	}
	if err := store.CreateTasks(ctx, []domain.Task{
		{ID: "PLAN-1", PlanSlug: "p1", Title: "Plan task"},
	}); err != nil {
		t.Fatalf("create plan task failed: %v", err)
	}
	if err := store.CreateTasks(ctx, []domain.Task{
		{ID: "ORPHAN-1", Title: "Orphan task"},
	}); err != nil {
		t.Fatalf("create orphan task failed: %v", err)
	}

	projectTask := mustTask(t, store, ctx, "PROJ-1")
	if projectTask.Scope() != domain.ScopeProject || projectTask.ProjectSlug != "alpha" {
		t.Fatalf("unexpected project task scope: %+v", projectTask)
	}
	if projectTask.Status != domain.StatusReady {
		t.Fatalf("project task status = %s, want READY", projectTask.Status)
	}

	planTask := mustTask(t, store, ctx, "PLAN-1")
	if planTask.Scope() != domain.ScopePlan || planTask.ProjectSlug != "alpha" || planTask.PlanSlug != "p1" {
		t.Fatalf("expected plan task to inherit project, got %+v", planTask)
	}

	orphan := mustTask(t, store, ctx, "ORPHAN-1")
	if orphan.Scope() != domain.ScopeOrphan {
		t.Fatalf("unexpected orphan scope: %+v", orphan)
	}
}

func TestTaskStore_RejectsCrossContainerBatch(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedProject(t, store, ctx, "beta")

	err := store.CreateTasks(ctx, []domain.Task{
		{ID: "A", ProjectSlug: "alpha", Title: "A"},
		{ID: "B", ProjectSlug: "beta", Title: "B"},
	})
	if !errors.Is(err, storage.ErrInvalidGraph) {
		t.Fatalf("expected ErrInvalidGraph for cross-container batch, got %v", err)
	}
	if _, err := store.GetTask(ctx, "A"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected batch rollback, got %v", err)
	}
}

func TestTaskStore_ListFilters(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedProject(t, store, ctx, "beta")
	seedPlan(t, store, ctx, "alpha", "p1", []domain.Task{
		{ID: "P1-A", Title: "Plan A", Status: domain.StatusReady, AgentSlug: "coder"},
	})
	if err := store.CreateTasks(ctx, []domain.Task{
		{ID: "PROJ-A", ProjectSlug: "alpha", Title: "Project A", Status: domain.StatusRunning},
	}); err != nil {
		t.Fatalf("create project task failed: %v", err)
	}
	if err := store.CreateTasks(ctx, []domain.Task{
		{ID: "ORPHAN-A", Title: "Orphan A"},
	}); err != nil {
		t.Fatalf("create orphan task failed: %v", err)
	}

	byPlan, err := store.ListTasks(ctx, domain.TaskFilter{PlanSlug: "p1"})
	if err != nil || len(byPlan) != 1 || byPlan[0].ID != "P1-A" {
		t.Fatalf("unexpected plan filter result: %+v, err=%v", byPlan, err)
	}
	byProject, err := store.ListTasks(ctx, domain.TaskFilter{ProjectSlug: "alpha"})
	if err != nil || len(byProject) != 2 {
		t.Fatalf("unexpected project filter result: %+v, err=%v", byProject, err)
	}
	byStatus, err := store.ListTasks(ctx, domain.TaskFilter{ProjectSlug: "alpha", Status: domain.StatusRunning})
	if err != nil || len(byStatus) != 1 || byStatus[0].ID != "PROJ-A" {
		t.Fatalf("unexpected status filter result: %+v, err=%v", byStatus, err)
	}
	byAgent, err := store.ListTasks(ctx, domain.TaskFilter{AgentSlug: "coder"})
	if err != nil || len(byAgent) != 1 || byAgent[0].ID != "P1-A" {
		t.Fatalf("unexpected agent filter result: %+v, err=%v", byAgent, err)
	}
	orphans, err := store.ListTasks(ctx, domain.TaskFilter{OrphanOnly: true})
	if err != nil || len(orphans) != 1 || orphans[0].ID != "ORPHAN-A" {
		t.Fatalf("unexpected orphan filter result: %+v, err=%v", orphans, err)
	}

	planTasks, err := store.GetTasksByPlan(ctx, "p1")
	if err != nil || len(planTasks) != 1 || planTasks[0].ID != "P1-A" {
		t.Fatalf("unexpected GetTasksByPlan result: %+v, err=%v", planTasks, err)
	}
}

func TestTaskStore_DependencyPolicy(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedProject(t, store, ctx, "beta")
	seedPlan(t, store, ctx, "alpha", "p1", nil)
	if err := store.CreateTasks(ctx, []domain.Task{
		{ID: "BETA-1", ProjectSlug: "beta", Title: "Beta task"},
	}); err != nil {
		t.Fatalf("create beta task failed: %v", err)
	}

	if err := store.CreateTasks(ctx, []domain.Task{
		{ID: "P1-A", PlanSlug: "p1", Title: "A"},
		{ID: "P1-B", PlanSlug: "p1", Title: "B", Dependencies: []string{"P1-A"}},
	}); err != nil {
		t.Fatalf("create plan DAG failed: %v", err)
	}
	if got := mustTask(t, store, ctx, "P1-B").Status; got != domain.StatusPending {
		t.Fatalf("dependent status = %s, want PENDING", got)
	}

	crossContainer := []domain.Task{
		{ID: "P1-C", PlanSlug: "p1", Title: "C", Dependencies: []string{"BETA-1"}},
	}
	if err := store.CreateTasks(ctx, crossContainer); !errors.Is(err, storage.ErrInvalidGraph) {
		t.Fatalf("expected ErrInvalidGraph for cross-container dependency, got %v", err)
	}

	selfDependency := []domain.Task{{ID: "SELF", Title: "Self", Dependencies: []string{"SELF"}}}
	if err := store.CreateTasks(ctx, selfDependency); !errors.Is(err, storage.ErrInvalidGraph) {
		t.Fatalf("expected ErrInvalidGraph for self dependency, got %v", err)
	}
}

func TestTaskStore_CycleRejectedOnMetadataUpdate(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedPlan(t, store, ctx, "alpha", "p1", []domain.Task{
		{ID: "A", Title: "A"},
		{ID: "B", Title: "B", Dependencies: []string{"A"}},
	})

	err := store.UpdateTaskMetadata(ctx, "A", domain.TaskPatch{Dependencies: &[]string{"B"}})
	if !errors.Is(err, storage.ErrInvalidGraph) {
		t.Fatalf("expected ErrInvalidGraph for cycle, got %v", err)
	}
	task := mustTask(t, store, ctx, "A")
	if len(task.Dependencies) != 0 {
		t.Fatalf("expected failed update to roll back, got %+v", task.Dependencies)
	}
}

func TestTaskStore_UpdateMetadataAndDependencies(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedPlan(t, store, ctx, "alpha", "p1", []domain.Task{
		{ID: "A", Title: "Old", Description: "old"},
		{ID: "B", Title: "B"},
	})

	patch := domain.TaskPatch{
		Title:                ptr("New"),
		Description:          ptr("new"),
		Priority:             ptr(domain.PriorityP0),
		Complexity:           ptr(domain.ComplexityHigh),
		RiskLevel:            ptr(domain.RiskHigh),
		AgentSlug:            ptr("coder"),
		RequiredSkills:       &[]string{"tdd"},
		RequiredDocs:         &[]string{"ARCH"},
		TargetFiles:          &[]string{"a.go"},
		AcceptanceCriteria:   &[]string{"passes"},
		VerificationCommands: &[]string{"go test ./..."},
		WorktreePath:         ptr("/tmp/wt"),
	}
	if err := store.UpdateTaskMetadata(ctx, "A", patch); err != nil {
		t.Fatalf("UpdateTaskMetadata failed: %v", err)
	}
	task := mustTask(t, store, ctx, "A")
	if task.Title != "New" || task.Priority != domain.PriorityP0 || task.AgentSlug != "coder" ||
		task.WorktreePath != "/tmp/wt" {
		t.Fatalf("metadata patch not applied: %+v", task)
	}
	if len(task.RequiredDocs) != 1 || task.RequiredDocs[0] != "ARCH" {
		t.Fatalf("required docs not applied: %+v", task.RequiredDocs)
	}

	if err := store.UpdateTaskDependencies(ctx, "A", []string{"B"}); err != nil {
		t.Fatalf("UpdateTaskDependencies failed: %v", err)
	}
	task = mustTask(t, store, ctx, "A")
	if len(task.Dependencies) != 1 || task.Dependencies[0] != "B" {
		t.Fatalf("dependencies not updated: %+v", task.Dependencies)
	}
	if task.Status != domain.StatusPending {
		t.Fatalf("expected A PENDING after depending on B, got %s", task.Status)
	}
}

func TestTaskStore_MetadataLockedAfterClaim(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedPlan(t, store, ctx, "alpha", "p1", []domain.Task{
		{ID: "A", Title: "A", Status: domain.StatusRunning},
	})

	err := store.UpdateTaskMetadata(ctx, "A", domain.TaskPatch{Title: ptr("New")})
	if !errors.Is(err, storage.ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState while RUNNING, got %v", err)
	}
}

func TestTaskStore_NotesAppend(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedPlan(t, store, ctx, "alpha", "p1", []domain.Task{{ID: "A", Title: "A"}})

	if err := store.AppendTaskNotes(ctx, "A", "first"); err != nil {
		t.Fatalf("AppendTaskNotes failed: %v", err)
	}
	if err := store.AppendTaskNotes(ctx, "A", "second"); err != nil {
		t.Fatalf("AppendTaskNotes failed: %v", err)
	}
	task := mustTask(t, store, ctx, "A")
	if task.Notes != "first\nsecond" {
		t.Fatalf("notes = %q, want first\\nsecond", task.Notes)
	}
}

func TestTaskStore_DuplicateID(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")

	if err := store.CreateTasks(ctx, []domain.Task{{ID: "A", ProjectSlug: "alpha", Title: "A"}}); err != nil {
		t.Fatalf("create failed: %v", err)
	}
	err := store.CreateTasks(ctx, []domain.Task{{ID: "A", ProjectSlug: "alpha", Title: "again"}})
	if !errors.Is(err, storage.ErrAlreadyExists) {
		t.Fatalf("expected ErrAlreadyExists, got %v", err)
	}
}

func TestTaskStore_AutoRunPersistenceAndFilter(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedPlan(t, store, ctx, "alpha", "p1", []domain.Task{
		{ID: "TASK-AUTO", Title: "Auto Task", Status: domain.StatusReady, AutoRun: true},
		{ID: "TASK-MANUAL", Title: "Manual Task", Status: domain.StatusReady, AutoRun: false},
	})

	taskAuto, err := store.GetTask(ctx, "TASK-AUTO")
	if err != nil || !taskAuto.AutoRun {
		t.Fatalf("expected AutoRun=true on TASK-AUTO, got %v, err=%v", taskAuto.AutoRun, err)
	}

	taskManual, err := store.GetTask(ctx, "TASK-MANUAL")
	if err != nil || taskManual.AutoRun {
		t.Fatalf("expected AutoRun=false on TASK-MANUAL, got %v, err=%v", taskManual.AutoRun, err)
	}

	trueVal := true
	if err := store.UpdateTaskMetadata(ctx, "TASK-MANUAL", domain.TaskPatch{AutoRun: &trueVal}); err != nil {
		t.Fatalf("UpdateTaskMetadata failed: %v", err)
	}
	updated, err := store.GetTask(ctx, "TASK-MANUAL")
	if err != nil || !updated.AutoRun {
		t.Fatalf("expected AutoRun to be updated to true, got %v", updated.AutoRun)
	}

	autoOnly, err := store.ListTasks(ctx, domain.TaskFilter{PlanSlug: "p1", AutoRun: &trueVal})
	if err != nil || len(autoOnly) != 2 {
		t.Fatalf("expected 2 auto tasks, got %d, err=%v", len(autoOnly), err)
	}
}

func TestTaskStore_DeleteTaskCascadesAndResyncsDAG(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedPlan(t, store, ctx, "alpha", "p1", nil)

	// Create 3 tasks: A -> B -> C
	tasks := []domain.Task{
		{ID: "A", PlanSlug: "p1", Title: "Task A", Status: domain.StatusPending},
		{ID: "B", PlanSlug: "p1", Title: "Task B", Dependencies: []string{"A"}, Status: domain.StatusPending},
		{ID: "C", PlanSlug: "p1", Title: "Task C", Dependencies: []string{"B"}, Status: domain.StatusPending},
	}
	if err := store.CreateTasks(ctx, tasks); err != nil {
		t.Fatalf("CreateTasks failed: %v", err)
	}

	taskA := mustTask(t, store, ctx, "A")
	if taskA.Status != domain.StatusReady {
		t.Fatalf("expected A to be READY, got %s", taskA.Status)
	}
	taskB := mustTask(t, store, ctx, "B")
	if taskB.Status != domain.StatusPending {
		t.Fatalf("expected B to be PENDING, got %s", taskB.Status)
	}

	// Delete task A: task B should lose its dependency on A and automatically become READY
	if err := store.DeleteTask(ctx, "A"); err != nil {
		t.Fatalf("DeleteTask A failed: %v", err)
	}

	if _, err := store.GetTask(ctx, "A"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected A to be deleted, got %v", err)
	}

	taskBAfter := mustTask(t, store, ctx, "B")
	if len(taskBAfter.Dependencies) != 0 {
		t.Fatalf("expected B dependencies to be empty after A deleted, got %+v", taskBAfter.Dependencies)
	}
	if taskBAfter.Status != domain.StatusReady {
		t.Fatalf("expected B to resync to READY, got %s", taskBAfter.Status)
	}

	// Deleting non-existent task returns ErrNotFound
	if err := store.DeleteTask(ctx, "NONEXISTENT"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent task, got %v", err)
	}
}

// A task authored without optional lists must still persist JSON arrays, not
// "null": the schema declares `[]` and every reader assumes an array shape.
func TestTaskStore_NilStringSlicesPersistAsArrays(t *testing.T) {
	db, err := storage.Open(t.TempDir() + "/state.db")
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	store := storage.NewStore(db)
	ctx := context.Background()

	seedProject(t, store, ctx, "alpha")
	if err := store.CreateTasks(ctx, []domain.Task{{
		ID: "NIL-1", ProjectSlug: "alpha", Title: "Nil lists",
	}}); err != nil {
		t.Fatalf("CreateTasks failed: %v", err)
	}

	var deps, skills, docs, files, criteria, verif, options string
	err = db.QueryRow(ctx, `SELECT dependencies, required_skills, required_docs, target_files,
		acceptance_criteria, verification_commands, review_options FROM tasks WHERE id = 'NIL-1'`).
		Scan(&deps, &skills, &docs, &files, &criteria, &verif, &options)
	if err != nil {
		t.Fatalf("read raw task row failed: %v", err)
	}
	for column, value := range map[string]string{
		"dependencies": deps, "required_skills": skills, "required_docs": docs,
		"target_files": files, "acceptance_criteria": criteria,
		"verification_commands": verif, "review_options": options,
	} {
		if value != "[]" {
			t.Errorf("%s = %q, want []", column, value)
		}
	}
}
