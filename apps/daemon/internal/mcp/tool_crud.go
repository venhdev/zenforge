package mcp

import (
	"context"

	"github.com/mark3labs/mcp-go/mcp"

	"zenf/internal/domain"
	"zenf/internal/service"
)

// registerCRUDTools registers the polymorphic mutation primitives: zenf_create, zenf_update, zenf_delete.
func (s *Server) registerCRUDTools() {
	s.registerCreateTool()
	s.registerUpdateTool()
	s.registerDeleteTool()
}

func (s *Server) registerCreateTool() {
	s.mcpServer.AddTool(
		mcp.NewTool("zenf_create",
			mcp.WithDescription("Polymorphic batch creation tool. Accepts an entity type and an array of items to create in one transaction."),
			mcp.WithString("type", mcp.Required(), mcp.Description("Entity type to create: project, plan, task, resource, agent")),
			mcp.WithArray("items", mcp.Required(), mcp.Description("Array of entity payloads to create. For type 'plan', items can include an embedded 'tasks[]' array.")),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			entityType := domain.NormalizeEntityType(request.GetString("type", ""))
			rawItems, ok := request.GetArguments()["items"].([]any)
			if !ok || len(rawItems) == 0 {
				return toolError("items must be a non-empty array"), nil
			}

			switch entityType {
			case "project":
				return s.createProjects(ctx, rawItems)
			case "plan":
				return s.createPlans(ctx, rawItems)
			case "task":
				return s.createTasks(ctx, rawItems)
			case "resource":
				return s.createResources(ctx, rawItems)
			case "agent":
				return s.createAgents(ctx, rawItems)
			default:
				return toolError("unrecognized entity type '%s' (expected project, plan, task, resource, agent)", entityType), nil
			}
		},
	)
}

func (s *Server) createProjects(ctx context.Context, rawItems []any) (*mcp.CallToolResult, error) {
	createdProjects := make([]domain.Project, 0, len(rawItems))
	for i, raw := range rawItems {
		p, err := decodeItem[domain.Project](raw, i, "project")
		if err != nil {
			return toolError("%v", err), nil
		}
		if p.Slug == "" || p.Name == "" {
			return toolError("project at index %d requires slug and name", i), nil
		}
		if p.Status == "" {
			p.Status = domain.ProjectStatusActive
		}
		if err := s.store.CreateProject(ctx, p); err != nil {
			return toolError("failed to create project %s: %v", p.Slug, err), nil
		}
		saved, err := s.store.GetProject(ctx, p.Slug)
		if err != nil {
			return toolError("failed to fetch created project %s: %v", p.Slug, err), nil
		}
		createdProjects = append(createdProjects, *saved)
	}
	return marshalToolResult(map[string]any{
		"type":    "project",
		"created": len(createdProjects),
		"items":   createdProjects,
	}), nil
}

