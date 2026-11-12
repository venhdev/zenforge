package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"zenf/internal/domain"
)

// ResourceRepository persists the file-canonical resource registry. Files stay
// authoritative; the row stores identity, metadata, tags, hash, a searchable
// snapshot, append-only versions, and the FTS index maintained by triggers.
type ResourceRepository struct {
	db *DB
}

const resourceSelectColumns = `
id, COALESCE(project_slug, '') AS project_slug, key, slug, kind, type, scope, scope_ref,
title, path, url, format, types_json, content_hash, byte_size, status, summary, content, version,
created_at, updated_at`

// resourceSearchSelectColumns qualifies every column because resources_fts
// exposes key, slug, kind, title, summary, and content as well.
const resourceSearchSelectColumns = `
resources.id, COALESCE(resources.project_slug, '') AS project_slug, resources.key,
resources.slug, resources.kind, resources.type, resources.scope, resources.scope_ref,
resources.title, resources.path, resources.url, resources.format, resources.types_json, resources.content_hash, resources.byte_size,
resources.status, resources.summary, resources.content,
resources.version, resources.created_at, resources.updated_at`

func newResourceID() string {
	var random [10]byte
	_, _ = rand.Read(random[:])
	return fmt.Sprintf("res_%012x%s", time.Now().UTC().UnixMilli(), hex.EncodeToString(random[:]))
}

func normalizeTags(tags []string) []string {
	seen := make(map[string]bool, len(tags))
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out
}

func ftsQuery(query string) string {
	fields := strings.Fields(query)
	if len(fields) == 0 {
		return ""
	}
	terms := make([]string, 0, len(fields))
	for _, field := range fields {
		field = strings.ReplaceAll(field, `"`, `""`)
		terms = append(terms, `"`+field+`"`)
	}
	return strings.Join(terms, " AND ")
}

func scanResource(s scanner) (*domain.Resource, error) {
	var r domain.Resource
	var kindStr, typeStr, scopeStr, statusStr, typesJSON string
	if err := s.Scan(
		&r.ID, &r.ProjectSlug, &r.Key, &r.Slug, &kindStr, &typeStr, &scopeStr, &r.ScopeRef,
		&r.Title, &r.Path, &r.URL, &r.Format, &typesJSON, &r.ContentHash, &r.ByteSize, &statusStr,
		&r.Summary, &r.Content, &r.Version, &r.CreatedAt, &r.UpdatedAt,
	); err != nil {
		return nil, err
	}
	r.Kind = domain.ResourceKind(kindStr)
	r.Type = domain.ResourceType(typeStr)
	r.Scope = domain.ResourceScope(scopeStr)
	r.Status = domain.ResourceStatus(statusStr)
	if typesJSON != "" {
		_ = json.Unmarshal([]byte(typesJSON), &r.Types)
	}
	if len(r.Types) == 0 && r.Type != "" {
		r.Types = []string{strings.ToLower(string(r.Type))}
	}
	if r.Format == "" {
		r.Format = "markdown"
	}
	if r.Kind == "" {
		r.Kind = domain.ResourceKindSpec
	}
	return &r, nil
}

