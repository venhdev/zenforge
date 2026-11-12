package prompt

import (
	"context"
	"fmt"
	"strings"

	"zenf/internal/domain"
)

// Input carries every entity the compiler may render into a context packet.
// Pointers stay nil when the task is an orphan or has no agent binding.
type Input struct {
	Task             domain.Task
	Project          *domain.Project
	Plan             *domain.Plan
	Agent            *domain.Agent
	Soul             *domain.Soul
	InputAttachments []domain.Artifact
	LinkedResources  []domain.ResourceBrief
}

// Compiler defines the contract for assembling structured prompt context packets.
type Compiler interface {
	Compile(ctx context.Context, input Input) (*domain.ContextPacket, error)
}

// MarkdownPromptCompiler formats prompt packets using Markdown syntax.
type MarkdownPromptCompiler struct{}

var _ Compiler = (*MarkdownPromptCompiler)(nil)

// NewCompiler returns a new instance of MarkdownPromptCompiler.
func NewCompiler() *MarkdownPromptCompiler {
	return &MarkdownPromptCompiler{}
}

// Compile generates a prompt-ready ContextPacket for an agent.
func (c *MarkdownPromptCompiler) Compile(ctx context.Context, input Input) (*domain.ContextPacket, error) {
	task := input.Task
	if input.InputAttachments == nil {
		input.InputAttachments = []domain.Artifact{}
	}
	if input.LinkedResources == nil {
		input.LinkedResources = []domain.ResourceBrief{}
	}
	targetFiles := task.TargetFiles
	if targetFiles == nil {
		targetFiles = []string{}
	}
	verificationCommands := task.VerificationCommands
	if verificationCommands == nil {
		verificationCommands = []string{}
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("# Task Assignment: %s (%s)\n\n", task.Title, task.ID))
	if input.Project != nil {
		sb.WriteString(fmt.Sprintf("- **Project**: `%s` — %s\n", input.Project.Slug, input.Project.Name))
	}
	switch {
	case input.Plan != nil:
		sb.WriteString(fmt.Sprintf("- **Plan**: `%s` — %s\n", input.Plan.Slug, input.Plan.Title))
	case task.PlanSlug != "":
		sb.WriteString(fmt.Sprintf("- **Plan**: `%s`\n", task.PlanSlug))
	case task.ProjectSlug != "":
		sb.WriteString("- **Scope**: project task (no plan wrapper)\n")
	default:
		sb.WriteString("- **Scope**: orphan task (no project or plan)\n")
	}
	sb.WriteString(fmt.Sprintf("- **Priority**: `%s` | **Complexity**: `%s` | **Risk**: `%s`\n", task.Priority, task.Complexity, task.RiskLevel))
	if input.Agent != nil {
		sb.WriteString(fmt.Sprintf("- **Agent**: `%s` — %s\n", input.Agent.Slug, input.Agent.Name))
		if input.Agent.Goal != "" {
			sb.WriteString(fmt.Sprintf("- **Agent goal**: %s\n", input.Agent.Goal))
		}
		if input.Soul != nil {
			sb.WriteString(fmt.Sprintf("- **Soul**: `%s` — %s\n", input.Soul.Key, input.Soul.Name))
		}
	}
	if task.WorktreePath != "" {
		sb.WriteString(fmt.Sprintf("- **Worktree Path**: `%s`\n", task.WorktreePath))
	}
	if task.CurrentPhase != "" {
		sb.WriteString(fmt.Sprintf("- **Current Phase**: `%s`\n", task.CurrentPhase))
	}

	if input.Soul != nil && input.Soul.Body != "" {
		sb.WriteString("\n<soul>\n")
		sb.WriteString(input.Soul.Body)
		sb.WriteString("\n</soul>\n")
	}

	sb.WriteString("\n<task_context>\n")
	sb.WriteString(fmt.Sprintf("  <task_id>%s</task_id>\n", task.ID))
	sb.WriteString(fmt.Sprintf("  <title>%s</title>\n", task.Title))
	if task.ProjectSlug != "" {
		sb.WriteString(fmt.Sprintf("  <project_slug>%s</project_slug>\n", task.ProjectSlug))
	}
	if task.PlanSlug != "" {
		sb.WriteString(fmt.Sprintf("  <plan_slug>%s</plan_slug>\n", task.PlanSlug))
	}
	sb.WriteString(fmt.Sprintf("  <priority>%s</priority>\n", task.Priority))
	sb.WriteString(fmt.Sprintf("  <complexity>%s</complexity>\n", task.Complexity))
	sb.WriteString(fmt.Sprintf("  <risk_level>%s</risk_level>\n", task.RiskLevel))
	if task.WorktreePath != "" {
		sb.WriteString(fmt.Sprintf("  <worktree_path>%s</worktree_path>\n", task.WorktreePath))
	}
	if task.CurrentPhase != "" {
		sb.WriteString(fmt.Sprintf("  <current_phase>%s</current_phase>\n", task.CurrentPhase))
	}
	sb.WriteString("</task_context>\n")

	sb.WriteString("\n## 1. Description & Context\n<context>\n")
	if task.Description != "" {
		sb.WriteString(task.Description + "\n")
	} else {
		sb.WriteString("Execute the implementation according to plan specifications.\n")
	}
	sb.WriteString("</context>\n\n")

	section := 2
	if len(input.LinkedResources) > 0 {
		sb.WriteString(fmt.Sprintf("## %d. Linked Context Resources\n<read_only_references>\n", section))
		sb.WriteString("> **MCP Query Guide**: To read the complete content or slice of any linked resource via MCP, run:\n")
		sb.WriteString("> `zenf_find(type=\"resource\", ids=[\"<KEY>\"])`\n\n")
		for _, res := range input.LinkedResources {
			sb.WriteString(fmt.Sprintf("- `%s` [%s/%s/%s] — %s (`%s`)", res.Key, res.Kind, res.Type, res.Scope, res.Title, res.Path))
			if res.Summary != "" {
				sb.WriteString(": " + res.Summary)
			}
			sb.WriteString("\n")
		}
		sb.WriteString("</read_only_references>\n\n")
		section++
	}

	if len(task.AcceptanceCriteria) > 0 {
		sb.WriteString(fmt.Sprintf("## %d. Acceptance Criteria\n<acceptance_criteria>\n", section))
		for _, ac := range task.AcceptanceCriteria {
			sb.WriteString(fmt.Sprintf("- [ ] %s\n", ac))
		}
		sb.WriteString("</acceptance_criteria>\n\n")
		section++
	}

	if len(targetFiles) > 0 {
		sb.WriteString(fmt.Sprintf("## %d. Target Files\n<scope>\n  <allowed_files>\n", section))
		for _, tf := range targetFiles {
			sb.WriteString(fmt.Sprintf("  - `%s`\n", tf))
		}
		sb.WriteString("  </allowed_files>\n")
		sb.WriteString("  <constraints>\n")
		sb.WriteString("    <positive_invariants>\n")
		sb.WriteString("      - Preserve existing public API seams, contracts, and error structures unless explicitly asked.\n")
		sb.WriteString("      - Keep code changes minimal and hermetically testable.\n")
		sb.WriteString("    </positive_invariants>\n")
		sb.WriteString("    <negative_guards>\n")
		sb.WriteString("      - STRICT: Do NOT modify any file outside <allowed_files> without explicit review.\n")
		sb.WriteString("      - Do NOT suppress compiler, linter, or test failures with ignore comments or mock hacks.\n")
		sb.WriteString("    </negative_guards>\n")
		sb.WriteString("  </constraints>\n")
		sb.WriteString("</scope>\n\n")
		section++
	}

	if len(verificationCommands) > 0 {
		sb.WriteString(fmt.Sprintf("## %d. Verification Commands\n<verification_commands>\n", section))
		sb.WriteString("Run the following commands to verify implementation correctness before completing:\n```bash\n")
		for _, vc := range verificationCommands {
			sb.WriteString(vc + "\n")
		}
		sb.WriteString("```\n</verification_commands>\n\n")
		section++
	}

	sb.WriteString(fmt.Sprintf("## %d. MCP Tool Handshake Protocol\n<mcp_handshake_protocol>\n", section))
	claimArgs := fmt.Sprintf("task_id=\"%s\"", task.ID)
	if task.AgentSlug != "" {
		claimArgs += fmt.Sprintf(", worker_id=\"%s\"", task.AgentSlug)
	} else {
		claimArgs += ", worker_id=\"<your-agent-identity>\""
	}
	sb.WriteString(fmt.Sprintf("- **Claim**: Call `claim_task(%s)` before editing files.\n", claimArgs))
	sb.WriteString(fmt.Sprintf("- **Checkpoint**: Call `transition_task(task_ids=[\"%s\"], action=\"CHECKPOINT_PHASE\", phase_id=\"...\", summary=\"...\")` upon completing intermediate phase milestones.\n", task.ID))
	sb.WriteString(fmt.Sprintf("- **Architectural Drift / Blocked**: Call `transition_task(task_ids=[\"%s\"], action=\"REQUEST_REVIEW\", reason=\"...\", details=\"...\", options=[\"...\"])` and exit immediately. The main orchestrator relays the decision via `RESOLVE_REVIEW`.\n", task.ID))
	sb.WriteString(fmt.Sprintf("- **Complete**: Once all verification commands pass with exit code 0, call `transition_task(task_ids=[\"%s\"], action=\"COMPLETE_TASK\", summary=\"...\")`. Tasks with a worktree stop at AWAITING_MERGE for the orchestrator to merge outside MCP.\n", task.ID))
	sb.WriteString(fmt.Sprintf("- **Failure**: If the task cannot be completed, call `transition_task(task_ids=[\"%s\"], action=\"FAIL_TASK\", reason=\"...\")`.\n", task.ID))
	sb.WriteString("</mcp_handshake_protocol>\n")

	return &domain.ContextPacket{
		Task:                 task,
		Project:              input.Project,
		Plan:                 input.Plan,
		Agent:                input.Agent,
		Soul:                 input.Soul,
		TargetFiles:          targetFiles,
		VerificationCommands: verificationCommands,
		SkillPaths:           []string{},
		InputAttachments:     input.InputAttachments,
		LinkedResources:      input.LinkedResources,
		PromptMarkdown:       sb.String(),
	}, nil
}
