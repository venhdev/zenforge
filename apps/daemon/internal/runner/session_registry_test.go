package runner

import (
	"os/exec"
	"testing"
)

func TestSessionRegistry_Lifecycle(t *testing.T) {
	reg := NewSessionRegistry()

	if reg.Count() != 0 {
		t.Fatalf("expected 0 sessions, got %d", reg.Count())
	}

	r := NewProcessRunner(ModeHeadless, 1024)
	err := reg.Register("sess-01", r)
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	if reg.Count() != 1 {
		t.Fatalf("expected 1 session, got %d", reg.Count())
	}

	// Double registration rejection
	err = reg.Register("sess-01", r)
	if err == nil {
		t.Fatalf("expected error on duplicate session registration")
	}

	// Retrieval
	retrieved, err := reg.Get("sess-01")
	if err != nil || retrieved == nil {
		t.Fatalf("Get failed: %v", err)
	}

	// Non-existent retrieval
	_, err = reg.Get("non-existent")
	if err == nil {
		t.Fatalf("expected error on missing session")
	}

	// Unregister
	reg.Unregister("sess-01")
	if reg.Count() != 0 {
		t.Fatalf("expected 0 sessions after unregister, got %d", reg.Count())
	}
}

func TestSessionRegistry_AbortSession(t *testing.T) {
	reg := NewSessionRegistry()
	r := NewProcessRunner(ModeHeadless, 1024)

	cmd := exec.Command("bash", "-c", "sleep 100")
	if err := r.StartHeadless(cmd); err != nil {
		t.Fatalf("StartHeadless failed: %v", err)
	}

	_ = reg.Register("sess-to-abort", r)

	if err := reg.AbortSession("sess-to-abort"); err != nil {
		t.Fatalf("AbortSession failed: %v", err)
	}

	if reg.Count() != 0 {
		t.Fatalf("expected 0 sessions after abort, got %d", reg.Count())
	}
}

func TestSessionRegistry_BoundedRetentionEvictsCompleted(t *testing.T) {
	// Registry capped at 2 sessions
	reg := NewSessionRegistryWithLimit(2)

	r1 := NewProcessRunner(ModeHeadless, 1024)
	cmd1 := exec.Command("echo", "done1")
	if err := r1.StartHeadless(cmd1); err != nil {
		t.Fatalf("StartHeadless failed: %v", err)
	}
	_, _ = r1.Wait() // r1 is completed
	if err := reg.Register("sess-01", r1); err != nil {
		t.Fatalf("register sess-01: %v", err)
	}

	r2 := NewProcessRunner(ModeHeadless, 1024)
	cmd2 := exec.Command("bash", "-c", "sleep 100")
	if err := r2.StartHeadless(cmd2); err != nil {
		t.Fatalf("StartHeadless failed: %v", err)
	}
	defer r2.Abort()
	if err := reg.Register("sess-02", r2); err != nil {
		t.Fatalf("register sess-02: %v", err)
	}

	if reg.Count() != 2 {
		t.Fatalf("expected 2 sessions, got %d", reg.Count())
	}

	// Now register a 3rd session -> should evict completed sess-01, but keep active sess-02
	r3 := NewProcessRunner(ModeHeadless, 1024)
	if err := reg.Register("sess-03", r3); err != nil {
		t.Fatalf("register sess-03: %v", err)
	}

	if reg.Count() != 2 {
		t.Fatalf("expected 2 sessions after eviction, got %d", reg.Count())
	}

	// sess-01 should be evicted
	if _, err := reg.Get("sess-01"); err == nil {
		t.Fatalf("expected sess-01 to be evicted")
	}

	// sess-02 and sess-03 should remain
	if _, err := reg.Get("sess-02"); err != nil {
		t.Fatalf("expected sess-02 to remain: %v", err)
	}
	if _, err := reg.Get("sess-03"); err != nil {
		t.Fatalf("expected sess-03 to remain: %v", err)
	}
}
