package storage_test

import (
	"errors"
	"testing"

	"zenf/internal/domain"
	"zenf/internal/storage"
)

func newResource(project, key string) domain.Resource {
	return domain.Resource{
		ProjectSlug: project,
		Key:         key,
		Slug:        key,
		Kind:        domain.ResourceKindSpec,
		Type:        domain.ResourceTypeArchitecture,
		Scope:       domain.ResourceScopeProject,
		Title:       "Title " + key,
		Path:        "/tmp/docs/" + key + ".md",
		Content:     "architecture and design notes for " + key,
		Summary:     "summary for " + key,
		Tags:        []string{"Architecture", " core ", "architecture"},
	}
}

func TestResourceStore_CreateDefaultsAndTags(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")

	resource := newResource("alpha", "ARCH")
	if err := store.CreateResource(ctx, resource); err != nil {
		t.Fatalf("CreateResource failed: %v", err)
	}

	created, err := store.GetResourceByKey(ctx, "alpha", "ARCH")
	if err != nil {
		t.Fatalf("GetResourceByKey failed: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected generated resource id")
	}
	if created.Kind != domain.ResourceKindSpec {
		t.Fatalf("expected default kind 'spec', got %s", created.Kind)
	}
	if created.Status != domain.ResourceStatusActive || created.Version != 1 {
		t.Fatalf("unexpected defaults: %+v", created)
	}
	if created.ContentHash == "" || created.ByteSize == 0 {
		t.Fatalf("expected content hash and byte size to be provided: %+v", created)
	}
	if len(created.Tags) != 2 || created.Tags[0] != "architecture" || created.Tags[1] != "core" {
		t.Fatalf("tags not normalized: %+v", created.Tags)
	}

	bySlug, err := store.GetResourceBySlug(ctx, "alpha", "ARCH")
	if err != nil || bySlug.ID != created.ID {
		t.Fatalf("GetResourceBySlug mismatch: %+v, err=%v", bySlug, err)
	}
}

func TestResourceStore_UniquenessPerProjectAndGlobal(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedProject(t, store, ctx, "beta")

	if err := store.CreateResource(ctx, newResource("alpha", "ARCH")); err != nil {
		t.Fatalf("create alpha doc failed: %v", err)
	}
	if err := store.CreateResource(ctx, newResource("alpha", "ARCH")); !errors.Is(err, storage.ErrAlreadyExists) {
		t.Fatalf("expected duplicate key in same project to fail, got %v", err)
	}
	if err := store.CreateResource(ctx, newResource("beta", "ARCH")); err != nil {
		t.Fatalf("same key in another project should be allowed: %v", err)
	}

	global := newResource("", "RULES")
	global.Scope = domain.ResourceScopeGlobal
	if err := store.CreateResource(ctx, global); err != nil {
		t.Fatalf("create global doc failed: %v", err)
	}
	if err := store.CreateResource(ctx, global); !errors.Is(err, storage.ErrAlreadyExists) {
		t.Fatalf("expected duplicate global key to fail, got %v", err)
	}
}

func TestResourceStore_Validation(t *testing.T) {
	store, ctx := newTestStore(t)

	cases := []domain.Resource{
		{Key: "", Slug: "no-key", Scope: domain.ResourceScopeGlobal, Title: "No key"},
		{Key: "NO-TITLE", Slug: "no-title", Scope: domain.ResourceScopeGlobal, Path: "/tmp/x.md"},
		{Key: "SPACE IN KEY", Slug: "space-key", Scope: domain.ResourceScopeGlobal, Title: "Space Key"},
		{
			Key: "PLAN-SCOPE", Slug: "plan",
			Scope: domain.ResourceScopePlan, Title: "x", Path: "/tmp/x.md", // missing ScopeRef
		},
	}
	for _, resource := range cases {
		if err := store.CreateResource(ctx, resource); err == nil {
			t.Fatalf("expected validation error for %+v", resource)
		}
	}
}

