package parser

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"

	"zenf/internal/domain"
)

var (
	headerSlugRegex = regexp.MustCompile(`(?i)^#+\s+(?:Plan(?:\s+Dossier)?:\s*)?([a-zA-Z0-9_\-\.]+)(?:\s*·\s*([a-zA-Z0-9_]+))?`)
)

// CleanMarkdownToken strips markdown decorators like **, __, $, [], etc.
func CleanMarkdownToken(s string) string {
	for _, char := range []string{"*", "_", "`", "[", "]", "$"} {
		s = strings.ReplaceAll(s, char, "")
	}
	return strings.TrimSpace(s)
}

// NormalizeStatus maps human statuses (VERIFIED, PLANNED, IN PROGRESS) to domain.TaskStatus.
func NormalizeStatus(raw string) domain.TaskStatus {
	clean := strings.ToUpper(CleanMarkdownToken(raw))
	switch {
	case strings.Contains(clean, "VERIF") || strings.Contains(clean, "DONE") || strings.Contains(clean, "COMPLET"):
		return domain.StatusCompleted
	case strings.Contains(clean, "PROGRESS") || strings.Contains(clean, "RUN"):
		return domain.StatusRunning
	case strings.Contains(clean, "BLOCK"):
		return domain.StatusBlocked
	case strings.Contains(clean, "FAIL"):
		return domain.StatusFailed
	case strings.Contains(clean, "READY"):
		return domain.StatusReady
	default:
		return domain.StatusPending
	}
}

// ParseMarkdownPlan parses a markdown plan dossier into domain.Plan and []domain.Task.
func ParseMarkdownPlan(r io.Reader, fallbackSlug string) (domain.Plan, []domain.Task, error) {
	scanner := bufio.NewScanner(r)

	var title string
	slug := fallbackSlug
	planStatus := domain.PlanStatusActive

	var tasks []domain.Task
	var inTable bool
	var headerMap map[string]int

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			inTable = false
			continue
		}

		// 1. Detect Plan Heading: # Plan Dossier: {slug} · {STATUS}
		if strings.HasPrefix(line, "#") && title == "" {
			title = strings.TrimLeft(line, "# ")
			matches := headerSlugRegex.FindStringSubmatch(line)
			if len(matches) > 1 && matches[1] != "" {
				extractedSlug := strings.ToLower(matches[1])
				// Ignore generic keywords
				if extractedSlug != "plan" && extractedSlug != "dossier" {
					slug = extractedSlug
				}
				if len(matches) > 2 && matches[2] != "" {
					candidate := domain.PlanStatus(strings.ToUpper(matches[2]))
					if candidate.IsValid() {
						planStatus = candidate
					}
				}
			}
			continue
		}

		// 2. Detect Table
		if strings.HasPrefix(line, "|") && strings.HasSuffix(line, "|") {
			parts := splitTableRow(line)
			if len(parts) < 2 {
				continue
			}

			// Table separator: | :--- | :--- |
			if isTableSeparator(parts) {
				inTable = true
				continue
			}

			// Table Header Row
			if !inTable {
				headerMap = buildHeaderMap(parts)
				continue
			}

			// Table Data Row
			task := parseTaskRow(parts, headerMap, slug)
			if task.ID != "" {
				tasks = append(tasks, task)
			}
		} else {
			inTable = false
		}
	}

	if err := scanner.Err(); err != nil {
		return domain.Plan{}, nil, fmt.Errorf("error reading markdown: %w", err)
	}

	if slug == "" {
		slug = "unnamed-plan"
	}
	if title == "" {
		title = slug
	}

	// Resolve Ready statuses: if Pending and has 0 dependencies, mark Ready
	for i := range tasks {
		if tasks[i].Status == domain.StatusPending && len(tasks[i].Dependencies) == 0 {
			tasks[i].Status = domain.StatusReady
		}
	}

	plan := domain.Plan{
		Slug:      slug,
		Title:     title,
		Status:    planStatus,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	return plan, tasks, nil
}

