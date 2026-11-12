package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"zenf/internal/domain"
)

// TaskStorage defines the persistence seam required by TaskService.
type TaskStorage interface {
	GetTask(ctx context.Context, id string) (*domain.Task, error)
	ClaimTask(ctx context.Context, id string, opts domain.ClaimOptions) (*domain.ContextPacket, error)
	UpdateTaskStatus(ctx context.Context, id string, from, to domain.TaskStatus) error
	UpdateTaskStatusWithNote(ctx context.Context, id string, from, to domain.TaskStatus, note string) error
	UpdateTaskMetadata(ctx context.Context, id string, patch domain.TaskPatch) error
	AppendTaskNotes(ctx context.Context, id string, note string) error
	EvictTask(ctx context.Context, id string, reason string, auditVerb string) (domain.TaskStatus, error)
	RequestReview(ctx context.Context, id string, reason string, details string, options []string) error
	ResolveReview(ctx context.Context, id string, decision string) error
}

// RunnerRegistry defines the execution session seam required for process cleanup.
type RunnerRegistry interface {
	AbortSession(sessionID string) error
	Unregister(sessionID string)
}

// EventBroadcaster abstracts real-time event dissemination.
type EventBroadcaster interface {
	Broadcast(msg domain.EventMessage)
}

// TransitionRequest describes a task status or phase change request.
type TransitionRequest struct {
	From        domain.TaskStatus
	Status      domain.TaskStatus
	Action      string
	Reason      string
	Details     string
	Options     []string
	Decision    string
	Summary     string
	PhaseID     string
	PhaseStatus domain.PhaseStatus
	Notes       string
}

// TaskService orchestrates atomic domain task transitions across all transport seams.
type TaskService interface {
	TransitionTask(ctx context.Context, taskID string, req TransitionRequest) (*domain.Task, error)
	ClaimTask(ctx context.Context, taskID string, opts domain.ClaimOptions) (*domain.ContextPacket, error)
}

// taskService implements TaskService.
type taskService struct {
	storage     TaskStorage
	registry    RunnerRegistry
	broadcaster EventBroadcaster
}

// NewTaskService constructs an application TaskService with explicit dependencies.
func NewTaskService(storage TaskStorage, registry RunnerRegistry, broadcaster EventBroadcaster) TaskService {
	return &taskService{
		storage:     storage,
		registry:    registry,
		broadcaster: broadcaster,
	}
}

// ClaimTask atomically preflight-claims a READY task and broadcasts the RUNNING state.
func (s *taskService) ClaimTask(ctx context.Context, taskID string, opts domain.ClaimOptions) (*domain.ContextPacket, error) {
	if s.storage == nil {
		return nil, errors.New("no storage configured")
	}

	packet, err := s.storage.ClaimTask(ctx, taskID, opts)
	if err != nil {
		return nil, err
	}

	if s.broadcaster != nil {
		s.broadcaster.Broadcast(domain.EventMessage{
			Type:      "task.status",
			TaskID:    taskID,
			Payload:   statusPayload(taskID, domain.StatusRunning),
			Timestamp: time.Now().UTC(),
		})
	}

	return packet, nil
}

