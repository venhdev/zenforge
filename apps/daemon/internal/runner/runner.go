package runner

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
)

// defaultWaitDelay bounds how long Wait blocks on inherited stdout/stderr pipes
// after the process has exited, so a lingering grandchild cannot hang the reaper.
const defaultWaitDelay = 5 * time.Second

// ExecutionMode defines the immutable execution profile of a runner session.
type ExecutionMode string

const (
	ModeHeadless    ExecutionMode = "HEADLESS"
	ModeInteractive ExecutionMode = "INTERACTIVE"
)

// Runner defines the process execution boundary.
type Runner interface {
	GetMode() ExecutionMode
	StartHeadless(cmd *exec.Cmd) error
	StartInteractive(cmd *exec.Cmd, initialRows, initialCols uint16) error
	WriteInput(data []byte) (int, error)
	Resize(rows, cols uint16) error
	Abort() error
	Wait() (int, error)
	Done() <-chan struct{}
	ExitCode() int
	Buffer() *RingBuffer
	Subscribe() (<-chan []byte, func())
}

// ProcessRunner implements Runner via OS pipes or creack/pty.
type ProcessRunner struct {
	mode            ExecutionMode
	ringBuffer      *RingBuffer
	lineTransformer func(line string) string

	mu       sync.Mutex
	cmd      *exec.Cmd
	ptmx     *os.File
	pgid     int
	exitCode int
	doneChan chan struct{}
	onceDone sync.Once

	subMu       sync.RWMutex
	subscribers map[chan []byte]struct{}

	paused    bool
	aborted   bool
	pauseCond *sync.Cond
}

var _ Runner = (*ProcessRunner)(nil)

// NewProcessRunner allocates a new ProcessRunner in the given mode.
func NewProcessRunner(mode ExecutionMode, bufferSize int) *ProcessRunner {
	pr := &ProcessRunner{
		mode:        mode,
		ringBuffer:  NewRingBuffer(bufferSize),
		doneChan:    make(chan struct{}),
		subscribers: make(map[chan []byte]struct{}),
		exitCode:    -1,
	}
	pr.pauseCond = sync.NewCond(&pr.mu)
	return pr
}

func (pr *ProcessRunner) GetMode() ExecutionMode {
	return pr.mode
}

func (pr *ProcessRunner) Buffer() *RingBuffer {
	return pr.ringBuffer
}

func (pr *ProcessRunner) Done() <-chan struct{} {
	return pr.doneChan
}

func (pr *ProcessRunner) ExitCode() int {
	pr.mu.Lock()
	defer pr.mu.Unlock()
	return pr.exitCode
}

// Subscribe returns a channel that receives live output chunks and an unsubscribe cancel func.
func (pr *ProcessRunner) Subscribe() (<-chan []byte, func()) {
	ch := make(chan []byte, 100)
	pr.subMu.Lock()
	pr.subscribers[ch] = struct{}{}
	pr.subMu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			pr.subMu.Lock()
			delete(pr.subscribers, ch)
			pr.subMu.Unlock()
			close(ch)
		})
	}
	return ch, cancel
}

// emit records a chunk in the scrollback buffer and fans it out to subscribers.
func (pr *ProcessRunner) emit(data []byte) {
	_, _ = pr.ringBuffer.Write(data)
	pr.broadcast(data)
}

func (pr *ProcessRunner) broadcast(data []byte) {
	pr.subMu.RLock()
	defer pr.subMu.RUnlock()

	for ch := range pr.subscribers {
		// Each subscriber gets its own copy: consumers may reuse or mutate chunks.
		chunk := append([]byte(nil), data...)
		select {
		case ch <- chunk:
		default:
			// Non-blocking drop on slow consumer to avoid head-of-line blocking
		}
	}
}

// streamWriter forwards process output into the runner. When transform is set,
// output is buffered into lines and each line passes through the transformer.
type streamWriter struct {
	pr        *ProcessRunner
	transform func(string) string
	line      bool

	mu      sync.Mutex
	pending []byte
}

func (w *streamWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.line {
		w.pr.emit(p)
		return len(p), nil
	}

	w.pending = append(w.pending, p...)
	for {
		idx := bytes.IndexByte(w.pending, '\n')
		if idx < 0 {
			break
		}
		w.emitLine(w.pending[:idx])
		w.pending = w.pending[idx+1:]
	}
	return len(p), nil
}

func (w *streamWriter) emitLine(raw []byte) {
	line := strings.TrimSuffix(string(raw), "\r")
	formatted := w.transform(line)
	if len(formatted) == 0 {
		return
	}
	w.pr.emit([]byte(formatted))
}

// Flush emits any trailing partial line. Safe to call after Wait.
func (w *streamWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if len(w.pending) > 0 {
		w.emitLine(w.pending)
		w.pending = nil
	}
}

// SetLineTransformer sets an optional line-by-line formatting hook for stdout.
func (pr *ProcessRunner) SetLineTransformer(fn func(line string) string) {
	pr.mu.Lock()
	defer pr.mu.Unlock()
	pr.lineTransformer = fn
}

