package runner

import (
	"sync"
)

// DefaultRingBufferSize is the default 2 MiB ceiling for in-memory terminal scrollback.
const DefaultRingBufferSize = 2 * 1024 * 1024

// RingBuffer stores a circular byte buffer of the last N bytes of process output.
// It is fully safe for concurrent reads and writes across goroutines.
type RingBuffer struct {
	mu  sync.RWMutex
	buf []byte
	max int
}

// NewRingBuffer allocates a new RingBuffer capped at max bytes.
// If max <= 0, DefaultRingBufferSize is used.
func NewRingBuffer(max int) *RingBuffer {
	if max <= 0 {
		max = DefaultRingBufferSize
	}
	return &RingBuffer{
		max: max,
		buf: make([]byte, 0, max),
	}
}

// Write appends p to the circular buffer, dropping oldest bytes when max is exceeded.
func (r *RingBuffer) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	n := len(p)
	if n >= r.max {
		r.buf = append(r.buf[:0], p[n-r.max:]...)
		return n, nil
	}

	overflow := len(r.buf) + n - r.max
	if overflow > 0 {
		r.buf = r.buf[overflow:]
	}
	r.buf = append(r.buf, p...)
	return n, nil
}

// Snapshot returns a copy of the current buffer contents without blocking writers.
func (r *RingBuffer) Snapshot() []byte {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]byte, len(r.buf))
	copy(out, r.buf)
	return out
}

// Reset clears the buffer while retaining allocated capacity.
func (r *RingBuffer) Reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf = r.buf[:0]
}

// Len returns the current number of bytes in the buffer.
func (r *RingBuffer) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.buf)
}
