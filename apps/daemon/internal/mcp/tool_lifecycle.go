package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"

	"zenf/internal/domain"
	"zenf/internal/service"
)

// transitionContext encapsulates structured context for task lifecycle transitions.
type transitionContext struct {
	Summary      string   `json:"summary,omitempty"`
	Reason       string   `json:"reason,omitempty"`
	ErrorDetails string   `json:"error_details,omitempty"`
	Artifacts    []string `json:"artifacts,omitempty"`
	PhaseID      string   `json:"phase_id,omitempty"`
	PhaseStatus  string   `json:"phase_status,omitempty"`
	Details      string   `json:"details,omitempty"`
	Options      []string `json:"options,omitempty"`
	Decision     string   `json:"decision,omitempty"`
	Instructions string   `json:"instructions,omitempty"`
}

func (s *Server) registerWorkflowTools() {
	s.mcpServer.AddTool(
		mcp.NewTool("claim_task",
			mcp.WithDescription("Atomically claims a READY task with mutual exclusion, transitions it to RUNNING, and returns its ContextPacket."),
			mcp.WithString("task_id", mcp.Required(), mcp.Description("Unique task ID to claim")),
			mcp.WithString("worker_id", mcp.Description("Optional worker or subagent identifier")),
			mcp.WithString("session_id", mcp.Description("Optional runner session id to link the claim to a live stream")),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			taskID, err := request.RequireString("task_id")
			if err != nil {
				return toolError("%v", err), nil
			}
			opts := domain.ClaimOptions{
				WorkerID:  request.GetString("worker_id", ""),
				SessionID: request.GetString("session_id", ""),
			}
			var packet *domain.ContextPacket
			if s.taskService != nil {
				packet, err = s.taskService.ClaimTask(ctx, taskID, opts)
			} else {
				packet, err = s.store.ClaimTask(ctx, taskID, opts)
			}
			if err != nil {
				return toolError("failed to claim task %s: %v", taskID, err), nil
			}
			return marshalToolResult(packet), nil
		},
	)

	s.mcpServer.AddTool(
		mcp.NewTool("transition_task",
			mcp.WithDescription("Applies a lifecycle state transition to one or more tasks. Supports explicit action verbs (COMPLETE_TASK, FAIL_TASK, CHECKPOINT_PHASE, REQUEST_REVIEW, RESOLVE_REVIEW, RESET_TO_READY, CANCEL_TASK) and structured context."),
			mcp.WithArray("task_ids", mcp.Description("List of task IDs for a shared action")),
			mcp.WithString("task_id", mcp.Description("Single task ID (convenience alternative to task_ids)")),
			mcp.WithString("action", mcp.Description("Action verb: COMPLETE_TASK, FAIL_TASK, CHECKPOINT_PHASE, REQUEST_REVIEW, RESOLVE_REVIEW, RESET_TO_READY, CANCEL_TASK")),
			mcp.WithObject("context", mcp.Description("Action-specific structured context (summary, reason, error_details, artifacts, phase_id, phase_status, details, options, decision, instructions)")),
			mcp.WithArray("items", mcp.Description("Mixed per-task transitions, each with task_id, action, and optional context")),
			// Backwards compatibility flat arguments
			mcp.WithString("reason", mcp.Description("Failure, reset, or cancellation reason")),
			mcp.WithString("summary", mcp.Description("Completion summary")),
			mcp.WithString("phase_id", mcp.Description("Target phase ID for CHECKPOINT")),
			mcp.WithString("phase_status", mcp.Description("Target phase status for CHECKPOINT")),
			mcp.WithString("details", mcp.Description("Detailed explanation for review request")),
			mcp.WithArray("options", mcp.Description("Choice strings for review request")),
			mcp.WithString("response", mcp.Description("Human decision for review resolution")),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			args := request.GetArguments()
			taskIDs := request.GetStringSlice("task_ids", nil)
			if singleID := request.GetString("task_id", ""); singleID != "" && len(taskIDs) == 0 {
				taskIDs = []string{singleID}
			}
			action := request.GetString("action", "")

			// Parse structured context or fallback to top-level fields
			tCtx := s.extractTransitionContext(args)

			type taskResult struct {
				TaskID string `json:"task_id"`
				Status string `json:"status,omitempty"`
				Error  string `json:"error,omitempty"`
			}
			results := []taskResult{}

			if rawItems, ok := args["items"]; ok && rawItems != nil {
				if len(taskIDs) > 0 || action != "" {
					return toolError("provide either items or task_ids + action, not both"), nil
				}
				items, ok := rawItems.([]any)
				if !ok || len(items) == 0 {
					return toolError("items must be a non-empty array"), nil
				}
				for i, raw := range items {
					itemMap, ok := raw.(map[string]any)
					if !ok {
						results = append(results, taskResult{Error: fmt.Sprintf("invalid item %d: expected object", i)})
						continue
					}
					itemTaskID, _ := itemMap["task_id"].(string)
					itemAction, _ := itemMap["action"].(string)
					if itemTaskID == "" || itemAction == "" {
						results = append(results, taskResult{TaskID: itemTaskID, Error: fmt.Sprintf("item %d requires task_id and action", i)})
						continue
					}
					itemContext := s.extractTransitionContext(itemMap)
					status, err := s.applySingleTransition(ctx, itemTaskID, itemAction, itemContext)
					if err != nil {
						results = append(results, taskResult{TaskID: itemTaskID, Error: err.Error()})
						continue
					}
					results = append(results, taskResult{TaskID: itemTaskID, Status: string(status)})
				}
				return marshalToolResult(map[string]any{"results": results}), nil
			}

			if len(taskIDs) == 0 {
				return toolError("task_ids must contain at least one task ID"), nil
			}
			if action == "" {
				return toolError("action is required with task_ids"), nil
			}

			for _, taskID := range taskIDs {
				status, err := s.applySingleTransition(ctx, taskID, action, tCtx)
				if err != nil {
					results = append(results, taskResult{TaskID: taskID, Error: err.Error()})
					continue
				}
				results = append(results, taskResult{TaskID: taskID, Status: string(status)})
			}

			return marshalToolResult(map[string]any{"results": results}), nil
		},
	)
}

