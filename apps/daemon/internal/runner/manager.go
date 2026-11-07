package runner

import (
	"errors"
	"fmt"
	"sync"
)

var (
	ErrSessionNotFound     = errors.New("session not found")
	ErrSessionAlreadyExist = errors.New("session already registered")
)

// ManagedSession holds a runner and its terminal state.
type ManagedSession struct {
	SessionID string
	Runner    Runner
}

// Manager coordinates in-memory runner instances across session lifecycles.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*ManagedSession
}

// NewManager creates a thread-safe runner manager.
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*ManagedSession),
	}
}

// Register binds a runner to a session ID.
func (m *Manager) Register(sessionID string, r Runner) error {
	if sessionID == "" {
		return errors.New("session ID cannot be empty")
	}
	if r == nil {
		return errors.New("runner cannot be nil")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[sessionID]; exists {
		return fmt.Errorf("%w: %s", ErrSessionAlreadyExist, sessionID)
	}

	m.sessions[sessionID] = &ManagedSession{
		SessionID: sessionID,
		Runner:    r,
	}
	return nil
}

// Get retrieves a runner by session ID.
func (m *Manager) Get(sessionID string) (Runner, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s, ok := m.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrSessionNotFound, sessionID)
	}
	return s.Runner, nil
}

// Unregister removes a runner from the manager without aborting it.
func (m *Manager) Unregister(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
}

// AbortSession sends an abort signal to the session's process group and unregisters it.
func (m *Manager) AbortSession(sessionID string) error {
	m.mu.RLock()
	s, ok := m.sessions[sessionID]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("%w: %s", ErrSessionNotFound, sessionID)
	}

	err := s.Runner.Abort()
	m.Unregister(sessionID)
	return err
}

// Count returns the number of currently tracked sessions.
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.sessions)
}