func (r *ResourceRepository) loadTags(ctx context.Context, resourceID string) ([]string, error) {
	rows, err := r.db.Query(ctx,
		"SELECT tag FROM resource_tags WHERE resource_id = ? ORDER BY tag ASC", resourceID)
	if err != nil {
		return nil, fmt.Errorf("failed to load tags for resource %s: %w", resourceID, err)
	}
	defer rows.Close()

	tags := []string{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, fmt.Errorf("failed to scan resource tag: %w", err)
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

func (r *ResourceRepository) loadTagsBatch(ctx context.Context, resourceIDs []string) (map[string][]string, error) {
	result := make(map[string][]string, len(resourceIDs))
	if len(resourceIDs) == 0 {
		return result, nil
	}

	placeholders := make([]string, len(resourceIDs))
	args := make([]any, len(resourceIDs))
	for i, id := range resourceIDs {
		placeholders[i] = "?"
		args[i] = id
		result[id] = []string{}
	}

	query := fmt.Sprintf("SELECT resource_id, tag FROM resource_tags WHERE resource_id IN (%s) ORDER BY tag ASC", strings.Join(placeholders, ","))
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to batch load resource tags: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var resID, tag string
		if err := rows.Scan(&resID, &tag); err != nil {
			return nil, fmt.Errorf("failed to scan batch resource tag: %w", err)
		}
		result[resID] = append(result[resID], tag)
	}
	return result, rows.Err()
}

func (r *ResourceRepository) CreateResource(ctx context.Context, resource domain.Resource) error {
	now := time.Now().UTC()
	if resource.ID == "" {
		resource.ID = newResourceID()
	}
	if resource.CreatedAt.IsZero() {
		resource.CreatedAt = now
	}
	resource.UpdatedAt = now
	if resource.Kind == "" {
		resource.Kind = domain.ResourceKindSpec
	}
	if resource.Status == "" {
		resource.Status = domain.ResourceStatusActive
	}
	if resource.Scope == "" {
		resource.Scope = domain.ResourceScopeProject
	}
	if resource.Type == "" {
		resource.Type = domain.ResourceTypeOther
	}
	if resource.Version == 0 {
		resource.Version = 1
	}
	if resource.Content != "" {
		if resource.ContentHash == "" {
			resource.ContentHash = domain.ComputeContentHash(resource.Content)
		}
		if resource.ByteSize == 0 {
			resource.ByteSize = int64(len(resource.Content))
		}
	}
	if err := resource.Validate(); err != nil {
		return err
	}

	tags := normalizeTags(resource.Tags)
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		if err := insertResourceTx(ctx, tx, resource); err != nil {
			if isUniqueViolation(err) {
				return fmt.Errorf("%w: resource key %s in project %q", ErrAlreadyExists, resource.Key, resource.ProjectSlug)
			}
			return err
		}
		if err := replaceResourceTagsTx(ctx, tx, resource.ID, tags); err != nil {
			return err
		}
		return nil
	})
}

func insertResourceTx(ctx context.Context, tx *sql.Tx, resource domain.Resource) error {
	typesJSON, _ := json.Marshal(resource.Types)
	if len(resource.Types) == 0 {
		typesJSON = []byte("[]")
	}
	format := resource.Format
	if format == "" {
		format = "markdown"
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO resources (
			id, project_slug, key, slug, kind, type, scope, scope_ref, title, path, url,
			format, types_json, content_hash, byte_size, status, summary, content, version,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		resource.ID, nullableString(resource.ProjectSlug), resource.Key, resource.Slug,
		string(resource.Kind), string(resource.Type), string(resource.Scope), resource.ScopeRef, resource.Title,
		resource.Path, resource.URL, format, string(typesJSON), resource.ContentHash, resource.ByteSize,
		string(resource.Status), resource.Summary, resource.Content, resource.Version,
		resource.CreatedAt, resource.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to create resource %s: %w", resource.Key, err)
	}
	return nil
}

func replaceResourceTagsTx(ctx context.Context, tx *sql.Tx, resourceID string, tags []string) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM resource_tags WHERE resource_id = ?", resourceID); err != nil {
		return fmt.Errorf("failed to clear tags for resource %s: %w", resourceID, err)
	}
	for _, tag := range tags {
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO resource_tags (resource_id, tag) VALUES (?, ?)", resourceID, tag); err != nil {
			return fmt.Errorf("failed to tag resource %s with %s: %w", resourceID, tag, err)
		}
	}
	return nil
}

func (r *ResourceRepository) finalizeResource(ctx context.Context, resource *domain.Resource) error {
	tags, err := r.loadTags(ctx, resource.ID)
	if err != nil {
		return err
	}
	resource.Tags = tags
	return nil
}

func (r *ResourceRepository) GetResource(ctx context.Context, id string) (*domain.Resource, error) {
	row := r.db.QueryRow(ctx, "SELECT "+resourceSelectColumns+" FROM resources WHERE id = ?", id)
	resource, err := scanResource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: resource %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query resource %s: %w", id, err)
	}
	if err := r.finalizeResource(ctx, resource); err != nil {
		return nil, err
	}
	return resource, nil
}

func (r *ResourceRepository) GetResourceByKey(ctx context.Context, projectSlug string, key string) (*domain.Resource, error) {
	row := r.db.QueryRow(ctx,
		"SELECT "+resourceSelectColumns+" FROM resources WHERE IFNULL(project_slug, '') = ? AND key = ?",
		projectSlug, key)
	resource, err := scanResource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: resource %s in project %q", ErrNotFound, key, projectSlug)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query resource %s: %w", key, err)
	}
	if err := r.finalizeResource(ctx, resource); err != nil {
		return nil, err
	}
	return resource, nil
}

