package runner

import (
	"bytes"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestRunner_HeadlessLifecycle(t *testing.T) {
	r := NewProcessRunner(ModeHeadless, 1024*1024)

	ch, cancel := r.Subscribe()
	defer cancel()

	cmd := exec.Command("bash", "-c", "echo 'headless output'; exit 0")
	if err := r.StartHeadless(cmd); err != nil {
		t.Fatalf("StartHeadless failed: %v", err)
	}

	// Verify input rejection invariant
	_, err := r.WriteInput([]byte("attempt"))
	if err == nil || !strings.Contains(err.Error(), "HEADLESS") {
		t.Fatalf("expected HEADLESS rejection, got err=%v", err)
	}

	// Verify resize rejection invariant
	err = r.Resize(40, 120)
	if err == nil || !strings.Contains(err.Error(), "HEADLESS") {
		t.Fatalf("expected HEADLESS resize rejection, got err=%v", err)
	}

	exitCode, err := r.Wait()
	if err != nil || exitCode != 0 {
		t.Fatalf("expected exit code 0, got %d, err=%v", exitCode, err)
	}

	// Verify ring buffer contains the output
	snap := string(r.Buffer().Snapshot())
	if !strings.Contains(snap, "headless output") {
		t.Fatalf("expected 'headless output' in buffer, got: %s", snap)
	}

	// Verify subscriber received chunks
	select {
	case chunk := <-ch:
		if len(chunk) == 0 {
			t.Fatalf("expected non-empty chunk from subscriber")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("subscriber timeout")
	}
}

func TestRunner_HeadlessExitCodeFailure(t *testing.T) {
	r := NewProcessRunner(ModeHeadless, 1024*1024)
	cmd := exec.Command("bash", "-c", "echo 'failure step'; exit 42")
	if err := r.StartHeadless(cmd); err != nil {
		t.Fatalf("StartHeadless failed: %v", err)
	}

	exitCode, _ := r.Wait()
	if exitCode != 42 {
		t.Fatalf("expected exit code 42, got %d", exitCode)
	}
}

func TestRunner_InteractiveLifecycle(t *testing.T) {
	r := NewProcessRunner(ModeInteractive, 1024*1024)
	cmd := exec.Command("bash", "--norc")

	if err := r.StartInteractive(cmd, 24, 80); err != nil {
		t.Fatalf("StartInteractive failed: %v", err)
	}

	// Test writing input to PTY master
	n, err := r.WriteInput([]byte("echo 'interactive echo test'\n"))
	if err != nil || n == 0 {
		t.Fatalf("WriteInput failed: %v", err)
	}

	// Test resizing PTY master
	if err := r.Resize(40, 120); err != nil {
		t.Fatalf("Resize failed: %v", err)
	}

	// Let the command echo, then exit
	time.Sleep(100 * time.Millisecond)
	_, _ = r.WriteInput([]byte("exit 0\n"))

	exitCode, err := r.Wait()
	if err != nil || exitCode != 0 {
		t.Fatalf("expected exit code 0, got %d err=%v", exitCode, err)
	}

	snap := string(r.Buffer().Snapshot())
	if !strings.Contains(snap, "interactive echo test") {
		t.Fatalf("expected interactive echo in snapshot, got: %s", snap)
	}
}

func TestRunner_AbortProcessGroup(t *testing.T) {
	r := NewProcessRunner(ModeHeadless, 1024)
	cmd := exec.Command("bash", "-c", "sleep 100")
	if err := r.StartHeadless(cmd); err != nil {
		t.Fatalf("StartHeadless failed: %v", err)
	}

	time.Sleep(50 * time.Millisecond)
	if err := r.Abort(); err != nil {
		t.Fatalf("Abort failed: %v", err)
	}

	// Process should exit promptly due to SIGKILL
	select {
	case <-r.Done():
		// Success
	case <-time.After(1 * time.Second):
		t.Fatalf("process did not terminate after abort")
	}

	// Verify child process is dead
	err := syscall.Kill(cmd.Process.Pid, 0)
	if err == nil {
		t.Fatalf("process PID %d is still alive", cmd.Process.Pid)
	}
}

func TestRunner_ModeMismatchGuards(t *testing.T) {
	rHeadless := NewProcessRunner(ModeHeadless, 1024)
	cmd1 := exec.Command("true")
	if err := rHeadless.StartInteractive(cmd1, 24, 80); err == nil {
		t.Fatalf("expected error starting interactive on headless runner")
	}

	rInteractive := NewProcessRunner(ModeInteractive, 1024)
	cmd2 := exec.Command("true")
	if err := rInteractive.StartHeadless(cmd2); err == nil {
		t.Fatalf("expected error starting headless on interactive runner")
	}
}

func TestRunner_BackpressurePauseResume(t *testing.T) {
	r := NewProcessRunner(ModeInteractive, 1024*1024)
	cmd := exec.Command("bash", "-c", "echo 'before pause'; sleep 0.1; echo 'after pause'; exit 0")

	r.SetPaused(true)
	if err := r.StartInteractive(cmd, 24, 80); err != nil {
		t.Fatalf("StartInteractive failed: %v", err)
	}

	// While paused, wait a moment
	time.Sleep(50 * time.Millisecond)
	r.SetPaused(false) // resume

	exitCode, _ := r.Wait()
	if exitCode != 0 {
		t.Fatalf("expected exit code 0, got %d", exitCode)
	}

	snap := string(r.Buffer().Snapshot())
	if !bytes.Contains([]byte(snap), []byte("after pause")) {
		t.Fatalf("expected output after pause/resume, got: %s", snap)
	}
}
