package mcp

import (
	"context"
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"

	"zenf/internal/domain"
)

// registerFindTool registers the unified read primitive (zenf_find).
func (s *Server) registerFindTool() {
	s.mcpServer.AddTool(
		mcp.NewTool("zenf_find",
			mcp.WithDescription("Unified read primitive for ZenForge tracking plane. Supports lookup by ID, canonical URI (zenf://...), structured filtering by attribute, and full-text search across content."),
			mcp.WithString("uri", mcp.Description("Optional canonical ZenForge URI, e.g. zenf://<project>/<type>/<id> or zenf://<type>/<id>.")),
			mcp.WithString("type", mcp.Description("Optional entity discriminator: project, plan, task, resource, agent. If omitted with query or URI, auto-resolved.")),
			mcp.WithArray("ids", mcp.Description("Optional list of entity IDs, slugs, or zenf:// URIs to fetch directly.")),
			mcp.WithObject("filter", mcp.Description("Optional relational filter map (e.g. status, project_slug, plan_slug, agent_slug, include_archived, include_disabled, active_only).")),
			mcp.WithString("query", mcp.Description("Optional keyword or phrase for full-text search across titles, summaries, and contents.")),
			mcp.WithNumber("limit", mcp.Description("Maximum number of results to return (default: 50, max: 200).")),
			mcp.WithBoolean("include_packet", mcp.Description("For task type: include the compiled ContextPacket instead of metadata only.")),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			rawURI := strings.TrimSpace(request.GetString("uri", ""))
			entityType := domain.NormalizeEntityType(request.GetString("type", ""))
			ids := request.GetStringSlice("ids", nil)
			query := strings.TrimSpace(request.GetString("query", ""))
			limit := request.GetInt("limit", 50)
			if limit <= 0 {
				limit = 50
			} else if limit > 200 {
				limit = 200
			}
			includePacket := request.GetBool("include_packet", false)

			var filterMap map[string]any
			if rawFilter, ok := request.GetArguments()["filter"]; ok && rawFilter != nil {
				if fm, ok := rawFilter.(map[string]any); ok {
					filterMap = fm
				}
			}

			// Helper to get string filter with fallback
			getFilterStr := func(key string) string {
				if filterMap == nil {
					return ""
				}
				if val, ok := filterMap[key]; ok && val != nil {
					return fmt.Sprintf("%v", val)
				}
				return ""
			}

			// Helper to get bool filter
			getFilterBool := func(key string, def bool) bool {
				if filterMap == nil {
					return def
				}
				if val, ok := filterMap[key]; ok && val != nil {
					if b, ok := val.(bool); ok {
						return b
					}
					if s, ok := val.(string); ok {
						return strings.ToLower(s) == "true" || s == "1"
					}
				}
				return def
			}

			extractTypes := func() []string {
				if filterMap == nil {
					return nil
				}
				var out []string
				if raw, ok := filterMap["types"].([]any); ok {
					for _, item := range raw {
						if s, ok := item.(string); ok && s != "" {
							out = append(out, s)
						}
					}
				} else if str := getFilterStr("types"); str != "" {
					for _, part := range strings.Split(str, ",") {
						if part = strings.TrimSpace(part); part != "" {
							out = append(out, part)
						}
					}
				}
				return out
			}

			projectSlug := getFilterStr("project_slug")

			// If uri is provided, parse it to extract entityType, projectSlug, and identifier
			if rawURI != "" {
				if parsedURI, err := domain.ParseResourceURI(rawURI); err == nil {
					if entityType == "" {
						entityType = parsedURI.EntityType
					}
					if projectSlug == "" && parsedURI.ProjectSlug != "" && !strings.EqualFold(parsedURI.ProjectSlug, "global") {
						projectSlug = parsedURI.ProjectSlug
					}
					if len(ids) == 0 && parsedURI.Identifier != "" {
						ids = []string{parsedURI.Identifier}
					}
				}
			}

			// Clean and resolve any URIs or typed prefixes passed in ids
			if len(ids) > 0 {
				cleanedIDs := make([]string, 0, len(ids))
				for _, idStr := range ids {
					idStr = strings.TrimSpace(idStr)
					if idStr == "" {
						continue
					}
					if strings.HasPrefix(strings.ToLower(idStr), "zenf://") || strings.HasPrefix(strings.ToLower(idStr), "zenf:") {
						if parsed, err := domain.ParseResourceURI(idStr); err == nil {
							if entityType == "" {
								entityType = parsed.EntityType
							}
							if projectSlug == "" && parsed.ProjectSlug != "" && !strings.EqualFold(parsed.ProjectSlug, "global") {
								projectSlug = parsed.ProjectSlug
							}
							cleanedIDs = append(cleanedIDs, parsed.Identifier)
							continue
						}
					}
					if entityType == "" {
						if detected := domain.DetectTypeFromPrefix(idStr); detected != "" {
							entityType = detected
						}
					}
					cleanedIDs = append(cleanedIDs, idStr)
				}
				ids = cleanedIDs
			}

			// -------------------------------------------------------------
			// Mode 1: Full-Text Search (query provided)
			// -------------------------------------------------------------
			if query != "" {
				// Intelligent Tag Query: If query is "#tag" or starts with "#", extract it as a tag filter
				trimmedQuery := strings.TrimSpace(query)
				if strings.HasPrefix(trimmedQuery, "#") && !strings.Contains(trimmedQuery, " ") {
					tagOnly := strings.TrimPrefix(trimmedQuery, "#")
					if entityType == "" || entityType == "resource" {
						resFilter := domain.ResourceFilter{
							ProjectSlug:   projectSlug,
							IncludeGlobal: getFilterBool("include_global", true),
							Kind:          domain.ResourceKind(strings.ToLower(getFilterStr("kind"))),
							Tag:           tagOnly,
							Limit:         limit,
						}
						resources, err := s.store.ListResources(ctx, resFilter)
						if err != nil {
							return toolError("failed to find resources by tag: %v", err), nil
						}
						if resources == nil {
							resources = []domain.Resource{}
						}
						return marshalToolResult(map[string]any{
							"type":  "resource",
							"tag":   tagOnly,
							"count": len(resources),
							"items": resources,
						}), nil
					}
				}

				if entityType == "resource" {
					resFilter := domain.ResourceFilter{
						ProjectSlug:   projectSlug,
						IncludeGlobal: getFilterBool("include_global", true),
						Kind:          domain.ResourceKind(strings.ToLower(getFilterStr("kind"))),
						Type:          domain.ResourceType(getFilterStr("type")),
						Types:         extractTypes(),
						Format:        getFilterStr("format"),
						Scope:         domain.ResourceScope(getFilterStr("scope")),
						ScopeRef:      getFilterStr("scope_ref"),
						Status:        domain.ResourceStatus(getFilterStr("status")),
						Tag:           getFilterStr("tag"),
						Limit:         limit,
					}
					results, err := s.store.SearchResources(ctx, query, resFilter)
					if err != nil {
						return toolError("failed to search resources: %v", err), nil
					}
					return marshalToolResult(map[string]any{
						"type":    "resource",
						"query":   query,
						"count":   len(results),
						"results": results,
						"items":   results,
					}), nil
				}

				// Cross-entity or specific entity search
				searchResults, err := s.store.Search(ctx, query, projectSlug, limit)
				if err != nil {
					return toolError("failed to search: %v", err), nil
				}
				if searchResults == nil {
					searchResults = []domain.SearchResult{}
				}

				// Filter by entityType if specified
				if entityType != "" {
					filtered := make([]domain.SearchResult, 0, len(searchResults))
					for _, r := range searchResults {
						if strings.EqualFold(r.EntityType, entityType) {
							filtered = append(filtered, r)
						}
					}
					searchResults = filtered
				}

				return marshalToolResult(map[string]any{
					"query":   query,
					"type":    entityType,
					"count":   len(searchResults),
					"results": searchResults,
					"items":   searchResults,
				}), nil
			}

			// -------------------------------------------------------------
			// Mode 2: Direct ID / Slug Lookup (ids provided)
			// -------------------------------------------------------------
			if len(ids) > 0 {
				switch entityType {
				case "project":
					items := make([]domain.Project, 0, len(ids))
					for _, slug := range ids {
						p, err := s.store.GetProject(ctx, slug)
						if err != nil {
							continue
						}
						items = append(items, *p)
					}
					return marshalToolResult(map[string]any{"type": "project", "count": len(items), "items": items}), nil

				case "plan":
					items := make([]domain.Plan, 0, len(ids))
					for _, slug := range ids {
						p, err := s.store.GetPlan(ctx, slug)
						if err != nil {
							continue
						}
						items = append(items, *p)
					}
					return marshalToolResult(map[string]any{"type": "plan", "count": len(items), "items": items}), nil

				case "task":
					if includePacket {
						items := make([]domain.ContextPacket, 0, len(ids))
						for _, taskID := range ids {
							pkt, err := s.store.GetTaskContextPacket(ctx, taskID)
							if err != nil {
								continue
							}
							items = append(items, *pkt)
						}
						return marshalToolResult(map[string]any{"type": "task", "include_packet": true, "count": len(items), "items": items}), nil
					}
					items := make([]domain.Task, 0, len(ids))
					for _, taskID := range ids {
						t, err := s.store.GetTask(ctx, taskID)
						if err != nil {
							continue
						}
						items = append(items, *t)
					}
					return marshalToolResult(map[string]any{"type": "task", "count": len(items), "items": items}), nil

				case "resource":
					items := make([]domain.Resource, 0, len(ids))
					for _, rawID := range ids {
						d, err := s.store.GetResource(ctx, rawID)
						if err == nil {
							items = append(items, *d)
							continue
						}
						// fallback to key/slug lookup if project_slug given
						if projectSlug != "" {
							if d2, err2 := s.store.GetResourceByKey(ctx, projectSlug, rawID); err2 == nil {
								items = append(items, *d2)
								continue
							}
						}
						// fallback to matching Key/Slug across all resources
						resources, err3 := s.store.ListResources(ctx, domain.ResourceFilter{
							IncludeGlobal: true,
							Limit:         100,
						})
						if err3 == nil {
							var matched bool
							for _, cand := range resources {
								if strings.EqualFold(cand.Key, rawID) || strings.EqualFold(cand.Slug, rawID) {
									items = append(items, cand)
									matched = true
									break
								}
							}
							if matched {
								continue
							}
						}
					}
					return marshalToolResult(map[string]any{"type": "resource", "count": len(items), "items": items}), nil

				case "agent":
					items := make([]domain.Agent, 0, len(ids))
					for _, slug := range ids {
						a, err := s.store.GetAgent(ctx, slug)
						if err != nil {
							continue
						}
						items = append(items, *a)
					}
					return marshalToolResult(map[string]any{"type": "agent", "count": len(items), "items": items}), nil

				default:
					// Cross-entity resolution when type was not specified
					for _, candID := range ids {
						if d, err := s.store.GetResource(ctx, candID); err == nil {
							return marshalToolResult(map[string]any{"type": "resource", "count": 1, "items": []domain.Resource{*d}}), nil
						}
						if t, err := s.store.GetTask(ctx, candID); err == nil {
							if includePacket {
								if pkt, errPkt := s.store.GetTaskContextPacket(ctx, candID); errPkt == nil {
									return marshalToolResult(map[string]any{"type": "task", "include_packet": true, "count": 1, "items": []domain.ContextPacket{*pkt}}), nil
								}
							}
							return marshalToolResult(map[string]any{"type": "task", "count": 1, "items": []domain.Task{*t}}), nil
						}
						if p, err := s.store.GetPlan(ctx, candID); err == nil {
							return marshalToolResult(map[string]any{"type": "plan", "count": 1, "items": []domain.Plan{*p}}), nil
						}
						if prj, err := s.store.GetProject(ctx, candID); err == nil {
							return marshalToolResult(map[string]any{"type": "project", "count": 1, "items": []domain.Project{*prj}}), nil
						}
						// Check if candID matches a resource key
						resources, _ := s.store.ListResources(ctx, domain.ResourceFilter{IncludeGlobal: true, Limit: 100})
						for _, cand := range resources {
							if strings.EqualFold(cand.Key, candID) || strings.EqualFold(cand.Slug, candID) {
								return marshalToolResult(map[string]any{"type": "resource", "count": 1, "items": []domain.Resource{cand}}), nil
							}
						}
					}
					return toolError("type is required when specifying ids (project, plan, task, resource, agent)"), nil
				}
			}

			// -------------------------------------------------------------
			// Mode 3: Filtered Listing
			// -------------------------------------------------------------
			switch entityType {
			case "project", "":
				// If entityType is empty and no query/ids, default to projects listing
				includeArchived := getFilterBool("include_archived", false)
				projects, err := s.store.ListProjects(ctx, includeArchived)
				if err != nil {
					return toolError("failed to list projects: %v", err), nil
				}
				if projects == nil {
					projects = []domain.Project{}
				}
				return marshalToolResult(map[string]any{"type": "project", "count": len(projects), "items": projects}), nil

			case "plan":
				includeArchived := getFilterBool("include_archived", false)
				plans, err := s.store.ListPlans(ctx, projectSlug, includeArchived)
				if err != nil {
					return toolError("failed to list plans: %v", err), nil
				}
				if plans == nil {
					plans = []domain.Plan{}
				}
				return marshalToolResult(map[string]any{"type": "plan", "project_slug": projectSlug, "count": len(plans), "items": plans}), nil

			case "task":
				filter := domain.TaskFilter{
					ProjectSlug: projectSlug,
					PlanSlug:    getFilterStr("plan_slug"),
					Status:      domain.TaskStatus(getFilterStr("status")),
					AgentSlug:   getFilterStr("agent_slug"),
					OrphanOnly:  getFilterBool("orphan", false),
				}
				tasks, err := s.store.ListTasks(ctx, filter)
				if err != nil {
					return toolError("failed to list tasks: %v", err), nil
				}
				if tasks == nil {
					tasks = []domain.Task{}
				}
				return marshalToolResult(map[string]any{"type": "task", "count": len(tasks), "items": tasks}), nil

			case "resource":
				filter := domain.ResourceFilter{
					ProjectSlug:   projectSlug,
					IncludeGlobal: getFilterBool("include_global", true),
					Kind:          domain.ResourceKind(strings.ToLower(getFilterStr("kind"))),
					Type:          domain.ResourceType(getFilterStr("type")),
					Types:         extractTypes(),
					Format:        getFilterStr("format"),
					Scope:         domain.ResourceScope(getFilterStr("scope")),
					ScopeRef:      getFilterStr("scope_ref"),
					Status:        domain.ResourceStatus(getFilterStr("status")),
					Tag:           getFilterStr("tag"),
					Limit:         limit,
				}
				resources, err := s.store.ListResources(ctx, filter)
				if err != nil {
					return toolError("failed to list resources: %v", err), nil
				}
				if resources == nil {
					resources = []domain.Resource{}
				}
				return marshalToolResult(map[string]any{"type": "resource", "count": len(resources), "items": resources}), nil

			case "agent":
				includeDisabled := getFilterBool("include_disabled", false)
				agents, err := s.store.ListAgents(ctx, includeDisabled)
				if err != nil {
					return toolError("failed to list agents: %v", err), nil
				}
				if agents == nil {
					agents = []domain.Agent{}
				}
				return marshalToolResult(map[string]any{"type": "agent", "count": len(agents), "items": agents}), nil

			case "tag_cloud", "tags":
				includeGlobal := getFilterBool("include_global", true)
				tagCloud, err := s.store.GetTagCloud(ctx, projectSlug, includeGlobal)
				if err != nil {
					return toolError("failed to get tag cloud: %v", err), nil
				}
				if tagCloud == nil {
					tagCloud = []domain.TagCount{}
				}
				return marshalToolResult(map[string]any{"type": "tag_cloud", "count": len(tagCloud), "items": tagCloud}), nil

			default:
				return toolError("unrecognized entity type '%s' (expected project, plan, task, resource, agent)", entityType), nil
			}
		},
	)
}
