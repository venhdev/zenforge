package domain

import (
	"fmt"
	"time"
)

// ArtifactType categorizes concrete outputs produced during task execution.
type ArtifactType string

const (
	ArtifactTypeImage    ArtifactType = "IMAGE"
	ArtifactTypeMarkdown ArtifactType = "MARKDOWN"
	ArtifactTypeDoc      ArtifactType = "DOC"
	ArtifactTypeFile     ArtifactType = "FILE"
)

const (
	ArtifactRoleInput  = "INPUT"
	ArtifactRoleOutput = "OUTPUT"
)

// IsValid checks if the artifact type is supported.
func (a ArtifactType) IsValid() bool {
	switch a {
	case ArtifactTypeImage, ArtifactTypeMarkdown, ArtifactTypeDoc, ArtifactTypeFile:
		return true
	default:
		return false
	}
}

// Artifact represents a stored file with exactly one owner: a task (execution
// input/output) or a resource (knowledge attachment). Ownership is enforced by
// a database CHECK constraint, so TaskID and ResourceID are mutually exclusive.
type Artifact struct {
	ID         string       `json:"id"`
	TaskID     string       `json:"task_id,omitempty"`
	ResourceID string       `json:"resource_id,omitempty"`
	Role       string       `json:"role"` // "INPUT" or "OUTPUT"; empty for resource-owned rows
	Name       string       `json:"name"` // Display filename or caption
	Type       ArtifactType `json:"type"`
	FilePath   string       `json:"file_path"`
	MimeType   string       `json:"mime_type"`
	ByteSize   int64        `json:"byte_size"`
	Sha256     string       `json:"sha256"`
	CreatedAt  time.Time    `json:"created_at"`
}

// ValidateOwner enforces the exactly-one-owner invariant before the row reaches
// the database CHECK constraint.
func (a Artifact) ValidateOwner() error {
	hasTask := a.TaskID != ""
	hasResource := a.ResourceID != ""
	switch {
	case hasTask && hasResource:
		return fmt.Errorf("artifact %s cannot be owned by both a task and a resource", a.ID)
	case !hasTask && !hasResource:
		return fmt.Errorf("artifact %s requires either task_id or resource_id", a.ID)
	}
	return nil
}
