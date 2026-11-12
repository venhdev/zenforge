package service

import (
	"context"
	"errors"
	"testing"

	"zenf/internal/domain"
)

type mockTaskStorage struct {
	tasks           map[string]*domain.Task
	updateStatusErr error
}

func newMockTaskStorage() *mockTaskStorage {
	return &mockTaskStorage{
		tasks: make(map[string]*domain.Task),
	}
}

func (m *mockTaskStorage) GetTask(_ context.Context, id string) (*domain.Task, error) {
	t, ok := m.tasks[id]
	if !ok {
		return nil, errors.New("task not found")
	}
	cp := *t
	return &cp, nil
}

func (m *mockTaskStorage) ClaimTask(_ context.Context, id string, opts domain.ClaimOptions) (*domain.ContextPacket, error) {
	t, ok := m.tasks[id]
	if !ok {
		return nil, errors.New("task not found")
	}
	t.Status = domain.StatusRunning
	t.ClaimedBy = opts.WorkerID
	t.ClaimSessionID = opts.SessionID
	cp := *t
	return &domain.ContextPacket{Task: cp}, nil
}

func (m *mockTaskStorage) UpdateTaskStatus(_ context.Context, id string, from, to domain.TaskStatus) error {
	if m.updateStatusErr != nil {
		return m.updateStatusErr
	}
	t, ok := m.tasks[id]
	if !ok {
		return errors.New("task not found")
	}
	if t.Status != from {
		return errors.New("conflict status")
	}
	t.Status = to
	return nil
}

func (m *mockTaskStorage) UpdateTaskStatusWithNote(_ context.Context, id string, from, to domain.TaskStatus, note string) error {
	if m.updateStatusErr != nil {
		return m.updateStatusErr
	}
	t, ok := m.tasks[id]
	if !ok {
		return errors.New("task not found")
	}
	if t.Status != from {
		return errors.New("conflict status")
	}
	t.Status = to
	if note != "" {
		t.Notes = t.Notes + "\n" + note
	}
	return nil
}

func (m *mockTaskStorage) UpdateTaskMetadata(_ context.Context, id string, patch domain.TaskPatch) error {
	t, ok := m.tasks[id]
	if !ok {
		return errors.New("task not found")
	}
	if patch.Phases != nil {
		t.Phases = *patch.Phases
	}
	if patch.CurrentPhase != nil {
		t.CurrentPhase = *patch.CurrentPhase
	}
	return nil
}

func (m *mockTaskStorage) AppendTaskNotes(_ context.Context, id string, note string) error {
	t, ok := m.tasks[id]
	if !ok {
		return errors.New("task not found")
	}
	t.Notes = t.Notes + "\n" + note
	return nil
}

func (m *mockTaskStorage) EvictTask(_ context.Context, id string, _ string, auditVerb string) (domain.TaskStatus, error) {
	t, ok := m.tasks[id]
	if !ok {
		return "", errors.New("task not found")
	}
	if auditVerb == "CANCEL" {
		t.Status = domain.StatusCancelled
		t.ClaimedBy = ""
		t.ClaimSessionID = ""
		return domain.StatusCancelled, nil
	}
	t.Status = domain.StatusReady
	t.ClaimedBy = ""
	t.ClaimSessionID = ""
	return domain.StatusReady, nil
}

func (m *mockTaskStorage) RequestReview(_ context.Context, id string, reason string, details string, options []string) error {
	t, ok := m.tasks[id]
	if !ok {
		return errors.New("task not found")
	}
	t.Status = domain.StatusAwaitingReview
	t.ReviewReason = reason
	t.ReviewDetails = details
	return nil
}

func (m *mockTaskStorage) ResolveReview(_ context.Context, id string, decision string) error {
	t, ok := m.tasks[id]
	if !ok {
		return errors.New("task not found")
	}
	t.Status = domain.StatusReady
	t.Notes = "Review response: " + decision
	return nil
}

type mockRunnerRegistry struct {
	abortedSessions []string
}

func (m *mockRunnerRegistry) AbortSession(sessionID string) error {
	m.abortedSessions = append(m.abortedSessions, sessionID)
	return nil
}

func (m *mockRunnerRegistry) Unregister(_ string) {}

type mockBroadcaster struct {
	events []domain.EventMessage
}

func (m *mockBroadcaster) Broadcast(msg domain.EventMessage) {
	m.events = append(m.events, msg)
}

func TestTaskService_ClaimTask(t *testing.T) {
	storage := newMockTaskStorage()
	storage.tasks["T-01"] = &domain.Task{
		ID:     "T-01",
		Status: domain.StatusReady,
	}
	reg := &mockRunnerRegistry{}
	bcast := &mockBroadcaster{}

	svc := NewTaskService(storage, reg, bcast)
	packet, err := svc.ClaimTask(context.Background(), "T-01", domain.ClaimOptions{
		WorkerID:  "agent-1",
		SessionID: "sess-123",
	})
	if err != nil {
		t.Fatalf("unexpected claim error: %v", err)
	}
	if packet.Task.Status != domain.StatusRunning {
		t.Errorf("expected status RUNNING, got %s", packet.Task.Status)
	}
	if len(bcast.events) != 1 || bcast.events[0].Type != "task.status" {
		t.Errorf("expected 1 task.status event, got %d", len(bcast.events))
	}
}

