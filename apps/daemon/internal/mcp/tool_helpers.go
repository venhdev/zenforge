package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	"zenf/internal/attachment"
	"zenf/internal/domain"
)

// mediaInput is a local file to copy into the attachment store.
type mediaInput struct {
	FilePath string `json:"file_path"`
	Name     string `json:"name"`
}

// mediaResult reports one attach attempt.
type mediaResult struct {
	TaskID   string           `json:"task_id"`
	FilePath string           `json:"file_path,omitempty"`
	Artifact *domain.Artifact `json:"artifact,omitempty"`
	Error    string           `json:"error,omitempty"`
}

// mediaRemoveResult reports one detach attempt.
type mediaRemoveResult struct {
	TaskID     string `json:"task_id"`
	ArtifactID string `json:"artifact_id"`
	Removed    bool   `json:"removed"`
	Error      string `json:"error,omitempty"`
}

// taskInput is the wire shape accepted by zenf_create and zenf_update.
type taskInput struct {
	ID                   string             `json:"id"`
	Title                string             `json:"title"`
	Description          string             `json:"description"`
	Dependencies         []string           `json:"dependencies"`
	TargetFiles          []string           `json:"target_files"`
	Skills               []string           `json:"skills"`
	Docs                 []string           `json:"docs"`
	Resources            []string           `json:"resources"`
	AcceptanceCriteria   []string           `json:"acceptance_criteria"`
	VerificationCommands []string           `json:"verification_commands"`
	Priority             string             `json:"priority"`
	Complexity           string             `json:"complexity"`
	RiskLevel            string             `json:"risk_level"`
	AgentSlug            string             `json:"agent_slug"`
	WorktreePath         string             `json:"worktree_path"`
	AutoRun              bool               `json:"auto_run"`
	Phases               []domain.TaskPhase `json:"phases"`
	CurrentPhase         string             `json:"current_phase"`
	Media                []mediaInput       `json:"media"`
}

func toDomainTask(projectSlug, planSlug string, in taskInput) domain.Task {
	priority := domain.TaskPriority(in.Priority)
	if priority == "" {
		priority = domain.PriorityP2
	}
	complexity := domain.TaskComplexity(in.Complexity)
	if complexity == "" {
		complexity = domain.ComplexityMedium
	}
	risk := domain.TaskRisk(in.RiskLevel)
	if risk == "" {
		risk = domain.RiskLow
	}
	status := domain.StatusPending
	if len(in.Dependencies) == 0 {
		status = domain.StatusReady
	}
	reqDocs := in.Resources
	if len(reqDocs) == 0 {
		reqDocs = in.Docs
	}

	task := domain.Task{
		ID:                   in.ID,
		ProjectSlug:          projectSlug,
		PlanSlug:             planSlug,
		Title:                in.Title,
		Description:          in.Description,
		Dependencies:         in.Dependencies,
		TargetFiles:          in.TargetFiles,
		RequiredSkills:       in.Skills,
		RequiredDocs:         reqDocs,
		AcceptanceCriteria:   in.AcceptanceCriteria,
		VerificationCommands: in.VerificationCommands,
		Priority:             priority,
		Complexity:           complexity,
		RiskLevel:            risk,
		AgentSlug:            in.AgentSlug,
		WorktreePath:         in.WorktreePath,
		AutoRun:              in.AutoRun,
		Status:               status,
		Phases:               in.Phases,
		CurrentPhase:         in.CurrentPhase,
	}
	if len(in.Phases) > 0 && in.CurrentPhase == "" {
		task.CurrentPhase = in.Phases[0].ID
		if in.Phases[0].Status == "" {
			task.Phases[0].Status = domain.PhasePending
		}
	}
	return task
}

func parseTaskInputs(projectSlug, planSlug string, raw []any) ([]domain.Task, map[string][]mediaInput, error) {
	tasks := make([]domain.Task, 0, len(raw))
	media := make(map[string][]mediaInput)

	for i, item := range raw {
		encoded, err := json.Marshal(item)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid task at index %d: %v", i, err)
		}
		var in taskInput
		if err := json.Unmarshal(encoded, &in); err != nil {
			return nil, nil, fmt.Errorf("invalid task at index %d: %v", i, err)
		}
		if in.ID == "" || in.Title == "" {
			return nil, nil, fmt.Errorf("task at index %d requires id and title", i)
		}
		tasks = append(tasks, toDomainTask(projectSlug, planSlug, in))
		if len(in.Media) > 0 {
			media[in.ID] = in.Media
		}
	}
	return tasks, media, nil
}

