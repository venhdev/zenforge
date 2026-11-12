package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// MaxSnapshotSize is the 4 MiB ceiling for inlining resource text snapshots.
const MaxSnapshotSize = 4 << 20

// TextExtensions are supported extensions for searchable text snapshot extraction.
var TextExtensions = map[string]bool{
	".md": true, ".markdown": true, ".txt": true, ".json": true,
	".yaml": true, ".yml": true, ".xml": true, ".csv": true,
	".toml": true, ".sql": true, ".go": true, ".ts": true,
	".tsx": true, ".js": true, ".jsx": true, ".css": true, ".html": true,
}

// ComputeContentHash returns the hex-encoded SHA-256 digest of content.
func ComputeContentHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// ReadTextSnapshot reads a text-like resource up to 4 MiB and returns its content.
// Binary/media files return ("", nil) without error so they can be registered by path only.
func ReadTextSnapshot(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s is a directory", path)
	}
	if info.Size() > MaxSnapshotSize {
		return "", fmt.Errorf("%s is larger than 4 MiB; register it without a content snapshot", path)
	}
	ext := strings.ToLower(filepath.Ext(path))
	if !TextExtensions[ext] {
		return "", nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// ResourceKind classifies the fundamental role of a resource.
type ResourceKind string

const (
	ResourceKindSpec     ResourceKind = "spec"
	ResourceKindSoul     ResourceKind = "soul"
	ResourceKindHarness  ResourceKind = "harness"
	ResourceKindArtifact ResourceKind = "artifact"
)

func (k ResourceKind) IsValid() bool {
	switch k {
	case ResourceKindSpec, ResourceKindSoul, ResourceKindHarness, ResourceKindArtifact:
		return true
	default:
		return false
	}
}

// NormalizeResourceKind normalizes string input into a canonical ResourceKind.
func NormalizeResourceKind(s string) ResourceKind {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "soul":
		return ResourceKindSoul
	case "harness", "env":
		return ResourceKindHarness
	case "artifact":
		return ResourceKindArtifact
	case "spec", "doc", "document":
		return ResourceKindSpec
	default:
		return ResourceKindSpec
	}
}

type ResourceType string

const (
	ResourceTypeArchitecture ResourceType = "ARCHITECTURE"
	ResourceTypeADR          ResourceType = "ADR"
	ResourceTypeSpec         ResourceType = "SPEC"
	ResourceTypeRule         ResourceType = "RULE"
	ResourceTypeGuide        ResourceType = "GUIDE"
	ResourceTypeReference    ResourceType = "REFERENCE"
	ResourceTypeMemory       ResourceType = "MEMORY"
	ResourceTypeOther        ResourceType = "OTHER"
)

func (t ResourceType) IsValid() bool {
	switch t {
	case ResourceTypeArchitecture, ResourceTypeADR, ResourceTypeSpec, ResourceTypeRule,
		ResourceTypeGuide, ResourceTypeReference, ResourceTypeMemory, ResourceTypeOther:
		return true
	default:
		return false
	}
}

type ResourceScope string

const (
	ResourceScopeGlobal  ResourceScope = "GLOBAL"
	ResourceScopeProject ResourceScope = "PROJECT"
	ResourceScopePlan    ResourceScope = "PLAN"
	ResourceScopeTask    ResourceScope = "TASK"
)

func (s ResourceScope) IsValid() bool {
	switch s {
	case ResourceScopeGlobal, ResourceScopeProject, ResourceScopePlan, ResourceScopeTask:
		return true
	default:
		return false
	}
}

type ResourceStatus string

const (
	ResourceStatusDraft      ResourceStatus = "DRAFT"
	ResourceStatusActive     ResourceStatus = "ACTIVE"
	ResourceStatusSuperseded ResourceStatus = "SUPERSEDED"
	ResourceStatusArchived   ResourceStatus = "ARCHIVED"
)

func (s ResourceStatus) IsValid() bool {
	switch s {
	case ResourceStatusDraft, ResourceStatusActive, ResourceStatusSuperseded, ResourceStatusArchived:
		return true
	default:
		return false
	}
}

