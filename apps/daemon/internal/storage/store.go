package storage

import (
	"zenf/internal/domain"
)

// The storage package re-exports the domain sentinels so existing call sites and
// tests keep using storage.Err* while transports can classify by domain.Err*.
var (
	ErrNotFound       = domain.ErrNotFound
	ErrAlreadyExists  = domain.ErrAlreadyExists
	ErrInvalidState   = domain.ErrInvalidState
	ErrConflictStatus = domain.ErrConflictStatus
	ErrInvalidGraph   = domain.ErrInvalidGraph
)

// Store is the storage composition root. Each embedded repository owns one
// aggregate; Store only wires them and promotes their methods for existing
// callers.
type Store struct {
	*ProjectRepository
	*PlanRepository
	*TaskRepository
	*TaskLifecycle
	*ResourceRepository
	*AgentRepository
	*ArtifactRepository
	*EventRepository
	*StateFingerprinter
	*SearchRepository
}

// NewStore creates a Store backed by the SQLite WAL DB.
func NewStore(db *DB) *Store {
	projects := &ProjectRepository{db: db}
	plans := &PlanRepository{db: db}
	tasks := &TaskRepository{db: db}
	resources := &ResourceRepository{db: db}
	agents := &AgentRepository{db: db}
	artifacts := &ArtifactRepository{db: db}

	return &Store{
		ProjectRepository:  projects,
		PlanRepository:     plans,
		TaskRepository:     tasks,
		TaskLifecycle:      &TaskLifecycle{db: db, tasks: tasks, agents: agents},
		ResourceRepository: resources,
		AgentRepository:    agents,
		ArtifactRepository: artifacts,
		EventRepository:    &EventRepository{db: db},
		StateFingerprinter: &StateFingerprinter{db: db},
		SearchRepository:   &SearchRepository{db: db},
	}
}

// SetPacketBuilder configures an optional ContextPacketBuilder on the store.
func (s *Store) SetPacketBuilder(b domain.ContextPacketBuilder) {
	s.TaskLifecycle.SetPacketBuilder(b)
}

var (
	_ domain.ProjectRepository  = (*ProjectRepository)(nil)
	_ domain.PlanRepository     = (*PlanRepository)(nil)
	_ domain.TaskRepository     = (*TaskRepository)(nil)
	_ domain.TaskLifecycle      = (*TaskLifecycle)(nil)
	_ domain.ResourceRepository = (*ResourceRepository)(nil)
	_ domain.AgentRepository    = (*AgentRepository)(nil)
	_ domain.ArtifactRepository = (*ArtifactRepository)(nil)
	_ domain.ArtifactReader     = (*ArtifactRepository)(nil)
	_ domain.ProjectReader      = (*ProjectRepository)(nil)
	_ domain.PlanReader         = (*PlanRepository)(nil)
	_ domain.ResourceReader     = (*ResourceRepository)(nil)
	_ domain.AgentReader        = (*AgentRepository)(nil)
	_ domain.EventRepository    = (*EventRepository)(nil)
	_ domain.StateFingerprinter = (*StateFingerprinter)(nil)
	_ domain.SearchRepository   = (*SearchRepository)(nil)
)