func (r *ResourceRepository) GetResourceBySlug(ctx context.Context, projectSlug string, slug string) (*domain.Resource, error) {
	row := r.db.QueryRow(ctx,
		"SELECT "+resourceSelectColumns+" FROM resources WHERE IFNULL(project_slug, '') = ? AND slug = ?",
		projectSlug, slug)
	resource, err := scanResource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: resource slug %s in project %q", ErrNotFound, slug, projectSlug)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query resource slug %s: %w", slug, err)
	}
	if err := r.finalizeResource(ctx, resource); err != nil {
		return nil, err
	}
	return resource, nil
}

func (r *ResourceRepository) ListResources(ctx context.Context, filter domain.ResourceFilter) ([]domain.Resource, error) {
	query := "SELECT " + resourceSelectColumns + " FROM resources"
	var conditions []string
	var args []any

	if filter.ProjectSlug != "" {
		if filter.IncludeGlobal {
			conditions = append(conditions, "(project_slug = ? OR project_slug IS NULL)")
		} else {
			conditions = append(conditions, "project_slug = ?")
		}
		args = append(args, filter.ProjectSlug)
	}
	if filter.Key != "" {
		conditions = append(conditions, "key = ?")
		args = append(args, filter.Key)
	}
	if filter.Kind != "" {
		conditions = append(conditions, "kind = ?")
		args = append(args, string(filter.Kind))
	}
	if len(filter.Types) > 0 {
		var typeClauses []string
		for _, t := range filter.Types {
			typeClauses = append(typeClauses, "(type = ? OR EXISTS (SELECT 1 FROM json_each(types_json) WHERE value = ?))")
			args = append(args, strings.ToUpper(t), strings.ToLower(t))
		}
		conditions = append(conditions, "("+strings.Join(typeClauses, " OR ")+")")
	} else if filter.Type != "" {
		conditions = append(conditions, "(type = ? OR EXISTS (SELECT 1 FROM json_each(types_json) WHERE value = ?))")
		args = append(args, string(filter.Type), strings.ToLower(string(filter.Type)))
	}
	if filter.Format != "" {
		conditions = append(conditions, "format = ?")
		args = append(args, filter.Format)
	}
	if filter.Scope != "" {
		conditions = append(conditions, "scope = ?")
		args = append(args, string(filter.Scope))
	}
	if filter.ScopeRef != "" {
		conditions = append(conditions, "scope_ref = ?")
		args = append(args, filter.ScopeRef)
	}
	if filter.Status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, string(filter.Status))
	}
	if filter.Tag != "" {
		conditions = append(conditions,
			"EXISTS (SELECT 1 FROM resource_tags rt WHERE rt.resource_id = resources.id AND rt.tag = ?)")
		args = append(args, strings.ToLower(strings.TrimSpace(filter.Tag)))
	}
	if len(conditions) > 0 {
		query += " WHERE " + joinConditions(conditions)
	}
	query += " ORDER BY updated_at DESC, id ASC"
	if filter.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, filter.Limit)
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list resources: %w", err)
	}
	defer rows.Close()

	resources := []domain.Resource{}
	for rows.Next() {
		resource, err := scanResource(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan resource: %w", err)
		}
		resources = append(resources, *resource)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(resources) > 0 {
		ids := make([]string, len(resources))
		for i, res := range resources {
			ids[i] = res.ID
		}
		tagMap, err := r.loadTagsBatch(ctx, ids)
		if err != nil {
			return nil, err
		}
		for i := range resources {
			resources[i].Tags = tagMap[resources[i].ID]
		}
	}
	return resources, nil
}

