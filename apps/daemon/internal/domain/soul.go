package domain

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// SoulFrontmatter is the optional YAML preamble of a soul markdown document.
// Only `skills` affects execution; `name` is presentation.
type SoulFrontmatter struct {
	Name   string   `yaml:"name"`
	Skills []string `yaml:"skills"`
}

// Soul is the resolved persona context attached to an agent at claim time.
// It is projected from a Resource with Kind == ResourceKindSoul.
type Soul struct {
	Key    string   `json:"key"`
	Name   string   `json:"name,omitempty"`
	Skills []string `json:"skills,omitempty"`
	// Body is rendered into the compiled prompt only. It is omitted from the
	// packet JSON so the persona text is not duplicated in the response.
	Body string `json:"-"`
}

// ParseSoul splits optional YAML frontmatter from a soul markdown body.
// Malformed or absent frontmatter yields an empty struct and the original
// content as the body: a broken soul still contributes its prose, never a fault.
func ParseSoul(content string) (SoulFrontmatter, string) {
	fm := SoulFrontmatter{}

	trimmed := strings.TrimLeft(content, " \t\r\n")
	if !strings.HasPrefix(trimmed, "---") {
		return fm, content
	}

	rest := strings.TrimPrefix(trimmed, "---")
	if !strings.HasPrefix(rest, "\n") {
		return fm, content
	}
	rest = strings.TrimPrefix(rest, "\n")

	closing := strings.Index(rest, "\n---")
	if closing < 0 {
		return fm, content
	}

	header := rest[:closing]
	body := strings.TrimPrefix(rest[closing+len("\n---"):], "\n")

	if err := yaml.Unmarshal([]byte(header), &fm); err != nil {
		return SoulFrontmatter{}, content
	}
	fm.Skills = normalizeSkillNames(fm.Skills)
	return fm, strings.TrimSpace(body)
}

// normalizeSkillNames trims, drops empties, and de-duplicates skill names
// case-insensitively while preserving first-seen order.
func normalizeSkillNames(in []string) []string {
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, name := range in {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, name)
	}
	return out
}

// MergeSkillSets returns the additive union of soul and task skills.
// Soul order comes first, then task extras, de-duplicated case-insensitively.
// A task can extend a soul's workflow but never remove a step from it.
func MergeSkillSets(soulSkills, taskSkills []string) []string {
	merged := make([]string, 0, len(soulSkills)+len(taskSkills))
	merged = append(merged, soulSkills...)
	merged = append(merged, taskSkills...)
	return normalizeSkillNames(merged)
}

// soulFromResource projects a soul-kind resource into the packet-facing Soul.
// Non-soul resources return nil so callers cannot accidentally bind a spec.
func soulFromResource(r *Resource) *Soul {
	if r == nil || r.Kind != ResourceKindSoul {
		return nil
	}
	fm, body := ParseSoul(r.Content)

	name := fm.Name
	if name == "" {
		name = r.Title
	}
	if name == "" {
		name = r.Key
	}

	return &Soul{
		Key:    r.Key,
		Name:   name,
		Skills: fm.Skills,
		Body:   body,
	}
}

// SoulReader is the narrow read seam needed to resolve and validate a soul
// binding. It is the resource subset a soul consumer actually needs.
type SoulReader interface {
	GetResourceByKey(ctx context.Context, projectSlug string, key string) (*Resource, error)
	ListResources(ctx context.Context, filter ResourceFilter) ([]Resource, error)
}

// ResolveSoul loads the soul bound to key, preferring projectSlug and falling
// back to the global scope. It returns nil for an empty key, a missing resource,
// or a resource of the wrong kind: a soul supplies content, so resolution never
// becomes a hard dispatch gate.
func ResolveSoul(ctx context.Context, reader SoulReader, projectSlug, key string) *Soul {
	if reader == nil || key == "" {
		return nil
	}
	resource, err := reader.GetResourceByKey(ctx, projectSlug, key)
	if errors.Is(err, ErrNotFound) && projectSlug != "" {
		resource, err = reader.GetResourceByKey(ctx, "", key)
	}
	if err != nil || resource == nil {
		return nil
	}
	return soulFromResource(resource)
}

// ValidateSoulKey rejects a key that resolves to no soul resource in any scope.
// Agents are global while souls are project-scoped, so existence is checked
// across projects: any `kind=soul` resource with this key satisfies the binding.
func ValidateSoulKey(ctx context.Context, reader SoulReader, key string) error {
	if key == "" || reader == nil {
		return nil
	}
	matches, err := reader.ListResources(ctx, ResourceFilter{
		Key:   key,
		Kind:  ResourceKindSoul,
		Limit: 1,
	})
	if err != nil {
		return fmt.Errorf("failed to resolve soul %q: %w", key, err)
	}
	if len(matches) == 0 {
		return fmt.Errorf("soul_key %q does not reference a resource with kind=%q", key, ResourceKindSoul)
	}
	return nil
}

// ValidateAgentSlug rejects a slug that names no registered agent. An empty
// slug is valid: the task is simply unassigned and may be claimed by anyone.
func ValidateAgentSlug(ctx context.Context, reader AgentReader, slug string) error {
	if slug == "" || reader == nil {
		return nil
	}
	if _, err := reader.GetAgent(ctx, slug); err != nil {
		if errors.Is(err, ErrNotFound) {
			return fmt.Errorf("agent_slug %q does not reference a registered agent", slug)
		}
		return fmt.Errorf("failed to resolve agent %q: %w", slug, err)
	}
	return nil
}