func TestResourceStore_NativeFirstAndMultiTypes(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "zenforge")

	nativeResource := domain.Resource{
		ProjectSlug: "zenforge",
		Key:         "research.headless",
		Slug:        "headless-cli-matrix",
		Kind:        domain.ResourceKindSpec,
		Title:       "Headless CLI Matrix",
		Scope:       domain.ResourceScopeProject,
		Format:      "markdown",
		Types:       []string{"research", "scout", "adaptor"},
		Path:        "", // Native SQLite Resource (no file on disk!)
		Content:     "# Headless CLI Matrix\n\n```mermaid\ngraph TD\n```",
		Summary:     "Comprehensive scout matrix for AI agent CLI headless execution.",
	}

	if err := store.CreateResource(ctx, nativeResource); err != nil {
		t.Fatalf("failed to create native resource: %v", err)
	}

	fetched, err := store.GetResourceByKey(ctx, "zenforge", "research.headless")
	if err != nil {
		t.Fatalf("failed to get native resource: %v", err)
	}

	if fetched.Path != "" {
		t.Errorf("expected empty path for native resource, got %q", fetched.Path)
	}
	if len(fetched.Types) != 3 || fetched.Types[0] != "research" {
		t.Errorf("expected multi-types preserved, got %+v", fetched.Types)
	}
	if fetched.Format != "markdown" {
		t.Errorf("expected format markdown, got %s", fetched.Format)
	}

	// Filter by Types
	filtered, err := store.ListResources(ctx, domain.ResourceFilter{
		ProjectSlug: "zenforge",
		Types:       []string{"scout"},
	})
	if err != nil {
		t.Fatalf("failed to list by type scout: %v", err)
	}
	if len(filtered) != 1 || filtered[0].Slug != "headless-cli-matrix" {
		t.Fatalf("expected 1 resource matched by type scout, got %d", len(filtered))
	}
}

func TestResourceStore_KindFiltering(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "zenforge")

	soul := domain.Resource{
		ProjectSlug: "zenforge",
		Key:         "soul.coder",
		Slug:        "coder",
		Kind:        domain.ResourceKindSoul,
		Title:       "Coder Persona",
		Scope:       domain.ResourceScopeProject,
		Content:     "You are an expert coder.",
	}
	harness := domain.Resource{
		ProjectSlug: "zenforge",
		Key:         "harness.vitest",
		Slug:        "vitest",
		Kind:        domain.ResourceKindHarness,
		Title:       "Vitest Test Harness",
		Scope:       domain.ResourceScopeProject,
		Content:     "npm test",
	}
	spec := domain.Resource{
		ProjectSlug: "zenforge",
		Key:         "spec.api",
		Slug:        "api-spec",
		Kind:        domain.ResourceKindSpec,
		Title:       "API Specification",
		Scope:       domain.ResourceScopeProject,
		Content:     "# API Spec",
	}

	for _, r := range []domain.Resource{soul, harness, spec} {
		if err := store.CreateResource(ctx, r); err != nil {
			t.Fatalf("failed to seed resource: %v", err)
		}
	}

	souls, err := store.ListResources(ctx, domain.ResourceFilter{ProjectSlug: "zenforge", Kind: domain.ResourceKindSoul})
	if err != nil || len(souls) != 1 || souls[0].Key != "soul.coder" {
		t.Fatalf("expected 1 soul, got: %+v, err=%v", souls, err)
	}

	harnesses, err := store.ListResources(ctx, domain.ResourceFilter{ProjectSlug: "zenforge", Kind: domain.ResourceKindHarness})
	if err != nil || len(harnesses) != 1 || harnesses[0].Key != "harness.vitest" {
		t.Fatalf("expected 1 harness, got: %+v, err=%v", harnesses, err)
	}
}