func (r *ResourceRepository) UpdateResource(ctx context.Context, id string, patch domain.ResourcePatch) error {
	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		resource, err := getResourceTx(ctx, tx, id)
		if err != nil {
			return err
		}
		if patch.Title != nil {
			resource.Title = *patch.Title
		}
		if patch.Summary != nil {
			resource.Summary = *patch.Summary
		}
		if patch.Kind != nil {
			resource.Kind = *patch.Kind
		}
		if patch.Status != nil {
			resource.Status = *patch.Status
		}
		if patch.Path != nil {
			resource.Path = *patch.Path
		}
		if patch.URL != nil {
			resource.URL = *patch.URL
		}
		if patch.Format != nil {
			resource.Format = *patch.Format
		}
		if patch.Types != nil {
			resource.Types = *patch.Types
			if len(resource.Types) > 0 {
				resource.Type = domain.ResourceType(strings.ToUpper(resource.Types[0]))
			}
		}
		if patch.Content != nil && *patch.Content != resource.Content {
			resource.Content = *patch.Content
			resource.ContentHash = domain.ComputeContentHash(resource.Content)
			resource.ByteSize = int64(len(resource.Content))
			resource.Version++
		}
		if err := resource.Validate(); err != nil {
			return err
		}

		typesJSON, _ := json.Marshal(resource.Types)
		if len(resource.Types) == 0 {
			typesJSON = []byte("[]")
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE resources
			SET title = ?, summary = ?, kind = ?, status = ?, path = ?, url = ?, format = ?, types_json = ?, type = ?, content = ?, content_hash = ?, byte_size = ?, version = ?, updated_at = ?
			WHERE id = ?`,
			resource.Title, resource.Summary, string(resource.Kind), string(resource.Status), resource.Path, resource.URL, resource.Format, string(typesJSON), string(resource.Type), resource.Content, resource.ContentHash, resource.ByteSize, resource.Version, now, id); err != nil {
			return fmt.Errorf("failed to update resource %s: %w", id, err)
		}
		if patch.Tags != nil {
			if err := replaceResourceTagsTx(ctx, tx, id, normalizeTags(*patch.Tags)); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *ResourceRepository) RefreshResource(ctx context.Context, id string, content string, contentHash string, byteSize int64) error {
	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		var currentVersion int
		row := tx.QueryRowContext(ctx, "SELECT version FROM resources WHERE id = ?", id)
		if err := row.Scan(&currentVersion); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("%w: resource %s", ErrNotFound, id)
			}
			return fmt.Errorf("failed to query resource version: %w", err)
		}

		newVersion := currentVersion + 1
		res, err := tx.ExecContext(ctx, `
			UPDATE resources
			SET content = ?, content_hash = ?, byte_size = ?, version = ?, updated_at = ?
			WHERE id = ?`,
			content, contentHash, byteSize, newVersion, now, id)
		if err != nil {
			return fmt.Errorf("failed to refresh resource %s: %w", id, err)
		}
		rows, err := affectedOrErr(res, "refresh resource", id)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: resource %s", ErrNotFound, id)
		}
		return nil
	})
}

func (r *ResourceRepository) ArchiveResource(ctx context.Context, id string, archived bool) error {
	status := domain.ResourceStatusActive
	if archived {
		status = domain.ResourceStatusArchived
	}
	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "UPDATE resources SET status = ?, updated_at = ? WHERE id = ?",
			string(status), now, id)
		if err != nil {
			return fmt.Errorf("failed to archive resource %s: %w", id, err)
		}
		rows, err := affectedOrErr(res, "archive resource", id)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: resource %s", ErrNotFound, id)
		}
		return nil
	})
}

func (r *ResourceRepository) DeleteResource(ctx context.Context, id string) error {
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "DELETE FROM resources WHERE id = ?", id)
		if err != nil {
			return fmt.Errorf("failed to delete resource %s: %w", id, err)
		}
		rows, err := affectedOrErr(res, "delete resource", id)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: resource %s", ErrNotFound, id)
		}
		return nil
	})
}

func getResourceTx(ctx context.Context, tx *sql.Tx, id string) (*domain.Resource, error) {
	row := tx.QueryRowContext(ctx, "SELECT "+resourceSelectColumns+" FROM resources WHERE id = ?", id)
	resource, err := scanResource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: resource %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query resource %s: %w", id, err)
	}
	return resource, nil
}

func (r *ResourceRepository) SearchResources(ctx context.Context, query string, filter domain.ResourceFilter) ([]domain.ResourceSearchResult, error) {
	match := ftsQuery(query)
	if match == "" {
		return []domain.ResourceSearchResult{}, nil
	}

	sqlQuery := `
		SELECT ` + resourceSearchSelectColumns + `, snippet(resources_fts, -1, '[', ']', '…', 16)
		FROM resources_fts
		JOIN resources ON resources.id = resources_fts.resource_id
		WHERE resources_fts MATCH ?`
	args := []any{match}

	if filter.ProjectSlug != "" {
		if filter.IncludeGlobal {
			sqlQuery += " AND (resources.project_slug = ? OR resources.project_slug IS NULL)"
		} else {
			sqlQuery += " AND resources.project_slug = ?"
		}
		args = append(args, filter.ProjectSlug)
	}
	if filter.Kind != "" {
		sqlQuery += " AND resources.kind = ?"
		args = append(args, string(filter.Kind))
	}
	if len(filter.Types) > 0 {
		var typeClauses []string
		for _, t := range filter.Types {
			typeClauses = append(typeClauses, "(resources.type = ? OR EXISTS (SELECT 1 FROM json_each(resources.types_json) WHERE value = ?))")
			args = append(args, strings.ToUpper(t), strings.ToLower(t))
		}
		sqlQuery += " AND (" + strings.Join(typeClauses, " OR ") + ")"
	} else if filter.Type != "" {
		sqlQuery += " AND (resources.type = ? OR EXISTS (SELECT 1 FROM json_each(resources.types_json) WHERE value = ?))"
		args = append(args, string(filter.Type), strings.ToLower(string(filter.Type)))
	}
	if filter.Format != "" {
		sqlQuery += " AND resources.format = ?"
		args = append(args, filter.Format)
	}
	if filter.Scope != "" {
		sqlQuery += " AND resources.scope = ?"
		args = append(args, string(filter.Scope))
	}
	if filter.ScopeRef != "" {
		sqlQuery += " AND resources.scope_ref = ?"
		args = append(args, filter.ScopeRef)
	}
	if filter.Status != "" {
		sqlQuery += " AND resources.status = ?"
		args = append(args, string(filter.Status))
	}
	sqlQuery += " ORDER BY rank LIMIT ?"
	limit := filter.Limit
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	args = append(args, limit)

	rows, err := r.db.Query(ctx, sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to search resources: %w", err)
	}
	defer rows.Close()

	results := []domain.ResourceSearchResult{}
	for rows.Next() {
		var d domain.Resource
		var kindStr, typeStr, scopeStr, statusStr, typesJSON, snippet string
		if err := rows.Scan(
			&d.ID, &d.ProjectSlug, &d.Key, &d.Slug, &kindStr, &typeStr, &scopeStr, &d.ScopeRef,
			&d.Title, &d.Path, &d.URL, &d.Format, &typesJSON, &d.ContentHash, &d.ByteSize, &statusStr,
			&d.Summary, &d.Content, &d.Version, &d.CreatedAt, &d.UpdatedAt, &snippet,
		); err != nil {
			return nil, fmt.Errorf("failed to scan resource search hit: %w", err)
		}
		d.Kind = domain.ResourceKind(kindStr)
		d.Type = domain.ResourceType(typeStr)
		d.Scope = domain.ResourceScope(scopeStr)
		d.Status = domain.ResourceStatus(statusStr)
		if typesJSON != "" {
			_ = json.Unmarshal([]byte(typesJSON), &d.Types)
		}
		if len(d.Types) == 0 && d.Type != "" {
			d.Types = []string{strings.ToLower(string(d.Type))}
		}
		if d.Format == "" {
			d.Format = "markdown"
		}
		results = append(results, domain.ResourceSearchResult{Resource: d, Snippet: snippet})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(results) > 0 {
		ids := make([]string, len(results))
		for i, res := range results {
			ids[i] = res.Resource.ID
		}
		tagMap, err := r.loadTagsBatch(ctx, ids)
		if err != nil {
			return nil, err
		}
		for i := range results {
			results[i].Resource.Tags = tagMap[results[i].Resource.ID]
		}
	}
	return results, nil
}

func (r *ResourceRepository) GetTagCloud(ctx context.Context, projectSlug string, includeGlobal bool) ([]domain.TagCount, error) {
	query := `
		SELECT rt.tag, COUNT(DISTINCT r.id) as cnt
		FROM resource_tags rt
		JOIN resources r ON rt.resource_id = r.id
	`
	var conditions []string
	var args []any

	if projectSlug != "" {
		if includeGlobal {
			conditions = append(conditions, "(r.project_slug = ? OR r.scope = 'GLOBAL' OR r.project_slug = '')")
			args = append(args, projectSlug)
		} else {
			conditions = append(conditions, "r.project_slug = ?")
			args = append(args, projectSlug)
		}
	}

	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " GROUP BY rt.tag ORDER BY cnt DESC, rt.tag ASC"

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get tag cloud: %w", err)
	}
	defer rows.Close()

	counts := []domain.TagCount{}
	for rows.Next() {
		var tc domain.TagCount
		if err := rows.Scan(&tc.Tag, &tc.Count); err != nil {
			return nil, fmt.Errorf("failed to scan tag count: %w", err)
		}
		counts = append(counts, tc)
	}
	return counts, rows.Err()
}
