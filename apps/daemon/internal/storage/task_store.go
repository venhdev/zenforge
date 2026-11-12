package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"zenf/internal/domain"
)

// TaskRepository persists task records and their read projections.
type TaskRepository struct {
	db *DB
}

type scanner interface {
	Scan(dest ...any) error
}

const taskSelectColumns = `
id,
COALESCE(project_slug, '') AS project_slug,
COALESCE(plan_slug, '') AS plan_slug,
title, description, dependencies, priority, complexity, risk_level, agent_slug,
required_skills, required_docs, target_files, acceptance_criteria,
verification_commands, worktree_path, auto_run, status, claimed_by, claimed_at,
claim_session_id, notes, review_reason, review_details, review_options,
phases, current_phase, created_at, updated_at`

const taskInsertQuery = `
INSERT INTO tasks (
	id, project_slug, plan_slug, title, description, dependencies, priority, complexity,
	risk_level, agent_slug, required_skills, required_docs, target_files,
	acceptance_criteria, verification_commands, worktree_path, auto_run, status, claimed_by,
	claimed_at, claim_session_id, notes, review_reason,
	review_details, review_options, phases, current_phase, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING`

const taskAuthoringUpdateQuery = `
INSERT INTO tasks (
	id, project_slug, plan_slug, title, description, dependencies, priority, complexity,
	risk_level, agent_slug, required_skills, required_docs, target_files,
	acceptance_criteria, verification_commands, worktree_path, auto_run, status, claimed_by,
	claimed_at, claim_session_id, notes, review_reason,
	review_details, review_options, phases, current_phase, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
	title = excluded.title,
	description = excluded.description,
	dependencies = excluded.dependencies,
	priority = excluded.priority,
	complexity = excluded.complexity,
	risk_level = excluded.risk_level,
	agent_slug = excluded.agent_slug,
	required_skills = excluded.required_skills,
	required_docs = excluded.required_docs,
	target_files = excluded.target_files,
	acceptance_criteria = excluded.acceptance_criteria,
	verification_commands = excluded.verification_commands,
	worktree_path = excluded.worktree_path,
	auto_run = excluded.auto_run,
	phases = excluded.phases,
	current_phase = excluded.current_phase,
	updated_at = excluded.updated_at`

func scanTask(s scanner) (*domain.Task, error) {
	var t domain.Task
	var depsJSON, skillsJSON, docsJSON, filesJSON, criteriaJSON, verifJSON, optionsJSON, phasesJSON string
	var priorityStr, complexityStr, riskStr, statusStr string
	var autoRunInt int
	var claimedAt sql.NullTime

	err := s.Scan(
		&t.ID, &t.ProjectSlug, &t.PlanSlug, &t.Title, &t.Description, &depsJSON,
		&priorityStr, &complexityStr, &riskStr, &t.AgentSlug, &skillsJSON, &docsJSON,
		&filesJSON, &criteriaJSON, &verifJSON,
		&t.WorktreePath, &autoRunInt, &statusStr, &t.ClaimedBy, &claimedAt,
		&t.ClaimSessionID, &t.Notes,
		&t.ReviewReason, &t.ReviewDetails, &optionsJSON,
		&phasesJSON, &t.CurrentPhase, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	t.AutoRun = autoRunInt != 0

	t.Priority = domain.TaskPriority(priorityStr)
	if t.Priority == "" {
		t.Priority = domain.PriorityP2
	}
	t.Complexity = domain.TaskComplexity(complexityStr)
	if t.Complexity == "" {
		t.Complexity = domain.ComplexityMedium
	}
	t.RiskLevel = domain.TaskRisk(riskStr)
	if t.RiskLevel == "" {
		t.RiskLevel = domain.RiskLow
	}
	t.Status = domain.TaskStatus(statusStr)

	if claimedAt.Valid {
		t.ClaimedAt = &claimedAt.Time
	}

	deps, depsCorrupt := decodeStringArray(depsJSON)
	t.Dependencies = deps
	t.DependenciesCorrupt = depsCorrupt
	t.RequiredSkills = unmarshalStrings(skillsJSON)
	t.RequiredDocs = unmarshalStrings(docsJSON)
	t.TargetFiles = unmarshalStrings(filesJSON)
	t.AcceptanceCriteria = unmarshalStrings(criteriaJSON)
	t.VerificationCommands = unmarshalStrings(verifJSON)
	t.ReviewOptions = unmarshalStrings(optionsJSON)

	if phasesJSON != "" && phasesJSON != "[]" {
		var phases []domain.TaskPhase
		if err := json.Unmarshal([]byte(phasesJSON), &phases); err == nil {
			t.Phases = phases
		}
	}
	if t.Phases == nil {
		t.Phases = []domain.TaskPhase{}
	}

	return &t, nil
}

func decodeStringArray(raw string) ([]string, bool) {
	if raw == "" {
		return []string{}, false
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}, true
	}
	if out == nil {
		return []string{}, false
	}
	return out, false
}

