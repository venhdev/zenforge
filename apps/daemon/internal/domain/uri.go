package domain

import (
	"fmt"
	"strings"
)

// ResourceURI represents a parsed canonical ZenForge Universal Resource Identifier.
type ResourceURI struct {
	Scheme      string // Always "zenf"
	ProjectSlug string // e.g. "zenforge", "global", or ""
	EntityType  string // "resource", "task", "plan", "project", "artifact", "agent", "session", "skill"
	Identifier  string // key, slug, or UUID
}

// String formats the ResourceURI into the canonical URI string: zenf://<project>/<type>/<id> or zenf://<type>/<id>.
func (u ResourceURI) String() string {
	if u.ProjectSlug != "" && !strings.EqualFold(u.ProjectSlug, "global") {
		return fmt.Sprintf("zenf://%s/%s/%s", u.ProjectSlug, u.EntityType, u.Identifier)
	}
	if strings.EqualFold(u.ProjectSlug, "global") {
		return fmt.Sprintf("zenf://global/%s/%s", u.EntityType, u.Identifier)
	}
	return fmt.Sprintf("zenf://%s/%s", u.EntityType, u.Identifier)
}

// NormalizeEntityType maps plural, singular, and alias entity names to canonical singular forms.
func NormalizeEntityType(raw string) string {
	t := strings.ToLower(strings.TrimSpace(raw))
	switch t {
	case "resource", "resources", "doc", "docs", "document", "documents", "rule", "rules", "spec", "adr", "soul", "harness":
		return "resource"
	case "task", "tasks":
		return "task"
	case "plan", "plans":
		return "plan"
	case "project", "projects":
		return "project"
	case "artifact", "artifacts":
		return "artifact"
	case "agent", "agents":
		return "agent"
	case "session", "sessions":
		return "session"
	case "skill", "skills":
		return "skill"
	default:
		return t
	}
}

// IsKnownEntityType returns true if the entity type is one of the recognized ZenForge entities.
func IsKnownEntityType(entityType string) bool {
	switch NormalizeEntityType(entityType) {
	case "resource", "task", "plan", "project", "artifact", "agent", "session", "skill":
		return true
	default:
		return false
	}
}

// DetectTypeFromPrefix attempts to infer entity type from common identifier prefixes.
func DetectTypeFromPrefix(id string) string {
	lower := strings.ToLower(strings.TrimSpace(id))
	switch {
	case strings.HasPrefix(lower, "res_") || strings.HasPrefix(lower, "doc_"):
		return "resource"
	case strings.HasPrefix(lower, "task-") || strings.HasPrefix(lower, "tsk_"):
		return "task"
	case strings.HasPrefix(lower, "art_") || strings.HasPrefix(lower, "artifact_"):
		return "artifact"
	case strings.HasPrefix(lower, "plan-") || strings.HasPrefix(lower, "pln_"):
		return "plan"
	case strings.HasPrefix(lower, "prj_") || strings.HasPrefix(lower, "project-"):
		return "project"
	case strings.HasPrefix(lower, "sess_") || strings.HasPrefix(lower, "session_"):
		return "session"
	default:
		return ""
	}
}

// ParseResourceURI parses a raw string into a ResourceURI.
// Supports:
//   - zenf://<project>/<type>/<id> (e.g. zenf://zenforge/resource/CONSTRUCTION_RULES)
//   - zenf://<type>/<id>           (e.g. zenf://resource/res_01a1...)
//   - zenf:<type>:<id>             (e.g. zenf:resource:CONSTRUCTION_RULES)
//   - zenf:<project>:<type>:<id>   (e.g. zenf:zenforge:resource:CONSTRUCTION_RULES)
//   - Prefixed IDs                 (e.g. res_01a1..., task-01)
func ParseResourceURI(raw string) (ResourceURI, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ResourceURI{}, fmt.Errorf("empty resource URI")
	}

	// 1. zenf:// scheme
	if strings.HasPrefix(strings.ToLower(trimmed), "zenf://") {
		body := trimmed[7:]
		// Strip leading/trailing slashes
		body = strings.Trim(body, "/")
		if body == "" {
			return ResourceURI{}, fmt.Errorf("invalid zenf:// URI: missing path")
		}

		parts := strings.Split(body, "/")
		if len(parts) >= 3 {
			// First part is project, second part is entity type, remainder is id
			project := parts[0]
			entityType := NormalizeEntityType(parts[1])
			id := strings.Join(parts[2:], "/")
			if id == "" {
				return ResourceURI{}, fmt.Errorf("invalid zenf:// URI: missing identifier in %q", raw)
			}
			return ResourceURI{
				Scheme:      "zenf",
				ProjectSlug: project,
				EntityType:  entityType,
				Identifier:  id,
			}, nil
		}

		if len(parts) == 2 {
			// Could be <type>/<id> or <project>/<id>
			if IsKnownEntityType(parts[0]) {
				return ResourceURI{
					Scheme:      "zenf",
					ProjectSlug: "",
					EntityType:  NormalizeEntityType(parts[0]),
					Identifier:  parts[1],
				}, nil
			}
			// If not a known type, check if parts[1] has a detected prefix
			if detected := DetectTypeFromPrefix(parts[1]); detected != "" {
				return ResourceURI{
					Scheme:      "zenf",
					ProjectSlug: parts[0],
					EntityType:  detected,
					Identifier:  parts[1],
				}, nil
			}
			// Fallback: assume parts[0] is entity type
			return ResourceURI{
				Scheme:      "zenf",
				ProjectSlug: "",
				EntityType:  NormalizeEntityType(parts[0]),
				Identifier:  parts[1],
			}, nil
		}

		// Single part in zenf://...
		if detected := DetectTypeFromPrefix(parts[0]); detected != "" {
			return ResourceURI{
				Scheme:      "zenf",
				EntityType:  detected,
				Identifier:  parts[0],
			}, nil
		}
		return ResourceURI{}, fmt.Errorf("invalid zenf:// URI: insufficient parts in %q", raw)
	}

	// 2. zenf: URN scheme
	if strings.HasPrefix(strings.ToLower(trimmed), "zenf:") {
		parts := strings.Split(trimmed[5:], ":")
		if len(parts) == 2 {
			return ResourceURI{
				Scheme:     "zenf",
				EntityType: NormalizeEntityType(parts[0]),
				Identifier: parts[1],
			}, nil
		}
		if len(parts) == 3 {
			return ResourceURI{
				Scheme:      "zenf",
				ProjectSlug: parts[0],
				EntityType:  NormalizeEntityType(parts[1]),
				Identifier:  parts[2],
			}, nil
		}
		return ResourceURI{}, fmt.Errorf("invalid zenf: URN in %q", raw)
	}

	// 3. Raw Prefixed IDs
	if detected := DetectTypeFromPrefix(trimmed); detected != "" {
		return ResourceURI{
			Scheme:     "zenf",
			EntityType: detected,
			Identifier: trimmed,
		}, nil
	}

	return ResourceURI{
		Scheme:     "zenf",
		Identifier: trimmed,
	}, nil
}
