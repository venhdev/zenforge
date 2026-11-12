package domain

import (
	"context"
	"strings"
	"testing"
)

func TestParseSoul_FrontmatterAndBody(t *testing.T) {
	content := "---\nname: debugger\nskills: [recon, diagnose, tdd]\n---\n\nYou are a debugger."

	fm, body := ParseSoul(content)

	if fm.Name != "debugger" {
		t.Fatalf("expected name debugger, got %q", fm.Name)
	}
	if len(fm.Skills) != 3 || fm.Skills[0] != "recon" || fm.Skills[2] != "tdd" {
		t.Fatalf("unexpected skills %v", fm.Skills)
	}
	if body != "You are a debugger." {
		t.Fatalf("unexpected body %q", body)
	}
}

func TestParseSoul_NoFrontmatter(t *testing.T) {
	content := "You are a coder."
	fm, body := ParseSoul(content)

	if fm.Name != "" || len(fm.Skills) != 0 {
		t.Fatalf("expected empty frontmatter, got %+v", fm)
	}
	if body != content {
		t.Fatalf("expected body passthrough, got %q", body)
	}
}

func TestParseSoul_MalformedFrontmatterFallsBackToBody(t *testing.T) {
	content := "---\nskills: [unclosed\n---\nbody text"
	fm, body := ParseSoul(content)

	if len(fm.Skills) != 0 {
		t.Fatalf("expected no parsed skills, got %v", fm.Skills)
	}
	if body != content {
		t.Fatalf("expected full content preserved, got %q", body)
	}
}

func TestParseSoul_UnterminatedFenceIsBody(t *testing.T) {
	content := "---\nname: broken\nno closing fence"
	_, body := ParseSoul(content)

	if body != content {
		t.Fatalf("expected content preserved, got %q", body)
	}
}

func TestMergeSkillSets_AdditiveAndOrdered(t *testing.T) {
	got := MergeSkillSets(
		[]string{"recon", "Diagnose"},
		[]string{"diagnose", " tdd ", ""},
	)
	want := []string{"recon", "Diagnose", "tdd"}

	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
}

func TestMergeSkillSets_TaskCannotRemoveSoulSkill(t *testing.T) {
	got := MergeSkillSets([]string{"recon", "diagnose"}, []string{"tdd"})

	for _, required := range []string{"recon", "diagnose", "tdd"} {
		found := false
		for _, s := range got {
			if strings.EqualFold(s, required) {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected %q in union, got %v", required, got)
		}
	}
}

func TestSoulFromResource_ProjectsSoulKindOnly(t *testing.T) {
	soulRes := &Resource{
		Key:     "SOUL_DEBUGGER",
		Kind:    ResourceKindSoul,
		Title:   "Debugger Soul",
		Content: "---\nskills: [recon]\n---\nBody",
	}
	soul := soulFromResource(soulRes)
	if soul == nil {
		t.Fatal("expected soul projection")
	}
	if soul.Key != "SOUL_DEBUGGER" || soul.Name != "Debugger Soul" || soul.Body != "Body" {
		t.Fatalf("unexpected soul %+v", soul)
	}
	if len(soul.Skills) != 1 || soul.Skills[0] != "recon" {
		t.Fatalf("unexpected skills %v", soul.Skills)
	}

	specRes := &Resource{Key: "ARCH", Kind: ResourceKindSpec}
	if soulFromResource(specRes) != nil {
		t.Fatal("expected nil for non-soul resource")
	}
	if soulFromResource(nil) != nil {
		t.Fatal("expected nil for nil resource")
	}
}

type stubSoulReader struct {
	byKey  map[string]*Resource
	listed []Resource
	err    error
}

func (s stubSoulReader) GetResourceByKey(_ context.Context, projectSlug string, key string) (*Resource, error) {
	if s.err != nil {
		return nil, s.err
	}
	if r, ok := s.byKey[projectSlug+"/"+key]; ok {
		return r, nil
	}
	return nil, ErrNotFound
}

func (s stubSoulReader) ListResources(_ context.Context, filter ResourceFilter) ([]Resource, error) {
	if s.err != nil {
		return nil, s.err
	}
	out := make([]Resource, 0, len(s.listed))
	for _, r := range s.listed {
		if filter.Key != "" && r.Key != filter.Key {
			continue
		}
		if filter.Kind != "" && r.Kind != filter.Kind {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

func TestValidateSoulKey(t *testing.T) {
	lister := stubSoulReader{listed: []Resource{
		{Key: "SOUL_CODER", Kind: ResourceKindSoul},
		{Key: "ARCH", Kind: ResourceKindSpec},
	}}

	if err := ValidateSoulKey(context.Background(), lister, "SOUL_CODER"); err != nil {
		t.Fatalf("expected soul key to validate, got %v", err)
	}
	if err := ValidateSoulKey(context.Background(), lister, ""); err != nil {
		t.Fatalf("empty soul key must be allowed, got %v", err)
	}
	if err := ValidateSoulKey(context.Background(), lister, "ARCH"); err == nil {
		t.Fatal("expected a non-soul resource to be rejected")
	}
	if err := ValidateSoulKey(context.Background(), lister, "SOUL_MISSING"); err == nil {
		t.Fatal("expected an unknown soul key to be rejected")
	}
}

func TestResolveSoul_ProjectThenGlobalFallback(t *testing.T) {
	reader := stubSoulReader{byKey: map[string]*Resource{
		"alpha/SOUL_D": {Key: "SOUL_D", Kind: ResourceKindSoul, ProjectSlug: "alpha", Content: "---\nskills: [recon]\n---\nproject body"},
		"/SOUL_G":      {Key: "SOUL_G", Kind: ResourceKindSoul, Content: "global body"},
		"alpha/ARCH":   {Key: "ARCH", Kind: ResourceKindSpec, ProjectSlug: "alpha"},
	}}

	if got := ResolveSoul(context.Background(), reader, "alpha", "SOUL_D"); got == nil || got.Body != "project body" {
		t.Fatalf("expected project-scoped soul, got %+v", got)
	}
	if got := ResolveSoul(context.Background(), reader, "beta", "SOUL_G"); got == nil || got.Body != "global body" {
		t.Fatalf("expected global fallback, got %+v", got)
	}
	if got := ResolveSoul(context.Background(), reader, "alpha", "ARCH"); got != nil {
		t.Fatalf("expected nil for a spec resource, got %+v", got)
	}
	if got := ResolveSoul(context.Background(), reader, "alpha", "SOUL_MISSING"); got != nil {
		t.Fatalf("expected nil for a missing soul, got %+v", got)
	}
}

type stubAgentReader struct {
	agents map[string]*Agent
}

func (s stubAgentReader) GetAgent(_ context.Context, slug string) (*Agent, error) {
	if a, ok := s.agents[slug]; ok {
		return a, nil
	}
	return nil, ErrNotFound
}

func TestValidateAgentSlug(t *testing.T) {
	reader := stubAgentReader{agents: map[string]*Agent{
		"coder-alpha": {Slug: "coder-alpha", Name: "Coder Alpha", Enabled: true},
	}}

	if err := ValidateAgentSlug(context.Background(), reader, ""); err != nil {
		t.Fatalf("empty slug must be valid, got %v", err)
	}
	if err := ValidateAgentSlug(context.Background(), reader, "coder-alpha"); err != nil {
		t.Fatalf("registered agent must validate, got %v", err)
	}
	if err := ValidateAgentSlug(context.Background(), reader, "coder-alpah"); err == nil {
		t.Fatal("expected a typo to be rejected instead of stored as a dangling assignment")
	}
}
