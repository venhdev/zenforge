package gateway

import (
	"encoding/binary"
	"net/http"
	"sync"

	"zenf/internal/runner"

	"github.com/gorilla/websocket"
)

// Opcodes for the 1-byte framed binary WebSocket protocol.
const (
	OpcodeData   byte = 0x00 // Stdin / Stdout raw bytes
	OpcodeResize byte = 0x01 // [Cols_Hi, Cols_Lo, Rows_Hi, Rows_Lo]
	OpcodePause  byte = 0x02 // Client backpressure high watermark
	OpcodeResume byte = 0x03 // Client backpressure low watermark
	OpcodePing   byte = 0x04 // Keepalive ping
	OpcodeExit   byte = 0x05 // Process exit code [Code]
)

var terminalUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow cross-origin WebSocket connections from Web Cockpit
	},
}

// handleSessionTerminal handles WebSocket connections for live terminal streaming and control.
func (s *Server) handleSessionTerminal(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	if sessionID == "" {
		writeHttpError(w, "session ID is required", http.StatusBadRequest)
		return
	}

	if s.runnerMgr == nil {
		writeHttpError(w, "runner manager is uninitialized", http.StatusServiceUnavailable)
		return
	}

	rnr, err := s.runnerMgr.Get(sessionID)
	if err != nil {
		writeHttpError(w, "active session not found: "+sessionID, http.StatusNotFound)
		return
	}

	conn, err := terminalUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var writeMu sync.Mutex
	safeWrite := func(msgType int, data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(msgType, data)
	}

	// 1. Replay scrollback from the ring buffer
	snap := rnr.Buffer().Snapshot()
	if len(snap) > 0 {
		frame := append([]byte{OpcodeData}, snap...)
		if err := safeWrite(websocket.BinaryMessage, frame); err != nil {
			return
		}
	}

	// If the runner has already finished, deliver exit code immediately
	select {
	case <-rnr.Done():
		exitFrame := []byte{OpcodeExit, byte(rnr.ExitCode())}
		_ = safeWrite(websocket.BinaryMessage, exitFrame)
		return
	default:
	}

	// 2. Subscribe to live output stream
	ch, cancel := rnr.Subscribe()
	defer cancel()

	stopSignal := make(chan struct{})
	defer close(stopSignal)

	// Pump live output chunks from runner to WebSocket
	go func() {
		for {
			select {
			case chunk, ok := <-ch:
				if !ok {
					return
				}
				frame := append([]byte{OpcodeData}, chunk...)
				if err := safeWrite(websocket.BinaryMessage, frame); err != nil {
					return
				}
			case <-rnr.Done():
				// Drain any pending buffered output chunks before sending exit code
				for {
					select {
					case chunk, ok := <-ch:
						if ok {
							frame := append([]byte{OpcodeData}, chunk...)
							_ = safeWrite(websocket.BinaryMessage, frame)
						}
					default:
						goto exitDelivered
					}
				}
			exitDelivered:
				// Deliver exit code frame
				exitFrame := []byte{OpcodeExit, byte(rnr.ExitCode())}
				_ = safeWrite(websocket.BinaryMessage, exitFrame)
				return
			case <-stopSignal:
				return
			}
		}
	}()

	// 3. Receive frames from WebSocket client
	for {
		msgType, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		if len(msg) == 0 {
			continue
		}

		opcode := msg[0]
		payload := msg[1:]

		switch opcode {
		case OpcodeData:
			// Forward stdin keystrokes (only valid for INTERACTIVE mode)
			if rnr.GetMode() == runner.ModeInteractive {
				_, _ = rnr.WriteInput(payload)
			}
		case OpcodeResize:
			if len(payload) >= 4 && rnr.GetMode() == runner.ModeInteractive {
				cols := binary.BigEndian.Uint16(payload[0:2])
				rows := binary.BigEndian.Uint16(payload[2:4])
				_ = rnr.Resize(rows, cols)
			}
		case OpcodePause:
			if pr, ok := rnr.(*runner.ProcessRunner); ok {
				pr.SetPaused(true)
			}
		case OpcodeResume:
			if pr, ok := rnr.(*runner.ProcessRunner); ok {
				pr.SetPaused(false)
			}
		case OpcodePing:
			_ = safeWrite(websocket.BinaryMessage, []byte{OpcodePing})
		}
		_ = msgType
	}
}
