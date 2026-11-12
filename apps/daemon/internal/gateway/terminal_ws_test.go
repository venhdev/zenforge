package gateway

import (
	"encoding/binary"
	"net/http"
	"os/exec"
	"strings"
	"testing"
	"time"

	"zenf/internal/runner"

	"github.com/gorilla/websocket"
)

func TestTerminalWS_NotFound(t *testing.T) {
	srv, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	_ = srv
	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + "/api/v1/sessions/nonexistent/terminal"

	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("expected dial error for non-existent session, got nil")
	}
	if resp != nil && resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", resp.StatusCode)
	}
}

func TestTerminalWS_HeadlessStreamAndExit(t *testing.T) {
	srv, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	rnr := runner.NewProcessRunner(runner.ModeHeadless, 64*1024)
	if err := srv.RunnerRegistry().Register("sess-hl", rnr); err != nil {
		t.Fatalf("failed to register runner: %v", err)
	}

	cmd := exec.Command("echo", "hello", "zenforge")
	if err := rnr.StartHeadless(cmd); err != nil {
		t.Fatalf("failed to start headless: %v", err)
	}

	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + "/api/v1/sessions/sess-hl/terminal"
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		if resp != nil {
			t.Fatalf("dial failed with status %d: %v", resp.StatusCode, err)
		}
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	var collected string
	var exitCodeReceived = -1

	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if len(msg) == 0 {
				continue
			}
			opcode := msg[0]
			payload := msg[1:]
			switch opcode {
			case OpcodeData:
				collected += string(payload)
			case OpcodeExit:
				if len(payload) > 0 {
					exitCodeReceived = int(payload[0])
				}
				return
			}
		}
	}()

	select {
	case <-doneCh:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for terminal stream to complete")
	}

	if !strings.Contains(collected, "hello zenforge") {
		t.Fatalf("expected 'hello zenforge' in stream output, got: %q", collected)
	}
	if exitCodeReceived != 0 {
		t.Fatalf("expected exit code 0, got %d", exitCodeReceived)
	}
}

func TestTerminalWS_InteractiveInputAndResize(t *testing.T) {
	srv, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	rnr := runner.NewProcessRunner(runner.ModeInteractive, 64*1024)
	if err := srv.RunnerRegistry().Register("sess-it", rnr); err != nil {
		t.Fatalf("failed to register runner: %v", err)
	}

	cmd := exec.Command("sh", "-c", "read line; echo echoed: $line; exit 0")
	if err := rnr.StartInteractive(cmd, 24, 80); err != nil {
		t.Fatalf("failed to start interactive: %v", err)
	}

	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + "/api/v1/sessions/sess-it/terminal"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Send resize frame (cols=80, rows=24)
	resizeFrame := make([]byte, 5)
	resizeFrame[0] = OpcodeResize
	binary.BigEndian.PutUint16(resizeFrame[1:3], 80)
	binary.BigEndian.PutUint16(resizeFrame[3:5], 24)
	if err := conn.WriteMessage(websocket.BinaryMessage, resizeFrame); err != nil {
		t.Fatalf("failed to write resize: %v", err)
	}

	// Send input frame
	inputFrame := append([]byte{OpcodeData}, []byte("zenforge-rocks\n")...)
	if err := conn.WriteMessage(websocket.BinaryMessage, inputFrame); err != nil {
		t.Fatalf("failed to write stdin: %v", err)
	}

	var collected string
	var exitCodeReceived = -1
	doneCh := make(chan struct{})

	go func() {
		defer close(doneCh)
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if len(msg) == 0 {
				continue
			}
			opcode := msg[0]
			payload := msg[1:]
			switch opcode {
			case OpcodeData:
				collected += string(payload)
			case OpcodeExit:
				if len(payload) > 0 {
					exitCodeReceived = int(payload[0])
				}
				return
			}
		}
	}()

	select {
	case <-doneCh:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for interactive response")
	}

	if !strings.Contains(collected, "echoed: zenforge-rocks") {
		t.Fatalf("expected 'echoed: zenforge-rocks' in stream output, got: %q", collected)
	}
	if exitCodeReceived != 0 {
		t.Fatalf("expected exit code 0, got %d", exitCodeReceived)
	}
}

func TestTerminalWS_LateAttachReplay(t *testing.T) {
	srv, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	rnr := runner.NewProcessRunner(runner.ModeHeadless, 64*1024)
	if err := srv.RunnerRegistry().Register("sess-replay", rnr); err != nil {
		t.Fatalf("failed to register runner: %v", err)
	}

	cmd := exec.Command("echo", "historical", "replay", "data")
	if err := rnr.StartHeadless(cmd); err != nil {
		t.Fatalf("failed to start headless: %v", err)
	}

	// Wait for process to fully exit
	select {
	case <-rnr.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("process failed to complete in time")
	}

	// Now attach client after process is already dead
	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + "/api/v1/sessions/sess-replay/terminal"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	var collected string
	var exitCodeReceived = -1

	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if len(msg) == 0 {
				continue
			}
			opcode := msg[0]
			payload := msg[1:]
			switch opcode {
			case OpcodeData:
				collected += string(payload)
			case OpcodeExit:
				if len(payload) > 0 {
					exitCodeReceived = int(payload[0])
				}
				return
			}
		}
	}()

	select {
	case <-doneCh:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for replay and exit")
	}

	if exitCodeReceived != 0 {
		t.Fatalf("expected exit code 0, got %d", exitCodeReceived)
	}
}

func TestTerminalWS_OriginCheck(t *testing.T) {
	srv, baseURL, _, cleanup := setupTestGateway(t)
	defer cleanup()

	rnr := runner.NewProcessRunner(runner.ModeHeadless, 64*1024)
	if err := srv.RunnerRegistry().Register("sess-origin", rnr); err != nil {
		t.Fatalf("failed to register runner: %v", err)
	}

	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + "/api/v1/sessions/sess-origin/terminal"

	// 1. Rejected: foreign origin
	badHeader := http.Header{"Origin": []string{"http://attacker.com"}}
	_, badResp, err := websocket.DefaultDialer.Dial(wsURL, badHeader)
	if err == nil {
		t.Fatal("expected dial error with foreign origin, got nil")
	}
	if badResp != nil && badResp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected status 403 Forbidden for foreign origin, got %d", badResp.StatusCode)
	}

	// 2. Allowed: loopback origin
	goodHeader := http.Header{"Origin": []string{"http://localhost:5173"}}
	conn, goodResp, err := websocket.DefaultDialer.Dial(wsURL, goodHeader)
	if err != nil {
		if goodResp != nil {
			t.Fatalf("dial failed with status %d: %v", goodResp.StatusCode, err)
		}
		t.Fatalf("dial failed with loopback origin: %v", err)
	}
	conn.Close()
}
