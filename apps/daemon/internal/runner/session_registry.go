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

// DefaultMaxSessions is the default ceiling of sessions retained in memory.
const DefaultMaxSessions = 100

// ManagedSession holds a runner and its terminal state.
type ManagedSession struct {
	SessionID string
	Runner    Runner
}

// SessionRegistry coordinates in-memory runner instances across session lifecycles.
type SessionRegistry struct {
	mu          sync.RWMutex
	maxSessions int
	order       []string
	sessions    map[string]*ManagedSession
}

// NewSessionRegistry creates a thread-safe runner session registry with default capacity.
func NewSessionRegistry() *SessionRegistry {
	return NewSessionRegistryWithLimit(DefaultMaxSessions)
}

// NewSessionRegistryWithLimit creates a session registry with a custom maximum session retention limit.
func NewSessionRegistryWithLimit(max int) *SessionRegistry {
	if max <= 0 {
		max = DefaultMaxSessions
	}
	return &SessionRegistry{
		maxSessions: max,
		order:       make([]string, 0, max),
		sessions:    make(map[string]*ManagedSession),
	}
}

// Register binds a runner to a session ID. If capacity is reached, it evicts the oldest
// completed session to make room while preserving active sessions and recent scrollback.
func (r *SessionRegistry) Register(sessionID string, runner Runner) error {
	if sessionID == "" {
		return errors.New("session ID cannot be empty")
	}
	if runner == nil {
		return errors.New("runner cannot be nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.sessions[sessionID]; exists {
		return fmt.Errorf("%w: %s", ErrSessionAlreadyExist, sessionID)
	}

	if len(r.sessions) >= r.maxSessions {
		r.evictOldestCompletedLocked()
	}

	r.sessions[sessionID] = &ManagedSession{
		SessionID: sessionID,
		Runner:    runner,
	}
	r.order = append(r.order, sessionID)
	return nil
}

// evictOldestCompletedLocked searches for and evicts the oldest completed runner.
func (r *SessionRegistry) evictOldestCompletedLocked() {
	for i, id := range r.order {
		sess, ok := r.sessions[id]
		if !ok {
			continue
		}
		select {
		case <-sess.Runner.Done():
			delete(r.sessions, id)
			r.order = append(r.order[:i], r.order[i+1:]...)
			return
		default:
			// Active runner, preserve
		}
	}
}

// Get retrieves a runner by session ID.
func (r *SessionRegistry) Get(sessionID string) (Runner, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	s, ok := r.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrSessionNotFound, sessionID)
	}
	return s.Runner, nil
}

// Unregister removes a runner from the registry without aborting it.
func (r *SessionRegistry) Unregister(sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, sessionID)
	for i, id := range r.order {
		if id == sessionID {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
}

// AbortSession sends an abort signal to the session's process group and unregisters it.
func (r *SessionRegistry) AbortSession(sessionID string) error {
	r.mu.RLock()
	s, ok := r.sessions[sessionID]
	r.mu.RUnlock()

	if !ok {
		return fmt.Errorf("%w: %s", ErrSessionNotFound, sessionID)
	}

	err := s.Runner.Abort()
	r.Unregister(sessionID)
	return err
}

// Count returns the number of currently tracked sessions.
func (r *SessionRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.sessions)
}