func (s *Server) extractTransitionContext(args map[string]any) transitionContext {
	var tCtx transitionContext
	if rawCtx, ok := args["context"]; ok && rawCtx != nil {
		if encoded, err := json.Marshal(rawCtx); err == nil {
			_ = json.Unmarshal(encoded, &tCtx)
		}
	}
	// Fallback to top-level properties if context fields are empty
	if tCtx.Summary == "" {
		if v, ok := args["summary"].(string); ok {
			tCtx.Summary = v
		}
	}
	if tCtx.Reason == "" {
		if v, ok := args["reason"].(string); ok {
			tCtx.Reason = v
		}
	}
	if tCtx.PhaseID == "" {
		if v, ok := args["phase_id"].(string); ok {
			tCtx.PhaseID = v
		}
	}
	if tCtx.PhaseStatus == "" {
		if v, ok := args["phase_status"].(string); ok {
			tCtx.PhaseStatus = v
		}
	}
	if tCtx.Details == "" {
		if v, ok := args["details"].(string); ok {
			tCtx.Details = v
		}
	}
	if len(tCtx.Options) == 0 {
		if rawOpts, ok := args["options"].([]any); ok {
			opts := make([]string, 0, len(rawOpts))
			for _, opt := range rawOpts {
				if s, ok := opt.(string); ok {
					opts = append(opts, s)
				}
			}
			tCtx.Options = opts
		}
	}
	if tCtx.Decision == "" {
		if v, ok := args["response"].(string); ok {
			tCtx.Decision = v
		} else if v, ok := args["decision"].(string); ok {
			tCtx.Decision = v
		}
	}
	return tCtx
}

// applySingleTransition dispatches a single task lifecycle action with structured context.
func (s *Server) applySingleTransition(ctx context.Context, taskID string, action string, tCtx transitionContext) (domain.TaskStatus, error) {
	if s.taskService == nil {
		return "", fmt.Errorf("task service is uninitialized")
	}

	summary := tCtx.Summary
	if len(tCtx.Artifacts) > 0 {
		artifactsStr := "Artifacts: " + strings.Join(tCtx.Artifacts, ", ")
		if summary != "" {
			summary = summary + " | " + artifactsStr
		} else {
			summary = artifactsStr
		}
	}

	reason := tCtx.Reason
	if tCtx.ErrorDetails != "" {
		if reason != "" {
			reason = reason + " | Error: " + tCtx.ErrorDetails
		} else {
			reason = "Error: " + tCtx.ErrorDetails
		}
	}

	decision := tCtx.Decision
	if decision == "" {
		decision = tCtx.Instructions
	}

	updated, err := s.taskService.TransitionTask(ctx, taskID, service.TransitionRequest{
		Action:      action,
		Reason:      reason,
		Details:     tCtx.Details,
		Options:     tCtx.Options,
		Decision:    decision,
		Summary:     summary,
		PhaseID:     tCtx.PhaseID,
		PhaseStatus: domain.PhaseStatus(tCtx.PhaseStatus),
	})
	if err != nil {
		return "", err
	}
	return updated.Status, nil
}
