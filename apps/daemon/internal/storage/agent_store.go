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

// AgentRepository persists reusable worker definitions. Execution stays with an
// external runner; the daemon stores the definition, goal, and schedule.
type AgentRepository struct {
	db *DB
}

const agentSelectColumns = `
slug, name, soul_key, mode, goal, start_conditions, stop_conditions, schedule,
skills, runner, enabled, created_at, updated_at`

func scanAgent(s scanner) (*domain.Agent, error) {
	var a domain.Agent
	var mode, startJSON, stopJSON, skillsJSON string
	if err := s.Scan(
		&a.Slug, &a.Name, &a.SoulKey, &mode, &a.Goal, &startJSON, &stopJSON,
		&a.Schedule, &skillsJSON, &a.Runner, &a.Enabled,
		&a.CreatedAt, &a.UpdatedAt,
	); err != nil {
		return nil, err
	}
	a.Mode = domain.AgentMode(mode)
	if startJSON != "" && startJSON != "{}" && startJSON != "[]" {
		_ = json.Unmarshal([]byte(startJSON), &a.StartConditions)
	}
	if stopJSON != "" && stopJSON != "{}" && stopJSON != "[]" {
		_ = json.Unmarshal([]byte(stopJSON), &a.StopConditions)
	}
	a.Skills = unmarshalStrings(skillsJSON)
	return &a, nil
}

func agentArgs(agent domain.Agent) ([]any, error) {
	startJSON, err := json.Marshal(agent.StartConditions)
	if err != nil {
		return nil, err
	}
	stopJSON, err := json.Marshal(agent.StopConditions)
	if err != nil {
		return nil, err
	}
	skillsJSON, err := json.Marshal(agent.Skills)
	if err != nil {
		return nil, err
	}
	return []any{
		agent.Slug, agent.Name, agent.SoulKey, string(agent.Mode), agent.Goal,
		string(startJSON), string(stopJSON), agent.Schedule, string(skillsJSON),
		agent.Runner, agent.Enabled, agent.CreatedAt, agent.UpdatedAt,
	}, nil
}

func (r *AgentRepository) CreateAgent(ctx context.Context, agent domain.Agent) error {
	now := time.Now().UTC()
	if agent.CreatedAt.IsZero() {
		agent.CreatedAt = now
	}
	agent.UpdatedAt = now
	if agent.Mode == "" {
		agent.Mode = domain.AgentModeHeadless
	}
	if err := agent.Validate(); err != nil {
		return err
	}
	args, err := agentArgs(agent)
	if err != nil {
		return fmt.Errorf("failed to encode agent %s: %w", agent.Slug, err)
	}

	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO agents (
				slug, name, soul_key, mode, goal, start_conditions, stop_conditions,
				schedule, skills, runner, enabled, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args...)
		if err != nil {
			if isUniqueViolation(err) {
				return fmt.Errorf("%w: agent %s", ErrAlreadyExists, agent.Slug)
			}
			return fmt.Errorf("failed to create agent %s: %w", agent.Slug, err)
		}
		return nil
	})
}

func (r *AgentRepository) GetAgent(ctx context.Context, slug string) (*domain.Agent, error) {
	row := r.db.QueryRow(ctx, "SELECT "+agentSelectColumns+" FROM agents WHERE slug = ?", slug)
	agent, err := scanAgent(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: agent %s", ErrNotFound, slug)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query agent %s: %w", slug, err)
	}
	return agent, nil
}

func (r *AgentRepository) ListAgents(ctx context.Context, includeDisabled bool) ([]domain.Agent, error) {
	query := "SELECT " + agentSelectColumns + " FROM agents"
	if !includeDisabled {
		query += " WHERE enabled = 1"
	}
	query += " ORDER BY slug ASC"

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list agents: %w", err)
	}
	defer rows.Close()

	agents := []domain.Agent{}
	for rows.Next() {
		agent, err := scanAgent(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan agent: %w", err)
		}
		agents = append(agents, *agent)
	}
	return agents, rows.Err()
}

func (r *AgentRepository) UpdateAgent(ctx context.Context, slug string, patch domain.AgentPatch) error {
	now := time.Now().UTC()
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		agent, err := getAgentTx(ctx, tx, slug)
		if err != nil {
			return err
		}
		if patch.Name != nil {
			agent.Name = *patch.Name
		}
		if patch.SoulKey != nil {
			agent.SoulKey = *patch.SoulKey
		}
		if patch.Mode != nil {
			agent.Mode = *patch.Mode
		}
		if patch.Goal != nil {
			agent.Goal = *patch.Goal
		}
		if patch.StartConditions != nil {
			agent.StartConditions = *patch.StartConditions
		}
		if patch.StopConditions != nil {
			agent.StopConditions = *patch.StopConditions
		}
		if patch.Schedule != nil {
			agent.Schedule = *patch.Schedule
		}
		if patch.Skills != nil {
			agent.Skills = *patch.Skills
		}
		if patch.Runner != nil {
			agent.Runner = *patch.Runner
		}
		if patch.Enabled != nil {
			agent.Enabled = *patch.Enabled
		}
		if err := agent.Validate(); err != nil {
			return err
		}
		agent.UpdatedAt = now
		args, err := agentArgs(*agent)
		if err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE agents SET
				name = ?, soul_key = ?, mode = ?, goal = ?, start_conditions = ?,
				stop_conditions = ?, schedule = ?, skills = ?, runner = ?,
				enabled = ?, created_at = ?, updated_at = ?
			WHERE slug = ?`,
			append(args[1:], slug)...)
		if err != nil {
			return fmt.Errorf("failed to update agent %s: %w", slug, err)
		}
		rows, err := affectedOrErr(res, "update agent", slug)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: agent %s", ErrNotFound, slug)
		}
		return nil
	})
}

func getAgentTx(ctx context.Context, tx *sql.Tx, slug string) (*domain.Agent, error) {
	row := tx.QueryRowContext(ctx, "SELECT "+agentSelectColumns+" FROM agents WHERE slug = ?", slug)
	agent, err := scanAgent(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: agent %s", ErrNotFound, slug)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query agent %s: %w", slug, err)
	}
	return agent, nil
}

func (r *AgentRepository) DeleteAgent(ctx context.Context, slug string) error {
	return r.db.ExecImmediate(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "DELETE FROM agents WHERE slug = ?", slug)
		if err != nil {
			return fmt.Errorf("failed to delete agent %s: %w", slug, err)
		}
		rows, err := affectedOrErr(res, "delete agent", slug)
		if err != nil {
			return err
		}
		if rows == 0 {
			return fmt.Errorf("%w: agent %s", ErrNotFound, slug)
		}
		return nil
	})
}
