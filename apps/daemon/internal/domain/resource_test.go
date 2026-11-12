package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestResource_Normalize_Defaults(t *testing.T) {
	r := &Resource{
		Key:   "spec-overview",
		Title: "Spec Overview",
	}

	if err := r.Normalize(); err != nil {
		t.Fatalf("Normalize failed: %v", err)
	}

	if r.ID == "" {
		t.Errorf("expected ID to be generated, got empty")
	}
	if r.Slug != "spec-overview" {
		t.Errorf("expected Slug to match Key, got %s", r.Slug)
	}
	if r.Kind != ResourceKindSpec {
		t.Errorf("expected Kind to default to spec, got %s", r.Kind)
	}
	if r.Scope != ResourceScopeGlobal {
		t.Errorf("expected Scope to default to GLOBAL, got %s", r.Scope)
	}
	if r.Type != ResourceTypeOther {
		t.Errorf("expected Type to default to OTHER, got %s", r.Type)
	}
	if r.Status != ResourceStatusActive {
		t.Errorf("expected Status to default to ACTIVE, got %s", r.Status)
	}
	if r.Format != "markdown" {
		t.Errorf("expected Format to default to markdown, got %s", r.Format)
	}
}

func TestResource_Normalize_ProjectScope(t *testing.T) {
	r := &Resource{
		ProjectSlug: "zenforge",
		Slug:        "backend-architecture",
	}

	if err := r.Normalize(); err != nil {
		t.Fatalf("Normalize failed: %v", err)
	}

	if r.Key != "backend-architecture" {
		t.Errorf("expected Key to sync from Slug, got %s", r.Key)
	}
	if r.Scope != ResourceScopeProject {
		t.Errorf("expected Scope to default to PROJECT when ProjectSlug present, got %s", r.Scope)
	}
	if r.Title != "backend-architecture" {
		t.Errorf("expected Title to fallback to Key, got %s", r.Title)
	}
}

func TestResource_Normalize_BlocksAndHash(t *testing.T) {
	r := &Resource{
		Key:   "block-doc",
		Title: "Block Doc",
		Blocks: []ResourceBlock{
			{
				ID:     "b1",
				Type:   "text",
				Format: "markdown",
				Data:   json.RawMessage(`"# Hello World"`),
			},
			{
				ID:     "b2",
				Type:   "diagram",
				Format: "mermaid",
				Data:   json.RawMessage(`"graph TD; A-->B;"`),
			},
		},
	}

	if err := r.Normalize(); err != nil {
		t.Fatalf("Normalize failed: %v", err)
	}

	if r.Content == "" {
		t.Fatalf("expected Content to be serialized from Blocks, got empty")
	}
	if r.ContentHash == "" {
		t.Errorf("expected ContentHash to be computed, got empty")
	}
	if r.ByteSize != int64(len(r.Content)) {
		t.Errorf("expected ByteSize to match Content length, got %d vs %d", r.ByteSize, len(r.Content))
	}
}

func TestResource_Normalize_FromPath(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "sample.md")
	testContent := "# Sample Content for Path Testing"
	if err := os.WriteFile(filePath, []byte(testContent), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	r := &Resource{
		Key:   "path-res",
		Title: "Path Resource",
		Path:  filePath,
	}

	if err := r.Normalize(); err != nil {
		t.Fatalf("Normalize failed: %v", err)
	}

	if r.Content != testContent {
		t.Errorf("expected Content %q from file, got %q", testContent, r.Content)
	}
	if r.ContentHash != ComputeContentHash(testContent) {
		t.Errorf("expected matching ContentHash, got %s", r.ContentHash)
	}
}