func (s *Server) createPlans(ctx context.Context, rawItems []any) (*mcp.CallToolResult, error) {
	type planInput struct {
		Slug        string `json:"slug"`
		ProjectSlug string `json:"project_slug"`
		Title       string `json:"title"`
		Status      string `json:"status"`
		Version     int    `json:"version,omitempty"`
		Tasks       []any  `json:"tasks,omitempty"`
	}
	createdPlans := make([]map[string]any, 0, len(rawItems))
	for i, raw := range rawItems {
		pi, err := decodeItem[planInput](raw, i, "plan")
		if err != nil {
			return toolError("%v", err), nil
		}
		if pi.Slug == "" || pi.ProjectSlug == "" {
			return toolError("plan at index %d requires slug and project_slug", i), nil
		}
		plan := domain.Plan{
			Slug:        pi.Slug,
			ProjectSlug: pi.ProjectSlug,
			Title:       pi.Title,
			Status:      planStatusOrDefault(pi.Status),
			Version:     pi.Version,
		}
		if plan.Title == "" {
			plan.Title = plan.Slug
		}

		var tasks []domain.Task
		var media map[string][]mediaInput
		if len(pi.Tasks) > 0 {
			parsed, m, err := parseTaskInputs(pi.ProjectSlug, pi.Slug, pi.Tasks)
			if err != nil {
				return toolError("invalid tasks for plan %s: %v", pi.Slug, err), nil
			}
			tasks, media = parsed, m
		}
		for _, t := range tasks {
			if err := domain.ValidateAgentSlug(ctx, s.store, t.AgentSlug); err != nil {
				return toolError("plan %s task %s: %v", plan.Slug, t.ID, err), nil
			}
		}

		if err := s.store.CreatePlanWithTasks(ctx, plan, tasks); err != nil {
			return toolError("failed to create plan %s: %v", pi.Slug, err), nil
		}
		if savedPlan, err := s.store.GetPlan(ctx, plan.Slug); err == nil && savedPlan != nil {
			plan = *savedPlan
		}

		var taskIDs []string
		if len(tasks) > 0 {
			taskIDs = make([]string, len(tasks))
			for idx, t := range tasks {
				taskIDs[idx] = t.ID
			}
		}

		mediaRes := s.attachMediaForTasks(ctx, media)
		createdPlans = append(createdPlans, map[string]any{
			"plan":     plan,
			"task_ids": taskIDs,
			"media":    mediaRes,
		})
	}
	return marshalToolResult(map[string]any{
		"type":    "plan",
		"created": len(createdPlans),
		"items":   createdPlans,
	}), nil
}

func (s *Server) createTasks(ctx context.Context, rawItems []any) (*mcp.CallToolResult, error) {
	tasks := make([]domain.Task, 0, len(rawItems))
	mediaByTask := make(map[string][]mediaInput)
	for i, raw := range rawItems {
		type taskWire struct {
			taskInput
			ProjectSlug string `json:"project_slug"`
			PlanSlug    string `json:"plan_slug"`
		}
		in, err := decodeItem[taskWire](raw, i, "task")
		if err != nil {
			return toolError("%v", err), nil
		}
		if in.ID == "" || in.Title == "" {
			return toolError("task at index %d requires id and title", i), nil
		}
		task := toDomainTask(in.ProjectSlug, in.PlanSlug, in.taskInput)
		if err := domain.ValidateAgentSlug(ctx, s.store, task.AgentSlug); err != nil {
			return toolError("task %s: %v", task.ID, err), nil
		}
		tasks = append(tasks, task)
		if len(in.Media) > 0 {
			mediaByTask[in.ID] = in.Media
		}
	}

	if err := s.store.CreateTasks(ctx, tasks); err != nil {
		return toolError("failed to create tasks: %v", err), nil
	}
	mediaRes := s.attachMediaForTasks(ctx, mediaByTask)
	taskIDs := make([]string, len(tasks))
	for i, t := range tasks {
		taskIDs[i] = t.ID
	}
	return marshalToolResult(map[string]any{
		"type":     "task",
		"created":  len(tasks),
		"task_ids": taskIDs,
		"media":    mediaRes,
	}), nil
}

func (s *Server) createResources(ctx context.Context, rawItems []any) (*mcp.CallToolResult, error) {
	createdResources := make([]domain.Resource, 0, len(rawItems))
	for i, raw := range rawItems {
		r, err := decodeItem[domain.Resource](raw, i, "resource")
		if err != nil {
			return toolError("%v", err), nil
		}
		if err := r.Normalize(); err != nil {
			return toolError("invalid resource at index %d: %v", i, err), nil
		}
		if err := s.store.CreateResource(ctx, r); err != nil {
			return toolError("failed to create resource %s: %v", r.Key, err), nil
		}
		saved, err := s.store.GetResourceByKey(ctx, r.ProjectSlug, r.Key)
		if err != nil {
			saved, err = s.store.GetResourceBySlug(ctx, r.ProjectSlug, r.Slug)
		}
		if err == nil && saved != nil {
			createdResources = append(createdResources, *saved)
		} else {
			createdResources = append(createdResources, r)
		}
	}
	return marshalToolResult(map[string]any{
		"type":    "resource",
		"created": len(createdResources),
		"items":   createdResources,
	}), nil
}