func (s *Server) attachMedia(ctx context.Context, taskID string, items []mediaInput) []mediaResult {
	results := make([]mediaResult, 0, len(items))
	for _, item := range items {
		if item.FilePath == "" {
			results = append(results, mediaResult{TaskID: taskID, Error: "file_path is required"})
			continue
		}

		artifact, err := attachment.Ingest(taskID, item.FilePath, item.Name)
		if err != nil {
			results = append(results, mediaResult{TaskID: taskID, FilePath: item.FilePath, Error: err.Error()})
			continue
		}
		if err := s.store.RecordArtifact(ctx, artifact); err != nil {
			_ = os.Remove(artifact.FilePath)
			results = append(results, mediaResult{TaskID: taskID, FilePath: item.FilePath, Error: err.Error()})
			continue
		}
		results = append(results, mediaResult{TaskID: taskID, FilePath: item.FilePath, Artifact: &artifact})
	}
	return results
}

func (s *Server) attachMediaForTasks(ctx context.Context, media map[string][]mediaInput) []mediaResult {
	results := []mediaResult{}
	if len(media) == 0 {
		return results
	}

	ids := make([]string, 0, len(media))
	for id := range media {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		results = append(results, s.attachMedia(ctx, id, media[id])...)
	}
	return results
}

func (s *Server) removeMedia(ctx context.Context, taskID string, ids []string) []mediaRemoveResult {
	results := make([]mediaRemoveResult, 0, len(ids))
	for _, id := range ids {
		artifact, err := s.store.DeleteArtifact(ctx, taskID, id)
		if err != nil {
			results = append(results, mediaRemoveResult{TaskID: taskID, ArtifactID: id, Error: err.Error()})
			continue
		}
		if err := attachment.Remove(artifact.FilePath); err != nil {
			results = append(results, mediaRemoveResult{TaskID: taskID, ArtifactID: id, Error: err.Error()})
			continue
		}
		results = append(results, mediaRemoveResult{TaskID: taskID, ArtifactID: id, Removed: true})
	}
	return results
}

type taskUpdatePayload struct {
	Title                *string             `json:"title"`
	Description          *string             `json:"description"`
	Dependencies         *[]string           `json:"dependencies"`
	TargetFiles          *[]string           `json:"target_files"`
	Skills               *[]string           `json:"skills"`
	Docs                 *[]string           `json:"docs"`
	Resources            *[]string           `json:"resources"`
	AcceptanceCriteria   *[]string           `json:"acceptance_criteria"`
	VerificationCommands *[]string           `json:"verification_commands"`
	Priority             *string             `json:"priority"`
	Complexity           *string             `json:"complexity"`
	RiskLevel            *string             `json:"risk_level"`
	AgentSlug            *string             `json:"agent_slug"`
	WorktreePath         *string             `json:"worktree_path"`
	AutoRun              *bool               `json:"auto_run"`
	Phases               *[]domain.TaskPhase `json:"phases"`
	CurrentPhase         *string             `json:"current_phase"`
	MediaAdd             []mediaInput        `json:"media_add"`
	MediaRemove          []string            `json:"media_remove"`
}

func parseTaskPatch(args map[string]any) (domain.TaskPatch, []mediaInput, []string, error) {
	encoded, err := json.Marshal(args)
	if err != nil {
		return domain.TaskPatch{}, nil, nil, err
	}
	var payload taskUpdatePayload
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return domain.TaskPatch{}, nil, nil, err
	}

	reqDocs := payload.Resources
	if reqDocs == nil {
		reqDocs = payload.Docs
	}

	patch := domain.TaskPatch{
		Title:                payload.Title,
		Description:          payload.Description,
		Dependencies:         payload.Dependencies,
		RequiredSkills:       payload.Skills,
		RequiredDocs:         reqDocs,
		TargetFiles:          payload.TargetFiles,
		AcceptanceCriteria:   payload.AcceptanceCriteria,
		VerificationCommands: payload.VerificationCommands,
		AgentSlug:            payload.AgentSlug,
		WorktreePath:         payload.WorktreePath,
		AutoRun:              payload.AutoRun,
		Phases:               payload.Phases,
		CurrentPhase:         payload.CurrentPhase,
	}
	if payload.Priority != nil {
		p := domain.TaskPriority(strings.ToUpper(*payload.Priority))
		patch.Priority = &p
	}
	if payload.Complexity != nil {
		c := domain.TaskComplexity(strings.ToUpper(*payload.Complexity))
		patch.Complexity = &c
	}
	if payload.RiskLevel != nil {
		r := domain.TaskRisk(strings.ToUpper(*payload.RiskLevel))
		patch.RiskLevel = &r
	}
	return patch, payload.MediaAdd, payload.MediaRemove, nil
}