func TestTaskService_TransitionTask_Complete(t *testing.T) {
	storage := newMockTaskStorage()
	storage.tasks["T-01"] = &domain.Task{
		ID:     "T-01",
		Status: domain.StatusRunning,
	}
	reg := &mockRunnerRegistry{}
	bcast := &mockBroadcaster{}

	svc := NewTaskService(storage, reg, bcast)
	res, err := svc.TransitionTask(context.Background(), "T-01", TransitionRequest{
		Action:  "COMPLETE",
		Summary: "Finished all work successfully",
	})
	if err != nil {
		t.Fatalf("unexpected transition error: %v", err)
	}
	if res.Status != domain.StatusCompleted {
		t.Errorf("expected status COMPLETED, got %s", res.Status)
	}
	if len(bcast.events) != 1 || bcast.events[0].Type != "task.status" {
		t.Errorf("expected task.status event, got %+v", bcast.events)
	}
}

func TestTaskService_TransitionTask_CancelAbortsSession(t *testing.T) {
	storage := newMockTaskStorage()
	storage.tasks["T-01"] = &domain.Task{
		ID:             "T-01",
		Status:         domain.StatusRunning,
		ClaimSessionID: "sess-active-runner",
	}
	reg := &mockRunnerRegistry{}
	bcast := &mockBroadcaster{}

	svc := NewTaskService(storage, reg, bcast)
	res, err := svc.TransitionTask(context.Background(), "T-01", TransitionRequest{
		Action: "CANCEL",
		Reason: "User cancelled task",
	})
	if err != nil {
		t.Fatalf("unexpected cancel error: %v", err)
	}
	if res.Status != domain.StatusCancelled {
		t.Errorf("expected status CANCELLED, got %s", res.Status)
	}
	if len(reg.abortedSessions) != 1 || reg.abortedSessions[0] != "sess-active-runner" {
		t.Errorf("expected session sess-active-runner to be aborted, got %v", reg.abortedSessions)
	}
}

func TestTaskService_TransitionTask_ResetEvictsTask(t *testing.T) {
	storage := newMockTaskStorage()
	storage.tasks["T-01"] = &domain.Task{
		ID:             "T-01",
		Status:         domain.StatusFailed,
		ClaimedBy:      "worker-1",
		ClaimSessionID: "sess-1",
	}
	reg := &mockRunnerRegistry{}
	bcast := &mockBroadcaster{}

	svc := NewTaskService(storage, reg, bcast)
	res, err := svc.TransitionTask(context.Background(), "T-01", TransitionRequest{
		Action: "RESET",
		Reason: "Retrying failed task",
	})
	if err != nil {
		t.Fatalf("unexpected reset error: %v", err)
	}
	if res.Status != domain.StatusReady {
		t.Errorf("expected status READY, got %s", res.Status)
	}
}

func TestTaskService_TransitionTask_CheckpointPhase(t *testing.T) {
	storage := newMockTaskStorage()
	storage.tasks["T-01"] = &domain.Task{
		ID:           "T-01",
		Status:       domain.StatusRunning,
		CurrentPhase: "ph-1",
		Phases: []domain.TaskPhase{
			{ID: "ph-1", Title: "Phase 1", Status: domain.PhaseRunning},
			{ID: "ph-2", Title: "Phase 2", Status: domain.PhasePending},
		},
	}
	reg := &mockRunnerRegistry{}
	bcast := &mockBroadcaster{}

	svc := NewTaskService(storage, reg, bcast)
	res, err := svc.TransitionTask(context.Background(), "T-01", TransitionRequest{
		Action:      "CHECKPOINT",
		PhaseID:     "ph-1",
		PhaseStatus: domain.PhaseCompleted,
		Summary:     "Phase 1 done",
	})
	if err != nil {
		t.Fatalf("unexpected checkpoint error: %v", err)
	}
	// Task status stays RUNNING
	if res.Status != domain.StatusRunning {
		t.Errorf("expected status RUNNING, got %s", res.Status)
	}
	if res.Phases[0].Status != domain.PhaseCompleted {
		t.Errorf("expected ph-1 COMPLETED, got %s", res.Phases[0].Status)
	}
}

func TestTaskService_TransitionTask_RequestReview(t *testing.T) {
	storage := newMockTaskStorage()
	storage.tasks["T-01"] = &domain.Task{
		ID:     "T-01",
		Status: domain.StatusRunning,
	}
	reg := &mockRunnerRegistry{}
	bcast := &mockBroadcaster{}

	svc := NewTaskService(storage, reg, bcast)
	res, err := svc.TransitionTask(context.Background(), "T-01", TransitionRequest{
		Action:  "REQUEST_REVIEW",
		Reason:  "Blocked on architectural ambiguity",
		Details: "Should we use Strategy or Adapter pattern?",
		Options: []string{"Strategy", "Adapter"},
	})
	if err != nil {
		t.Fatalf("unexpected request review error: %v", err)
	}
	if res.Status != domain.StatusAwaitingReview {
		t.Errorf("expected status AWAITING_REVIEW, got %s", res.Status)
	}
}

func TestTaskService_TransitionTask_ResolveReview(t *testing.T) {
	storage := newMockTaskStorage()
	storage.tasks["T-01"] = &domain.Task{
		ID:     "T-01",
		Status: domain.StatusAwaitingReview,
	}
	reg := &mockRunnerRegistry{}
	bcast := &mockBroadcaster{}

	svc := NewTaskService(storage, reg, bcast)
	res, err := svc.TransitionTask(context.Background(), "T-01", TransitionRequest{
		Action:   "RESOLVE_REVIEW",
		Decision: "Use Adapter pattern",
	})
	if err != nil {
		t.Fatalf("unexpected resolve review error: %v", err)
	}
	if res.Status != domain.StatusReady {
		t.Errorf("expected status READY, got %s", res.Status)
	}
}