// StartHeadless spawns a process non-interactively. Output is handed to io.Writer
// sinks so that os/exec owns the draining goroutines: Wait returns only after the
// pipes are drained, and WaitDelay bounds a grandchild that inherits them.
func (pr *ProcessRunner) StartHeadless(cmd *exec.Cmd) error {
	if pr.mode != ModeHeadless {
		return fmt.Errorf("runner initialized in %s mode, cannot start headless", pr.mode)
	}

	setProcessGroup(cmd)

	pr.mu.Lock()
	transformer := pr.lineTransformer
	pr.mu.Unlock()

	stdout := &streamWriter{pr: pr}
	if transformer != nil {
		stdout.transform = transformer
		stdout.line = true
	}
	stderr := &streamWriter{pr: pr}
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	if cmd.WaitDelay == 0 {
		cmd.WaitDelay = defaultWaitDelay
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("process start: %w", err)
	}

	pr.mu.Lock()
	pr.cmd = cmd
	pr.pgid = getProcessGroup(cmd)
	pr.mu.Unlock()

	go func() {
		waitErr := cmd.Wait()
		stdout.Flush()
		stderr.Flush()

		pr.mu.Lock()
		if waitErr != nil {
			var exitErr *exec.ExitError
			if errors.As(waitErr, &exitErr) {
				pr.exitCode = exitErr.ExitCode()
			} else if cmd.ProcessState != nil && cmd.ProcessState.ExitCode() >= 0 {
				pr.exitCode = cmd.ProcessState.ExitCode()
			} else {
				pr.exitCode = 1
			}
		} else {
			pr.exitCode = 0
		}
		pr.mu.Unlock()

		pr.onceDone.Do(func() {
			close(pr.doneChan)
		})
	}()

	return nil
}

// StartInteractive spawns a process attached to a virtual PTY master.
func (pr *ProcessRunner) StartInteractive(cmd *exec.Cmd, initialRows, initialCols uint16) error {
	if pr.mode != ModeInteractive {
		return fmt.Errorf("runner initialized in %s mode, cannot start interactive", pr.mode)
	}

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: initialRows, Cols: initialCols})
	if err != nil {
		return fmt.Errorf("pty start: %w", err)
	}

	pr.mu.Lock()
	pr.cmd = cmd
	pr.ptmx = ptmx
	pr.pgid = getProcessGroup(cmd)
	pr.mu.Unlock()

	go func() {
		defer func() {
			pr.mu.Lock()
			if pr.ptmx != nil {
				_ = pr.ptmx.Close()
				pr.ptmx = nil
			}
			pr.mu.Unlock()
		}()

		buf := make([]byte, 2048)
		for {
			pr.mu.Lock()
			for pr.paused && !pr.aborted {
				pr.pauseCond.Wait()
			}
			if pr.aborted {
				pr.mu.Unlock()
				break
			}
			pr.mu.Unlock()

			n, err := ptmx.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				_, _ = pr.ringBuffer.Write(chunk)
				pr.broadcast(chunk)
			}
			if err != nil {
				// Linux returns syscall.EIO when slave exits; treat as clean finish
				break
			}
		}

		waitErr := cmd.Wait()
		pr.mu.Lock()
		if waitErr != nil {
			var exitErr *exec.ExitError
			if errors.As(waitErr, &exitErr) {
				pr.exitCode = exitErr.ExitCode()
			} else {
				pr.exitCode = 1
			}
		} else {
			pr.exitCode = 0
		}
		pr.mu.Unlock()

		pr.onceDone.Do(func() {
			close(pr.doneChan)
		})
	}()

	return nil
}

// WriteInput injects keystrokes into the process stdin if in INTERACTIVE mode.
func (pr *ProcessRunner) WriteInput(data []byte) (int, error) {
	if pr.mode != ModeInteractive {
		return 0, errors.New("cannot write input: runner is in HEADLESS mode")
	}

	pr.mu.Lock()
	ptmx := pr.ptmx
	pr.mu.Unlock()

	if ptmx == nil {
		return 0, errors.New("cannot write input: pty master is not active")
	}

	return ptmx.Write(data)
}

// Resize updates the terminal dimensions and triggers SIGWINCH in INTERACTIVE mode.
func (pr *ProcessRunner) Resize(rows, cols uint16) error {
	if pr.mode != ModeInteractive {
		return errors.New("cannot resize: runner is in HEADLESS mode")
	}

	pr.mu.Lock()
	ptmx := pr.ptmx
	pr.mu.Unlock()

	if ptmx == nil {
		return errors.New("cannot resize: pty master is not active")
	}

	return pty.Setsize(ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

// SetPaused controls backpressure by pausing/resuming PTY reads.
func (pr *ProcessRunner) SetPaused(paused bool) {
	pr.mu.Lock()
	pr.paused = paused
	if !paused {
		pr.pauseCond.Broadcast()
	}
	pr.mu.Unlock()
}

// Abort kills the entire process group cleanly before process reaping.
func (pr *ProcessRunner) Abort() error {
	pr.mu.Lock()
	pgid := pr.pgid
	cmd := pr.cmd
	ptmx := pr.ptmx
	pr.ptmx = nil
	pr.aborted = true
	// Wake any reader parked on the backpressure condition.
	pr.pauseCond.Broadcast()
	pr.mu.Unlock()

	if ptmx != nil {
		_ = ptmx.Close()
	}

	return killProcessGroup(pgid, cmd)
}

// Wait blocks until the process finishes and returns the exit code.
func (pr *ProcessRunner) Wait() (int, error) {
	<-pr.doneChan
	return pr.ExitCode(), nil
}