func unmarshalStrings(raw string) []string {
	out, _ := decodeStringArray(raw)
	return out
}

// marshalStringList renders a nil slice as `[]` so the column keeps the array
// shape its schema default declares. `json.Marshal(nil)` would write "null".
func marshalStringList(values []string) string {
	if values == nil {
		return "[]"
	}
	raw, err := json.Marshal(values)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

func taskArgs(task *domain.Task) []any {
	depsJSON := marshalStringList(task.Dependencies)
	skillsJSON := marshalStringList(task.RequiredSkills)
	docsJSON := marshalStringList(task.RequiredDocs)
	filesJSON := marshalStringList(task.TargetFiles)
	criteriaJSON := marshalStringList(task.AcceptanceCriteria)
	verifJSON := marshalStringList(task.VerificationCommands)
	optionsJSON := marshalStringList(task.ReviewOptions)

	priority := string(task.Priority)
	if priority == "" {
		priority = string(domain.PriorityP2)
	}
	complexity := string(task.Complexity)
	if complexity == "" {
		complexity = string(domain.ComplexityMedium)
	}
	risk := string(task.RiskLevel)
	if risk == "" {
		risk = string(domain.RiskLow)
	}

	phasesJSON, _ := json.Marshal(task.Phases)
	if task.Phases == nil {
		phasesJSON = []byte("[]")
	}

	autoRunInt := 0
	if task.AutoRun {
		autoRunInt = 1
	}

	return []any{
		task.ID, nullableString(task.ProjectSlug), nullableString(task.PlanSlug),
		task.Title, task.Description, depsJSON, priority, complexity, risk,
		task.AgentSlug, skillsJSON, docsJSON,
		filesJSON, criteriaJSON, verifJSON,
		task.WorktreePath, autoRunInt, string(task.Status),
		task.ClaimedBy, task.ClaimedAt,
		task.ClaimSessionID, task.Notes, task.ReviewReason, task.ReviewDetails,
		optionsJSON, string(phasesJSON), task.CurrentPhase, task.CreatedAt, task.UpdatedAt,
	}
}

func normalizeTaskForWrite(task *domain.Task, now time.Time) {
	if task.CreatedAt.IsZero() {
		task.CreatedAt = now
	}
	task.UpdatedAt = now
	if task.Status == "" {
		task.Status = domain.StatusPending
		if len(task.Dependencies) == 0 {
			task.Status = domain.StatusReady
		}
	}
}

// resolveTaskScopeTx fills project_slug from the plan and verifies that an
// explicit project matches. It is a no-op for project tasks and orphans.
func resolveTaskScopeTx(ctx context.Context, tx *sql.Tx, task *domain.Task) error {
	if task.PlanSlug != "" {
		var planProject string
		err := tx.QueryRowContext(ctx, "SELECT project_slug FROM plans WHERE slug = ?", task.PlanSlug).Scan(&planProject)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: plan %s", ErrNotFound, task.PlanSlug)
		}
		if err != nil {
			return fmt.Errorf("failed to resolve plan %s: %w", task.PlanSlug, err)
		}
		if task.ProjectSlug == "" {
			task.ProjectSlug = planProject
		} else if task.ProjectSlug != planProject {
			return fmt.Errorf("%w: plan %s belongs to project %s, not %s", ErrInvalidGraph, task.PlanSlug, planProject, task.ProjectSlug)
		}
	}
	if task.ProjectSlug != "" {
		if _, err := getProjectTx(ctx, tx, task.ProjectSlug); err != nil {
			return err
		}
	}
	return nil
}