func planStatusOrDefault(raw string) domain.PlanStatus {
	status := domain.PlanStatus(strings.ToUpper(strings.TrimSpace(raw)))
	if status.IsValid() {
		return status
	}
	return domain.PlanStatusActive
}

func parsePlanPatch(args map[string]any) (domain.PlanPatch, error) {
	encoded, err := json.Marshal(args)
	if err != nil {
		return domain.PlanPatch{}, err
	}
	var payload struct {
		Title  *string `json:"title"`
		Status *string `json:"status"`
	}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return domain.PlanPatch{}, err
	}
	patch := domain.PlanPatch{Title: payload.Title}
	if payload.Status != nil {
		status := domain.PlanStatus(*payload.Status)
		patch.Status = &status
	}
	return patch, nil
}

func parseProjectPatch(args map[string]any) (domain.ProjectPatch, error) {
	encoded, err := json.Marshal(args)
	if err != nil {
		return domain.ProjectPatch{}, err
	}
	var payload struct {
		Name        *string `json:"name"`
		RootPath    *string `json:"root_path"`
		Description *string `json:"description"`
		Status      *string `json:"status"`
	}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return domain.ProjectPatch{}, err
	}
	patch := domain.ProjectPatch{
		Name:        payload.Name,
		RootPath:    payload.RootPath,
		Description: payload.Description,
	}
	if payload.Status != nil {
		status := domain.ProjectStatus(*payload.Status)
		patch.Status = &status
	}
	return patch, nil
}

func parseResourcePatch(args map[string]any) (domain.ResourcePatch, error) {
	encoded, err := json.Marshal(args)
	if err != nil {
		return domain.ResourcePatch{}, err
	}
	var payload struct {
		Title   *string   `json:"title"`
		Summary *string   `json:"summary"`
		Kind    *string   `json:"kind"`
		Status  *string   `json:"status"`
		Path    *string   `json:"path"`
		URL     *string   `json:"url"`
		Format  *string   `json:"format"`
		Types   *[]string `json:"types"`
		Content *string   `json:"content"`
		Tags    *[]string `json:"tags"`
	}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return domain.ResourcePatch{}, err
	}
	patch := domain.ResourcePatch{
		Title:   payload.Title,
		Summary: payload.Summary,
		Path:    payload.Path,
		URL:     payload.URL,
		Format:  payload.Format,
		Types:   payload.Types,
		Content: payload.Content,
		Tags:    payload.Tags,
	}
	if payload.Kind != nil {
		kind := domain.NormalizeResourceKind(*payload.Kind)
		patch.Kind = &kind
	}
	if payload.Status != nil {
		status := domain.ResourceStatus(*payload.Status)
		patch.Status = &status
	}
	return patch, nil
}

func parseAgentPatch(args map[string]any) (domain.AgentPatch, error) {
	encoded, err := json.Marshal(args)
	if err != nil {
		return domain.AgentPatch{}, err
	}
	var payload struct {
		Name            *string                      `json:"name"`
		SoulKey         *string                      `json:"soul_key"`
		Mode            *string                      `json:"mode"`
		Goal            *string                      `json:"goal"`
		StartConditions *domain.AgentStartConditions `json:"start_conditions"`
		StopConditions  *domain.AgentStopConditions  `json:"stop_conditions"`
		Schedule        *string                      `json:"schedule"`
		Skills          *[]string                    `json:"skills"`
		Runner          *string                      `json:"runner"`
		Enabled         *bool                        `json:"enabled"`
	}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return domain.AgentPatch{}, err
	}
	patch := domain.AgentPatch{
		Name:            payload.Name,
		SoulKey:         payload.SoulKey,
		Goal:            payload.Goal,
		StartConditions: payload.StartConditions,
		StopConditions:  payload.StopConditions,
		Schedule:        payload.Schedule,
		Skills:          payload.Skills,
		Runner:          payload.Runner,
		Enabled:         payload.Enabled,
	}
	if payload.Mode != nil {
		mode := domain.AgentMode(strings.ToUpper(*payload.Mode))
		patch.Mode = &mode
	}
	return patch, nil
}

// decodeItem deserializes an untyped MCP argument into a typed struct T, returning a formatted error if decoding fails.
func decodeItem[T any](raw any, index int, entity string) (T, error) {
	var target T
	encoded, err := json.Marshal(raw)
	if err != nil {
		return target, fmt.Errorf("invalid %s at index %d: %w", entity, index, err)
	}
	if err := json.Unmarshal(encoded, &target); err != nil {
		return target, fmt.Errorf("invalid %s at index %d: %w", entity, index, err)
	}
	return target, nil
}
