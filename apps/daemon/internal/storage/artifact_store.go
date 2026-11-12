package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"zenf/internal/domain"
)

// artifactSelectCols is the projection shared by every artifact read.
const artifactSelectCols = "id, COALESCE(task_id, '') AS task_id, COALESCE(resource_id, '') AS resource_id, role, name, type, file_path, mime_type, byte_size, sha256, created_at"

// ArtifactRepository persists artifact metadata following the claim-check
// pattern.
type ArtifactRepository struct {
	db *DB
}

// RecordArtifact saves artifact metadata to SQLite adhering to the Claim-Check pattern.
func (r *ArtifactRepository) RecordArtifact(ctx context.Context, artifact domain.Artifact) error {
	if artifact.ID == "" {
		return fmt.Errorf("artifact ID cannot be empty")
	}
	if !artifact.Type.IsValid() {
		return fmt.Errorf("invalid artifact type: %s", artifact.Type)
	}

	if err := artifact.ValidateOwner(); err != nil {
		return err
	}
	if artifact.CreatedAt.IsZero() {
		artifact.CreatedAt = time.Now().UTC()
	}
	// Role describes task execution semantics; resource-owned rows leave it empty.
	if artifact.Role == "" && artifact.TaskID != "" {
		artifact.Role = domain.ArtifactRoleOutput
	}

	query := `
	INSERT INTO artifacts (id, task_id, resource_id, role, name, type, file_path, mime_type, byte_size, sha256, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		if artifact.TaskID != "" && artifact.Role == domain.ArtifactRoleInput {
			if err := assertInputAllowed(ctx, tx, artifact.TaskID); err != nil {
				return err
			}
		}

		_, err := tx.ExecContext(ctx, query,
			artifact.ID, nullableString(artifact.TaskID), nullableString(artifact.ResourceID),
			artifact.Role, artifact.Name,
			string(artifact.Type), artifact.FilePath, artifact.MimeType,
			artifact.ByteSize, artifact.Sha256, artifact.CreatedAt)
		return err
	})
}

// assertInputAllowed gates context media to tasks that are still being prepared.
// Attaching an INPUT artifact to a RUNNING or finished task would be invisible
// to the ContextPacket that was already handed to the worker.
func assertInputAllowed(ctx context.Context, tx *sql.Tx, taskID string) error {
	var status string
	err := tx.QueryRowContext(ctx, "SELECT status FROM tasks WHERE id = ?", taskID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: task %s", ErrNotFound, taskID)
	}
	if err != nil {
		return fmt.Errorf("failed to load task %s: %w", taskID, err)
	}

	switch domain.TaskStatus(status) {
	case domain.StatusReady, domain.StatusPending:
		return nil
	default:
		return fmt.Errorf("%w: input media can only be attached while the task is READY or PENDING (task %s is %s)",
			ErrInvalidState, taskID, status)
	}
}

// GetArtifact retrieves artifact metadata by ID.
func (r *ArtifactRepository) GetArtifact(ctx context.Context, id string) (*domain.Artifact, error) {
	query := `SELECT ` + artifactSelectCols + ` FROM artifacts WHERE id = ?`
	row := r.db.QueryRow(ctx, query, id)

	art, err := scanArtifact(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query artifact: %w", err)
	}
	return art, nil
}

// scanArtifact maps one artifacts row. The destination order must match
// artifactSelectCols.
func scanArtifact(s scanner) (*domain.Artifact, error) {
	var art domain.Artifact
	var typeStr string
	var name sql.NullString

	if err := s.Scan(
		&art.ID, &art.TaskID, &art.ResourceID, &art.Role, &name,
		&typeStr, &art.FilePath, &art.MimeType, &art.ByteSize,
		&art.Sha256, &art.CreatedAt,
	); err != nil {
		return nil, err
	}

	if name.Valid {
		art.Name = name.String
	}
	art.Type = domain.ArtifactType(typeStr)
	return &art, nil
}

// DeleteArtifact removes an artifact owned by taskID and returns it so the
// caller can delete the backing file.
func (r *ArtifactRepository) DeleteArtifact(ctx context.Context, taskID string, artifactID string) (*domain.Artifact, error) {
	var deleted *domain.Artifact
	err := r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		query := fmt.Sprintf("SELECT %s FROM artifacts WHERE id = ? AND task_id = ?", artifactSelectCols)
		art, err := scanArtifact(tx.QueryRowContext(ctx, query, artifactID, taskID))
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: artifact %s for task %s", ErrNotFound, artifactID, taskID)
		}
		if err != nil {
			return err
		}

		if art.Role == domain.ArtifactRoleInput {
			if err := assertInputAllowed(ctx, tx, taskID); err != nil {
				return err
			}
		}

		res, err := tx.ExecContext(ctx, "DELETE FROM artifacts WHERE id = ?", artifactID)
		if err != nil {
			return err
		}
		rows, err := affectedOrErr(res, "delete artifact", artifactID)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: artifact %s", ErrNotFound, artifactID)
		}
		deleted = art
		return nil
	})
	if err != nil {
		return nil, err
	}
	return deleted, nil
}

// GetArtifactsByTask retrieves all artifacts associated with a task, optionally filtered by role ("INPUT" | "OUTPUT").
func (r *ArtifactRepository) GetArtifactsByTask(ctx context.Context, taskID string, role string) ([]domain.Artifact, error) {
	var query string
	var args []any

	if role != "" {
		query = `SELECT ` + artifactSelectCols + `
		FROM artifacts
		WHERE task_id = ? AND role = ?
		ORDER BY created_at ASC`
		args = []any{taskID, strings.ToUpper(role)}
	} else {
		query = `SELECT ` + artifactSelectCols + `
		FROM artifacts
		WHERE task_id = ?
		ORDER BY created_at ASC`
		args = []any{taskID}
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query artifacts for task %s: %w", taskID, err)
	}
	defer rows.Close()

	var artifacts []domain.Artifact
	for rows.Next() {
		art, err := scanArtifact(rows)
		if err != nil {
			return nil, err
		}
		artifacts = append(artifacts, *art)
	}

	return artifacts, rows.Err()
}

// GetArtifactsByResource returns every file attached to a resource.
func (r *ArtifactRepository) GetArtifactsByResource(ctx context.Context, resourceID string) ([]domain.Artifact, error) {
	rows, err := r.db.Query(ctx, `SELECT `+artifactSelectCols+`
		FROM artifacts
		WHERE resource_id = ?
		ORDER BY created_at ASC`, resourceID)
	if err != nil {
		return nil, fmt.Errorf("failed to query artifacts for resource %s: %w", resourceID, err)
	}
	defer rows.Close()

	artifacts := []domain.Artifact{}
	for rows.Next() {
		art, err := scanArtifact(rows)
		if err != nil {
			return nil, err
		}
		artifacts = append(artifacts, *art)
	}
	return artifacts, rows.Err()
}

// DeleteResourceArtifact removes one file attached to a resource and returns it
// so the caller can decide whether the backing file is still referenced.
func (r *ArtifactRepository) DeleteResourceArtifact(ctx context.Context, resourceID string, artifactID string) (*domain.Artifact, error) {
	var deleted *domain.Artifact
	err := r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		query := fmt.Sprintf("SELECT %s FROM artifacts WHERE id = ? AND resource_id = ?", artifactSelectCols)
		art, err := scanArtifact(tx.QueryRowContext(ctx, query, artifactID, resourceID))
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: artifact %s for resource %s", ErrNotFound, artifactID, resourceID)
		}
		if err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, "DELETE FROM artifacts WHERE id = ?", artifactID)
		if err != nil {
			return err
		}
		rows, err := affectedOrErr(res, "delete resource artifact", artifactID)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: artifact %s", ErrNotFound, artifactID)
		}
		deleted = art
		return nil
	})
	if err != nil {
		return nil, err
	}
	return deleted, nil
}

// IsFilePathReferenced reports whether any artifact row still points at the
// file. Content-addressed storage means several rows can share one file, so a
// row delete must not remove the bytes while another owner still uses them.
func (r *ArtifactRepository) IsFilePathReferenced(ctx context.Context, filePath string) (bool, error) {
	var count int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM artifacts WHERE file_path = ?", filePath).Scan(&count); err != nil {
		return false, fmt.Errorf("failed to count artifact references: %w", err)
	}
	return count > 0, nil
}
