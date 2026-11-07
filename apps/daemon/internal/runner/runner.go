package runner

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

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
	mode       ExecutionMode
	ringBuffer *RingBuffer

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

	cancel := func() {
		pr.subMu.Lock()
		delete(pr.subscribers, ch)
		pr.subMu.Unlock()
		close(ch)
	}
	return ch, cancel
}

func (pr *ProcessRunner) broadcast(data []byte) {
	pr.subMu.RLock()
	defer pr.subMu.RUnlock()

	for ch := range pr.subscribers {
		select {
		case ch <- data:
		default:
			// Non-blocking drop on slow consumer to avoid head-of-line blocking
		}
	}
}

// StartHeadless spawns a process non-interactively using asynchronous pipes.
func (pr *ProcessRunner) StartHeadless(cmd *exec.Cmd) error {
	if pr.mode != ModeHeadless {
		return fmt.Errorf("runner initialized in %s mode, cannot start headless", pr.mode)
	}

	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("process start: %w", err)
	}

	pr.mu.Lock()
	pr.cmd = cmd
	pr.pgid, _ = syscall.Getpgid(cmd.Process.Pid)
	pr.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)

	pump := func(reader io.Reader) {
		defer wg.Done()
		buf := make([]byte, 2048)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				_, _ = pr.ringBuffer.Write(chunk)
				pr.broadcast(chunk)
			}
			if err != nil {
				break
			}
		}
	}

	go pump(stdout)
	go pump(stderr)

	go func() {
		wg.Wait()
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
	pr.pgid, _ = syscall.Getpgid(cmd.Process.Pid)
	pr.mu.Unlock()

	go func() {
		buf := make([]byte, 2048)
		for {
			pr.mu.Lock()
			for pr.paused {
				pr.pauseCond.Wait()
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

// Abort kills the entire process group (-pgid) cleanly before process reaping.
func (pr *ProcessRunner) Abort() error {
	pr.mu.Lock()
	pgid := pr.pgid
	pr.mu.Unlock()

	if pgid <= 0 {
		return nil
	}

	// 1. Send SIGTERM to process group for graceful shutdown
	_ = syscall.Kill(-pgid, syscall.SIGTERM)

	// 2. Schedule hard SIGKILL after 100ms if still alive
	time.Sleep(100 * time.Millisecond)
	_ = syscall.Kill(-pgid, syscall.SIGKILL)

	return nil
}

// Wait blocks until the process finishes and returns the exit code.
func (pr *ProcessRunner) Wait() (int, error) {
	<-pr.doneChan
	return pr.ExitCode(), nil
}