func TestResourceStore_ListFilters(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedProject(t, store, ctx, "beta")

	arch := newResource("alpha", "ARCH")
	global := newResource("", "RULES")
	global.Scope = domain.ResourceScopeGlobal
	global.Type = domain.ResourceTypeRule
	global.Tags = []string{"rule"}
	betaDoc := newResource("beta", "SPEC")
	betaDoc.Type = domain.ResourceTypeSpec
	betaDoc.Tags = []string{"spec"}

	for _, resource := range []domain.Resource{arch, global, betaDoc} {
		if err := store.CreateResource(ctx, resource); err != nil {
			t.Fatalf("seed resource failed: %v", err)
		}
	}

	projectOnly, err := store.ListResources(ctx, domain.ResourceFilter{ProjectSlug: "alpha"})
	if err != nil || len(projectOnly) != 1 || projectOnly[0].Key != "ARCH" {
		t.Fatalf("unexpected project-only list: %+v, err=%v", projectOnly, err)
	}
	withGlobal, err := store.ListResources(ctx, domain.ResourceFilter{ProjectSlug: "alpha", IncludeGlobal: true})
	if err != nil || len(withGlobal) != 2 {
		t.Fatalf("unexpected include-global list: %+v, err=%v", withGlobal, err)
	}
	byType, err := store.ListResources(ctx, domain.ResourceFilter{Type: domain.ResourceTypeRule})
	if err != nil || len(byType) != 1 || byType[0].Key != "RULES" {
		t.Fatalf("unexpected type filter: %+v, err=%v", byType, err)
	}
	byTag, err := store.ListResources(ctx, domain.ResourceFilter{Tag: "spec"})
	if err != nil || len(byTag) != 1 || byTag[0].Key != "SPEC" {
		t.Fatalf("unexpected tag filter: %+v, err=%v", byTag, err)
	}
	limited, err := store.ListResources(ctx, domain.ResourceFilter{Limit: 1})
	if err != nil || len(limited) != 1 {
		t.Fatalf("unexpected limit result: %+v, err=%v", limited, err)
	}
}

func TestResourceStore_UpdateRefreshArchiveDelete(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	if err := store.CreateResource(ctx, newResource("alpha", "ARCH")); err != nil {
		t.Fatalf("create resource failed: %v", err)
	}
	resource, _ := store.GetResourceByKey(ctx, "alpha", "ARCH")

	newContent := "Updated content version 2"
	if err := store.UpdateResource(ctx, resource.ID, domain.ResourcePatch{
		Title:   ptr("Renamed"),
		Summary: ptr("new summary"),
		Path:    ptr("/tmp/docs/renamed.md"),
		Tags:    &[]string{"new-tag"},
		Content: &newContent,
	}); err != nil {
		t.Fatalf("UpdateResource failed: %v", err)
	}
	updated, _ := store.GetResource(ctx, resource.ID)
	if updated.Title != "Renamed" || updated.Summary != "new summary" || updated.Path != "/tmp/docs/renamed.md" {
		t.Fatalf("metadata patch not applied: %+v", updated)
	}
	if updated.Version != 2 {
		t.Fatalf("expected version 2 after content update, got %d", updated.Version)
	}
	if len(updated.Tags) != 1 || updated.Tags[0] != "new-tag" {
		t.Fatalf("tags not replaced: %+v", updated.Tags)
	}

	if err := store.RefreshResource(ctx, resource.ID, "fresh content about widgets", "hash-fresh", 26); err != nil {
		t.Fatalf("RefreshResource failed: %v", err)
	}
	refreshed, _ := store.GetResource(ctx, resource.ID)
	if refreshed.Version != 3 || refreshed.Content != "fresh content about widgets" ||
		refreshed.ContentHash != "hash-fresh" || refreshed.ByteSize != 26 {
		t.Fatalf("refresh not applied: %+v", refreshed)
	}

	if err := store.ArchiveResource(ctx, resource.ID, true); err != nil {
		t.Fatalf("ArchiveResource failed: %v", err)
	}
	archived, _ := store.GetResource(ctx, resource.ID)
	if archived.Status != domain.ResourceStatusArchived {
		t.Fatalf("status = %s, want ARCHIVED", archived.Status)
	}

	if err := store.DeleteResource(ctx, resource.ID); err != nil {
		t.Fatalf("DeleteResource failed: %v", err)
	}
	if _, err := store.GetResource(ctx, resource.ID); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected resource deleted, got %v", err)
	}
}