func insertTaskTx(ctx context.Context, tx *sql.Tx, task *domain.Task, now time.Time) error {
	if err := resolveTaskScopeTx(ctx, tx, task); err != nil {
		return err
	}
	normalizeTaskForWrite(task, now)
	if err := task.Validate(); err != nil {
		return err
	}
	if err := assertDependenciesInContainer(ctx, tx, task); err != nil {
		return err
	}

	res, err := tx.ExecContext(ctx, taskInsertQuery, taskArgs(task)...)
	if err != nil {
		return fmt.Errorf("failed to insert task %s: %w", task.ID, err)
	}
	rows, err := affectedOrErr(res, "insert task", task.ID)
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("%w: task %s", ErrAlreadyExists, task.ID)
	}
	return nil
}

func upsertTaskAuthoringTx(ctx context.Context, tx *sql.Tx, task *domain.Task, now time.Time) error {
	if err := resolveTaskScopeTx(ctx, tx, task); err != nil {
		return err
	}
	normalizeTaskForWrite(task, now)
	if err := task.Validate(); err != nil {
		return err
	}
	if err := assertDependenciesInContainer(ctx, tx, task); err != nil {
		return err
	}

	var existingProject, existingPlan string
	err := tx.QueryRowContext(ctx,
		"SELECT COALESCE(project_slug, ''), COALESCE(plan_slug, '') FROM tasks WHERE id = ?", task.ID).
		Scan(&existingProject, &existingPlan)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("failed to inspect task %s: %w", task.ID, err)
	}
	if err == nil && (existingProject != task.ProjectSlug || existingPlan != task.PlanSlug) {
		return fmt.Errorf("%w: task %s belongs to project %q plan %q", ErrInvalidGraph, task.ID, existingProject, existingPlan)
	}

	if _, err := tx.ExecContext(ctx, taskAuthoringUpdateQuery, taskArgs(task)...); err != nil {
		return fmt.Errorf("failed to upsert task %s: %w", task.ID, err)
	}
	return nil
}

func assertDependenciesInContainer(ctx context.Context, tx *sql.Tx, task *domain.Task) error {
	seen := make(map[string]bool, len(task.Dependencies))
	for _, dep := range task.Dependencies {
		if dep == task.ID {
			return fmt.Errorf("%w: task %s depends on itself", ErrInvalidGraph, task.ID)
		}
		if dep == "" {
			return fmt.Errorf("%w: task %s has an empty dependency", ErrInvalidGraph, task.ID)
		}
		if seen[dep] {
			return fmt.Errorf("%w: task %s repeats dependency %s", ErrInvalidGraph, task.ID, dep)
		}
		seen[dep] = true

		var depProject, depPlan string
		err := tx.QueryRowContext(ctx,
			"SELECT COALESCE(project_slug, ''), COALESCE(plan_slug, '') FROM tasks WHERE id = ?", dep).
			Scan(&depProject, &depPlan)
		if errors.Is(err, sql.ErrNoRows) {
			continue // forward reference; validated once the prerequisite exists
		}
		if err != nil {
			return fmt.Errorf("failed to inspect dependency %s: %w", dep, err)
		}
		if depProject != task.ProjectSlug || depPlan != task.PlanSlug {
			return fmt.Errorf("%w: task %s cannot depend on %s from another container", ErrInvalidGraph, task.ID, dep)
		}
	}
	return nil
}

func (r *TaskRepository) GetTask(ctx context.Context, taskID string) (*domain.Task, error) {
	row := r.db.QueryRow(ctx, "SELECT "+taskSelectColumns+" FROM tasks WHERE id = ?", taskID)
	task, err := scanTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: task %s", ErrNotFound, taskID)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query task %s: %w", taskID, err)
	}
	return task, nil
}

func (r *TaskRepository) GetTasksByPlan(ctx context.Context, planSlug string) ([]domain.Task, error) {
	rows, err := r.db.Query(ctx,
		"SELECT "+taskSelectColumns+" FROM tasks WHERE plan_slug = ? ORDER BY id ASC", planSlug)
	if err != nil {
		return nil, fmt.Errorf("failed to query tasks by plan: %w", err)
	}
	defer rows.Close()

	tasks := []domain.Task{}
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan task: %w", err)
		}
		tasks = append(tasks, *task)
	}
	return tasks, rows.Err()
}

