package runner

import (
	"os/exec"
	"testing"
)

func TestManager_Lifecycle(t *testing.T) {
	mgr := NewManager()

	if mgr.Count() != 0 {
		t.Fatalf("expected 0 sessions, got %d", mgr.Count())
	}

	r := NewProcessRunner(ModeHeadless, 1024)
	err := mgr.Register("sess-01", r)
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	if mgr.Count() != 1 {
		t.Fatalf("expected 1 session, got %d", mgr.Count())
	}

	// Double registration rejection
	err = mgr.Register("sess-01", r)
	if err == nil {
		t.Fatalf("expected error on duplicate session registration")
	}

	// Retrieval
	retrieved, err := mgr.Get("sess-01")
	if err != nil || retrieved == nil {
		t.Fatalf("Get failed: %v", err)
	}

	// Non-existent retrieval
	_, err = mgr.Get("non-existent")
	if err == nil {
		t.Fatalf("expected error on missing session")
	}

	// Unregister
	mgr.Unregister("sess-01")
	if mgr.Count() != 0 {
		t.Fatalf("expected 0 sessions after unregister, got %d", mgr.Count())
	}
}

func TestManager_AbortSession(t *testing.T) {
	mgr := NewManager()
	r := NewProcessRunner(ModeHeadless, 1024)

	cmd := exec.Command("bash", "-c", "sleep 100")
	if err := r.StartHeadless(cmd); err != nil {
		t.Fatalf("StartHeadless failed: %v", err)
	}

	_ = mgr.Register("sess-to-abort", r)

	if err := mgr.AbortSession("sess-to-abort"); err != nil {
		t.Fatalf("AbortSession failed: %v", err)
	}

	if mgr.Count() != 0 {
		t.Fatalf("expected 0 sessions after abort, got %d", mgr.Count())
	}
}