func TestResourceStore_SearchUsesFTSTriggers(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")
	seedProject(t, store, ctx, "beta")

	arch := newResource("alpha", "ARCH")
	arch.Content = "The claim handshake uses an atomic database transaction."
	if err := store.CreateResource(ctx, arch); err != nil {
		t.Fatalf("create alpha doc failed: %v", err)
	}
	global := newResource("", "GLOBAL-RULES")
	global.Scope = domain.ResourceScopeGlobal
	global.Content = "Global rule about atomic transactions and locking."
	if err := store.CreateResource(ctx, global); err != nil {
		t.Fatalf("create global doc failed: %v", err)
	}
	beta := newResource("beta", "BETA-SPEC")
	beta.Content = "Beta mentions transactions differently."
	if err := store.CreateResource(ctx, beta); err != nil {
		t.Fatalf("create beta doc failed: %v", err)
	}

	results, err := store.SearchResources(ctx, "atomic transactions",
		domain.ResourceFilter{ProjectSlug: "alpha", IncludeGlobal: true})
	if err != nil {
		t.Fatalf("SearchResources failed: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 hits for alpha+global, got %d: %+v", len(results), results)
	}
	for _, result := range results {
		if result.Resource.ProjectSlug == "beta" {
			t.Fatalf("project filter leaked beta hit: %+v", result)
		}
		if result.Snippet == "" {
			t.Fatalf("expected a snippet, got none for %+v", result.Resource.Key)
		}
	}

	if _, err := store.SearchResources(ctx, "", domain.ResourceFilter{}); err != nil {
		t.Fatalf("empty query should not fail: %v", err)
	}
}

func TestResourceStore_BatchTagPreloading(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "perf-proj")

	r1 := newResource("perf-proj", "RES-1")
	r1.Tags = []string{"alpha", "shared"}
	r2 := newResource("perf-proj", "RES-2")
	r2.Tags = []string{"beta", "shared"}
	r3 := newResource("perf-proj", "RES-3")
	r3.Tags = []string{"gamma"}

	for _, r := range []domain.Resource{r1, r2, r3} {
		if err := store.CreateResource(ctx, r); err != nil {
			t.Fatalf("CreateResource failed: %v", err)
		}
	}

	// 1. Verify ListResources batch preloads tags accurately
	list, err := store.ListResources(ctx, domain.ResourceFilter{ProjectSlug: "perf-proj"})
	if err != nil {
		t.Fatalf("ListResources failed: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("expected 3 resources, got %d", len(list))
	}

	tagMap := make(map[string][]string)
	for _, res := range list {
		tagMap[res.Key] = res.Tags
	}
	if len(tagMap["RES-1"]) != 2 || tagMap["RES-1"][0] != "alpha" || tagMap["RES-1"][1] != "shared" {
		t.Fatalf("unexpected tags for RES-1: %+v", tagMap["RES-1"])
	}
	if len(tagMap["RES-2"]) != 2 || tagMap["RES-2"][0] != "beta" || tagMap["RES-2"][1] != "shared" {
		t.Fatalf("unexpected tags for RES-2: %+v", tagMap["RES-2"])
	}
	if len(tagMap["RES-3"]) != 1 || tagMap["RES-3"][0] != "gamma" {
		t.Fatalf("unexpected tags for RES-3: %+v", tagMap["RES-3"])
	}

	// 2. Verify SearchResources batch preloads tags accurately
	searchHits, err := store.SearchResources(ctx, "architecture", domain.ResourceFilter{ProjectSlug: "perf-proj"})
	if err != nil {
		t.Fatalf("SearchResources failed: %v", err)
	}
	if len(searchHits) != 3 {
		t.Fatalf("expected 3 search hits, got %d", len(searchHits))
	}
	for _, hit := range searchHits {
		if len(hit.Resource.Tags) == 0 {
			t.Fatalf("expected tags to be populated on search hit %s, got empty", hit.Resource.Key)
		}
	}
}
