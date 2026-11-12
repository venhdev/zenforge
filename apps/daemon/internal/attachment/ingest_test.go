package attachment_test

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"zenf/internal/attachment"
	"zenf/internal/domain"
)

func TestIngest_CopiesAndClassifiesMedia(t *testing.T) {
	root := t.TempDir()
	t.Setenv(attachment.RootEnv, root)

	content := append([]byte("\x89PNG\r\n\x1a\n"), []byte("fake-image-bytes")...)
	src := filepath.Join(t.TempDir(), "mockup.png")
	if err := os.WriteFile(src, content, 0o644); err != nil {
		t.Fatalf("failed to write source: %v", err)
	}

	artifact, err := attachment.Ingest("T-01", src, "")
	if err != nil {
		t.Fatalf("Ingest failed: %v", err)
	}

	if !strings.HasPrefix(artifact.ID, "art-in-T-01-") {
		t.Errorf("unexpected artifact id %q", artifact.ID)
	}
	if artifact.Role != domain.ArtifactRoleInput {
		t.Errorf("role = %q, want INPUT", artifact.Role)
	}
	if artifact.Type != domain.ArtifactTypeImage {
		t.Errorf("type = %q, want IMAGE", artifact.Type)
	}
	if artifact.Name != "mockup.png" {
		t.Errorf("name = %q, want the source file name", artifact.Name)
	}
	if artifact.ByteSize != int64(len(content)) {
		t.Errorf("byte_size = %d, want %d", artifact.ByteSize, len(content))
	}

	sum := sha256.Sum256(content)
	if artifact.Sha256 != hex.EncodeToString(sum[:]) {
		t.Errorf("sha256 mismatch")
	}

	if !strings.HasPrefix(artifact.FilePath, root) {
		t.Errorf("artifact was not copied under the configured root: %s", artifact.FilePath)
	}
	copied, err := os.ReadFile(artifact.FilePath)
	if err != nil {
		t.Fatalf("copied file is unreadable: %v", err)
	}
	if string(copied) != string(content) {
		t.Errorf("copied bytes differ from source")
	}
}

func TestIngest_RejectsUnsafeTaskID(t *testing.T) {
	t.Setenv(attachment.RootEnv, t.TempDir())

	src := filepath.Join(t.TempDir(), "file.png")
	if err := os.WriteFile(src, []byte("x"), 0o644); err != nil {
		t.Fatalf("failed to write source: %v", err)
	}

	for _, taskID := range []string{"../escape", "a/b", `a\b`, "..", ""} {
		if _, err := attachment.Ingest(taskID, src, ""); err == nil {
			t.Errorf("expected task id %q to be rejected", taskID)
		}
	}
}

func TestIngest_RejectsMissingAndDirectorySources(t *testing.T) {
	t.Setenv(attachment.RootEnv, t.TempDir())

	if _, err := attachment.Ingest("T-01", filepath.Join(t.TempDir(), "nope.png"), ""); err == nil {
		t.Error("expected missing source to be rejected")
	}
	if _, err := attachment.Ingest("T-01", t.TempDir(), ""); err == nil {
		t.Error("expected directory source to be rejected")
	}
}

func TestRemove_ConstrainsToAttachmentRoot(t *testing.T) {
	root := t.TempDir()
	t.Setenv(attachment.RootEnv, root)

	inside := filepath.Join(root, "T-01", "a.png")
	if err := os.MkdirAll(filepath.Dir(inside), 0o755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	if err := os.WriteFile(inside, []byte("x"), 0o644); err != nil {
		t.Fatalf("failed to write file: %v", err)
	}

	if err := attachment.Remove(inside); err != nil {
		t.Fatalf("Remove inside root failed: %v", err)
	}
	if err := attachment.Remove(inside); err != nil {
		t.Fatalf("Remove should be idempotent: %v", err)
	}

	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatalf("failed to write outside file: %v", err)
	}
	if err := attachment.Remove(outside); err == nil {
		t.Fatal("expected Remove outside the root to fail")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Errorf("outside file must be preserved: %v", err)
	}
}