func (r *TaskRepository) ListTasks(ctx context.Context, filter domain.TaskFilter) ([]domain.Task, error) {
	query := "SELECT " + taskSelectColumns + " FROM tasks"
	var conditions []string
	var args []any
	if filter.OrphanOnly {
		conditions = append(conditions, "project_slug IS NULL AND plan_slug IS NULL")
	} else {
		if filter.ProjectSlug != "" {
			conditions = append(conditions, "project_slug = ?")
			args = append(args, filter.ProjectSlug)
		}
		if filter.PlanSlug != "" {
			conditions = append(conditions, "plan_slug = ?")
			args = append(args, filter.PlanSlug)
		}
	}
	if filter.Status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, string(filter.Status))
	}
	if filter.AgentSlug != "" {
		conditions = append(conditions, "agent_slug = ?")
		args = append(args, filter.AgentSlug)
	}
	if filter.AutoRun != nil {
		autoRunInt := 0
		if *filter.AutoRun {
			autoRunInt = 1
		}
		conditions = append(conditions, "auto_run = ?")
		args = append(args, autoRunInt)
	}
	if len(conditions) > 0 {
		query += " WHERE " + joinConditions(conditions)
	}
	query += " ORDER BY created_at ASC, id ASC"

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list tasks: %w", err)
	}
	defer rows.Close()

	tasks := []domain.Task{}
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan task: %w", err)
		}
		tasks = append(tasks, *task)
	}
	return tasks, rows.Err()
}

func (r *TaskRepository) CreateTasks(ctx context.Context, tasks []domain.Task) error {
	if len(tasks) == 0 {
		return nil
	}

	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		// Resolve every scope before comparing containers so a plan task with an
		// empty project_slug can still join the rest of its plan.
		for i := range tasks {
			if err := resolveTaskScopeTx(ctx, tx, &tasks[i]); err != nil {
				return err
			}
			if tasks[i].ProjectSlug != tasks[0].ProjectSlug || tasks[i].PlanSlug != tasks[0].PlanSlug {
				return fmt.Errorf("%w: batch spans containers %s and %s", ErrInvalidGraph,
					tasks[0].ContainerKey(), tasks[i].ContainerKey())
			}
			if err := insertTaskTx(ctx, tx, &tasks[i], now); err != nil {
				return err
			}
		}
		if err := validateContainerGraphTx(ctx, tx, tasks[0].ProjectSlug, tasks[0].PlanSlug); err != nil {
			return err
		}
		return resyncContainerStatuses(ctx, tx, tasks[0].ProjectSlug, tasks[0].PlanSlug, tasks, now)
	})
}

func (r *TaskRepository) UpdateTaskMetadata(ctx context.Context, taskID string, patch domain.TaskPatch) error {
	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		task, err := getTaskTx(ctx, tx, taskID)
		if err != nil {
			return err
		}
		// Assignment and execution-mode changes are authoring-time actions. Allowing
		// them while a task runs would retroactively change its gates and skew
		// per-agent concurrency accounting.
		if patch.Title != nil || patch.Description != nil || patch.Dependencies != nil ||
			patch.AgentSlug != nil || patch.AutoRun != nil {
			if task.Status != domain.StatusReady && task.Status != domain.StatusPending {
				return fmt.Errorf("%w: task %s is %s; metadata can only change while READY or PENDING", ErrInvalidState, taskID, task.Status)
			}
		}

		applyTaskPatch(task, patch)
		if err := resolveTaskScopeTx(ctx, tx, task); err != nil {
			return err
		}
		if err := task.Validate(); err != nil {
			return err
		}
		if err := assertDependenciesInContainer(ctx, tx, task); err != nil {
			return err
		}
		if err := updateTaskAuthoringTx(ctx, tx, task, now); err != nil {
			return err
		}
		if err := validateContainerGraphTx(ctx, tx, task.ProjectSlug, task.PlanSlug); err != nil {
			return err
		}
		return resyncContainerStatuses(ctx, tx, task.ProjectSlug, task.PlanSlug, []domain.Task{*task}, now)
	})
}

