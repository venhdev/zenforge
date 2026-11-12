// Package contextpacket assembles prompt-ready context packets for agent
// tasks. It owns entity resolution, skill path resolution, artifact loading, and
// prompt compilation so the storage layer stays persistence-only.
package contextpacket

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"zenf/internal/domain"
	"zenf/internal/domain/prompt"
)

// Builder compiles context packets for tasks.
type Builder struct {
	artifacts domain.ArtifactReader
	projects  domain.ProjectReader
	plans     domain.PlanReader
	agents    domain.AgentReader
	resources domain.ResourceReader
	compiler  prompt.Compiler
}

var _ domain.ContextPacketBuilder = (*Builder)(nil)

// Option configures optional entity readers.
type Option func(*Builder)

// WithProjectReader enables project context in the packet.
func WithProjectReader(reader domain.ProjectReader) Option {
	return func(b *Builder) { b.projects = reader }
}

// WithPlanReader enables plan context in the packet.
func WithPlanReader(reader domain.PlanReader) Option {
	return func(b *Builder) { b.plans = reader }
}

// WithAgentReader enables agent and soul context in the packet.
func WithAgentReader(reader domain.AgentReader) Option {
	return func(b *Builder) { b.agents = reader }
}

// WithResourceReader enables linked SSOT resource resolution.
func WithResourceReader(reader domain.ResourceReader) Option {
	return func(b *Builder) { b.resources = reader }
}

// New returns a Builder that loads input artifacts from artifacts and compiles
// prompts with compiler. A nil compiler falls back to the Markdown compiler.
func New(artifacts domain.ArtifactReader, compiler prompt.Compiler, opts ...Option) *Builder {
	if compiler == nil {
		compiler = prompt.NewCompiler()
	}
	builder := &Builder{artifacts: artifacts, compiler: compiler}
	for _, opt := range opts {
		opt(builder)
	}
	return builder
}

// Build compiles the full context packet for task.
func (b *Builder) Build(ctx context.Context, task domain.Task) (*domain.ContextPacket, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	attachments := []domain.Artifact{}
	if b.artifacts != nil {
		loaded, err := b.artifacts.GetArtifactsByTask(ctx, task.ID, domain.ArtifactRoleInput)
		if err != nil {
			return nil, fmt.Errorf("failed to load input artifacts for task %s: %w", task.ID, err)
		}
		attachments = loaded
	}

	var project *domain.Project
	if task.ProjectSlug != "" && b.projects != nil {
		loaded, err := b.projects.GetProject(ctx, task.ProjectSlug)
		if err != nil {
			return nil, fmt.Errorf("failed to load project %s for task %s: %w", task.ProjectSlug, task.ID, err)
		}
		project = loaded
	}

	var plan *domain.Plan
	if task.PlanSlug != "" && b.plans != nil {
		loaded, err := b.plans.GetPlan(ctx, task.PlanSlug)
		if err != nil {
			return nil, fmt.Errorf("failed to load plan %s for task %s: %w", task.PlanSlug, task.ID, err)
		}
		plan = loaded
	}

	var agent *domain.Agent
	if task.AgentSlug != "" && b.agents != nil {
		loaded, err := b.agents.GetAgent(ctx, task.AgentSlug)
		if err != nil {
			return nil, fmt.Errorf("failed to load agent %s for task %s: %w", task.AgentSlug, task.ID, err)
		}
		agent = loaded
	}

	linked, err := b.loadLinkedResources(ctx, task)
	if err != nil {
		return nil, err
	}

	var soul *domain.Soul
	if agent != nil && b.resources != nil {
		soul = domain.ResolveSoul(ctx, b.resources, task.ProjectSlug, agent.SoulKey)
	}

	packet, err := b.compiler.Compile(ctx, prompt.Input{
		Task:             task,
		Project:          project,
		Plan:             plan,
		Agent:            agent,
		Soul:             soul,
		InputAttachments: attachments,
		LinkedResources:  linked,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to compile prompt for task %s: %w", task.ID, err)
	}
	if packet == nil {
		return nil, fmt.Errorf("prompt compiler returned a nil packet for task %s", task.ID)
	}

	var soulSkills []string
	if soul != nil {
		soulSkills = soul.Skills
	}
	packet.SkillPaths = resolveSkillPaths(task.WorktreePath, domain.MergeSkillSets(soulSkills, task.RequiredSkills))
	return packet, nil
}

// loadLinkedResources resolves required resource keys inside the task's
// project, falls back to globally scoped resources, and automatically includes
// any technical resources scoped to the task's plan.
func (b *Builder) loadLinkedResources(ctx context.Context, task domain.Task) ([]domain.ResourceBrief, error) {
	linked := make([]domain.ResourceBrief, 0, len(task.RequiredDocs))
	if b.resources == nil {
		return linked, nil
	}
	seen := make(map[string]bool)
	for _, key := range task.RequiredDocs {
		resource, err := b.resources.GetResourceByKey(ctx, task.ProjectSlug, key)
		if errors.Is(err, domain.ErrNotFound) && task.ProjectSlug != "" {
			resource, err = b.resources.GetResourceByKey(ctx, "", key)
		}
		if err != nil {
			return nil, fmt.Errorf("failed to load required resource %s for task %s: %w", key, task.ID, err)
		}
		brief := resource.Brief()
		linked = append(linked, brief)
		seen[brief.Key] = true
	}

	// Auto-link technical resources scoped directly to the task's plan
	if task.PlanSlug != "" {
		planResources, err := b.resources.ListResources(ctx, domain.ResourceFilter{
			Scope:    domain.ResourceScopePlan,
			ScopeRef: task.PlanSlug,
		})
		if err == nil {
			for _, res := range planResources {
				if !seen[res.Key] {
					linked = append(linked, res.Brief())
					seen[res.Key] = true
				}
			}
		}
	}

	return linked, nil
}

// resolveSkillPaths maps skill names to SKILL.md files when the task has a
// worktree binding.
func resolveSkillPaths(worktreePath string, skills []string) []string {
	paths := make([]string, 0, len(skills))
	if worktreePath == "" {
		return append(paths, skills...)
	}

	for _, skill := range skills {
		localPath := filepath.Join(worktreePath, ".agents", "skills", skill, "SKILL.md")
		if _, err := os.Stat(localPath); err == nil {
			paths = append(paths, localPath)
			continue
		}
		paths = append(paths, skill)
	}
	return paths
}
