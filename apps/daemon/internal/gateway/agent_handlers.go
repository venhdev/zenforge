package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"zenf/internal/domain"
)

func (s *Server) handleListAgents(w http.ResponseWriter, r *http.Request) {
	agents, err := s.storage.ListAgents(r.Context(), r.URL.Query().Get("include_disabled") == "true")
	if err != nil {
		writeHttpError(w, fmt.Sprintf("failed to list agents: %v", err), http.StatusInternalServerError)
		return
	}
	if agents == nil {
		agents = []domain.Agent{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"agents": agents})
}

// POST /api/v1/agents
func (s *Server) handleCreateAgent(w http.ResponseWriter, r *http.Request) {
	var agent domain.Agent
	if err := json.NewDecoder(r.Body).Decode(&agent); err != nil {
		writeHttpError(w, fmt.Sprintf("invalid agent payload: %v", err), http.StatusBadRequest)
		return
	}
	if err := domain.ValidateSoulKey(r.Context(), s.storage, agent.SoulKey); err != nil {
		writeHttpError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.storage.CreateAgent(r.Context(), agent); err != nil {
		writeStorageError(w, "create agent", err)
		return
	}
	created, err := s.storage.GetAgent(r.Context(), agent.Slug)
	if err != nil {
		writeStorageError(w, "load agent", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(created)
}

// GET /api/v1/agents/{slug}
func (s *Server) handleGetAgent(w http.ResponseWriter, r *http.Request) {
	agent, err := s.storage.GetAgent(r.Context(), r.PathValue("slug"))
	if err != nil {
		writeStorageError(w, "load agent", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(agent)
}

// PATCH /api/v1/agents/{slug}
func (s *Server) handleUpdateAgent(w http.ResponseWriter, r *http.Request) {
	var req struct {
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeHttpError(w, fmt.Sprintf("invalid payload: %v", err), http.StatusBadRequest)
		return
	}
	patch := domain.AgentPatch{
		Name:            req.Name,
		SoulKey:         req.SoulKey,
		Goal:            req.Goal,
		StartConditions: req.StartConditions,
		StopConditions:  req.StopConditions,
		Schedule:        req.Schedule,
		Skills:          req.Skills,
		Runner:          req.Runner,
		Enabled:         req.Enabled,
	}
	if req.Mode != nil {
		mode := domain.AgentMode(strings.ToUpper(*req.Mode))
		patch.Mode = &mode
	}
	slug := r.PathValue("slug")
	if patch.SoulKey != nil {
		if err := domain.ValidateSoulKey(r.Context(), s.storage, *patch.SoulKey); err != nil {
			writeHttpError(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	if err := s.storage.UpdateAgent(r.Context(), slug, patch); err != nil {
		writeStorageError(w, "update agent", err)
		return
	}
	agent, err := s.storage.GetAgent(r.Context(), slug)
	if err != nil {
		writeStorageError(w, "load agent", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(agent)
}

// DELETE /api/v1/agents/{slug}
func (s *Server) handleDeleteAgent(w http.ResponseWriter, r *http.Request) {
	if err := s.storage.DeleteAgent(r.Context(), r.PathValue("slug")); err != nil {
		writeStorageError(w, "delete agent", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// GET /api/v1/search?q=&project_slug=&limit=