func applyTaskPatch(task *domain.Task, patch domain.TaskPatch) {
	if patch.Title != nil {
		task.Title = *patch.Title
	}
	if patch.Description != nil {
		task.Description = *patch.Description
	}
	if patch.Dependencies != nil {
		task.Dependencies = *patch.Dependencies
	}
	if patch.Priority != nil {
		task.Priority = *patch.Priority
	}
	if patch.Complexity != nil {
		task.Complexity = *patch.Complexity
	}
	if patch.RiskLevel != nil {
		task.RiskLevel = *patch.RiskLevel
	}
	if patch.AgentSlug != nil {
		task.AgentSlug = *patch.AgentSlug
	}
	if patch.RequiredSkills != nil {
		task.RequiredSkills = *patch.RequiredSkills
	}
	if patch.RequiredDocs != nil {
		task.RequiredDocs = *patch.RequiredDocs
	}
	if patch.TargetFiles != nil {
		task.TargetFiles = *patch.TargetFiles
	}
	if patch.AcceptanceCriteria != nil {
		task.AcceptanceCriteria = *patch.AcceptanceCriteria
	}
	if patch.VerificationCommands != nil {
		task.VerificationCommands = *patch.VerificationCommands
	}
	if patch.WorktreePath != nil {
		task.WorktreePath = *patch.WorktreePath
	}
	if patch.AutoRun != nil {
		task.AutoRun = *patch.AutoRun
	}
	if patch.Phases != nil {
		task.Phases = *patch.Phases
	}
	if patch.CurrentPhase != nil {
		task.CurrentPhase = *patch.CurrentPhase
	}
}

