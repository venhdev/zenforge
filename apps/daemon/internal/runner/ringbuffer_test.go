package runner

import (
	"bytes"
	"fmt"
	"sync"
	"testing"
)

func TestRingBuffer_BasicAppend(t *testing.T) {
	rb := NewRingBuffer(10)
	n, err := rb.Write([]byte("hello"))
	if err != nil || n != 5 {
		t.Fatalf("expected 5 bytes, got n=%d err=%v", n, err)
	}
	if string(rb.Snapshot()) != "hello" {
		t.Fatalf("expected 'hello', got '%s'", string(rb.Snapshot()))
	}
}

func TestRingBuffer_FIFOEviction(t *testing.T) {
	rb := NewRingBuffer(10)
	_, _ = rb.Write([]byte("12345678")) // 8 bytes: "12345678"
	_, _ = rb.Write([]byte("ABCD"))     // 4 bytes: total 12 bytes -> evicts "12", retains "345678ABCD"
	snap := string(rb.Snapshot())
	if snap != "345678ABCD" {
		t.Fatalf("expected '345678ABCD', got '%s'", snap)
	}
	if rb.Len() != 10 {
		t.Fatalf("expected len 10, got %d", rb.Len())
	}
}

func TestRingBuffer_OversizedWrite(t *testing.T) {
	rb := NewRingBuffer(5)
	_, _ = rb.Write([]byte("abcdefghijk")) // 11 bytes into 5-byte buffer
	snap := string(rb.Snapshot())
	if snap != "ghijk" {
		t.Fatalf("expected 'ghijk', got '%s'", snap)
	}
}

func TestRingBuffer_ConcurrentReadWrite(t *testing.T) {
	rb := NewRingBuffer(1024)
	var wg sync.WaitGroup

	// 10 concurrent writers
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_, _ = rb.Write([]byte(fmt.Sprintf("w%d:%d\n", id, j)))
			}
		}(i)
	}

	// 5 concurrent readers
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_ = rb.Snapshot()
			}
		}()
	}

	wg.Wait()
	if rb.Len() == 0 || rb.Len() > 1024 {
		t.Fatalf("expected 0 < len <= 1024, got %d", rb.Len())
	}
}

func TestRingBuffer_Reset(t *testing.T) {
	rb := NewRingBuffer(10)
	_, _ = rb.Write([]byte("hello"))
	rb.Reset()
	if rb.Len() != 0 || len(rb.Snapshot()) != 0 {
		t.Fatalf("expected empty buffer after reset")
	}
}

func TestRingBuffer_EmptyWrite(t *testing.T) {
	rb := NewRingBuffer(10)
	n, err := rb.Write([]byte{})
	if err != nil || n != 0 {
		t.Fatalf("expected 0, nil for empty write")
	}
	if !bytes.Equal(rb.Snapshot(), []byte{}) {
		t.Fatalf("expected empty snapshot")
	}
}

func TestRingBuffer_CapacityPreservedOnOverflow(t *testing.T) {
	rb := NewRingBuffer(16)
	initialCap := cap(rb.buf)
	if initialCap != 16 {
		t.Fatalf("expected initial capacity 16, got %d", initialCap)
	}

	for i := 0; i < 50; i++ {
		_, err := rb.Write([]byte("abcd"))
		if err != nil {
			t.Fatalf("write error: %v", err)
		}
		if cap(rb.buf) != 16 {
			t.Fatalf("capacity degraded on iteration %d: got %d, expected 16", i, cap(rb.buf))
		}
	}
}