func (s *Server) createAgents(ctx context.Context, rawItems []any) (*mcp.CallToolResult, error) {
	createdAgents := make([]domain.Agent, 0, len(rawItems))
	for i, raw := range rawItems {
		a, err := decodeItem[domain.Agent](raw, i, "agent")
		if err != nil {
			return toolError("%v", err), nil
		}
		a.Enabled = true
		if a.Slug == "" || a.Name == "" {
			return toolError("agent at index %d requires slug and name", i), nil
		}
		if err := domain.ValidateSoulKey(ctx, s.store, a.SoulKey); err != nil {
			return toolError("agent %s: %v", a.Slug, err), nil
		}
		if a.Mode == "" {
			a.Mode = domain.AgentModeHeadless
		}
		if err := s.store.CreateAgent(ctx, a); err != nil {
			return toolError("failed to create agent %s: %v", a.Slug, err), nil
		}
		saved, err := s.store.GetAgent(ctx, a.Slug)
		if err != nil {
			return toolError("failed to fetch created agent %s: %v", a.Slug, err), nil
		}
		createdAgents = append(createdAgents, *saved)
	}
	return marshalToolResult(map[string]any{
		"type":    "agent",
		"created": len(createdAgents),
		"items":   createdAgents,
	}), nil
}

func (s *Server) registerUpdateTool() {
	s.mcpServer.AddTool(
		mcp.NewTool("zenf_update",
			mcp.WithDescription("Polymorphic batch update tool. Updates metadata, tags, and properties across one or more entities."),
			mcp.WithString("type", mcp.Required(), mcp.Description("Entity type to update: project, plan, task, resource, agent")),
			mcp.WithArray("items", mcp.Required(), mcp.Description("Array of patch objects. Each item must contain 'id' or 'slug' plus the fields to update.")),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			entityType := domain.NormalizeEntityType(request.GetString("type", ""))
			rawItems, ok := request.GetArguments()["items"].([]any)
			if !ok || len(rawItems) == 0 {
				return toolError("items must be a non-empty array"), nil
			}

			updatedIDs := make([]string, 0, len(rawItems))

			switch entityType {
			case "project":
				for i, raw := range rawItems {
					itemMap, ok := raw.(map[string]any)
					if !ok {
						return toolError("item at index %d must be an object", i), nil
					}
					slug, _ := itemMap["slug"].(string)
					if slug == "" {
						slug, _ = itemMap["id"].(string)
					}
					if slug == "" {
						return toolError("project item at index %d requires slug or id", i), nil
					}
					patch, err := parseProjectPatch(itemMap)
					if err != nil {
						return toolError("failed to parse patch for project %s: %v", slug, err), nil
					}
					if err := s.store.UpdateProject(ctx, slug, patch); err != nil {
						return toolError("failed to update project %s: %v", slug, err), nil
					}
					if archived, ok := itemMap["archived"].(bool); ok {
						if err := s.store.ArchiveProject(ctx, slug, archived); err != nil {
							return toolError("failed to update archived state for project %s: %v", slug, err), nil
						}
					}
					updatedIDs = append(updatedIDs, slug)
				}

			case "plan":
				for i, raw := range rawItems {
					itemMap, ok := raw.(map[string]any)
					if !ok {
						return toolError("item at index %d must be an object", i), nil
					}
					slug, _ := itemMap["slug"].(string)
					if slug == "" {
						slug, _ = itemMap["id"].(string)
					}
					if slug == "" {
						return toolError("plan item at index %d requires slug or id", i), nil
					}
					patch, err := parsePlanPatch(itemMap)
					if err != nil {
						return toolError("failed to parse patch for plan %s: %v", slug, err), nil
					}
					if err := s.store.UpdatePlan(ctx, slug, patch); err != nil {
						return toolError("failed to update plan %s: %v", slug, err), nil
					}
					if archived, ok := itemMap["archived"].(bool); ok {
						if err := s.store.ArchivePlan(ctx, slug, archived); err != nil {
							return toolError("failed to update archived state for plan %s: %v", slug, err), nil
						}
					}
					updatedIDs = append(updatedIDs, slug)
				}

			case "task":
				for i, raw := range rawItems {
					itemMap, ok := raw.(map[string]any)
					if !ok {
						return toolError("item at index %d must be an object", i), nil
					}
					taskID, _ := itemMap["id"].(string)
					if taskID == "" {
						taskID, _ = itemMap["task_id"].(string)
					}
					if taskID == "" {
						return toolError("task item at index %d requires id or task_id", i), nil
					}
					patch, mediaAdd, mediaRemove, err := parseTaskPatch(itemMap)
					if err != nil {
						return toolError("failed to parse patch for task %s: %v", taskID, err), nil
					}
					if patch.AgentSlug != nil {
						if err := domain.ValidateAgentSlug(ctx, s.store, *patch.AgentSlug); err != nil {
							return toolError("task %s: %v", taskID, err), nil
						}
					}
					if err := s.store.UpdateTaskMetadata(ctx, taskID, patch); err != nil {
						return toolError("failed to update task %s: %v", taskID, err), nil
					}
					if len(mediaAdd) > 0 {
						for _, mr := range s.attachMedia(ctx, taskID, mediaAdd) {
							if mr.Error != "" {
								return toolError("failed to attach media %s to task %s: %s", mr.FilePath, taskID, mr.Error), nil
							}
						}
					}
					if len(mediaRemove) > 0 {
						for _, rr := range s.removeMedia(ctx, taskID, mediaRemove) {
							if rr.Error != "" {
								return toolError("failed to remove media %s from task %s: %s", rr.ArtifactID, taskID, rr.Error), nil
							}
						}
					}
					if notes, ok := itemMap["notes"].(string); ok && notes != "" {
						if err := s.store.AppendTaskNotes(ctx, taskID, notes); err != nil {
							return toolError("failed to append notes to task %s: %v", taskID, err), nil
						}
					}
					updatedIDs = append(updatedIDs, taskID)
				}

			case "resource":
				for i, raw := range rawItems {
					itemMap, ok := raw.(map[string]any)
					if !ok {
						return toolError("item at index %d must be an object", i), nil
					}
					id, _ := itemMap["id"].(string)
					if id == "" {
						id, _ = itemMap["key"].(string)
					}
					if id == "" {
						return toolError("resource item at index %d requires id or key", i), nil
					}
					patch, err := parseResourcePatch(itemMap)
					if err != nil {
						return toolError("failed to parse patch for resource %s: %v", id, err), nil
					}
					if err := s.store.UpdateResource(ctx, id, patch); err != nil {
						return toolError("failed to update resource %s: %v", id, err), nil
					}
					if archived, ok := itemMap["archived"].(bool); ok {
						if err := s.store.ArchiveResource(ctx, id, archived); err != nil {
							return toolError("failed to update archived state for resource %s: %v", id, err), nil
						}
					}
					if refresh, ok := itemMap["refresh"].(bool); ok && refresh {
						resource, err := s.store.GetResource(ctx, id)
						if err != nil {
							return toolError("failed to get resource %s for refresh: %v", id, err), nil
						}
						if resource.URL != "" {
							return toolError("resource %s is an external link; there is no local file to refresh", id), nil
						}
						content, err := domain.ReadTextSnapshot(resource.Path)
						if err != nil {
							return toolError("failed to read snapshot for resource %s at %s: %v", id, resource.Path, err), nil
						}
						if err := s.store.RefreshResource(ctx, id, content, domain.ComputeContentHash(content), int64(len(content))); err != nil {
							return toolError("failed to refresh resource %s: %v", id, err), nil
						}
					}
					updatedIDs = append(updatedIDs, id)
				}

			case "agent":
				for i, raw := range rawItems {
					itemMap, ok := raw.(map[string]any)
					if !ok {
						return toolError("item at index %d must be an object", i), nil
					}
					slug, _ := itemMap["slug"].(string)
					if slug == "" {
						slug, _ = itemMap["id"].(string)
					}
					if slug == "" {
						return toolError("agent item at index %d requires slug or id", i), nil
					}
					patch, err := parseAgentPatch(itemMap)
					if err != nil {
						return toolError("failed to parse patch for agent %s: %v", slug, err), nil
					}
					if patch.SoulKey != nil {
						if err := domain.ValidateSoulKey(ctx, s.store, *patch.SoulKey); err != nil {
							return toolError("agent %s: %v", slug, err), nil
						}
					}
					if err := s.store.UpdateAgent(ctx, slug, patch); err != nil {
						return toolError("failed to update agent %s: %v", slug, err), nil
					}
					updatedIDs = append(updatedIDs, slug)
				}

			default:
				return toolError("unrecognized entity type '%s' (expected project, plan, task, resource, agent)", entityType), nil
			}

			return marshalToolResult(map[string]any{
				"type":    entityType,
				"updated": len(updatedIDs),
				"ids":     updatedIDs,
			}), nil
		},
	)
}