func updateTaskAuthoringTx(ctx context.Context, tx *sql.Tx, task *domain.Task, now time.Time) error {
	task.UpdatedAt = now
	depsJSON := marshalStringList(task.Dependencies)
	skillsJSON := marshalStringList(task.RequiredSkills)
	docsJSON := marshalStringList(task.RequiredDocs)
	filesJSON := marshalStringList(task.TargetFiles)
	criteriaJSON := marshalStringList(task.AcceptanceCriteria)
	verifJSON := marshalStringList(task.VerificationCommands)
	phasesJSON, _ := json.Marshal(task.Phases)
	if task.Phases == nil {
		phasesJSON = []byte("[]")
	}

	autoRunInt := 0
	if task.AutoRun {
		autoRunInt = 1
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE tasks SET
			title = ?, description = ?, dependencies = ?, priority = ?, complexity = ?,
			risk_level = ?, agent_slug = ?, required_skills = ?,
			required_docs = ?, target_files = ?, acceptance_criteria = ?,
			verification_commands = ?, worktree_path = ?, auto_run = ?,
			phases = ?, current_phase = ?, updated_at = ?
		WHERE id = ?`,
		task.Title, task.Description, depsJSON, string(task.Priority), string(task.Complexity),
		string(task.RiskLevel), task.AgentSlug, skillsJSON,
		docsJSON, filesJSON, criteriaJSON, verifJSON,
		task.WorktreePath, autoRunInt, string(phasesJSON), task.CurrentPhase, now, task.ID)
	if err != nil {
		return fmt.Errorf("failed to update task %s: %w", task.ID, err)
	}
	rows, err := affectedOrErr(res, "update task", task.ID)
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("%w: task %s", ErrNotFound, task.ID)
	}
	return nil
}

func getTaskTx(ctx context.Context, tx *sql.Tx, taskID string) (*domain.Task, error) {
	row := tx.QueryRowContext(ctx, "SELECT "+taskSelectColumns+" FROM tasks WHERE id = ?", taskID)
	task, err := scanTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: task %s", ErrNotFound, taskID)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query task %s: %w", taskID, err)
	}
	return task, nil
}

func (r *TaskRepository) UpdateTaskDependencies(ctx context.Context, taskID string, deps []string) error {
	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		task, err := getTaskTx(ctx, tx, taskID)
		if err != nil {
			return err
		}
		if task.Status != domain.StatusReady && task.Status != domain.StatusPending && task.Status != domain.StatusBlocked {
			return fmt.Errorf("%w: task %s is %s; dependencies can only change while READY, PENDING, or BLOCKED", ErrInvalidState, taskID, task.Status)
		}
		task.Dependencies = deps
		if err := assertDependenciesInContainer(ctx, tx, task); err != nil {
			return err
		}

		depsJSON, err := json.Marshal(deps)
		if err != nil {
			return fmt.Errorf("failed to encode dependencies for task %s: %w", taskID, err)
		}
		res, err := tx.ExecContext(ctx, "UPDATE tasks SET dependencies = ?, updated_at = ? WHERE id = ?", string(depsJSON), now, taskID)
		if err != nil {
			return err
		}
		rows, err := affectedOrErr(res, "update task dependencies", taskID)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: task %s", ErrNotFound, taskID)
		}
		if err := validateContainerGraphTx(ctx, tx, task.ProjectSlug, task.PlanSlug); err != nil {
			return err
		}
		return resyncContainerStatuses(ctx, tx, task.ProjectSlug, task.PlanSlug, []domain.Task{*task}, now)
	})
}

func (r *TaskRepository) UpdateTaskNotes(ctx context.Context, taskID string, notes string) error {
	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "UPDATE tasks SET notes = ?, updated_at = ? WHERE id = ?", notes, now, taskID)
		if err != nil {
			return err
		}
		rows, err := affectedOrErr(res, "update task notes", taskID)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: task %s", ErrNotFound, taskID)
		}
		return nil
	})
}

func (r *TaskRepository) AppendTaskNotes(ctx context.Context, taskID string, note string) error {
	if note == "" {
		return nil
	}
	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		return appendTaskNotesTx(ctx, tx, taskID, note, now)
	})
}

func (r *TaskRepository) DeleteTask(ctx context.Context, taskID string) error {
	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		task, err := getTaskTx(ctx, tx, taskID)
		if err != nil {
			return err
		}

		// Prevent deleting tasks currently claimed or running to protect active workers
		if task.Status == domain.StatusRunning {
			return fmt.Errorf("%w: task %s is RUNNING; evict or transition before deletion", ErrInvalidState, taskID)
		}

		// Delete the task record (cascade triggers audit event and cleans up task attachments)
		res, err := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id = ?", taskID)
		if err != nil {
			return fmt.Errorf("failed to delete task %s: %w", taskID, err)
		}
		rows, err := affectedOrErr(res, "delete task", taskID)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: task %s", ErrNotFound, taskID)
		}

		// Clean up references to this deleted task from any dependent tasks in the same container
		where, args := containerClause(task.ProjectSlug, task.PlanSlug)
		depRows, err := tx.QueryContext(ctx, "SELECT id, dependencies FROM tasks WHERE "+where, args...)
		if err != nil {
			return fmt.Errorf("failed to inspect container dependencies: %w", err)
		}
		defer depRows.Close()

		type depUpdate struct {
			id   string
			deps []string
		}
		var updates []depUpdate

		for depRows.Next() {
			var id, depsJSON string
			if err := depRows.Scan(&id, &depsJSON); err != nil {
				return err
			}
			var deps []string
			if depsJSON != "" {
				_ = json.Unmarshal([]byte(depsJSON), &deps)
			}
			newDeps := make([]string, 0, len(deps))
			changed := false
			for _, d := range deps {
				if d == taskID {
					changed = true
				} else {
					newDeps = append(newDeps, d)
				}
			}
			if changed {
				updates = append(updates, depUpdate{id: id, deps: newDeps})
			}
		}
		depRows.Close()

		for _, u := range updates {
			newJSON, _ := json.Marshal(u.deps)
			if _, err := tx.ExecContext(ctx, "UPDATE tasks SET dependencies = ?, updated_at = ? WHERE id = ?", string(newJSON), now, u.id); err != nil {
				return fmt.Errorf("failed to strip deleted dependency %s from task %s: %w", taskID, u.id, err)
			}
		}

		// Validate container DAG and resync statuses of remaining tasks
		if err := validateContainerGraphTx(ctx, tx, task.ProjectSlug, task.PlanSlug); err != nil {
			return err
		}

		remainingTasks, err := loadContainerTaskListTx(ctx, tx, task.ProjectSlug, task.PlanSlug)
		if err != nil {
			return err
		}
		return resyncContainerStatuses(ctx, tx, task.ProjectSlug, task.PlanSlug, remainingTasks, now)
	})
}

func loadContainerTaskListTx(ctx context.Context, tx *sql.Tx, projectSlug, planSlug string) ([]domain.Task, error) {
	where, args := containerClause(projectSlug, planSlug)
	rows, err := tx.QueryContext(ctx, "SELECT "+taskSelectColumns+" FROM tasks WHERE "+where, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to load remaining tasks: %w", err)
	}
	defer rows.Close()

	var tasks []domain.Task
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, *task)
	}
	return tasks, rows.Err()
}

func appendTaskNotesTx(ctx context.Context, tx *sql.Tx, taskID string, note string, now time.Time) error {
	res, err := tx.ExecContext(ctx, `
		UPDATE tasks
		SET notes = CASE WHEN notes = '' THEN ? ELSE notes || char(10) || ? END, updated_at = ?
		WHERE id = ?`, note, note, now, taskID)
	if err != nil {
		return err
	}
	rows, err := affectedOrErr(res, "append task notes", taskID)
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("%w: task %s", ErrNotFound, taskID)
	}
	return nil
}