// TransitionTask applies atomic domain validation, phase checkpoints, runner cleanup, and status updates.
func (s *taskService) TransitionTask(ctx context.Context, taskID string, req TransitionRequest) (*domain.Task, error) {
	if taskID == "" {
		return nil, errors.New("missing task id")
	}
	if s.storage == nil {
		return nil, errors.New("no storage configured")
	}

	current, err := s.storage.GetTask(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("load task: %w", err)
	}

	action := strings.ToUpper(strings.TrimSpace(req.Action))
	if action == "" {
		switch req.Status {
		case domain.StatusCompleted:
			action = "COMPLETE"
		case domain.StatusFailed:
			action = "FAIL"
		case domain.StatusCancelled:
			action = "CANCEL"
		case domain.StatusReady:
			if current.Status == domain.StatusFailed || current.Status == domain.StatusCancelled {
				action = "RESET"
			}
		}
	}

	switch action {
	case "REQUEST_REVIEW", "REQUEST":
		reason := req.Reason
		if reason == "" {
			reason = "Review requested"
		}
		details := req.Details
		if details == "" {
			details = reason
		}
		if err := s.storage.RequestReview(ctx, taskID, reason, details, req.Options); err != nil {
			return nil, err
		}
		if s.broadcaster != nil {
			s.broadcaster.Broadcast(domain.EventMessage{
				Type:      "task.status",
				TaskID:    taskID,
				Payload:   statusPayload(taskID, domain.StatusAwaitingReview),
				Timestamp: time.Now().UTC(),
			})
		}
		return s.storage.GetTask(ctx, taskID)

	case "RESOLVE_REVIEW", "RESOLVE":
		decision := req.Decision
		if decision == "" {
			decision = "Review approved"
		}
		if err := s.storage.ResolveReview(ctx, taskID, decision); err != nil {
			return nil, err
		}
		if s.broadcaster != nil {
			s.broadcaster.Broadcast(domain.EventMessage{
				Type:      "task.status",
				TaskID:    taskID,
				Payload:   statusPayload(taskID, domain.StatusReady),
				Timestamp: time.Now().UTC(),
			})
		}
		return s.storage.GetTask(ctx, taskID)

	case "CANCEL_TASK", "CANCEL":
		reason := req.Reason
		if reason == "" {
			reason = "Cancelled"
		}
		if current.ClaimSessionID != "" && s.registry != nil {
			_ = s.registry.AbortSession(current.ClaimSessionID)
		}
		if current.Status == domain.StatusRunning {
			_, err := s.storage.EvictTask(ctx, taskID, reason, "CANCEL")
			if err != nil {
				return nil, err
			}
		} else if current.Status != domain.StatusCancelled {
			if err := s.storage.UpdateTaskStatusWithNote(ctx, taskID, current.Status, domain.StatusCancelled, reason); err != nil {
				return nil, err
			}
		}
		if s.broadcaster != nil {
			s.broadcaster.Broadcast(domain.EventMessage{
				Type:      "task.status",
				TaskID:    taskID,
				Payload:   statusPayload(taskID, domain.StatusCancelled),
				Timestamp: time.Now().UTC(),
			})
		}
		return s.storage.GetTask(ctx, taskID)

	case "RESET_TO_READY", "RESET":
		resetReason := req.Reason
		if resetReason == "" {
			resetReason = "Reset by operator"
		}
		newStatus, err := s.storage.EvictTask(ctx, taskID, resetReason, "RESET_TO_READY")
		if err != nil {
			return nil, fmt.Errorf("reset task: %w", err)
		}
		if req.Notes != "" {
			_ = s.storage.AppendTaskNotes(ctx, taskID, req.Notes)
		}
		if s.broadcaster != nil {
			s.broadcaster.Broadcast(domain.EventMessage{
				Type:      "task.status",
				TaskID:    taskID,
				Payload:   statusPayload(taskID, newStatus),
				Timestamp: time.Now().UTC(),
			})
		}
		return s.storage.GetTask(ctx, taskID)
	}

	if action != "" {
		evalRes, evalErr := domain.EvaluateTransition(*current, domain.TransitionTaskRequest{
			Action:      action,
			Reason:      req.Reason,
			Summary:     req.Summary,
			PhaseID:     req.PhaseID,
			PhaseStatus: req.PhaseStatus,
			Notes:       req.Notes,
		})
		if evalErr != nil {
			return nil, evalErr
		}

		if evalRes.PhasesUpdated {
			_ = s.storage.UpdateTaskMetadata(ctx, taskID, domain.TaskPatch{
				Phases:       &evalRes.Phases,
				CurrentPhase: &evalRes.CurrentPhase,
			})
		}

		targetStatus := evalRes.TargetStatus

		// On cancellation or terminal failure, terminate active session if one is registered
		if (targetStatus == domain.StatusCancelled || targetStatus == domain.StatusFailed) && current.ClaimSessionID != "" {
			if s.registry != nil {
				_ = s.registry.AbortSession(current.ClaimSessionID)
			}
		}

		if targetStatus != current.Status {
			err = s.storage.UpdateTaskStatusWithNote(ctx, taskID, current.Status, targetStatus, evalRes.AuditNote)
			if err != nil {
				return nil, fmt.Errorf("transition task status: %w", err)
			}
		} else if evalRes.AuditNote != "" {
			_ = s.storage.AppendTaskNotes(ctx, taskID, evalRes.AuditNote)
		}

		if s.broadcaster != nil {
			s.broadcaster.Broadcast(domain.EventMessage{
				Type:      "task.status",
				TaskID:    taskID,
				Payload:   statusPayload(taskID, targetStatus),
				Timestamp: time.Now().UTC(),
			})
		}

		return s.storage.GetTask(ctx, taskID)
	}

	// Fallback raw status transition (when action verb is empty and not inferrable)
	fromStatus := req.From
	if fromStatus == "" {
		fromStatus = current.Status
	}

	if req.Status == domain.StatusCancelled && current.ClaimSessionID != "" && s.registry != nil {
		_ = s.registry.AbortSession(current.ClaimSessionID)
	}

	err = s.storage.UpdateTaskStatus(ctx, taskID, fromStatus, req.Status)
	if err != nil {
		return nil, fmt.Errorf("update task status: %w", err)
	}

	if s.broadcaster != nil {
		s.broadcaster.Broadcast(domain.EventMessage{
			Type:      "task.status",
			TaskID:    taskID,
			Payload:   statusPayload(taskID, req.Status),
			Timestamp: time.Now().UTC(),
		})
	}

	return s.storage.GetTask(ctx, taskID)
}

func statusPayload(taskID string, status domain.TaskStatus) string {
	b, _ := json.Marshal(map[string]string{"task_id": taskID, "status": string(status)})
	return string(b)
}