// Resource is a knowledge/context/artifact entity in the ZenForge Context Operating System.
// Native-first: Content is stored directly in SQLite WAL.
// When Path is provided, it acts as an optional overlay referencing an existing Git repository file.
type Resource struct {
	ID          string          `json:"id"`
	ProjectSlug string          `json:"project_slug,omitempty"`
	Key         string          `json:"key"`
	Slug        string          `json:"slug"`
	Kind        ResourceKind    `json:"kind"` // spec | soul | harness | artifact
	Type        ResourceType    `json:"type"` // Primary type (e.g. SPEC, ADR, ARCHITECTURE)
	Scope       ResourceScope   `json:"scope"`
	ScopeRef    string          `json:"scope_ref,omitempty"`
	Title       string          `json:"title"`
	Format      string          `json:"format"`        // markdown, blocks, json, ascii, etc.
	Types       []string        `json:"types"`         // Multi-label kinds: ["research", "rules"]
	Path        string          `json:"path"`          // Optional overlay onto a file in the repository
	URL         string          `json:"url,omitempty"` // External reference link (mutually exclusive with Path)
	ContentHash string          `json:"content_hash"`
	ByteSize    int64           `json:"byte_size"`
	Status      ResourceStatus  `json:"status"`
	Summary     string          `json:"summary,omitempty"`
	Content     string          `json:"content,omitempty"`
	Blocks      []ResourceBlock `json:"blocks,omitempty"`
	Tags        []string        `json:"tags,omitempty"`
	Version     int             `json:"version"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

// ResourceBlock represents an autonomous rich content fragment inside a resource.
type ResourceBlock struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`               // text | heading | diagram | bash | fixture | wireframe | table | code
	Format   string          `json:"format"`             // markdown | mermaid | bash | json | ascii | <lang>
	Data     json.RawMessage `json:"data"`               // Structured payload or raw string
	Metadata map[string]any  `json:"metadata,omitempty"` // Extra block properties (e.g. executable: true)
}

// ContentString extracts the plain string representation of Data.
func (b ResourceBlock) ContentString() string {
	if len(b.Data) == 0 {
		return ""
	}
	var str string
	if err := json.Unmarshal(b.Data, &str); err == nil {
		return str
	}
	var obj any
	if err := json.Unmarshal(b.Data, &obj); err == nil {
		if pretty, err := json.MarshalIndent(obj, "", "  "); err == nil {
			return string(pretty)
		}
	}
	return string(b.Data)
}

// ResourceBrief is the compact reference embedded in a task context packet.
type ResourceBrief struct {
	ID      string        `json:"id"`
	Key     string        `json:"key"`
	Slug    string        `json:"slug"`
	Kind    ResourceKind  `json:"kind"`
	Title   string        `json:"title"`
	Type    ResourceType  `json:"type"`
	Scope   ResourceScope `json:"scope"`
	Path    string        `json:"path"`
	URL     string        `json:"url,omitempty"`
	Summary string        `json:"summary,omitempty"`
	Version int           `json:"version,omitempty"`
}

func (r *Resource) Brief() ResourceBrief {
	return ResourceBrief{
		ID: r.ID, Key: r.Key, Slug: r.Slug, Kind: r.Kind, Title: r.Title,
		Type: r.Type, Scope: r.Scope, Path: r.Path, URL: r.URL, Summary: r.Summary, Version: r.Version,
	}
}

// SerializeBlocks serializes a slice of ResourceBlocks into canonical GFM Markdown.
func SerializeBlocks(blocks []ResourceBlock) string {
	if len(blocks) == 0 {
		return ""
	}

	var parts []string
	for _, b := range blocks {
		content := b.ContentString()
		switch b.Type {
		case "text":
			parts = append(parts, content)
		case "diagram":
			fmtStr := b.Format
			if fmtStr == "" {
				fmtStr = "mermaid"
			}
			parts = append(parts, fmt.Sprintf("```%s\n%s\n```", fmtStr, content))
		case "bash":
			tag := "bash"
			if b.Metadata != nil && b.Metadata["executable"] == true {
				tag = "bash:run"
			} else if b.Format != "" {
				tag = b.Format
			}
			parts = append(parts, fmt.Sprintf("```%s\n%s\n```", tag, content))
		case "fixture":
			tag := "json:fixture"
			if b.Format != "" && b.Format != "json" {
				tag = b.Format + ":fixture"
			}
			parts = append(parts, fmt.Sprintf("```%s\n%s\n```", tag, content))
		case "wireframe":
			parts = append(parts, fmt.Sprintf("```ascii:wireframe\n%s\n```", content))
		case "code":
			tag := b.Format
			if tag == "" {
				tag = "text"
			}
			parts = append(parts, fmt.Sprintf("```%s\n%s\n```", tag, content))
		default:
			tag := b.Format
			if tag == "" {
				tag = b.Type
			}
			parts = append(parts, fmt.Sprintf("```%s\n%s\n```", tag, content))
		}
	}

	return strings.Join(parts, "\n\n")
}