func (s *Server) registerDeleteTool() {
	s.mcpServer.AddTool(
		mcp.NewTool("zenf_delete",
			mcp.WithDescription("Polymorphic batch deletion tool. Deletes entities by ID or slug."),
			mcp.WithString("type", mcp.Required(), mcp.Description("Entity type to delete: project, plan, task, resource, agent")),
			mcp.WithArray("ids", mcp.Required(), mcp.Description("List of entity IDs or slugs to delete.")),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			entityType := domain.NormalizeEntityType(request.GetString("type", ""))
			ids := request.GetStringSlice("ids", nil)
			if len(ids) == 0 {
				return toolError("ids must be a non-empty array of strings"), nil
			}

			deletedIDs := make([]string, 0, len(ids))

			switch entityType {
			case "project":
				for _, slug := range ids {
					if err := s.store.DeleteProject(ctx, slug); err != nil {
						return toolError("failed to delete project %s: %v", slug, err), nil
					}
					deletedIDs = append(deletedIDs, slug)
				}

			case "plan":
				for _, slug := range ids {
					if err := s.store.ArchivePlan(ctx, slug, true); err != nil {
						return toolError("failed to archive plan %s: %v", slug, err), nil
					}
					deletedIDs = append(deletedIDs, slug)
				}

			case "task":
				for _, taskID := range ids {
					if s.taskService != nil {
						if _, err := s.taskService.TransitionTask(ctx, taskID, service.TransitionRequest{
							Action: "CANCEL",
							Reason: "Cancelled via zenf_delete",
						}); err != nil {
							return toolError("failed to cancel task %s: %v", taskID, err), nil
						}
					} else {
						task, err := s.store.GetTask(ctx, taskID)
						if err != nil {
							return toolError("failed to find task %s: %v", taskID, err), nil
						}
						if task.Status == domain.StatusRunning {
							if _, err := s.store.EvictTask(ctx, taskID, "Deleted via zenf_delete", "CANCEL"); err != nil {
								return toolError("failed to evict task %s: %v", taskID, err), nil
							}
						} else if task.Status != domain.StatusCancelled {
							if err := s.store.UpdateTaskStatusWithNote(ctx, taskID, task.Status, domain.StatusCancelled, "Cancelled via zenf_delete"); err != nil {
								return toolError("failed to cancel task %s: %v", taskID, err), nil
							}
						}
					}
					deletedIDs = append(deletedIDs, taskID)
				}

			case "resource":
				for _, id := range ids {
					if err := s.store.DeleteResource(ctx, id); err != nil {
						return toolError("failed to delete resource %s: %v", id, err), nil
					}
					deletedIDs = append(deletedIDs, id)
				}

			case "agent":
				for _, slug := range ids {
					if err := s.store.DeleteAgent(ctx, slug); err != nil {
						return toolError("failed to delete agent %s: %v", slug, err), nil
					}
					deletedIDs = append(deletedIDs, slug)
				}

			default:
				return toolError("unrecognized entity type '%s' (expected project, plan, task, resource, agent)", entityType), nil
			}

			return marshalToolResult(map[string]any{
				"type":    entityType,
				"deleted": len(deletedIDs),
				"ids":     deletedIDs,
			}), nil
		},
	)
}
