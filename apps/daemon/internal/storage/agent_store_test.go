package storage_test

import (
	"errors"
	"testing"

	"zenf/internal/domain"
	"zenf/internal/storage"
)

func TestAgentStore_CreateDefaultsAndValidation(t *testing.T) {
	store, ctx := newTestStore(t)

	agent := domain.Agent{Slug: "coder", Name: "Coder", Enabled: true}
	if err := store.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("CreateAgent failed: %v", err)
	}
	created, err := store.GetAgent(ctx, "coder")
	if err != nil {
		t.Fatalf("GetAgent failed: %v", err)
	}
	if created.Mode != domain.AgentModeHeadless || created.SoulKey != "" {
		t.Fatalf("unexpected defaults: %+v", created)
	}

	bad := []domain.Agent{
		{Name: "No slug", Enabled: true},
		{Slug: "no-name", Enabled: true},
		{Slug: "bad-mode", Name: "Bad", Mode: "NOPE", Enabled: true},
	}
	for _, candidate := range bad {
		if err := store.CreateAgent(ctx, candidate); err == nil {
			t.Fatalf("expected validation error for %+v", candidate)
		}
	}

	if err := store.CreateAgent(ctx, domain.Agent{Slug: "coder", Name: "Duplicate", Enabled: true}); !errors.Is(err, storage.ErrAlreadyExists) {
		t.Fatalf("expected ErrAlreadyExists, got %v", err)
	}
}

func TestAgentStore_UpdateListDelete(t *testing.T) {
	store, ctx := newTestStore(t)

	explorer := domain.Agent{Slug: "explorer", Name: "Explorer", SoulKey: "SOUL_ARCHITECT", Enabled: true}
	reviewer := domain.Agent{Slug: "reviewer", Name: "Reviewer", Enabled: false}
	for _, agent := range []domain.Agent{explorer, reviewer} {
		if err := store.CreateAgent(ctx, agent); err != nil {
			t.Fatalf("CreateAgent(%s) failed: %v", agent.Slug, err)
		}
	}

	enabled, err := store.ListAgents(ctx, false)
	if err != nil || len(enabled) != 1 || enabled[0].Slug != "explorer" {
		t.Fatalf("unexpected enabled list: %+v, err=%v", enabled, err)
	}
	all, err := store.ListAgents(ctx, true)
	if err != nil || len(all) != 2 {
		t.Fatalf("unexpected all list: %+v, err=%v", all, err)
	}

	if err := store.UpdateAgent(ctx, "explorer", domain.AgentPatch{
		Name:    ptr("Explorer Updated"),
		SoulKey: ptr("SOUL_CODER"),
		Mode:    ptr(domain.AgentModeInteractive),
		Goal:    ptr("map the codebase"),
		StartConditions: &domain.AgentStartConditions{
			TaskStatus:     domain.StatusReady,
			MaxRiskLevel:   domain.RiskHigh,
			MaxConcurrency: 2,
		},
		StopConditions: &domain.AgentStopConditions{
			OnFailure:      "AWAITING_REVIEW",
			TimeoutSeconds: 900,
		},
		Schedule: ptr("0 * * * *"),
		Skills:   &[]string{"recon"},
		Runner:   ptr("codex"),
		Enabled:  ptr(true),
	}); err != nil {
		t.Fatalf("UpdateAgent failed: %v", err)
	}
	updated, _ := store.GetAgent(ctx, "explorer")
	if updated.Name != "Explorer Updated" || updated.SoulKey != "SOUL_CODER" ||
		updated.Mode != domain.AgentModeInteractive || updated.Goal != "map the codebase" {
		t.Fatalf("agent patch not applied: %+v", updated)
	}
	if updated.StartConditions.TaskStatus != domain.StatusReady || updated.StopConditions.OnFailure != "AWAITING_REVIEW" ||
		len(updated.Skills) != 1 || updated.Schedule != "0 * * * *" {
		t.Fatalf("agent list fields not applied: %+v", updated)
	}

	if err := store.UpdateAgent(ctx, "reviewer", domain.AgentPatch{Enabled: ptr(true)}); err != nil {
		t.Fatalf("enable reviewer failed: %v", err)
	}
	if enabled, _ := store.ListAgents(ctx, false); len(enabled) != 2 {
		t.Fatalf("expected reviewer enabled, got %+v", enabled)
	}

	if err := store.DeleteAgent(ctx, "reviewer"); err != nil {
		t.Fatalf("DeleteAgent failed: %v", err)
	}
	if _, err := store.GetAgent(ctx, "reviewer"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected agent deleted, got %v", err)
	}
	if err := store.DeleteAgent(ctx, "reviewer"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected ErrNotFound on second delete, got %v", err)
	}
}