// Normalize applies canonical domain defaults, extracts text snapshots, calculates hash/byte size, and validates invariants.
func (r *Resource) Normalize() error {
	if r.ID == "" {
		r.ID = fmt.Sprintf("res-%d", time.Now().UnixNano())
	}
	if r.Key == "" && r.Slug != "" {
		r.Key = r.Slug
	}
	if r.Slug == "" && r.Key != "" {
		r.Slug = r.Key
	}
	if r.Title == "" && r.Key != "" {
		r.Title = r.Key
	}
	if r.Kind == "" {
		r.Kind = ResourceKindSpec
	}
	if r.Scope == "" {
		if r.ProjectSlug != "" {
			r.Scope = ResourceScopeProject
		} else {
			r.Scope = ResourceScopeGlobal
		}
	}
	if r.Type == "" && len(r.Types) > 0 {
		r.Type = ResourceType(strings.ToUpper(r.Types[0]))
	}
	if r.Type == "" {
		r.Type = ResourceTypeOther
	}
	if len(r.Types) == 0 && r.Type != "" {
		r.Types = []string{strings.ToLower(string(r.Type))}
	}
	if r.Status == "" {
		r.Status = ResourceStatusActive
	}
	if r.Format == "" {
		r.Format = "markdown"
	}

	if r.Content == "" && len(r.Blocks) > 0 {
		r.Content = SerializeBlocks(r.Blocks)
	}
	if r.Content == "" && r.Path != "" && r.URL == "" {
		if raw, err := ReadTextSnapshot(r.Path); err == nil && raw != "" {
			r.Content = raw
		}
	}
	if r.Content != "" {
		if r.ContentHash == "" {
			r.ContentHash = ComputeContentHash(r.Content)
		}
		if r.ByteSize == 0 {
			r.ByteSize = int64(len(r.Content))
		}
	}

	return r.Validate()
}

func (r *Resource) Validate() error {
	if r.ID == "" {
		return fmt.Errorf("resource id cannot be empty")
	}
	if r.Key == "" {
		return fmt.Errorf("resource key cannot be empty")
	}
	if strings.ContainsAny(r.Key, " \t\n") {
		return fmt.Errorf("resource key %q cannot contain whitespace", r.Key)
	}
	if r.Slug == "" {
		return fmt.Errorf("resource slug cannot be empty")
	}
	if r.Title == "" {
		return fmt.Errorf("resource title cannot be empty")
	}
	if r.Format == "" {
		r.Format = "markdown"
	}
	if r.Kind == "" {
		r.Kind = ResourceKindSpec
	}
	if !r.Kind.IsValid() {
		return fmt.Errorf("invalid resource kind: %s", r.Kind)
	}

	// Normalize & synchronize multi-types and legacy Type
	if len(r.Types) == 0 && r.Type != "" {
		r.Types = []string{strings.ToLower(string(r.Type))}
	}
	if r.Type == "" && len(r.Types) > 0 {
		r.Type = ResourceType(strings.ToUpper(r.Types[0]))
	}
	if r.Type == "" {
		r.Type = ResourceTypeOther
	}

	if !r.Scope.IsValid() {
		return fmt.Errorf("invalid resource scope: %s", r.Scope)
	}
	if !r.Status.IsValid() {
		return fmt.Errorf("invalid resource status: %s", r.Status)
	}
	if r.Path != "" && r.URL != "" {
		return fmt.Errorf("resource %s cannot set both path and url", r.Key)
	}
	if r.URL != "" && !isExternalURL(r.URL) {
		return fmt.Errorf("resource url %q must be an absolute http(s) URL", r.URL)
	}

	// Scope matrix: a resource belongs to exactly one container.
	switch r.Scope {
	case ResourceScopeGlobal:
		if r.ProjectSlug != "" || r.ScopeRef != "" {
			return fmt.Errorf("global resource %s cannot carry project_slug or scope_ref", r.Key)
		}
	case ResourceScopeProject:
		if r.ProjectSlug == "" {
			return fmt.Errorf("project-scoped resource %s requires project_slug", r.Key)
		}
		if r.ScopeRef != "" {
			return fmt.Errorf("project-scoped resource %s cannot carry scope_ref", r.Key)
		}
	case ResourceScopePlan, ResourceScopeTask:
		if r.ProjectSlug == "" {
			return fmt.Errorf("resource scope %s requires project_slug", r.Scope)
		}
		if r.ScopeRef == "" {
			return fmt.Errorf("resource scope %s requires scope_ref", r.Scope)
		}
	}
	return nil
}

// isExternalURL reports whether raw is an absolute http(s) URL.
func isExternalURL(raw string) bool {
	lower := strings.ToLower(raw)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

// ResourcePatch carries partial metadata updates.
type ResourcePatch struct {
	Title   *string
	Summary *string
	Kind    *ResourceKind
	Status  *ResourceStatus
	Path    *string
	URL     *string
	Format  *string
	Types   *[]string
	Content *string
	Tags    *[]string
}

// TagCount represents a tag and its occurrence frequency in resources.
type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

// ResourceFilter narrows a resource query. Empty fields are not applied.
type ResourceFilter struct {
	ProjectSlug   string
	Key           string
	IncludeGlobal bool
	Kind          ResourceKind
	Type          ResourceType
	Types         []string
	Format        string
	Scope         ResourceScope
	ScopeRef      string
	Status        ResourceStatus
	Tag           string
	Limit         int
}

// ResourceSearchResult is one FTS hit with a short snippet.
type ResourceSearchResult struct {
	Resource Resource `json:"resource"`
	Snippet  string   `json:"snippet"`
}

// SearchResult is one cross-entity search hit.
type SearchResult struct {
	EntityType  string `json:"entity_type"`
	EntityID    string `json:"entity_id"`
	Title       string `json:"title"`
	Snippet     string `json:"snippet,omitempty"`
	ProjectSlug string `json:"project_slug,omitempty"`
}
