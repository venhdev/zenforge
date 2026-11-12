package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"zenf/internal/attachment"
	"zenf/internal/domain"
	"zenf/internal/service"
)

// handleListTasks handles GET /api/v1/tasks?status=
func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	filter := domain.TaskFilter{
		ProjectSlug: query.Get("project_slug"),
		PlanSlug:    query.Get("plan_slug"),
		AgentSlug:   query.Get("agent_slug"),
		OrphanOnly:  query.Get("orphan") == "true",
	}
	if statusStr := query.Get("status"); statusStr != "" {
		filter.Status = domain.TaskStatus(strings.ToUpper(statusStr))
	}

	tasks, err := s.storage.ListTasks(r.Context(), filter)
	if err != nil {
		writeHttpError(w, fmt.Sprintf("failed to query tasks: %v", err), http.StatusInternalServerError)
		return
	}

	if tasks == nil {
		tasks = []domain.Task{}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"tasks": tasks})
}

// handleGetTask handles GET /api/v1/tasks/{id}?include_packet=true
func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}
	if r.URL.Query().Get("include_packet") == "true" {
		packet, err := s.storage.GetTaskContextPacket(r.Context(), taskID)
		if err != nil {
			writeStorageError(w, "load task context packet", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(packet)
		return
	}
	task, err := s.storage.GetTask(r.Context(), taskID)
	if err != nil {
		writeStorageError(w, "load task", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(task)
}

// handleUpdateTaskStatus handles POST /api/v1/tasks/{id}/status
func (s *Server) handleUpdateTaskStatus(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}

	var req struct {
		From        domain.TaskStatus  `json:"from"`
		Status      domain.TaskStatus  `json:"status"`
		Action      string             `json:"action"`
		Reason      string             `json:"reason"`
		Summary     string             `json:"summary"`
		PhaseID     string             `json:"phase_id"`
		PhaseStatus domain.PhaseStatus `json:"phase_status"`
		Notes       string             `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeHttpError(w, fmt.Sprintf("invalid payload: %v", err), http.StatusBadRequest)
		return
	}

	if s.taskService == nil {
		writeHttpError(w, "no task service configured", http.StatusInternalServerError)
		return
	}

	updated, err := s.taskService.TransitionTask(r.Context(), taskID, service.TransitionRequest{
		From:        req.From,
		Status:      req.Status,
		Action:      req.Action,
		Reason:      req.Reason,
		Summary:     req.Summary,
		PhaseID:     req.PhaseID,
		PhaseStatus: req.PhaseStatus,
		Notes:       req.Notes,
	})
	if err != nil {
		writeStorageError(w, "transition task status", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"task_id": updated.ID,
		"status":  string(updated.Status),
	})
}

// handleGetArtifact handles GET /api/v1/artifacts/{id}
func (s *Server) handleGetArtifact(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeHttpError(w, "missing artifact id", http.StatusBadRequest)
		return
	}

	art, err := s.storage.GetArtifact(r.Context(), id)
	if err != nil {
		writeStorageError(w, "load artifact", err)
		return
	}

	fileInfo, err := os.Stat(art.FilePath)
	if err != nil {
		writeHttpError(w, "artifact file not accessible on disk", http.StatusNotFound)
		return
	}
	if fileInfo.IsDir() {
		writeHttpError(w, "artifact cannot be a directory", http.StatusBadRequest)
		return
	}

	if art.MimeType != "" {
		w.Header().Set("Content-Type", art.MimeType)
	}
	http.ServeFile(w, r, art.FilePath)
}

// handleUploadTaskAttachment handles POST /api/v1/tasks/{id}/attachments (multipart/form-data)
func (s *Server) handleUploadTaskAttachment(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}

	if err := r.ParseMultipartForm(attachment.MaxBytes); err != nil {
		writeHttpError(w, fmt.Sprintf("file too large or invalid multipart form: %v", err), http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeHttpError(w, "missing file in form field 'file': "+err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	art, err := attachment.IngestReader(taskID, header.Filename, file, header.Size)
	if err != nil {
		writeHttpError(w, err.Error(), http.StatusBadRequest)
		return
	}
	art.Role = domain.ArtifactRoleInput
	if displayName := r.FormValue("name"); displayName != "" {
		art.Name = displayName
	}

	if err := s.storage.RecordArtifact(r.Context(), art); err != nil {
		writeStorageError(w, "record artifact", err)
		return
	}

	s.Broadcast(domain.EventMessage{
		Type:      "artifact.added",
		TaskID:    taskID,
		Payload:   eventPayload(map[string]string{"artifact_id": art.ID, "role": "INPUT", "name": art.Name, "type": string(art.Type)}),
		Timestamp: art.CreatedAt,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(art)
}

// handleListTaskArtifacts handles GET /api/v1/tasks/{id}/artifacts?role=
func (s *Server) handleListTaskArtifacts(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}

	role := r.URL.Query().Get("role")
	artifacts, err := s.storage.GetArtifactsByTask(r.Context(), taskID, role)
	if err != nil {
		writeHttpError(w, fmt.Sprintf("failed to query artifacts: %v", err), http.StatusInternalServerError)
		return
	}
	if artifacts == nil {
		artifacts = []domain.Artifact{}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"artifacts": artifacts})
}

func (s *Server) handleClaimTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}

	var req struct {
		WorkerID  string `json:"worker_id"`
		SessionID string `json:"session_id"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeHttpError(w, fmt.Sprintf("invalid payload: %v", err), http.StatusBadRequest)
			return
		}
	}

	opts := domain.ClaimOptions{
		WorkerID:  req.WorkerID,
		SessionID: req.SessionID,
	}

	var packet *domain.ContextPacket
	if s.taskService != nil {
		p, err := s.taskService.ClaimTask(r.Context(), taskID, opts)
		if err != nil {
			writeStorageError(w, "claim task", err)
			return
		}
		packet = p
	} else {
		p, err := s.storage.ClaimTask(r.Context(), taskID, opts)
		if err != nil {
			writeStorageError(w, "claim task", err)
			return
		}
		s.Broadcast(domain.EventMessage{
			TaskID:    taskID,
			Type:      "task.status",
			Payload:   eventPayload(map[string]string{"task_id": taskID, "status": string(domain.StatusRunning)}),
			Timestamp: time.Now().UTC(),
		})
		packet = p
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(packet)
}

// GET /api/v1/env/global

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var task domain.Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		writeHttpError(w, fmt.Sprintf("invalid task payload: %v", err), http.StatusBadRequest)
		return
	}

	if task.ID == "" || task.Title == "" {
		writeHttpError(w, "task ID and title are required", http.StatusBadRequest)
		return
	}
	if err := domain.ValidateAgentSlug(r.Context(), s.storage, task.AgentSlug); err != nil {
		writeHttpError(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := s.storage.CreateTasks(r.Context(), []domain.Task{task}); err != nil {
		writeStorageError(w, "create task", err)
		return
	}
	created, err := s.storage.GetTask(r.Context(), task.ID)
	if err != nil {
		writeStorageError(w, "load task", err)
		return
	}

	s.Broadcast(domain.EventMessage{
		ProjectSlug: created.ProjectSlug,
		PlanSlug:    created.PlanSlug,
		TaskID:      created.ID,
		EntityType:  "task",
		EntityID:    created.ID,
		Type:        "task.created",
		Payload:     eventPayload(map[string]string{"id": created.ID, "plan_slug": created.PlanSlug}),
		Timestamp:   time.Now().UTC(),
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(created)
}

// POST /api/v1/tasks/{id}/dependencies
func (s *Server) handleUpdateTaskDependencies(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}

	var req struct {
		Dependencies []string `json:"dependencies"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeHttpError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := s.storage.UpdateTaskDependencies(r.Context(), taskID, req.Dependencies); err != nil {
		writeStorageError(w, "update dependencies", err)
		return
	}

	s.Broadcast(domain.EventMessage{
		TaskID:    taskID,
		Type:      "task.dependencies_updated",
		Payload:   eventPayload(map[string]string{"id": taskID}),
		Timestamp: time.Now().UTC(),
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": taskID, "dependencies": req.Dependencies})
}

// PATCH /api/v1/tasks/{id}
func (s *Server) handleUpdateTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}

	var req struct {
		Title                *string                `json:"title"`
		Description          *string                `json:"description"`
		Dependencies         *[]string              `json:"dependencies"`
		Priority             *domain.TaskPriority   `json:"priority"`
		Complexity           *domain.TaskComplexity `json:"complexity"`
		RiskLevel            *domain.TaskRisk       `json:"risk_level"`
		AgentSlug            *string                `json:"agent_slug"`
		RequiredSkills       *[]string              `json:"required_skills"`
		RequiredDocs         *[]string              `json:"required_docs"`
		TargetFiles          *[]string              `json:"target_files"`
		AcceptanceCriteria   *[]string              `json:"acceptance_criteria"`
		VerificationCommands *[]string              `json:"verification_commands"`
		WorktreePath         *string                `json:"worktree_path"`
		AutoRun              *bool                  `json:"auto_run"`
		Phases               *[]domain.TaskPhase    `json:"phases"`
		CurrentPhase         *string                `json:"current_phase"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeHttpError(w, fmt.Sprintf("invalid payload: %v", err), http.StatusBadRequest)
		return
	}

	patch := domain.TaskPatch{
		Title:                req.Title,
		Description:          req.Description,
		Dependencies:         req.Dependencies,
		Priority:             req.Priority,
		Complexity:           req.Complexity,
		RiskLevel:            req.RiskLevel,
		AgentSlug:            req.AgentSlug,
		RequiredSkills:       req.RequiredSkills,
		RequiredDocs:         req.RequiredDocs,
		TargetFiles:          req.TargetFiles,
		AcceptanceCriteria:   req.AcceptanceCriteria,
		VerificationCommands: req.VerificationCommands,
		WorktreePath:         req.WorktreePath,
		AutoRun:              req.AutoRun,
		Phases:               req.Phases,
		CurrentPhase:         req.CurrentPhase,
	}

	if patch.AgentSlug != nil {
		if err := domain.ValidateAgentSlug(r.Context(), s.storage, *patch.AgentSlug); err != nil {
			writeHttpError(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	if err := s.storage.UpdateTaskMetadata(r.Context(), taskID, patch); err != nil {
		writeStorageError(w, "update task metadata", err)
		return
	}

	updated, err := s.storage.GetTask(r.Context(), taskID)
	if err != nil {
		writeStorageError(w, "load task", err)
		return
	}

	s.Broadcast(domain.EventMessage{
		ProjectSlug: updated.ProjectSlug,
		PlanSlug:    updated.PlanSlug,
		TaskID:      updated.ID,
		EntityType:  "task",
		EntityID:    updated.ID,
		Type:        "task.updated",
		Payload:     eventPayload(map[string]any{"id": updated.ID, "status": string(updated.Status)}),
		Timestamp:   time.Now().UTC(),
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(updated)
}

// DELETE /api/v1/tasks/{id}
func (s *Server) handleDeleteTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}

	task, err := s.storage.GetTask(r.Context(), taskID)
	if err != nil {
		writeStorageError(w, "load task", err)
		return
	}

	if err := s.storage.DeleteTask(r.Context(), taskID); err != nil {
		writeStorageError(w, "delete task", err)
		return
	}

	s.Broadcast(domain.EventMessage{
		ProjectSlug: task.ProjectSlug,
		PlanSlug:    task.PlanSlug,
		TaskID:      taskID,
		EntityType:  "task",
		EntityID:    taskID,
		Type:        "task.deleted",
		Payload:     eventPayload(map[string]string{"id": taskID, "plan_slug": task.PlanSlug}),
		Timestamp:   time.Now().UTC(),
	})

	w.WriteHeader(http.StatusNoContent)
}

// PATCH /api/v1/tasks/{id}/context
func (s *Server) handleUpdateTaskContext(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}

	var req struct {
		Notes string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeHttpError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := s.storage.UpdateTaskNotes(r.Context(), taskID, req.Notes); err != nil {
		writeStorageError(w, "update notes", err)
		return
	}

	s.Broadcast(domain.EventMessage{
		TaskID:    taskID,
		Type:      "task.notes_updated",
		Payload:   eventPayload(map[string]string{"id": taskID}),
		Timestamp: time.Now().UTC(),
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": taskID, "notes": req.Notes})
}

// POST /api/v1/tasks/{id}/evict
func (s *Server) handleEvictTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if taskID == "" {
		writeHttpError(w, "missing task id", http.StatusBadRequest)
		return
	}

	var req struct {
		Reason string `json:"reason"`
		Action string `json:"action"` // "RESET_TO_READY" | "CANCEL"
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeHttpError(w, fmt.Sprintf("invalid payload: %v", err), http.StatusBadRequest)
			return
		}
	}
	if req.Action == "" {
		req.Action = "RESET_TO_READY"
	}

	status, err := s.storage.EvictTask(r.Context(), taskID, req.Reason, req.Action)
	if err != nil {
		writeStorageError(w, "evict task", err)
		return
	}

	s.Broadcast(domain.EventMessage{
		TaskID:    taskID,
		Type:      "task.status",
		Payload:   eventPayload(map[string]string{"task_id": taskID, "status": string(status)}),
		Timestamp: time.Now().UTC(),
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": taskID, "status": status})
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

// GET /api/v1/projects?include_archived=true
