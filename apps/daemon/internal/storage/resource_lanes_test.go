package storage_test

import (
	"testing"

	"zenf/internal/domain"
)

func TestResourceStore_URLRoundtripAndExclusivity(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")

	link := domain.Resource{
		ProjectSlug: "alpha",
		Key:         "REF-GO",
		Slug:        "ref-go",
		Kind:        domain.ResourceKindSpec,
		Type:        domain.ResourceTypeReference,
		Scope:       domain.ResourceScopeProject,
		Title:       "Go concurrency reference",
		URL:         "https://go.dev/blog/waza-talk",
		Summary:     "External reference",
	}
	if err := store.CreateResource(ctx, link); err != nil {
		t.Fatalf("CreateResource with url failed: %v", err)
	}

	got, err := store.GetResourceByKey(ctx, "alpha", "REF-GO")
	if err != nil {
		t.Fatalf("GetResourceByKey failed: %v", err)
	}
	if got.URL != link.URL {
		t.Fatalf("expected url %q, got %q", link.URL, got.URL)
	}

	both := domain.Resource{
		ProjectSlug: "alpha", Key: "BOTH", Slug: "both",
		Scope: domain.ResourceScopeProject, Title: "Both",
		Path: "/tmp/both.md", URL: "https://example.com",
	}
	if err := store.CreateResource(ctx, both); err == nil {
		t.Fatal("expected path+url to be rejected")
	}

	badURL := domain.Resource{
		ProjectSlug: "alpha", Key: "BADURL", Slug: "badurl",
		Scope: domain.ResourceScopeProject, Title: "Bad", URL: "ftp://example.com",
	}
	if err := store.CreateResource(ctx, badURL); err == nil {
		t.Fatal("expected a non-http url to be rejected")
	}
}

func TestResourceStore_ScopeMatrix(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")

	cases := map[string]domain.Resource{
		"global-with-project": {
			ProjectSlug: "alpha", Key: "G1", Slug: "g1",
			Scope: domain.ResourceScopeGlobal, Title: "G1",
		},
		"project-without-project": {
			Key: "P1", Slug: "p1", Scope: domain.ResourceScopeProject, Title: "P1",
		},
		"project-with-scope-ref": {
			ProjectSlug: "alpha", Key: "P2", Slug: "p2",
			Scope: domain.ResourceScopeProject, ScopeRef: "x", Title: "P2",
		},
		"plan-without-ref": {
			ProjectSlug: "alpha", Key: "PL1", Slug: "pl1",
			Scope: domain.ResourceScopePlan, Title: "PL1",
		},
		"task-without-project": {
			Key: "T1", Slug: "t1", Scope: domain.ResourceScopeTask, ScopeRef: "task-1", Title: "T1",
		},
	}
	for name, resource := range cases {
		t.Run(name, func(t *testing.T) {
			if err := store.CreateResource(ctx, resource); err == nil {
				t.Fatalf("expected scope matrix to reject %s", name)
			}
		})
	}

	global := domain.Resource{Key: "G-OK", Slug: "g-ok", Scope: domain.ResourceScopeGlobal, Title: "Global"}
	if err := store.CreateResource(ctx, global); err != nil {
		t.Fatalf("valid global resource rejected: %v", err)
	}

	taskScoped := domain.Resource{
		ProjectSlug: "alpha", Key: "T-OK", Slug: "t-ok",
		Scope: domain.ResourceScopeTask, ScopeRef: "task-1", Title: "Task scoped",
	}
	if err := store.CreateResource(ctx, taskScoped); err != nil {
		t.Fatalf("valid task-scoped resource rejected: %v", err)
	}
}

func TestArtifactStore_ExactlyOneOwner(t *testing.T) {
	store, ctx := newTestStore(t)
	seedProject(t, store, ctx, "alpha")

	base := domain.Artifact{
		ID: "art-owner", Name: "file.png", Type: domain.ArtifactTypeImage,
		FilePath: "/tmp/file.png", MimeType: "image/png", ByteSize: 10,
	}

	orphan := base
	if err := store.RecordArtifact(ctx, orphan); err == nil {
		t.Fatal("expected an artifact with no owner to be rejected")
	}

	twoOwners := base
	twoOwners.TaskID = "task-1"
	twoOwners.ResourceID = "res-1"
	if err := store.RecordArtifact(ctx, twoOwners); err == nil {
		t.Fatal("expected an artifact with two owners to be rejected")
	}
}