func TestIngest_ContentAddressedDedupe(t *testing.T) {
	root := t.TempDir()
	t.Setenv(attachment.RootEnv, root)

	content := []byte("identical log bytes")
	srcA := filepath.Join(t.TempDir(), "run.log")
	if err := os.WriteFile(srcA, content, 0o644); err != nil {
		t.Fatalf("write srcA: %v", err)
	}
	srcB := filepath.Join(t.TempDir(), "copy.log")
	if err := os.WriteFile(srcB, content, 0o644); err != nil {
		t.Fatalf("write srcB: %v", err)
	}

	first, err := attachment.Ingest("T-DEDUPE", srcA, "")
	if err != nil {
		t.Fatalf("first Ingest failed: %v", err)
	}
	second, err := attachment.Ingest("T-DEDUPE", srcB, "")
	if err != nil {
		t.Fatalf("second Ingest failed: %v", err)
	}

	if first.FilePath != second.FilePath {
		t.Fatalf("expected content-addressed reuse, got %q vs %q", first.FilePath, second.FilePath)
	}
	if filepath.Base(first.FilePath) != first.Sha256+".log" {
		t.Fatalf("expected sha-named file, got %s", filepath.Base(first.FilePath))
	}

	entries, err := os.ReadDir(filepath.Dir(first.FilePath))
	if err != nil {
		t.Fatalf("read attachment dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected exactly one stored file, found %d", len(entries))
	}
}

func TestGC_RemovesUnreferencedAndKeepsReferenced(t *testing.T) {
	root := t.TempDir()
	t.Setenv(attachment.RootEnv, root)

	keepSrc := filepath.Join(t.TempDir(), "keep.log")
	dropSrc := filepath.Join(t.TempDir(), "drop.log")
	if err := os.WriteFile(keepSrc, []byte("keep"), 0o644); err != nil {
		t.Fatalf("write keep: %v", err)
	}
	if err := os.WriteFile(dropSrc, []byte("drop"), 0o644); err != nil {
		t.Fatalf("write drop: %v", err)
	}

	kept, err := attachment.Ingest("T-GC", keepSrc, "")
	if err != nil {
		t.Fatalf("Ingest keep failed: %v", err)
	}
	dropped, err := attachment.Ingest("T-GC", dropSrc, "")
	if err != nil {
		t.Fatalf("Ingest drop failed: %v", err)
	}

	removed, err := attachment.GC(map[string]struct{}{kept.FilePath: {}})
	if err != nil {
		t.Fatalf("GC failed: %v", err)
	}
	if len(removed) != 1 || removed[0] != dropped.FilePath {
		t.Fatalf("expected only %q removed, got %v", dropped.FilePath, removed)
	}
	if _, err := os.Stat(dropped.FilePath); !os.IsNotExist(err) {
		t.Fatalf("expected unreferenced file to be deleted")
	}
	if _, err := os.Stat(kept.FilePath); err != nil {
		t.Fatalf("expected referenced file to survive: %v", err)
	}

	// Removing the last reference prunes the now-empty owner directory.
	if _, err := attachment.GC(nil); err != nil {
		t.Fatalf("second GC failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "T-GC")); !os.IsNotExist(err) {
		t.Fatalf("expected empty owner directory to be pruned")
	}
}

func TestValidateOwnerID_RejectsTraversal(t *testing.T) {
	for _, bad := range []string{"", ".", "..", "a/b", `a\b`} {
		if err := attachment.ValidateOwnerID(bad); err == nil {
			t.Fatalf("expected %q to be rejected", bad)
		}
	}
	if err := attachment.ValidateOwnerID("res_abc123"); err != nil {
		t.Fatalf("expected resource id to be accepted: %v", err)
	}
}
