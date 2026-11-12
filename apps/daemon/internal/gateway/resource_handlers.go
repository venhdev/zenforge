package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"zenf/internal/domain"
	"zenf/internal/parser"
)

// GET /api/v1/resources
func (s *Server) handleListResources(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	var types []string
	if rawTypes := query.Get("types"); rawTypes != "" {
		for _, t := range strings.Split(rawTypes, ",") {
			t = strings.TrimSpace(t)
			if t != "" {
				types = append(types, t)
			}
		}
	} else if len(query["types"]) > 0 {
		for _, t := range query["types"] {
			t = strings.TrimSpace(t)
			if t != "" {
				types = append(types, t)
			}
		}
	}

	filter := domain.ResourceFilter{
		ProjectSlug:   query.Get("project_slug"),
		IncludeGlobal: query.Get("include_global") == "true",
		Kind:          domain.ResourceKind(strings.ToLower(query.Get("kind"))),
		Type:          domain.ResourceType(strings.ToUpper(query.Get("type"))),
		Types:         types,
		Format:        query.Get("format"),
		Scope:         domain.ResourceScope(strings.ToUpper(query.Get("scope"))),
		ScopeRef:      query.Get("scope_ref"),
		Status:        domain.ResourceStatus(strings.ToUpper(query.Get("status"))),
		Tag:           query.Get("tag"),
		Limit:         parseIntDefault(query.Get("limit"), 50),
	}
	resources, err := s.storage.ListResources(r.Context(), filter)
	if err != nil {
		writeHttpError(w, fmt.Sprintf("failed to list resources: %v", err), http.StatusInternalServerError)
		return
	}
	if resources == nil {
		resources = []domain.Resource{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"resources": resources})
}

// POST /api/v1/resources
func (s *Server) handleCreateResource(w http.ResponseWriter, r *http.Request) {
	var resource domain.Resource
	if err := json.NewDecoder(r.Body).Decode(&resource); err != nil {
		writeHttpError(w, fmt.Sprintf("invalid resource payload: %v", err), http.StatusBadRequest)
		return
	}
	if err := resource.Normalize(); err != nil {
		writeHttpError(w, fmt.Sprintf("invalid resource: %v", err), http.StatusBadRequest)
		return
	}
	if err := s.storage.CreateResource(r.Context(), resource); err != nil {
		writeStorageError(w, "create resource", err)
		return
	}
	created, err := s.storage.GetResourceByKey(r.Context(), resource.ProjectSlug, resource.Key)
	if err != nil {
		writeStorageError(w, "load resource", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(created)
}

// GET /api/v1/resources/search?query=&project_slug=&include_global=true&kind=&type=&types=&scope=&status=&limit=
func (s *Server) handleSearchResources(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	if query.Get("query") == "" {
		writeHttpError(w, "query is required", http.StatusBadRequest)
		return
	}

	var types []string
	if rawTypes := query.Get("types"); rawTypes != "" {
		for _, t := range strings.Split(rawTypes, ",") {
			t = strings.TrimSpace(t)
			if t != "" {
				types = append(types, t)
			}
		}
	}

	filter := domain.ResourceFilter{
		ProjectSlug:   query.Get("project_slug"),
		IncludeGlobal: query.Get("include_global") == "true",
		Kind:          domain.ResourceKind(strings.ToLower(query.Get("kind"))),
		Type:          domain.ResourceType(strings.ToUpper(query.Get("type"))),
		Types:         types,
		Format:        query.Get("format"),
		Scope:         domain.ResourceScope(strings.ToUpper(query.Get("scope"))),
		ScopeRef:      query.Get("scope_ref"),
		Status:        domain.ResourceStatus(strings.ToUpper(query.Get("status"))),
		Limit:         parseIntDefault(query.Get("limit"), 25),
	}
	results, err := s.storage.SearchResources(r.Context(), query.Get("query"), filter)
	if err != nil {
		writeHttpError(w, fmt.Sprintf("failed to search resources: %v", err), http.StatusInternalServerError)
		return
	}
	if results == nil {
		results = []domain.ResourceSearchResult{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
}

// GET /api/v1/resources/{id}
func (s *Server) handleGetResource(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	resource, err := s.storage.GetResource(r.Context(), id)
	if err != nil {
		writeStorageError(w, "load resource", err)
		return
	}

	if r.URL.Query().Get("format") == "blocks" || r.URL.Query().Get("blocks") == "true" {
		resource.Blocks = parser.ParseBlocks(resource.Content)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resource)
}

// PATCH /api/v1/resources/{id}
func (s *Server) handleUpdateResource(w http.ResponseWriter, r *http.Request) {
	var req struct {
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeHttpError(w, fmt.Sprintf("invalid payload: %v", err), http.StatusBadRequest)
		return
	}
	patch := domain.ResourcePatch{
		Title:   req.Title,
		Summary: req.Summary,
		Path:    req.Path,
		URL:     req.URL,
		Format:  req.Format,
		Types:   req.Types,
		Content: req.Content,
		Tags:    req.Tags,
	}
	if req.Kind != nil {
		kind := domain.NormalizeResourceKind(*req.Kind)
		patch.Kind = &kind
	}
	if req.Status != nil {
		status := domain.ResourceStatus(strings.ToUpper(*req.Status))
		patch.Status = &status
	}
	id := r.PathValue("id")
	if err := s.storage.UpdateResource(r.Context(), id, patch); err != nil {
		writeStorageError(w, "update resource", err)
		return
	}
	resource, err := s.storage.GetResource(r.Context(), id)
	if err != nil {
		writeStorageError(w, "load resource", err)
		return
	}
	if r.URL.Query().Get("format") == "blocks" || r.URL.Query().Get("blocks") == "true" {
		resource.Blocks = parser.ParseBlocks(resource.Content)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resource)
}

// POST /api/v1/resources/{id}/refresh
func (s *Server) handleRefreshResource(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Content     string `json:"content"`
		ContentHash string `json:"content_hash"`
		ByteSize    int64  `json:"byte_size"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeHttpError(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
			return
		}
	}

	content := req.Content
	if content == "" {
		resource, err := s.storage.GetResource(r.Context(), id)
		if err != nil {
			writeStorageError(w, "load resource", err)
			return
		}
		if resource.URL != "" {
			writeHttpError(w, fmt.Sprintf("resource %s is an external link; there is no local file to refresh", id), http.StatusBadRequest)
			return
		}
		raw, err := domain.ReadTextSnapshot(resource.Path)
		if err != nil {
			writeHttpError(w, fmt.Sprintf("failed to read %s: %v", resource.Path, err), http.StatusBadRequest)
			return
		}
		content = raw
	}
	hash := req.ContentHash
	size := req.ByteSize
	if content != "" {
		if hash == "" {
			hash = domain.ComputeContentHash(content)
		}
		if size == 0 {
			size = int64(len(content))
		}
	}
	if err := s.storage.RefreshResource(r.Context(), id, content, hash, size); err != nil {
		writeStorageError(w, "refresh resource", err)
		return
	}
	resource, err := s.storage.GetResource(r.Context(), id)
	if err != nil {
		writeStorageError(w, "load resource", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resource)
}

// DELETE /api/v1/resources/{id}
func (s *Server) handleDeleteResource(w http.ResponseWriter, r *http.Request) {
	if err := s.storage.DeleteResource(r.Context(), r.PathValue("id")); err != nil {
		writeStorageError(w, "delete resource", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