// ParseMarkdownPlanFile opens a file from disk and parses it.
func ParseMarkdownPlanFile(path string) (domain.Plan, []domain.Task, error) {
	f, err := os.Open(path)
	if err != nil {
		return domain.Plan{}, nil, fmt.Errorf("failed to open plan file: %w", err)
	}
	defer f.Close()

	slug := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	if slug == "README" || slug == "index" {
		// Use parent directory name as fallback slug
		parent := filepath.Base(filepath.Dir(path))
		if parent != "." && parent != "/" && parent != "" {
			slug = parent
		}
	}

	return ParseMarkdownPlan(f, slug)
}

func splitTableRow(line string) []string {
	trimmed := strings.Trim(line, "|")
	rawParts := strings.Split(trimmed, "|")
	parts := make([]string, len(rawParts))
	for i, p := range rawParts {
		parts[i] = strings.TrimSpace(p)
	}
	return parts
}

func isTableSeparator(parts []string) bool {
	for _, p := range parts {
		clean := strings.ReplaceAll(p, ":", "")
		clean = strings.ReplaceAll(clean, "-", "")
		if clean != "" {
			return false
		}
	}
	return true
}

func buildHeaderMap(headers []string) map[string]int {
	m := make(map[string]int)
	set := func(role string, i int) {
		// First-wins: a later header must never overwrite a bound column.
		if _, ok := m[role]; !ok {
			m[role] = i
		}
	}
	for i, h := range headers {
		clean := strings.ToLower(CleanMarkdownToken(h))
		tokens := strings.FieldsFunc(clean, func(r rune) bool {
			return !unicode.IsLetter(r) && !unicode.IsDigit(r)
		})
		has := func(words ...string) bool {
			for _, t := range tokens {
				for _, w := range words {
					if t == w {
						return true
					}
				}
			}
			return false
		}
		// Order matters: specific roles are claimed before the generic id fallback,
		// so "Task Status" is a status column rather than an id column.
		switch {
		case has("status", "state"):
			set("status", i)
		case has("dep", "deps", "dependency", "dependencies", "prereq", "prereqs"):
			set("deps", i)
		case has("scope", "seam", "title", "desc", "description"):
			set("title", i)
		case has("id", "task", "phase"):
			set("id", i)
		}
	}
	return m
}

func parseTaskRow(parts []string, colMap map[string]int, planSlug string) domain.Task {
	idIdx, hasID := colMap["id"]
	if !hasID || idIdx >= len(parts) {
		return domain.Task{}
	}

	rawID := CleanMarkdownToken(parts[idIdx])
	if rawID == "" {
		return domain.Task{}
	}

	var title string
	if titleIdx, ok := colMap["title"]; ok && titleIdx < len(parts) {
		title = CleanMarkdownToken(parts[titleIdx])
	}
	if title == "" {
		title = rawID
	}

	status := domain.StatusPending
	if statusIdx, ok := colMap["status"]; ok && statusIdx < len(parts) {
		status = NormalizeStatus(parts[statusIdx])
	}

	var deps []string
	if depsIdx, ok := colMap["deps"]; ok && depsIdx < len(parts) {
		rawDeps := CleanMarkdownToken(parts[depsIdx])
		if rawDeps != "" && rawDeps != "-" && rawDeps != "none" {
			for _, d := range strings.FieldsFunc(rawDeps, func(r rune) bool {
				return r == ',' || r == ';' || r == ' '
			}) {
				d = strings.TrimSpace(d)
				if d != "" {
					deps = append(deps, d)
				}
			}
		}
	}
	if deps == nil {
		deps = []string{}
	}

	now := time.Now().UTC()
	return domain.Task{
		ID:           rawID,
		PlanSlug:     planSlug,
		Title:        title,
		Dependencies: deps,
		Status:       status,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}
