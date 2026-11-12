package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"

	"zenf/internal/attachment"
)

// GET /api/v1/resources/{id}/files
func (s *Server) handleListResourceFiles(w http.ResponseWriter, r *http.Request) {
	resourceID := r.PathValue("id")
	if resourceID == "" {
		writeHttpError(w, "missing resource id", http.StatusBadRequest)
		return
	}
	if _, err := s.storage.GetResource(r.Context(), resourceID); err != nil {
		writeStorageError(w, "load resource", err)
		return
	}

	files, err := s.storage.GetArtifactsByResource(r.Context(), resourceID)
	if err != nil {
		writeHttpError(w, fmt.Sprintf("failed to list resource files: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"files": files})
}

// POST /api/v1/resources/{id}/files (multipart/form-data)
func (s *Server) handleUploadResourceFile(w http.ResponseWriter, r *http.Request) {
	resourceID := r.PathValue("id")
	if resourceID == "" {
		writeHttpError(w, "missing resource id", http.StatusBadRequest)
		return
	}
	if _, err := s.storage.GetResource(r.Context(), resourceID); err != nil {
		writeStorageError(w, "load resource", err)
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

	art, err := attachment.IngestReader(resourceID, header.Filename, file, header.Size)
	if err != nil {
		writeHttpError(w, err.Error(), http.StatusBadRequest)
		return
	}
	// Ownership: the file belongs to the resource, not to a task, and carries no
	// execution role.
	art.TaskID = ""
	art.ResourceID = resourceID
	art.Role = ""
	if displayName := r.FormValue("name"); displayName != "" {
		art.Name = displayName
	}

	if err := s.storage.RecordArtifact(r.Context(), art); err != nil {
		writeStorageError(w, "record resource file", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(art)
}

// DELETE /api/v1/resources/{id}/files/{fileId}
func (s *Server) handleDeleteResourceFile(w http.ResponseWriter, r *http.Request) {
	resourceID := r.PathValue("id")
	fileID := r.PathValue("fileId")
	if resourceID == "" || fileID == "" {
		writeHttpError(w, "missing resource id or file id", http.StatusBadRequest)
		return
	}

	deleted, err := s.storage.DeleteResourceArtifact(r.Context(), resourceID, fileID)
	if err != nil {
		writeStorageError(w, "delete resource file", err)
		return
	}

	// Content-addressed storage can share one file between several rows; only
	// remove the bytes once nothing references them.
	if deleted.FilePath != "" {
		referenced, refErr := s.storage.IsFilePathReferenced(r.Context(), deleted.FilePath)
		if refErr == nil && !referenced {
			_ = attachment.Remove(deleted.FilePath)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}
